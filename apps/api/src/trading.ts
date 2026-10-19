import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { current } from './auth.js'
import type { FastifyInstance } from 'fastify'
import type { Pool, PoolClient } from 'pg'

export const isTradingIngest = (method: string, url: string) => method === 'POST' && url.split('?')[0] === '/api/trading/reports' && !url.includes('?')
function decimalString(value:string|number):string {
  if(typeof value==='string') return value
  const text=String(value)
  if(!text.includes('e')) return text
  const [coefficient,exponent]=text.split('e')
  const negative=coefficient.startsWith('-')
  const unsigned=negative?coefficient.slice(1):coefficient
  const digits=unsigned.replace('.','')
  const point=(unsigned.split('.')[0].length)+Number(exponent)
  return (negative?'-':'')+(point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point))
}
export const decimalInput = z.union([z.string(), z.number().finite()]).transform(decimalString).pipe(z.string().regex(/^-?\d{1,18}(\.\d{1,12})?$/))
const s = z.string().max(2000).optional()
const d = decimalInput.optional()
const timestamp = z.string().datetime({ offset: true })
const time = timestamp.optional()
// Bound traversal before Zod JSON validation recurses. Count object keys and array entries.
const extra = z.unknown().superRefine((value,ctx)=>{
  const stack=[{value,depth:0}]
  let members=0
  while(stack.length) {
    const item=stack.pop()!
    if(item.value===null || typeof item.value!=="object") continue
    if(item.depth>=20) { ctx.addIssue({code:"custom",message:"extra must not exceed 20 container levels"});return }
    const values=Object.values(item.value)
    members+=values.length
    if(members>10000) { ctx.addIssue({code:"custom",message:"extra must not exceed 10000 total members"});return }
    for(const value of values) stack.push({value,depth:item.depth+1})
  }
}).pipe(z.record(z.string(), z.json())).optional()
export const reportedAtWindowMessage = "reportedAt must be within the last 7 days and not more than 10 minutes in the future"

export const botSlug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/)
const position = z.object({symbol:s,market:s,outcome:s,side:z.enum(['long','short','yes','no']).optional(),size:d,entryPrice:d,markPrice:d,marketValue:d,unrealizedPnl:d,leverage:d,liquidationPrice:d}).strict()
const trade = z.object({externalId:z.string().min(1).max(2000).optional(),symbol:s,market:s,side:z.enum(['buy','sell']).optional(),qty:d,price:d,fee:d,realizedPnl:d,executedAt:time}).strict()
const order = z.object({externalId:s,symbol:s,market:s,outcome:s,side:s,type:s,qty:d,price:d,status:s}).strict()
const flow = z.object({externalId:z.string().min(1).max(2000).optional(),type:z.enum(['deposit','withdrawal']).optional(),amount:d,currency:s,occurredAt:time,note:z.string().max(10000).optional()}).strict()
export const reportInput = z.object({
  schemaVersion:z.literal(1).optional().default(1), reportId:z.string().min(1).max(100), reportedAt:timestamp.describe(reportedAtWindowMessage),
  bot:s,
  account:z.object({platform:s,label:s,currency:s}).strict().optional(),
  balances:z.object({equity:d,balance:d,cash:d,buyingPower:d,dayPnl:d,unrealizedPnl:d,realizedPnlTotal:d}).strict().optional(),
  strategyNotes:z.string().max(10000).optional(),riskFlags:z.array(z.object({level:z.enum(['info','warn','critical']),message:z.string().max(2000)}).strict()).max(50).optional(),
  positions:z.array(position).max(500).optional(),trades:z.array(trade).max(1000).optional(),orders:z.array(order).max(500).optional(),cashFlows:z.array(flow).max(200).optional(),extra
}).strict()

// pg returns NUMERIC as strings; no float parser or JS arithmetic is used for money.
const camel = (row:Record<string,unknown>):Record<string,unknown> => Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),v instanceof Date?v.toISOString():v]))
const botColumns = 'id, display_name, platform, key_prefix, active, created_at, revoked_at, last_report_at'
const reportColumns = 'id, reported_at, received_at, platform, account_label, currency, equity, day_pnl, realized_pnl_total, strategy_notes, risk_flags'
const latest = '(SELECT DISTINCT ON (bot_id) * FROM trading_reports ORDER BY bot_id, reported_at DESC, received_at DESC, id DESC)'
const column = (name:string) => name.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())
async function insert(client:PoolClient, table:string, data:Record<string,unknown>, conflict='') {
  const entries=Object.entries(data).filter(([,v])=>v!==undefined)
  return client.query(`INSERT INTO ${table} (${entries.map(([k])=>column(k)).join(',')}) VALUES (${entries.map((_,i)=>'$'+(i+1)).join(',')}) ${conflict} RETURNING id`,entries.map(([,v])=>v))
}

// Bounded rolling windows. IP failures are counted separately from authenticated bot traffic.
class Windows {
  private entries = new Map<string,{count:number;expires:number}>()
  constructor(private max:number, private duration:number) {}
  hit(key:string) {
    const now=Date.now()
    for(const [k,v] of this.entries) if(v.expires<=now) this.entries.delete(k)
    const previous=this.entries.get(key)
    const value=previous ?? {count:0,expires:now+this.duration}
    if(!previous && this.entries.size>=10000) this.entries.delete(this.entries.keys().next().value!)
    value.count++; this.entries.set(key,value); return value.count>this.max
  }
}
export function registerTrading(app:FastifyInstance, pool:Pool) {
  app.register(async app => {
  // Guard the matched route, not attacker-controlled raw URL spelling. The parent
  // prefix/session + exact raw-URL CSRF guards remain an additional boundary.
  app.addHook("onRequest",async(request,reply)=>{
    reply.header("Cache-Control","no-store")
    if(!isTradingIngest(request.method,request.routeOptions.url??"") && !current(request.cookies?.session))
      return reply.code(401).send({error:"Sign in required."})
  })
  const payloadSizes=new WeakMap<object,number>()
  const parseJson=app.getDefaultJsonParser('error','error')
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json',{parseAs:'string',bodyLimit:256*1024},(request,body,done)=>{
    payloadSizes.set(request,Buffer.byteLength(body))
    parseJson(request,String(body),done)
  })
  const failures=new Windows(30,600000)
  // Bot windows live in PostgreSQL under the bot row lock: consistent across workers/restarts.
  app.post('/api/trading/reports',{bodyLimit:256*1024},async(request,reply)=>{
    const unauthorized=()=>reply.code(failures.hit(request.ip)?429:401).send({error:'Unauthorized.'})
    const auth=request.headers.authorization
    const match=auth?.match(/^Bearer ([^\s]+)$/)
    if(!match || match[1].length>4096) { return unauthorized() }
    const hash=createHash('sha256').update(match[1]).digest('hex')
    const client=await pool.connect()
    try {
      await client.query('BEGIN')
      const bot=(await client.query('SELECT * FROM trading_bots WHERE key_hash=$1 AND active AND revoked_at IS NULL FOR UPDATE',[hash])).rows[0]
      if(!bot || !timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(bot.key_hash,'hex'))) {
        await client.query('ROLLBACK');return unauthorized()
      }
      const count=await client.query('SELECT count(*)::int AS count FROM trading_ingest_attempts WHERE bot_id=$1 AND attempted_at > now() - interval \'10 minutes\'',[bot.id])
      if(count.rows[0].count>=60) { await client.query('ROLLBACK');return reply.code(429).send({error:'Report rate limit exceeded.'}) }
      await client.query('DELETE FROM trading_ingest_attempts WHERE bot_id=$1 AND attempted_at <= now() - interval \'10 minutes\'',[bot.id])
      await client.query('INSERT INTO trading_ingest_attempts(bot_id) VALUES($1)',[bot.id])
      // No sensitive schema values are ever returned or logged.
      const parsed=reportInput.safeParse(request.body)
      if(!parsed.success) { await client.query('COMMIT');return reply.code(400).send({error:'Invalid trading report.',issues:parsed.error.issues.slice(0,20).map(issue=>({path:issue.path.join('.'),code:issue.code}))}) }
      const data=parsed.data
      if(data.bot!==undefined && data.bot!==bot.id) {
        await client.query('COMMIT');return reply.code(403).send({error:'Bot identity mismatch.'})
      }
      const delta=Date.parse(data.reportedAt)-Date.now()
      if(delta < -7*86400000 || delta>600000) { await client.query('COMMIT');return reply.code(400).send({error:'Invalid trading report.',message:reportedAtWindowMessage,issues:[{path:'reportedAt',code:'custom'}]}) }
      const {positions=[],trades=[],orders=[],cashFlows=[],bot:ignoredBot,extra:ignoredExtra,schemaVersion:ignoredVersion,account,balances,...fields}=data
      const result=await insert(client,'trading_reports',{
        botId:bot.id,...fields,...balances,platform:account?.platform??bot.platform,accountLabel:account?.label,currency:account?.currency,riskFlags:JSON.stringify(data.riskFlags??[]),
        raw:JSON.stringify(request.body),payloadBytes:payloadSizes.get(request)??Buffer.byteLength(JSON.stringify(request.body))
      },'ON CONFLICT (bot_id,report_id) DO NOTHING')
      if(!result.rowCount) { await client.query('COMMIT');return reply.code(200).send({duplicate:true}) }
      const reportId=result.rows[0].id
      for(const item of positions) await insert(client,'trading_positions',{reportId,...item})
      for(const item of orders) await insert(client,'trading_orders',{reportId,...item})
      for(const item of trades) await insert(client,'trading_trades',{botId:bot.id,reportId,...item},'ON CONFLICT (bot_id,external_id) DO NOTHING')
      for(const item of cashFlows) await insert(client,'trading_cash_flows',{botId:bot.id,reportId,...item},'ON CONFLICT (bot_id,external_id) DO NOTHING')
      await client.query('UPDATE trading_bots SET last_report_at=GREATEST(last_report_at,$2::timestamptz) WHERE id=$1',[bot.id,data.reportedAt])
      await client.query('COMMIT')
      return reply.code(201).send({duplicate:false})
    } catch {
      await client.query('ROLLBACK').catch(()=>undefined)
      return reply.code(500).send({error:'Trading operation failed.'})
    } finally {client.release()}
  })

  const queryInput=z.object({bot:z.string().min(1).max(2000).optional(),platform:z.string().min(1).max(2000).optional(),range:z.enum(['7d','30d','90d','all']).optional(),from:timestamp.optional(),to:timestamp.optional()}).strict().refine(q=>!q.from||!q.to||Date.parse(q.from)<=Date.parse(q.to))
  type Query=z.infer<typeof queryInput>
  function filters(q:Query, timeColumn:string, history=false) {
    const values:unknown[]=[];const terms:string[]=[]
    const add=(sql:string,value:unknown)=>{values.push(value);terms.push(sql.replace('?',`$${values.length}`))}
    if(q.bot) { values.push(q.bot);terms.push(`b.id=$1`) }
    if(q.platform) add('b.platform=?',q.platform)
    if(q.from) add(`${timeColumn}>=?::timestamptz`,q.from)
    if(q.to) add(`${timeColumn}<=?::timestamptz`,q.to)
    if(history && (q.range??'30d')!=='all') add(`${timeColumn}>=now()-(?::int * interval '1 day')`,parseInt(q.range??'30d',10))
    return {sql:terms.length?' WHERE '+terms.join(' AND '):'',values}
  }
  app.get('/api/trading/overview',async(request,reply)=>{
    const q=queryInput.safeParse(request.query);if(!q.success)return reply.code(400).send({error:'Invalid trading query.'})
    const f=filters(q.data,'r.reported_at')
    const bots=(await pool.query(`SELECT ${botColumns.split(', ').map(c=>'b.'+c).join(', ')} FROM trading_bots b${filters({...q.data,from:undefined,to:undefined},'').sql} ORDER BY b.display_name`,filters({...q.data,from:undefined,to:undefined},'').values)).rows
    const rawMinutes=Number(process.env.TRADING_STALE_AFTER_MINUTES??120)
    const minutes=Number.isFinite(rawMinutes)&&rawMinutes>=1&&rawMinutes<=525600?rawMinutes:120
    const reports=(await pool.query(`SELECT r.bot_id, ${reportColumns.split(', ').map(c=>'r.'+c).join(', ')}, (SELECT count(*)::int FROM trading_positions p WHERE p.report_id=r.id) AS positions_count FROM ${latest} r JOIN trading_bots b ON b.id=r.bot_id${f.sql}`,f.values)).rows
    const totals=(await pool.query(`SELECT r.currency, CASE WHEN count(r.equity)=count(*) THEN sum(r.equity)::text ELSE NULL END AS equity, CASE WHEN count(r.day_pnl)=count(*) THEN sum(r.day_pnl)::text ELSE NULL END AS day_pnl, CASE WHEN count(r.realized_pnl_total)=count(*) THEN sum(r.realized_pnl_total)::text ELSE NULL END AS realized_pnl_total FROM ${latest} r JOIN trading_bots b ON b.id=r.bot_id${f.sql}${f.sql?' AND':' WHERE'} r.currency ~ '[^[:space:]]' GROUP BY r.currency ORDER BY r.currency`,f.values)).rows.map(camel)
    return {bots:bots.map(b=>{
      const found=reports.find(r=>r.bot_id===b.id)
      const age=found?(Date.now()-new Date(found.reported_at).getTime())/60000:Infinity
      const {bot_id:ignore,positions_count:count,...report}=found??{}
      const {created_at:ignoreCreated,revoked_at:ignoreRevoked,...metadata}=b
      return {...camel(metadata),report:found?camel(report):null,positionsCount:count??0,freshness:!found?'never':age>1440?'critical':age>minutes?'stale':'fresh'}
    }),totals,staleAfterMinutes:minutes}
  })
  app.get('/api/trading/bots',async(request,reply)=>{
    const q=queryInput.safeParse(request.query);if(!q.success)return reply.code(400).send({error:'Invalid trading query.'})
    const f=filters({...q.data,from:undefined,to:undefined},'')
    return (await pool.query(`SELECT ${botColumns.split(', ').map(c=>'b.'+c).join(', ')} FROM trading_bots b${f.sql} ORDER BY b.display_name`,f.values)).rows.map(camel)
  })
  // Filtering and flat rows use registered bot platform; reports/raw retain the reporter's platform.
  app.get('/api/trading/history',async(request,reply)=>{
    const q=queryInput.safeParse(request.query);if(!q.success)return reply.code(400).send({error:'Invalid trading query.'})
    const f=filters(q.data,'r.reported_at',true)
    return (await pool.query(`SELECT r.bot_id,b.platform AS platform,r.reported_at,r.currency,r.equity,r.day_pnl,r.realized_pnl_total FROM trading_reports r JOIN trading_bots b ON b.id=r.bot_id${f.sql} ORDER BY r.reported_at,r.id`,f.values)).rows.map(camel)
  })
  for(const [route,table,isLatest,timeColumn] of [
    ['positions','trading_positions',true,'r.reported_at'],['orders','trading_orders',true,'r.reported_at'],
    ['trades','trading_trades',false,'x.executed_at'],['cash-flows','trading_cash_flows',false,'x.occurred_at']
  ] as const) app.get(`/api/trading/${route}`,async(request,reply)=>{
    const q=queryInput.safeParse(request.query);if(!q.success)return reply.code(400).send({error:'Invalid trading query.'})
    const f=filters(q.data,timeColumn)
    return (await pool.query(`SELECT x.*,r.bot_id,b.platform AS platform,${route==='cash-flows'?'COALESCE(x.currency,r.currency)':'r.currency'} AS currency,r.reported_at FROM ${table} x JOIN ${isLatest?latest:'trading_reports'} r ON r.id=x.report_id JOIN trading_bots b ON b.id=r.bot_id${f.sql} ORDER BY ${timeColumn} DESC NULLS LAST,x.id`,f.values)).rows.map(camel)
  })
  app.post('/api/trading/bots/:id/revoke',async(request,reply)=>{
    const id=botSlug.safeParse((request.params as {id:string}).id)
    if(!id.success)return reply.code(400).send({error:'Invalid bot identifier.'})
    const result=await pool.query('UPDATE trading_bots SET active=false,revoked_at=now() WHERE id=$1 RETURNING id',[id.data])
    if(!result.rowCount)return reply.code(404).send({error:'Bot not found.'})
    return {revoked:true}
  })
  })
}
