import test from "node:test"
import assert from "node:assert/strict"
import {randomBytes,createHash} from "node:crypto"
import {readFile,readdir} from "node:fs/promises"
import {existsSync} from "node:fs"
import {spawnSync} from "node:child_process"
import pg from "pg"
import * as trading from "./trading.js"

test("exact NUMERIC P&L rules on isolated PostgreSQL",{skip:!process.env.TRADING_TEST_DATABASE_URL},async t=>{
  assert.equal(typeof (trading as any).readTrading,"function","shared read API must exist")
  const url=new URL(process.env.TRADING_TEST_DATABASE_URL!)
  const schema=`pnl_rules_${process.pid}`
  const admin=new pg.Pool({connectionString:url.href})
  await admin.query(`CREATE SCHEMA ${schema}`)
  url.searchParams.set("options",`-csearch_path=${schema}`)
  const pool=new pg.Pool({connectionString:url.href})
  t.after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()})
  for(const file of (await readdir(new URL("../migrations/",import.meta.url))).filter(x=>x.endsWith(".sql")).sort()) await pool.query(await readFile(new URL(`../migrations/${file}`,import.meta.url),"utf8"))
  const read=(route:string,q:object={})=>(trading as any).readTrading(pool,route,q)
  const bot=async(id:string,currency:string|null="USD")=>{
    await pool.query("INSERT INTO trading_bots(id,display_name,platform,key_hash) VALUES($1,$1,$2,$3)",[id,"paper",createHash("sha256").update(randomBytes(32)).digest("hex")])
    return async(name:string,offset:string,equity:string|null,extras:Record<string,string>={})=>{
      const cols=Object.keys(extras)
      const row=(await pool.query(`INSERT INTO trading_reports(bot_id,report_id,reported_at,currency,equity,raw,payload_bytes${cols.map(x=>","+x).join("")}) VALUES($1,$2,((now() AT TIME ZONE $$America/New_York$$)::date AT TIME ZONE $$America/New_York$$)+$3::interval,$4,$5,$${6},0${cols.map((_,i)=>",$"+(7+i)).join("")}) RETURNING id`,[id,name,offset,currency,equity,"{}",...Object.values(extras)])).rows[0]
      return row.id as string
    }
  }
  const report=async(id:string)=>(await read("overview",{bot:id})).bots[0].report
  const eq=(value:string,wanted:string)=>assert.equal(value.replace(/(\.\d*?)0+$/,"$1").replace(/\.$/,""),wanted)
  await t.test("missing metrics and single snapshot return decimal zero, never null",async()=>{
    const add=await bot("missing");await add("one","1 hour",null)
    const r=await report("missing")
    for(const key of ["equity","totalPnl","todayPnl","unrealizedPnl","realizedPnl","netDeposits"]) eq(r[key],"0")
    assert.equal(r.pnlBasis.todayPnl,"computed")
  })
  await t.test("reported metrics override exact position and trade fallbacks",async()=>{
    const add=await bot("reported");const id=await add("one","2 hours","999999999999999999.123456789123",{unrealized_pnl:"0.000000000003",realized_pnl_total:"-0.000000000002",day_pnl:"-0.000000000001"})
    await pool.query("INSERT INTO trading_positions(report_id,unrealized_pnl) VALUES($1,99)",[id])
    await pool.query("INSERT INTO trading_trades(bot_id,report_id,realized_pnl) VALUES($1,$2,99)",["reported",id])
    const r=await report("reported")
    eq(r.unrealizedPnl,"0.000000000003");eq(r.realizedPnl,"-0.000000000002");eq(r.totalPnl,"0.000000000001");eq(r.todayPnl,"-0.000000000001")
    for(const key of ["unrealizedPnl","realizedPnl","todayPnl"]) assert.equal(r.pnlBasis[key],"reported")
    assert.equal(r.pnlBasis.totalPnl,"computed")
  })
  await t.test("computed P&L uses latest positions and all trades without float loss",async()=>{
    const add=await bot("computed");const old=await add("old","-1 hour","1");const id=await add("new","3 hours","2")
    await pool.query("INSERT INTO trading_positions(report_id,unrealized_pnl) VALUES($1,999),($2,0.000000000001),($2,-0.000000000003)",[old,id])
    await pool.query("INSERT INTO trading_trades(bot_id,report_id,realized_pnl) VALUES($1,$2,0.000000000005),($1,$3,0.000000000007)",["computed",old,id])
    const r=await report("computed");eq(r.unrealizedPnl,"-0.000000000002");eq(r.realizedPnl,"0.000000000012");eq(r.totalPnl,"0.00000000001")
    const h=await read("history",{bot:"computed",range:"all"});eq(h[0].totalPnl,"999.000000000005");eq(h[1].totalPnl,"0.00000000001")
  })
  await t.test("future cash flows do not rewrite pre-flow historical P&L",async()=>{
    const add=await bot("flow-cutoff")
    await add("before-flow","-2 days","100",{realized_pnl_total:"3",unrealized_pnl:"4"})
    const later=await add("with-flow","-1 day","150")
    await pool.query("INSERT INTO trading_cash_flows(bot_id,report_id,type,amount) VALUES($1,$2,$3,$4)",["flow-cutoff",later,"deposit","120"])
    const history=await read("history",{bot:"flow-cutoff",range:"all"})
    eq(history[0].netDeposits,"0");eq(history[0].totalPnl,"7")
    eq(history[1].netDeposits,"120");eq(history[1].totalPnl,"30")
    // The latest contract still includes ALL flows, including future-effective ones.
    await pool.query("UPDATE trading_cash_flows SET occurred_at=now()+interval $$1 day$$ WHERE report_id=$1",[later])
    eq((await report("flow-cutoff")).totalPnl,"30")
    const beforeEffective=await read("history",{bot:"flow-cutoff",range:"all"})
    eq(beforeEffective[0].totalPnl,"7");eq(beforeEffective[1].totalPnl,"0")
  })
  await t.test("cash-adjusted today uses ET midnight baseline, not UTC midnight",async()=>{
    const add=await bot("flows");const before=await add("before","-1 minute","100.000000000001");const first=await add("first","1 minute","155.000000000002");const last=await add("last","2 hours","170.000000000003")
    await pool.query("INSERT INTO trading_cash_flows(bot_id,report_id,type,amount,occurred_at) SELECT $1,$2,$3,$4,reported_at FROM trading_reports WHERE id=$2",["flows",before,"deposit","100"])
    await pool.query("INSERT INTO trading_cash_flows(bot_id,report_id,type,amount,occurred_at) SELECT $1,$2,$3,$4,reported_at FROM trading_reports WHERE id=$2",["flows",first,"deposit","50"])
    await pool.query("INSERT INTO trading_cash_flows(bot_id,report_id,type,amount,occurred_at) SELECT $1,$2,$3,$4,reported_at FROM trading_reports WHERE id=$2",["flows",last,"withdrawal","10"])
    const r=await report("flows");eq(r.netDeposits,"140");eq(r.totalPnl,"30.000000000003");eq(r.todayPnl,"30.000000000002")
    const h=await read("history",{bot:"flows",range:"all"});eq(h[0].totalPnl,"0.000000000001");eq(h[1].totalPnl,"5.000000000002");eq(h[2].totalPnl,"30.000000000003")
  })
  await t.test("without pre-midnight baseline first today is baseline, single is zero",async()=>{
    const add=await bot("intraday");await add("first","10 minutes","10");await add("last","30 minutes","12")
    eq((await report("intraday")).todayPnl,"2")
    const single=await bot("single");await single("first","1 minute","900")
    eq((await report("single")).todayPnl,"0")
  })
  await t.test("freshness uses receipt time even when data as-of is old",async()=>{
    const add=await bot("fresh");await add("old","-2 days","1")
    assert.equal((await read("overview",{bot:"fresh"})).bots[0].freshness,"fresh")
    await pool.query("UPDATE trading_reports SET received_at=now()-interval $$25 hours$$ WHERE bot_id=$1",["fresh"])
    assert.equal((await read("overview",{bot:"fresh"})).bots[0].freshness,"critical")
  })
  await t.test("same reported time history ends with most recently received overview snapshot",async()=>{
    const add=await bot("receipt-tie")
    // Insert the newer receipt first so id ordering alone picks the wrong winner.
    const insertedNewer=await add("newer-receipt","1 hour","22",{realized_pnl_total:"7",unrealized_pnl:"2"})
    const insertedOlder=await add("older-receipt","1 hour","11",{realized_pnl_total:"3",unrealized_pnl:"1"})
    const newer="00000000-0000-4000-8000-000000000001",older="00000000-0000-4000-8000-000000000002"
    await pool.query("UPDATE trading_reports SET id=CASE WHEN id=$1 THEN $3::uuid ELSE $4::uuid END WHERE id=ANY($2)",[insertedNewer,[insertedNewer,insertedOlder],newer,older])
    await pool.query("UPDATE trading_reports SET reported_at=TIMESTAMPTZ $$2026-01-01T12:00:00Z$$,received_at=CASE WHEN id=$1 THEN TIMESTAMPTZ $$2026-01-01T12:02:00Z$$ ELSE TIMESTAMPTZ $$2026-01-01T12:01:00Z$$ END WHERE id=ANY($2)",[newer,[newer,older]])
    const overview=await report("receipt-tie")
    const history=await read("history",{bot:"receipt-tie",range:"all"})
    eq(overview.equity,"22");eq(overview.totalPnl,"9")
    assert.deepEqual(history.map((r:any)=>r.receivedAt),["2026-01-01T12:01:00.000Z","2026-01-01T12:02:00.000Z"])
    const helperPath="../../web/src/trading-helpers.mjs"
    const {combinedHistory}=await import(helperPath)
    for(const metric of ["equity","totalPnl"]) {
      assert.equal(history.at(-1)[metric],overview[metric])
      const chart=combinedHistory(history,metric)
      assert.equal(chart.length,1)
      eq(chart[0][metric],metric==="equity"?"22":"9")
    }
  })
  await t.test("combined metrics retain mixed missing reports, exclude no report and unknown currency",async()=>{
    await bot("never");const add=await bot("unknown",null);await add("one","1 hour","999")
    const overview=await read("overview")
    assert.equal(overview.totals.length,1)
    for(const key of ["equity","totalPnl","todayPnl","unrealizedPnl","realizedPnl","netDeposits"]) assert.equal(typeof overview.totals[0][key],"string")
    assert.equal(overview.bots.find((b:any)=>b.id==="never").report,null)
    assert.deepEqual((await read("overview",{bot:"unknown"})).totals,[])
  })
  await t.test("combined exact values include computed zeros without poisoning reported values",async()=>{
    await pool.query("UPDATE trading_bots SET platform=$1 WHERE id=ANY($2)",["combined",["missing","reported","never","unknown"]])
    const total=(await read("overview",{platform:"combined"})).totals[0]
    eq(total.equity,"999999999999999999.123456789123");eq(total.totalPnl,"0.000000000001");eq(total.todayPnl,"-0.000000000001");eq(total.realizedPnl,"-0.000000000002");eq(total.unrealizedPnl,"0.000000000003");eq(total.netDeposits,"0")
  })
  await t.test("reported zeros override nonzero ledger inputs and schema columns remain NUMERIC",async()=>{
    const add=await bot("zeros");const id=await add("one","1 hour","20",{unrealized_pnl:"0",realized_pnl_total:"0",day_pnl:"0"})
    await pool.query("INSERT INTO trading_positions(report_id,unrealized_pnl) VALUES($1,99)",[id])
    await pool.query("INSERT INTO trading_trades(bot_id,report_id,realized_pnl) VALUES($1,$2,99)",["zeros",id])
    const r=await report("zeros")
    for(const key of ["unrealizedPnl","realizedPnl","todayPnl","totalPnl"])eq(r[key],"0")
    const columns=(await pool.query("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND column_name IN ($1,$2,$3)",["equity","unrealized_pnl","realized_pnl"])).rows
    assert.equal(columns.length,4);assert.ok(columns.every(c=>c.data_type==="numeric"))
  })
  await t.test("snapshot CLI shares endpoint readers and closes without listener",async()=>{
    const {runSnapshot}=await import("./scripts/trading-snapshot.js")
    for(const route of ["overview","history","positions","trades","orders","cash-flows"]) {
      let output="";await runSnapshot([route],pool,s=>output+=s)
      assert.deepEqual(JSON.parse(output),await read(route,route==="history"?{range:"all"}:{}))
    }
    await assert.rejects(runSnapshot(["invalid"],pool,()=>{}))
    const child=spawnSync(process.execPath,["--import","tsx",new URL("./scripts/trading-snapshot.ts",import.meta.url).pathname,"history"],{env:{...process.env,DATABASE_URL:url.href},encoding:"utf8",timeout:10000})
    assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),await read("history",{range:"all"}))
    const compiled=new URL("../dist/scripts/trading-snapshot.js",import.meta.url).pathname
    if(existsSync(compiled)) {
      const built=spawnSync(process.execPath,[compiled,"history"],{env:{...process.env,DATABASE_URL:url.href},encoding:"utf8",timeout:10000})
      assert.equal(built.status,0,built.stderr);assert.deepEqual(JSON.parse(built.stdout),await read("history",{range:"all"}))
    }
  })
})
