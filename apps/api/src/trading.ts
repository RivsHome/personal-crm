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
const latest = '(SELECT DISTINCT ON (bot_id) * FROM trading_reports ORDER BY bot_id, reported_at DESC, received_at DESC, id DESC)'
const column = (name:string) => name.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())
async function insert(client:PoolClient, table:string, data:Record<string,unknown>, conflict='') {
  const entries=Object.entries(data).filter(([,v])=>v!==undefined)
  return client.query(`INSERT INTO ${table} (${entries.map(([k])=>column(k)).join(',')}) VALUES (${entries.map((_,i)=>'$'+(i+1)).join(',')}) ${conflict} RETURNING id`,entries.map(([,v])=>v))
}

type LedgerChange = {botId:string;ledger:string;entryId:string;changedFields:string[]}
// The ingest transaction already holds this bot's row lock, serializing ledger
// corrections across workers. Compare in PostgreSQL so NUMERIC/timestamps retain
// their exact semantics; omitted fields are not corrections. Keep the original
// report link (fallback effective time/currency) when updating an existing entry.
async function insertLedger(client:PoolClient, table:'trading_trades'|'trading_cash_flows', botId:string, reportId:string, item:Record<string,unknown>):Promise<LedgerChange|undefined> {
  const {externalId,...fields}=item
  if(externalId!==undefined) {
    const entries=Object.entries(fields).filter(([,v])=>v!==undefined)
    const comparisons=entries.map(([k],i)=>`CASE WHEN ${column(k)} IS DISTINCT FROM $${i+3} THEN '${k}' END`)
    const existing=(await client.query(`SELECT id,array_remove(ARRAY[${comparisons.join(',')}]::text[],NULL) AS changed_fields FROM ${table} WHERE bot_id=$1 AND external_id=$2`,[botId,externalId,...entries.map(([,v])=>v)])).rows[0]
    if(existing) {
      if(!existing.changed_fields.length)return
      await client.query(`UPDATE ${table} SET ${entries.map(([k],i)=>`${column(k)}=$${i+2}`).join(',')} WHERE id=$1`,[existing.id,...entries.map(([,v])=>v)])
      return {botId,ledger:table,entryId:existing.id,changedFields:existing.changed_fields}
    }
  }
  await insert(client,table,{botId,reportId,...item},'ON CONFLICT (bot_id,external_id) DO NOTHING')
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
      const changes:LedgerChange[]=[]
      for(const [table,items] of [['trading_trades',trades],['trading_cash_flows',cashFlows]] as const) {
        for(const item of items) {
          const change=await insertLedger(client,table,bot.id,reportId,item)
          if(change)changes.push(change)
        }
      }
      await client.query('UPDATE trading_bots SET last_report_at=GREATEST(last_report_at,$2::timestamptz) WHERE id=$1',[bot.id,data.reportedAt])
      await client.query('COMMIT')
      // Never log credentials, payload values, external IDs or uncommitted changes.
      for(const change of changes)request.log.info(change,'Trading ledger entry corrected.')
      return reply.code(201).send({duplicate:false})
    } catch {
      await client.query('ROLLBACK').catch(()=>undefined)
      return reply.code(500).send({error:'Trading operation failed.'})
    } finally {client.release()}
  })

  for(const route of ["overview","bots","history","positions","trades","orders","cash-flows"]) app.get(`/api/trading/${route}`,async(request,reply)=>{
    const q=queryInput.safeParse(request.query)
    if(!q.success)return reply.code(400).send({error:"Invalid trading query."})
    return readTrading(pool,route,q.data)
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

// All monetary arithmetic is PostgreSQL NUMERIC. Historical snapshots use only
// ledger entries effective at that snapshot; receipt time is solely freshness.
const metrics = (history=false) => `WITH measured AS (
 SELECT r.*,
 COALESCE(r.equity,0) AS measured_equity,
 COALESCE(r.unrealized_pnl,(SELECT sum(p.unrealized_pnl) FROM trading_positions p WHERE p.report_id=r.id),0) AS measured_unrealized,
 COALESCE(r.realized_pnl_total,(SELECT sum(t.realized_pnl) FROM trading_trades t JOIN trading_reports tr ON tr.id=t.report_id WHERE t.bot_id=r.bot_id ${history?"AND COALESCE(t.executed_at,tr.reported_at)<=r.reported_at":""}),0) AS measured_realized,
 EXISTS(SELECT 1 FROM trading_cash_flows c JOIN trading_reports cr ON cr.id=c.report_id WHERE c.bot_id=r.bot_id ${history?"AND COALESCE(c.occurred_at,cr.reported_at)<=r.reported_at":""}) AS has_flows,
 COALESCE((SELECT sum(CASE c.type WHEN $$withdrawal$$ THEN -c.amount WHEN $$deposit$$ THEN c.amount ELSE 0 END) FROM trading_cash_flows c JOIN trading_reports cr ON cr.id=c.report_id WHERE c.bot_id=r.bot_id ${history?"AND COALESCE(c.occurred_at,cr.reported_at)<=r.reported_at":""}),0) AS net_deposits,
 baseline.id AS baseline_id,baseline.reported_at AS baseline_at,COALESCE(baseline.equity,0) AS baseline_equity
 FROM ${history?"trading_reports":latest} r
 LEFT JOIN LATERAL (
 SELECT id,reported_at,equity FROM (
  (SELECT br.id,br.reported_at,br.equity,0 AS priority FROM trading_reports br
   WHERE br.bot_id=r.bot_id AND br.reported_at<=r.reported_at
   AND (br.reported_at<r.reported_at OR (br.received_at,br.id)<=(r.received_at,r.id))
   AND br.reported_at < ((now() AT TIME ZONE $$America/New_York$$)::date AT TIME ZONE $$America/New_York$$)
   ORDER BY br.reported_at DESC,br.received_at DESC,br.id DESC LIMIT 1)
  UNION ALL
  (SELECT br.id,br.reported_at,br.equity,1 AS priority FROM trading_reports br
   WHERE br.bot_id=r.bot_id AND br.reported_at<=r.reported_at
   AND (br.reported_at<r.reported_at OR (br.received_at,br.id)<=(r.received_at,r.id))
   AND br.reported_at >= ((now() AT TIME ZONE $$America/New_York$$)::date AT TIME ZONE $$America/New_York$$)
   ORDER BY br.reported_at ASC,br.received_at DESC,br.id DESC LIMIT 1)
 ) candidates ORDER BY priority LIMIT 1
 ) baseline ON true
), calculated AS (
 SELECT m.*,
 CASE WHEN has_flows THEN measured_equity-net_deposits ELSE measured_realized+measured_unrealized END AS total_pnl,
 COALESCE(day_pnl,CASE WHEN baseline_id=id OR baseline_id IS NULL THEN 0 ELSE measured_equity-baseline_equity-COALESCE((SELECT sum(CASE c.type WHEN $$withdrawal$$ THEN -c.amount WHEN $$deposit$$ THEN c.amount ELSE 0 END) FROM trading_cash_flows c JOIN trading_reports cr ON cr.id=c.report_id WHERE c.bot_id=m.bot_id AND COALESCE(c.occurred_at,cr.reported_at)>m.baseline_at AND COALESCE(c.occurred_at,cr.reported_at)<=m.reported_at),0) END) AS today_pnl
 FROM measured m
), enriched AS (
 SELECT c.*,json_build_object(
 $$equity$$,CASE WHEN equity IS NULL THEN $$computed$$ ELSE $$reported$$ END,
 $$unrealizedPnl$$,CASE WHEN unrealized_pnl IS NULL THEN $$computed$$ ELSE $$reported$$ END,
 $$realizedPnl$$,CASE WHEN realized_pnl_total IS NULL THEN $$computed$$ ELSE $$reported$$ END,
 $$todayPnl$$,CASE WHEN day_pnl IS NULL THEN $$computed$$ ELSE $$reported$$ END,
 $$totalPnl$$,$$computed$$,$$netDeposits$$,$$computed$$) AS pnl_basis FROM calculated c
)`
const metricColumns = `r.measured_equity AS equity,r.measured_unrealized AS unrealized_pnl,r.measured_realized AS realized_pnl,r.measured_realized AS realized_pnl_total,r.today_pnl,r.today_pnl AS day_pnl,r.total_pnl,r.net_deposits,r.pnl_basis`
export async function readTrading(pool:Pick<Pool,"query">,route:string,q:Query={}) {
 if(route==="overview") {
  const f=filters(q,"r.reported_at")
  const bf=filters({...q,from:undefined,to:undefined},"")
  const bots=(await pool.query(`SELECT ${botColumns.split(", ").map(c=>"b."+c).join(", ")} FROM trading_bots b${bf.sql} ORDER BY b.display_name`,bf.values)).rows
  const rawMinutes=Number(process.env.TRADING_STALE_AFTER_MINUTES??120)
  const minutes=Number.isFinite(rawMinutes)&&rawMinutes>=1&&rawMinutes<=525600?rawMinutes:120
  const base=`${metrics()} SELECT r.bot_id,r.id,r.reported_at,r.received_at,r.platform,r.account_label,r.currency,r.strategy_notes,r.risk_flags,${metricColumns},(SELECT count(*)::int FROM trading_positions p WHERE p.report_id=r.id) AS positions_count FROM (SELECT DISTINCT ON(bot_id) * FROM enriched ORDER BY bot_id,reported_at DESC,received_at DESC,id DESC) r JOIN trading_bots b ON b.id=r.bot_id${f.sql}`
  const reports=(await pool.query(base,f.values)).rows
  const totals=(await pool.query(`SELECT currency,sum(equity)::text AS equity,sum(unrealized_pnl)::text AS unrealized_pnl,sum(realized_pnl)::text AS realized_pnl,sum(realized_pnl)::text AS realized_pnl_total,sum(today_pnl)::text AS today_pnl,sum(today_pnl)::text AS day_pnl,sum(total_pnl)::text AS total_pnl,sum(net_deposits)::text AS net_deposits FROM (${base}) totals WHERE currency ~ $$[^[:space:]]$$ GROUP BY currency ORDER BY currency`,f.values)).rows.map(camel)
  return {bots:bots.map(b=>{
   const found=reports.find(r=>r.bot_id===b.id)
   const age=found?(Date.now()-new Date(found.received_at).getTime())/60000:Infinity
   const {bot_id:ignore,positions_count:count,...report}=found??{}
   const {created_at:ignoreCreated,revoked_at:ignoreRevoked,...metadata}=b
   return {...camel(metadata),report:found?camel(report):null,positionsCount:count??0,freshness:!found?"never":age>1440?"critical":age>minutes?"stale":"fresh"}
  }),totals,staleAfterMinutes:minutes}
 }
 if(route==="bots") {
  const f=filters({...q,from:undefined,to:undefined},"")
  return (await pool.query(`SELECT ${botColumns.split(", ").map(c=>"b."+c).join(", ")} FROM trading_bots b${f.sql} ORDER BY b.display_name`,f.values)).rows.map(camel)
 }
 if(route==="history") {
  const f=filters(q,"r.reported_at",true)
  return (await pool.query(`${metrics(true)} SELECT r.bot_id,b.platform,r.reported_at,r.received_at,r.currency,${metricColumns} FROM enriched r JOIN trading_bots b ON b.id=r.bot_id${f.sql} ORDER BY r.reported_at,r.received_at,r.id`,f.values)).rows.map(camel)
 }
 const spec={positions:["trading_positions",true,"r.reported_at"],orders:["trading_orders",true,"r.reported_at"],trades:["trading_trades",false,"x.executed_at"],"cash-flows":["trading_cash_flows",false,"x.occurred_at"]}[route]
 if(!spec) throw new Error("Invalid trading read route.")
 const [table,isLatest,timeColumn]=spec as [string,boolean,string]
 const f=filters(q,timeColumn)
 return (await pool.query(`SELECT x.*,r.bot_id,b.platform,${route==="cash-flows"?"COALESCE(x.currency,r.currency)":"r.currency"} AS currency,r.reported_at FROM ${table} x JOIN ${isLatest?latest:"trading_reports"} r ON r.id=x.report_id JOIN trading_bots b ON b.id=r.bot_id${f.sql} ORDER BY ${timeColumn} DESC NULLS LAST,x.id`,f.values)).rows.map(camel)
}
