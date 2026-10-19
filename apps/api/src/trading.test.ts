import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { reportInput, decimalInput, isTradingIngest, registerTrading } from './trading.js'
import { runKeys } from './scripts/trading-keys.js'

test('approved nested v1 schema, not the obsolete flat shape', () => {
  const base={reportId:'nested',reportedAt:new Date().toISOString()}
  assert.equal(reportInput.safeParse({...base,account:{platform:'test',label:'Synthetic',currency:'USD'},balances:{equity:'1'},positions:[{side:'yes'}],trades:[{side:'buy'}],orders:[{}],cashFlows:[{type:'deposit',note:'x'.repeat(10000)}],riskFlags:[{level:'warn',message:'Synthetic'}]}).success,true)
  assert.equal(reportInput.safeParse({...base,equity:'1'}).success,false)
})

test('nested v1 field, enum, string, array, decimal and timestamp boundaries', () => {
  const base={reportId:'r',reportedAt:'2026-10-19T03:00:00+02:00'}
  const valid=(value:object)=>assert.equal(reportInput.safeParse({...base,...value}).success,true,JSON.stringify(value).slice(0,140))
  const invalid=(value:object)=>assert.equal(reportInput.safeParse({...base,...value}).success,false,JSON.stringify(value).slice(0,140))
  assert.equal(reportInput.parse(base).schemaVersion,1)
  valid({account:{},balances:{},bot:'synthetic',extra:{nested:{arbitrary:[true,null,1]}}})
  for(const side of ['long','short','yes','no']) valid({positions:[{side}]})
  for(const side of ['buy','sell']) valid({trades:[{side}]})
  for(const type of ['deposit','withdrawal']) valid({cashFlows:[{type}]})
  for(const level of ['info','warn','critical']) valid({riskFlags:[{level,message:'x'.repeat(2000)}]})
  for(const [name,max] of [['positions',500],['trades',1000],['orders',500],['cashFlows',200],['riskFlags',50]] as const) {
    const item=name==='riskFlags'?{level:'info',message:'test'}:{}
    valid({[name]:Array(max).fill(item)});invalid({[name]:Array(max+1).fill(item)})
  }
  valid({account:{platform:'x'.repeat(2000),label:'x'.repeat(2000),currency:'x'.repeat(2000)},strategyNotes:'x'.repeat(10000),cashFlows:[{note:'x'.repeat(10000)}]})
  for(const field of ['equity','balance','cash','buyingPower','dayPnl','unrealizedPnl','realizedPnlTotal']) {
    valid({balances:{[field]:'-999999999999999999.999999999999'}})
    invalid({balances:{[field]:'1e3'}})
  }
  for(const value of [{schemaVersion:2},{schemaVersion:'1'},{reportId:''},{reportId:'x'.repeat(101)},{reportedAt:'2026-10-19T03:00:00'},
    {platform:'test'},{currency:'USD'},{equity:'1'},{botId:'synthetic'},{accountLabel:'x'},
    {account:{extra:{}}},{balances:{unknown:'1'}},{positions:[{extra:{}}]},{trades:[{extra:{}}]},{orders:[{extra:{}}]},{cashFlows:[{extra:{}}]},
    {positions:[{side:'buy'}]},{trades:[{side:'long'}]},{cashFlows:[{type:'transfer'}]},
    {riskFlags:['warn']},{riskFlags:[{level:'bad',message:'x'}]},{riskFlags:[{level:'info'}]},{riskFlags:[{level:'warn',message:'x',extra:{}}]},
    {riskFlags:[{level:'info',message:'x'.repeat(2001)}]},{account:{label:'x'.repeat(2001)}},{positions:[{symbol:'x'.repeat(2001)}]},
    {strategyNotes:'x'.repeat(10001)},{cashFlows:[{note:'x'.repeat(10001)}]},{trades:[{executedAt:'2026-10-19T03:00:00'}]},{cashFlows:[{occurredAt:'2026-10-19T03:00:00'}]}]) invalid(value)
  valid({trades:[{executedAt:base.reportedAt}],cashFlows:[{occurredAt:'2026-10-19T01:00:00Z'}]})
})

test('strict decimal and exact exemption boundaries', () => {
  for (const value of ['999999999999999999.999999999999', '-0.000000000001', 12.5, 0, 1e-12, -1e-7]) assert.equal(decimalInput.safeParse(value).success, true)
  for (const value of ['1e3', '1000000000000000000', '0.0000000000001', Infinity, NaN, 1e30]) assert.equal(decimalInput.safeParse(value).success, false)
  assert.equal(isTradingIngest('POST', '/api/trading/reports'), true)
  for (const [method, url] of [['GET','/api/trading/reports'],['POST','/api/trading/reports?x=1'],['POST','/api/trading/reports/x']]) assert.equal(isTradingIngest(method,url), false)
  for (const method of ['GET','HEAD','PUT','PATCH','DELETE','OPTIONS']) assert.equal(isTradingIngest(method,'/api/trading/reports'),false)
  assert.equal(reportInput.safeParse({reportId:'r',reportedAt:new Date().toISOString(),positions:[{surprise:true}]}).success,false)
})

test('trading integration against isolated PostgreSQL', { skip: !process.env.TRADING_TEST_DATABASE_URL }, async t => {
  const originalCwd = process.cwd()
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
  const temporary = await mkdtemp(path.join(tmpdir(), 'crm-trading-'))
  process.env.DATABASE_URL = process.env.TRADING_TEST_DATABASE_URL
  process.chdir(temporary)
  const { app } = await import('./server.js')
  const { pool } = await import('./db.js')
  const { register, login } = await import('./auth.js')
  t.after(async () => { await app.close(); await pool.end(); process.chdir(originalCwd); await rm(temporary,{recursive:true,force:true}) })
  const migrations = path.join(root,'apps/api/migrations')
  for (let pass=0;pass<2;pass++) for (const f of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort()) await pool.query(await readFile(path.join(migrations,f),'utf8'))
  await pool.query('TRUNCATE trading_bots CASCADE')
  const key = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(key).digest('hex')
  const bodyMarker = randomBytes(24).toString('base64url')
  let logs = ''
  const originalWrite = process.stdout.write
  process.stdout.write = function(this:NodeJS.WriteStream, chunk:any, ...args:any[]) { logs += String(chunk);return (originalWrite as any).call(this,chunk,...args) } as typeof originalWrite
  t.after(async()=>{await new Promise(resolve=>setImmediate(resolve));process.stdout.write=originalWrite;assert.equal(logs.includes(key),false);assert.equal(logs.includes(hash),false);assert.equal(logs.includes(bodyMarker),false)})
  const headers = {authorization:`Bearer ${key}`}
  let output = ''
  const io = { read:async()=>hash, write:(s:string)=>{output+=s} }
  await runKeys(['register','synthetic','Synthetic','test','--prefix','test'],pool,io)
  const bot = (await pool.query('SELECT id FROM trading_bots WHERE id=$1',['synthetic'])).rows[0]
  const password = randomBytes(20).toString('hex')
  await register('synthetic@example.invalid','Synthetic',password)
  const session = await login('synthetic@example.invalid',password)
  const csrf = randomBytes(16).toString('hex')
  const sessionHeaders = {cookie:`session=${session!.token}; csrf=${csrf}`,'x-csrf-token':csrf}
  const payload = (id = randomBytes(8).toString('hex')) => ({reportId:id,reportedAt:new Date().toISOString(),account:{platform:'test',label:'Synthetic',currency:'USD'},balances:{equity:'1.000000000001'},positions:[{symbol:'SYN',side:'long',size:'2'}],trades:[{externalId:'external',side:'buy',qty:'1'}],orders:[{status:'open'}],cashFlows:[{externalId:'cash',type:'deposit',amount:'1'}],riskFlags:[{level:'warn',message:'Synthetic warning'}]})
  const post = (body:unknown, h:Record<string,string> = headers, url='/api/trading/reports') => app.inject({method:'POST',url,headers:h,payload:body as any})
  await t.test('authentication, exact CSRF bypass, and session boundary',async()=>{
    for (const h of [{},{authorization:`Bearer ${randomBytes(20).toString('hex')}`},sessionHeaders] as Record<string,string>[]) assert.equal((await post(payload(),h)).statusCode,401)
    for (const url of ['/api/trading/reports/x','/api/trading/reports?x=1',`/api/trading/bots/${bot.id}/revoke`,'/api/tasks']) assert.equal((await post(payload(),{},url)).statusCode,403)
    assert.equal(bot.id,'synthetic')
    assert.equal((await post({...payload(),bot:randomBytes(8).toString('hex')})).statusCode,403)
    assert.equal((await post({...payload(),botId:bot.id})).statusCode,400)
    assert.equal((await post({...payload(),bot:bot.id})).statusCode,201)
    assert.equal((await post(payload(),{...headers,cookie:`csrf=${csrf}`,'x-csrf-token':csrf},'/api/trading/reports?x=1')).statusCode,401)
    for (const url of ['overview','history','positions','trades','orders','cash-flows','bots']) {
      assert.equal((await app.inject({url:`/api/trading/${url}`})).statusCode,401)
      assert.equal((await app.inject({url:`/api/trading/${url}`,headers:{cookie:`session=${session!.token}`}})).statusCode,200)
      assert.equal((await app.inject({url:`/api/trading/${url}`,headers})).statusCode,401)
    }
  })
  await t.test('HTTP method matrix preserves CSRF and session boundaries without ingest',async()=>{
    const before=(await pool.query('SELECT count(*) FROM trading_reports')).rows[0].count
    const attempts=(await pool.query('SELECT count(*) FROM trading_ingest_attempts')).rows[0].count
    const csrfOnly={...headers,cookie:`csrf=${csrf}`,'x-csrf-token':csrf}
    for (const method of ['GET','HEAD'] as const) {
      for (const h of [{},headers]) assert.equal((await app.inject({method,url:'/api/trading/reports',headers:h})).statusCode,401)
    }
    for (const method of ['PUT','PATCH','DELETE'] as const) {
      for (const h of [{},headers]) assert.equal((await app.inject({method,url:'/api/trading/reports',headers:h,payload:payload()})).statusCode,403)
      assert.equal((await app.inject({method,url:'/api/trading/reports',headers:csrfOnly,payload:payload()})).statusCode,401)
    }
    assert.equal((await app.inject({method:'GET',url:'/api/tasks',headers})).statusCode,401)
    assert.equal((await post(payload(),csrfOnly,'/api/tasks')).statusCode,401)
    assert.equal((await post(payload(),csrfOnly,'/api/trading/reports?x=1')).statusCode,401)
    const invalidPreflight=await app.inject({method:'OPTIONS',url:'/api/trading/reports',headers})
    assert.equal(invalidPreflight.statusCode,400)
    const preflight=await app.inject({method:'OPTIONS',url:'/api/trading/reports',headers:{origin:'http://localhost:5173','access-control-request-method':'POST'}})
    assert.equal(preflight.statusCode,204)
    assert.equal((await pool.query('SELECT count(*) FROM trading_reports')).rows[0].count,before)
    assert.equal((await pool.query('SELECT count(*) FROM trading_ingest_attempts')).rows[0].count,attempts)
  })
  await t.test('registered platform is canonical across filtered history and detail reads',async()=>{
    const platformKey=randomBytes(32).toString('base64url')
    await runKeys(['register','platform-review','Platform Review','paper'],pool,{...io,read:async()=>createHash('sha256').update(platformKey).digest('hex')})
    try {
      const body={...payload('platform-review'),account:{platform:'other',currency:'USD'}}
      assert.equal((await post(body,{authorization:`Bearer ${platformKey}`})).statusCode,201)
      for (const route of ['history','positions','trades','orders','cash-flows']) {
        const response=await app.inject({url:`/api/trading/${route}?bot=platform-review&platform=paper&range=all`,headers:sessionHeaders})
        assert.equal(response.statusCode,200)
        assert.equal(response.json().length,1,route)
        assert.equal(response.json()[0].platform,'paper',route)
        assert.deepEqual((await app.inject({url:`/api/trading/${route}?bot=platform-review&platform=other&range=all`,headers:sessionHeaders})).json(),[])
      }
      const overview=(await app.inject({url:'/api/trading/overview?bot=platform-review&platform=paper',headers:sessionHeaders})).json()
      assert.equal(overview.bots[0].platform,'paper');assert.equal(overview.bots[0].report.platform,'other')
      assert.equal((await app.inject({url:'/api/trading/overview?bot=platform-review&platform=other',headers:sessionHeaders})).json().bots.length,0)
      const stored=(await pool.query('SELECT platform,raw FROM trading_reports WHERE bot_id=$1',['platform-review'])).rows[0]
      assert.equal(stored.platform,'other');assert.equal(stored.raw.account.platform,'other')
    } finally {await runKeys(['delete','platform-review','--with-data'],pool,io)}
  })
  await t.test('overview excludes unknown denominations and never silently sums partial metrics',async()=>{
    const ids:string[]=[]
    try {
      for (const [i,currency,balances] of [
        [0,'USD',{equity:'10',dayPnl:'1',realizedPnlTotal:'2'}],
        [1,'USD',{dayPnl:'2'}],
        [2,undefined,{equity:'100'}],[3,undefined,{equity:'200'}],
        [4,'',{equity:'300'}],[5,'  \t\n',{equity:'400'}],
      ] as const) {
        const id=`totals-review-${i}`;ids.push(id)
        const value=randomBytes(32).toString('base64url')
        await runKeys(['register',id,id,'totals-review'],pool,{...io,read:async()=>createHash('sha256').update(value).digest('hex')})
        assert.equal((await post({reportId:id,reportedAt:new Date().toISOString(),account:{currency},balances},{authorization:`Bearer ${value}`})).statusCode,201)
      }
      const overview=(await app.inject({url:'/api/trading/overview?platform=totals-review',headers:sessionHeaders})).json()
      assert.equal(overview.bots.length,6)
      assert.deepEqual(overview.totals,[{currency:'USD',equity:null,dayPnl:'3.000000000000',realizedPnlTotal:null}])
      assert.equal(overview.bots.find((b:any)=>b.id==='totals-review-2').report.equity,'100.000000000000')
      const unknown=(await app.inject({url:'/api/trading/overview?bot=totals-review-2',headers:sessionHeaders})).json()
      assert.deepEqual(unknown.totals,[]);assert.equal(unknown.bots[0].report.currency,null)
    } finally {for(const id of ids) await runKeys(['delete',id,'--with-data'],pool,io)}
  })
  await t.test('validation rejects unsafe payloads without echo',async()=>{
    for (const body of [{...payload(),equity:'1'},{...payload(),balances:{equity:'1e99'}},{...payload(),riskFlags:['warn']},{...payload(),unknown:bodyMarker},{...payload(),positions:Array(501).fill({})},{...payload(),reportedAt:'2026-01-01T00:00:00'},{...payload(),trades:[{unknown:'x'}]}]) {
      const r = await post(body); assert.equal(r.statusCode,400); assert.deepEqual(Object.keys(r.json()).sort(),['error','issues']); assert.ok(r.json().issues.length<=20); for(const issue of r.json().issues) assert.deepEqual(Object.keys(issue).sort(),['code','path'])
    }
    assert.equal((await post({...payload(),extra:{padding:'x'.repeat(262144)}})).statusCode,413)
  })
  await t.test('reported time and UTF-8 body byte boundaries, explicit offsets',async()=>{
    const boundaryKey=randomBytes(32).toString('base64url')
    await runKeys(['register','boundaries','Boundaries','test'],pool,{...io,read:async()=>createHash('sha256').update(boundaryKey).digest('hex')})
    const h={authorization:`Bearer ${boundaryKey}`}
    const now=Date.now()
    const clock=t.mock.method(Date,'now',()=>now)
    try {
      for(const [delta,status] of [[-7*86400000,201],[-7*86400000-1,400],[600000,201],[600001,400]]) {
        assert.equal((await post({reportId:String(delta),reportedAt:new Date(now+delta).toISOString()},h)).statusCode,status)
      }
      const offset=new Date(now).toISOString().replace('Z','+00:00')
      const body={reportId:'byte-boundary',reportedAt:offset,extra:{padding:''}}
      body.extra.padding='é'.repeat(100)+'x'.repeat(256*1024-Buffer.byteLength(JSON.stringify(body))-Buffer.byteLength('é'.repeat(100)))
      const wire=JSON.stringify(body)
      assert.equal(Buffer.byteLength(wire),256*1024)
      assert.equal((await post(wire,{...h,'content-type':'application/json'})).statusCode,201)
      assert.equal((await post(wire+' ',{...h,'content-type':'application/json'})).statusCode,413)
      const stored=(await pool.query('SELECT payload_bytes,raw FROM trading_reports WHERE bot_id=$1 AND report_id=$2',['boundaries',body.reportId])).rows[0]
      assert.equal(stored.payload_bytes,256*1024);assert.deepEqual(stored.raw,body)
    } finally { clock.mock.restore();await runKeys(['delete','boundaries','--with-data'],pool,io) }
  })
  await t.test('transactional ingest, replays, concurrency, decimal reads, latest by reported time',async()=>{
    const body=payload('first')
    const wire=JSON.stringify(body,null,2)
    assert.equal((await post(wire,{...headers,'content-type':'application/json'})).statusCode,201)
    const stored=(await pool.query('SELECT raw,payload_bytes FROM trading_reports WHERE report_id=$1',['first'])).rows[0]
    assert.deepEqual(stored.raw,body)
    assert.equal(stored.payload_bytes,Buffer.byteLength(wire))
    assert.deepEqual((await post(body)).json(),{duplicate:true})
    const concurrent=await Promise.all([post(payload('concurrent')),post(payload('concurrent'))])
    assert.deepEqual(concurrent.map(r=>r.statusCode).sort(),[200,201])
    assert.equal((await post({...payload('older'),reportedAt:new Date(Date.now()-3600000).toISOString(),balances:{equity:'900'},positions:[],trades:[{},{}],cashFlows:[]})).statusCode,201)
    const last=(await pool.query('SELECT last_report_at FROM trading_bots WHERE id=$1',[bot.id])).rows[0].last_report_at
    const newest=(await pool.query('SELECT max(reported_at) AS newest FROM trading_reports WHERE bot_id=$1',[bot.id])).rows[0].newest
    assert.equal(last.toISOString(),newest.toISOString())
    assert.equal((await pool.query('SELECT count(*) FROM trading_trades')).rows[0].count,'3')
    assert.equal((await pool.query('SELECT count(*) FROM trading_cash_flows')).rows[0].count,'1')
    const overview=(await app.inject({url:'/api/trading/overview',headers:sessionHeaders})).json()
    assert.equal(overview.bots[0].report.equity,'1.000000000001')
    assert.equal(overview.totals[0].equity,'1.000000000001')
    assert.equal(overview.bots[0].positionsCount,1)
    assert.equal(overview.bots[0].id,'synthetic')
    assert.deepEqual(Object.keys(overview).sort(),['bots','staleAfterMinutes','totals'])
    assert.deepEqual(Object.keys(overview.bots[0]).sort(),['active','displayName','freshness','id','keyPrefix','lastReportAt','platform','positionsCount','report'])
    assert.deepEqual(Object.keys(overview.bots[0].report).sort(),['accountLabel','currency','dayPnl','equity','id','platform','realizedPnlTotal','receivedAt','reportedAt','riskFlags','strategyNotes'])
    assert.equal(overview.bots[0].report.accountLabel,'Synthetic')
    assert.deepEqual(overview.bots[0].report.riskFlags,body.riskFlags)
    assert.equal(JSON.stringify(overview).includes(hash),false)
    assert.equal((await app.inject({url:'/api/trading/history?range=bad',headers:sessionHeaders})).statusCode,400)
    const before=(await pool.query('SELECT count(*) FROM trading_reports')).rows[0].count
    await pool.query(`CREATE FUNCTION trading_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$; CREATE TRIGGER test_fail BEFORE INSERT ON trading_positions FOR EACH ROW EXECUTE FUNCTION trading_test_fail()`)
    try { assert.equal((await post(payload('rollback'))).statusCode,500) } finally { await pool.query('DROP TRIGGER test_fail ON trading_positions; DROP FUNCTION trading_test_fail()') }
    assert.equal((await pool.query('SELECT count(*) FROM trading_reports')).rows[0].count,before)
  })
  await t.test('populated read contracts, filters, currency isolation and freshness',async()=>{
    const secondKey=randomBytes(32).toString('base64url')
    await runKeys(['register','second','Second','test'],pool,{...io,read:async()=>createHash('sha256').update(secondKey).digest('hex')})
    const second=(await pool.query('SELECT id FROM trading_bots WHERE id=$1',['second'])).rows[0]
    const when=new Date().toISOString()
    const body={reportId:'snapshot',reportedAt:when,account:{currency:'EUR'},balances:{equity:'999999999999999999.999999999999',dayPnl:1e-12,realizedPnlTotal:'-1.5'},extra:{synthetic:bodyMarker},
      positions:[{symbol:'SYN',side:'long',size:'1',markPrice:12.5}],orders:[{externalId:'order',symbol:'SYN',qty:'3',status:'open'}],
      trades:[{externalId:'external',symbol:'SYN',qty:'4',executedAt:when}],cashFlows:[{externalId:'cash',type:'deposit',amount:'4',currency:'GBP',occurredAt:when}]}
    assert.equal((await post(body,{authorization:`Bearer ${secondKey}`})).statusCode,201)
    const get=async(route:string)=>(await app.inject({url:'/api/trading/'+route,headers:sessionHeaders})).json()
    for(const route of ['positions','orders','trades','cash-flows']) {
      const rows=await get(`${route}?bot=second&platform=test`)
      assert.equal(rows.length,1);assert.equal(rows[0].botId,second.id);assert.equal(rows[0].platform,'test');assert.equal(rows[0].currency,route==='cash-flows'?'GBP':'EUR')
      assert.equal(rows[0][route==='positions'?'size':'qty']??rows[0].amount,route==='positions'?'1.000000000000':route==='orders'?'3.000000000000':'4.000000000000')
    }
    const overview=await get('overview')
    assert.deepEqual(overview.totals.map((r:any)=>r.currency),['EUR','USD'])
    assert.equal(overview.totals[0].equity,body.balances.equity)
    assert.equal(overview.totals[0].dayPnl,'0.000000000001')
    const history=await get('history?bot=second&range=all')
    assert.equal(history.length,1);assert.equal(history[0].botId,'second');assert.equal(history[0].platform,'test');assert.equal(history[0].currency,'EUR')
    assert.equal((await get('trades?bot=second&from='+encodeURIComponent(new Date(Date.now()+3600000).toISOString()))).length,0)
    assert.equal((await get('positions?bot=missing')).length,0)
    await runKeys(['register','never','Never','test'],pool,{...io,read:async()=>createHash('sha256').update(randomBytes(32)).digest('hex')})
    assert.equal((await get('overview?bot=never')).bots[0].freshness,'never')
    await pool.query("UPDATE trading_reports SET reported_at=now()-interval '3 hours' WHERE bot_id=$1",[second.id])
    assert.equal((await get('overview?bot=second')).bots[0].freshness,'stale')
    const previousMinutes=process.env.TRADING_STALE_AFTER_MINUTES
    try {
      process.env.TRADING_STALE_AFTER_MINUTES='240'
      assert.equal((await get('overview?bot=second')).bots[0].freshness,'fresh')
      assert.equal((await get('overview?bot=second')).staleAfterMinutes,240)
      process.env.TRADING_STALE_AFTER_MINUTES='invalid'
      assert.equal((await get('overview?bot=second')).staleAfterMinutes,120)
    } finally { if(previousMinutes===undefined)delete process.env.TRADING_STALE_AFTER_MINUTES;else process.env.TRADING_STALE_AFTER_MINUTES=previousMinutes }
    await pool.query("UPDATE trading_reports SET reported_at=now()-interval '5 hours' WHERE bot_id=$1",[second.id])
    assert.equal((await get('overview?bot=second')).bots[0].freshness,'stale')
    await pool.query("UPDATE trading_reports SET reported_at=now()-interval '25 hours' WHERE bot_id=$1",[second.id])
    assert.equal((await get('overview?bot=second')).bots[0].freshness,'critical')
    const reported=(await pool.query('SELECT reported_at FROM trading_reports WHERE bot_id=$1',[second.id])).rows[0].reported_at.getTime()
    const clock=t.mock.method(Date,'now',()=>reported+24*60*60000)
    try {
      assert.equal((await get('overview?bot=second')).bots[0].freshness,'stale')
      clock.mock.mockImplementation(()=>reported+24*60*60000+1)
      assert.equal((await get('overview?bot=second')).bots[0].freshness,'critical')
    } finally {clock.mock.restore()}
    assert.equal((await post({reportId:'minimal',reportedAt:when},{authorization:`Bearer ${secondKey}`})).statusCode,201)
    assert.equal((await get('positions?bot=second')).length,0)
    assert.equal((await get('orders?bot=second')).length,0)
    await runKeys(['delete','second','--with-data'],pool,io)
    await runKeys(['delete','never','--with-data'],pool,io)
  })
  await t.test('CLI subprocess closes pools on success and failure without disclosing values',async()=>{
    const cli=path.join(root,'apps/api/src/scripts/trading-keys.ts')
    const invoke=(args:string[],env=process.env,input='')=>spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),cli,...args],{cwd:root,env,input,encoding:'utf8',timeout:10000})
    const listed=invoke(['list']);assert.equal(listed.status,0);assert.equal(listed.stdout.includes(hash),false)
    assert.deepEqual(Object.keys(JSON.parse(listed.stdout)[0]).sort(),['active','last_report_at','prefix','slug'])
    const rejected=invoke(['register','bad','Bad','test'],process.env,key);assert.equal(rejected.status,1);assert.equal(rejected.stderr.includes(key),false)
    const duplicate=invoke(['register','collision','Collision','test'],process.env,hash);assert.equal(duplicate.status,1);assert.equal(duplicate.stderr.includes(hash),false)
    const missing=invoke(['list'],{...process.env,DATABASE_URL:''});assert.equal(missing.status,1)
    assert.equal(invoke(['invalid']).status,1)
  })
  await t.test('bot rate limiting and revoke lifecycle',async()=>{
    await pool.query('DELETE FROM trading_ingest_attempts WHERE bot_id=$1',[bot.id])
    for(let i=0;i<60;i++) assert.equal((await post({reportId:'limited-'+i,reportedAt:new Date().toISOString()})).statusCode,201)
    assert.equal((await post(payload())).statusCode,429)
    await pool.query("UPDATE trading_ingest_attempts SET attempted_at=now()-interval '11 minutes' WHERE bot_id=$1",[bot.id])
    assert.equal((await post(payload())).statusCode,201)
    assert.equal((await app.inject({method:'POST',url:`/api/trading/bots/${bot.id}/revoke`,headers:{cookie:`csrf=${csrf}`,'x-csrf-token':csrf}})).statusCode,401)
    assert.equal((await app.inject({method:'POST',url:`/api/trading/bots/${bot.id}/revoke`,headers:{cookie:`session=${session!.token}`}})).statusCode,403)
    assert.equal((await app.inject({method:'POST',url:`/api/trading/bots/${bot.id}/revoke`,headers:sessionHeaders})).statusCode,200)
    assert.equal((await post(payload())).statusCode,401)
    await runKeys(['register','synthetic','Synthetic','test'],pool,io)
    assert.equal((await pool.query('SELECT active, revoked_at FROM trading_bots')).rows[0].active,true)
    const replacement=randomBytes(32).toString('base64url')
    await runKeys(['register','synthetic','Synthetic','test'],pool,{...io,read:async()=>createHash('sha256').update(replacement).digest('hex')})
    assert.equal((await post(payload())).statusCode,401)
    assert.equal((await post(payload(),{authorization:`Bearer ${replacement}`})).statusCode,201)
    await pool.query('UPDATE trading_bots SET active=false WHERE id=$1',[bot.id])
    assert.equal((await post(payload(),{authorization:`Bearer ${replacement}`})).statusCode,401)
    output='';await runKeys(['list'],pool,io);assert.equal(output.includes(hash),false)
    await assert.rejects(runKeys(['delete','synthetic'],pool,io))
    await assert.rejects(runKeys(['register','bad','Bad','test'],pool,{...io,read:async()=>key}))
    await runKeys(['revoke','synthetic'],pool,io)
    await runKeys(['delete','synthetic','--with-data'],pool,io)
    assert.equal((await pool.query('SELECT count(*) FROM trading_reports')).rows[0].count,'0')
  })
  await t.test("40 failures on a shared IP never block a valid key lookup",async()=>{
    await runKeys(["register","ip-limit","IP Limit","test"],pool,io)
    const remoteAddress="198.51.100.20"
    const statuses:number[]=[]
    for(let i=0;i<40;i++) {
      const denied=await app.inject({method:"POST",url:"/api/trading/reports",remoteAddress,headers:{authorization:"Bearer synthetic-invalid"},payload:payload()})
      statuses.push(denied.statusCode)
      assert.deepEqual(denied.json(),{error:"Unauthorized."})
    }
    assert.equal((await app.inject({method:"POST",url:"/api/trading/reports",remoteAddress,headers,payload:payload()})).statusCode,201)
    assert.deepEqual(statuses,Array.from({length:40},(_,i)=>i<30?401:429))
    await runKeys(["delete","ip-limit","--with-data"],pool,io)
  })
  await t.test("bounded redacted issues and no-store across trading responses",async t=>{
    const h={authorization:`Bearer ${randomBytes(32).toString("hex")}`}
    const fresh=randomBytes(32).toString("hex")
    await runKeys(["register","review","Review","test"],pool,{...io,read:async()=>createHash("sha256").update(fresh).digest("hex")})
    h.authorization=`Bearer ${fresh}`
    const bad=await post({...payload(),positions:[{},{},{},{size:"private-invalid"}]},h)
    assert.equal(bad.statusCode,400)
    assert.deepEqual(bad.json(),{error:"Invalid trading report.",issues:[{path:"positions.3.size",code:"invalid_format"}]})
    const many=await post({...payload(),positions:Array.from({length:30},()=>({size:"private-invalid"}))},h)
    assert.equal(many.json().issues.length,20)
    for(const issue of many.json().issues) assert.deepEqual(Object.keys(issue).sort(),["code","path"])
    const times:typeof bad[]=[]
    for(const [label,delta] of [["past",-8*86400000],["future",3600000]] as const) {
      await t.test(`reportedAt ${label} window rejection includes only the corrective constant and redacted issue`,async()=>{
        const time=await post({...payload(),reportedAt:new Date(Date.now()+delta).toISOString()},h)
        times.push(time)
        assert.equal(time.statusCode,400)
        assert.deepEqual(time.json(),{error:"Invalid trading report.",message:"reportedAt must be within the last 7 days and not more than 10 minutes in the future",issues:[{path:"reportedAt",code:"custom"}]})
      })
    }
    for(const response of [bad,many,...times,await post(payload(),h),await post(payload(),{})]) assert.equal(response.headers["cache-control"],"no-store")
    for(const route of ["overview","history","positions","trades","orders","cash-flows","bots"]) {
      for(const headers of [{},sessionHeaders]) assert.equal((await app.inject({url:`/api/trading/${route}`,headers})).headers["cache-control"],"no-store")
    }
    let deep="0";for(let i=0;i<2000;i++)deep=`{"nested":${deep}}`
    const raw=`{"reportId":"deep","reportedAt":"${new Date().toISOString()}","extra":${deep}}`
    assert.equal((await post(raw,{...h,"content-type":"application/json"})).statusCode,400)
    await runKeys(["delete","review","--with-data"],pool,io)
  })
})

 test("extra JSON has iterative depth and total member limits before recursive validation",()=>{
  const base={reportId:"limits",reportedAt:new Date().toISOString()}
  let nested:unknown=0
  for(let i=0;i<20;i++) nested={nested}
  assert.equal(reportInput.safeParse({...base,extra:nested}).success,true)
  nested={nested}
  assert.equal(reportInput.safeParse({...base,extra:nested}).success,false)
  for(let i=0;i<10000;i++) nested={nested}
  assert.doesNotThrow(()=>assert.equal(reportInput.safeParse({...base,extra:nested}).success,false))
  const wide=Object.fromEntries(Array.from({length:10000},(_,i)=>[String(i),0]))
  assert.equal(reportInput.safeParse({...base,extra:wide}).success,true)
  assert.equal(reportInput.safeParse({...base,extra:{...wide,overflow:0}}).success,false)
})

 test("plugin-local session guard uses matched route even with encoded raw path",async()=>{
  const {default:Fastify}=await import("fastify")
  const {default:cookie}=await import("@fastify/cookie")
  let calls=0
  const pool={query:async()=>{calls++;return {rows:[]}},connect:async()=>{throw new Error("unexpected ingest")}}
  const app=Fastify()
  await app.register(cookie)
  registerTrading(app,pool as any)
  try {
    for(const url of ["/api/trading/bots","/api/trading/%62ots","/api/trading/overview"]) {
      const response=await app.inject({url})
      assert.equal(response.statusCode,401)
      assert.equal(response.headers["cache-control"],"no-store")
    }
    assert.equal((await app.inject({method:"POST",url:"/api/trading/bots/synthetic/revoke"})).statusCode,401)
    assert.equal(calls,0)
  } finally {await app.close()}
})
