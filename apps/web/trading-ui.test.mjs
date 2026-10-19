import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
// Bundle only our TSX; use the existing Vite/esbuild dependency, never install a test framework.
const temporary = await mkdtemp(join(import.meta.dirname || new URL('.',import.meta.url).pathname,'.trading-test-'))
const components = {}
try {
  for (const name of ['TradingModule','TradingBots']) {
    const outfile=join(temporary,`${name}.mjs`)
    await build({entryPoints:[new URL(`./src/${name}.tsx`,import.meta.url).pathname],outfile,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},jsx:'automatic'})
    const module=await import(pathToFileURL(outfile))
    Object.assign(components,module)
    if(name==='TradingModule') components.Dashboard=module.default
  }
  const css=await readFile(new URL('./src/trading.css',import.meta.url),'utf8')
  const source=await readFile(new URL('./src/TradingModule.tsx',import.meta.url),'utf8')
  const report={currency:'USD',equity:'120',totalPnl:'20',todayPnl:'2',netDeposits:'100',unrealizedPnl:'5',realizedPnl:'15',receivedAt:'2026-01-03T00:00:00Z',reportedAt:'2026-01-03T00:00:00Z',riskFlags:[]}
  test('polished KPI grid renders six cards and emphasizes total P&L',()=>{
    const html=renderToStaticMarkup(createElement(components.TradingTotals,{reports:[report]}))
    assert.equal((html.match(/<article /g)||[]).length,6)
    assert.match(html,/class="trading-kpis"/)
    assert.match(html,/class="panel trading-kpi trading-kpi-primary"[^>]*><h4>Total P&amp;L/)
    assert.match(css,/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(170px,\s*1fr\)\)/)
    assert.match(css,/@media\s*\(max-width:600px\)[\s\S]*?\.trading-kpis\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
    assert.doesNotMatch(css,/\.trading-kpis\s*\{[^}]*grid-template-columns:1fr/)
    assert.match(css,/\.trading-kpi-primary\s*>\s*div\s*\{[^}]*font-size/)
  })
  test('bot monograms, capitalized freshness, aligned rows and hover-only computation hints',()=>{
    const bots=['robinhood','hyperliquid','crypto','polymarket'].map(platform=>({id:platform,platform,displayName:platform,report,positionsCount:0,active:true}))
    const html=renderToStaticMarkup(createElement(components.BotCards,{bots,staleAfterMinutes:120,now:Date.parse('2026-01-03T00:25:00Z')}))
    for(const chip of ['RH','HL','CR','PM']) assert.match(html,new RegExp(`class="trading-monogram"[^>]*>${chip}</span>`))
    assert.match(html,/Fresh - 25 min ago/)
    assert.doesNotMatch(html,/No reported risk flags|<svg/)
    assert.match(html,/<dt title="[^"]*computed[^"]*">Unrealized<\/dt>/i)
    assert.match(html,/<dt title="[^"]*computed[^"]*">Realized<\/dt>/i)
    assert.match(css,/repeat\(auto-fill,\s*minmax\(min\(100%,\s*260px\),\s*1fr\)\)/)
    assert.match(css,/@media\s*\(min-width:1200px\)[\s\S]*?\.trading-cards\s*\{[^}]*repeat\(4,\s*minmax\(0,\s*1fr\)\)/)
    assert.match(css,/\.trading-card\s*\{[^}]*grid-template-rows/)
  })
  test('chart has four currency ticks, light gridlines, solid combined line and no idle tooltip',()=>{
    const history=['a','b'].flatMap(botId=>[0,1].map(i=>({botId,currency:'USD',totalPnl:String(i*50-20),reportedAt:`2026-01-0${i+1}T00:00:00Z`})))
    const html=renderToStaticMarkup(createElement(components.EquityChart,{history,bots:[]}))
    assert.equal((html.match(/class="trading-y-label"/g)||[]).length,4)
    assert.equal((html.match(/class="trading-gridline"/g)||[]).length,4)
    assert.match(html,/<text[^>]*class="trading-y-label"[^>]*>[^<]*\$/)
    assert.doesNotMatch(html,/approximate chart|role="tooltip"|Hover or focus/)
    assert.doesNotMatch(html,/<polyline[^>]*stroke-dasharray/)
    assert.match(html,/<polyline[^>]*stroke-width="3"/)
    assert.match(html,/<polyline[^>]*stroke-width="1.5"/)
  })
  test('explanations live under chart and mobile filters start collapsed without hiding desktop filters',()=>{
    const html=renderToStaticMarkup(createElement(components.Dashboard,{apiFetch:async()=>{throw Error('SSR does not fetch')}}))
    assert.match(html,/<details class="trading-filter-disclosure"><summary>Filters<\/summary>/)
    assert.doesNotMatch(html,/<details class="trading-filter-disclosure" open/)
    assert.match(html,/<details class="trading-methodology"><summary>About these numbers<\/summary>/)
    assert.ok(html.indexOf('About these numbers')>html.indexOf('Performance over time'))
    for(const explanation of ['500 points','carry','America/New_York','absent P&amp;L inputs default to zero','revoked bots']) assert.ok(html.includes(explanation),explanation)
    assert.match(css,/@media\s*\(min-width:601px\)[\s\S]*?\.trading-filter-disclosure[^}]*::details-content/)
    assert.doesNotMatch(source,/tooltip\|\|/)
  })
  test('table drops all-empty columns per filtered table, keeps zero and right-aligns numeric columns',()=>{
    const render=rows=>renderToStaticMarkup(createElement(components.TradingTable,{kind:'positions',rows,bots:[]}))
    const html=render([{botId:'a',platform:'paper',symbol:'A',size:'0',market:'  ',unrealizedPnl:null},{botId:'b',platform:'paper',symbol:'B',size:null,market:''}])
    assert.doesNotMatch(html,/>Market<|>Currency<|>Leverage<|>Unrealized PnL</)
    assert.match(html,/<th[^>]*class="trading-numeric"[^>]*>Size</)
    assert.match(html,/<td[^>]*class="trading-numeric"/)
    assert.match(render([{botId:'a',platform:'paper',market:'Prediction'}]),/>Market</)
    assert.match(css,/\.trading-table-wrap \.trading-numeric\s*\{[^}]*text-align:right/)
    assert.match(css,/thead th\s*\{[^}]*position:sticky/)
  })
  test('trading theme uses shared accent and semantic variables without legacy colors',()=>{
    assert.doesNotMatch(css,/#(?:62675a|727679|242527|eee\b|666a7055|79bb69|d39b3c|df7d7d)/i)
    assert.match(css,/--trading-surface:\s*var\(--surface\)/)
    assert.match(css,/--trading-border:\s*var\(--border-strong\)/)
    assert.match(css,/--trading-muted:\s*var\(--text-soft\)/)
    for(const platform of ['hyperliquid','crypto','polymarket']) assert.match(css,new RegExp(`data-platform=${platform}[^}]*--platform-tint:color-mix\\(in srgb,var\\(--accent\\)`))
    assert.match(css,/var\(--accent/)
    assert.match(css,/\[data-theme="light"\] \.trading-workspace/)
    assert.match(css,/\.trading-filters option\s*\{[^}]*background:var\(/)
    assert.match(css,/\.trading-badge.fresh\s*\{[^}]*var\(/)
  })
  test("P&L KPI zero is money, signed values and single-point chart has focus marker",()=>{
    const html=renderToStaticMarkup(createElement(components.TradingTotals,{reports:[{currency:"USD",equity:"0",totalPnl:"0",todayPnl:"0",netDeposits:"0",unrealizedPnl:"0",realizedPnl:"0"}]}))
    assert.match(html,/Total P&amp;L/);assert.match(html,/Today P&amp;L/);assert.match(html,/Net deposits/);assert.match(html,/\$0\.00/);assert.doesNotMatch(html,/—/)
    const chart=renderToStaticMarkup(createElement(components.EquityChart,{history:[{botId:"one",currency:"USD",equity:"1",totalPnl:"-2",reportedAt:"2026-01-01T12:00:00Z"}],bots:[]}))
    assert.match(chart,/P&amp;L/);assert.match(chart,/<circle[^>]*tabindex="0"/);assert.match(chart,/zero-line/)
  })
  test("freshness badge contains receipt age and data-as-of uses receipt/report difference only",()=>{
    const now=Date.parse('2026-01-03T00:00:00Z')
    const render=(receivedAt,reportedAt)=>renderToStaticMarkup(createElement(components.BotCards,{bots:[{id:'age',displayName:'Age',platform:'paper',active:true,lastReportAt:reportedAt,report:{currency:'USD',equity:'0',receivedAt,reportedAt}}],staleAfterMinutes:120,now}))
    const fresh=render('2026-01-02T23:55:00Z','2026-01-01T00:00:00Z')
    assert.match(fresh,/<span class="trading-badge fresh">Fresh - 5 min ago<\/span>/)
    assert.match(fresh,/Data as of/)
    assert.doesNotMatch(fresh,/Received: 5 min ago/)
    const stale=render('2026-01-02T21:00:00Z','2026-01-02T20:50:00Z')
    assert.match(stale,/<span class="trading-badge stale">Stale - 180 min ago<\/span>/)
    assert.doesNotMatch(stale,/Data as of/,'old receipt does not make data-as-of appear when difference is exactly 10 minutes')
    const critical=render('2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')
    assert.match(critical,/<span class="trading-badge critical">Critical - 2880 min ago<\/span>/)
    assert.doesNotMatch(critical,/Data as of/)
    assert.match(render('2026-01-02T23:55:00Z','2026-01-03T00:06:00Z'),/Data as of/,'difference is absolute, not only late arrivals')
    const never=renderToStaticMarkup(createElement(components.BotCards,{bots:[{id:'never',displayName:'Never',platform:'paper',report:null}],staleAfterMinutes:120,now}))
    assert.match(never,/<span class="trading-badge never">No report<\/span>/)
  })
  test("receipt freshness and delayed data-as-of label are independent",()=>{
    const html=renderToStaticMarkup(createElement(components.BotCards,{bots:[{id:"one",displayName:"One",platform:"paper",active:true,lastReportAt:"2026-01-01T00:00:00Z",positionsCount:1,report:{currency:"USD",equity:"0",totalPnl:"-1",todayPnl:"0",receivedAt:"2026-01-02T00:00:00Z",reportedAt:"2026-01-01T00:00:00Z",riskFlags:[]}}],staleAfterMinutes:120,now:Date.parse("2026-01-02T00:01:00Z")}))
    assert.match(html,/fresh/);assert.doesNotMatch(html,/critical/);assert.match(html,/Data as of/);assert.match(html,/1 min ago/);assert.match(html,/<details/);assert.match(html,/-\$1\.00/)
  })
  test('P&L dashboard renders all six KPIs as money and receipt freshness',()=>{
    const report={currency:'USD',equity:'10',totalPnl:'0',todayPnl:'0',netDeposits:'10',unrealizedPnl:'0',realizedPnl:'0',reportedAt:'2026-01-01T00:00:00Z',receivedAt:'2026-01-03T00:00:00Z',riskFlags:[]}
    const totals=renderToStaticMarkup(createElement(components.TradingTotals,{reports:[report]}))
    for(const label of ['Total P&L','Today P&L','Net deposits','Unrealized P&L','Realized P&L']) assert.ok(totals.includes(label.replaceAll('&','&amp;')),label)
    assert.match(totals,/\$0\.00/)
    const cards=renderToStaticMarkup(createElement(components.BotCards,{bots:[{id:'a',displayName:'A',platform:'paper',lastReportAt:report.reportedAt,report}],staleAfterMinutes:120,now:Date.parse(report.receivedAt)}))
    assert.match(cards,/trading-badge fresh/);assert.match(cards,/0 min ago/);assert.match(cards,/Data as of/);assert.match(cards,/<details/)
    const chart=renderToStaticMarkup(createElement(components.EquityChart,{history:[{botId:'a',currency:'USD',equity:'10',totalPnl:'0',reportedAt:report.reportedAt}],bots:[],metric:'totalPnl'}))
    assert.match(chart,/P&amp;L over time/);assert.match(chart,/<circle/);assert.match(chart,/tabindex="0"/);assert.match(chart,/zero-line/)
    const table=renderToStaticMarkup(createElement(components.TradingTable,{kind:'trades',rows:[{botId:'a',platform:'paper',currency:'USD',realizedPnl:null}],bots:[]}))
    assert.doesNotMatch(table,/>Realized PnL</,'all-null P&L columns are hidden, not fabricated as zero')
  })
  test('bot cards show precise amounts, strategy, risks and no-report state',()=>{
    const bots=[{id:'demo',displayName:'Demo',platform:'example',active:true,keyPrefix:'prefix',lastReportAt:'2026-01-01T00:00:00Z',positionsCount:2,report:{currency:'BTC',equity:'0.123456789123456789',dayPnl:null,realizedPnlTotal:'-2',strategyNotes:'<script>notes</script>',riskFlags:[{level:'critical',message:'Risk example'}]}},{id:'empty',displayName:'Empty',platform:'example',active:true,lastReportAt:null,report:null,positionsCount:0}]
    const html=renderToStaticMarkup(createElement(components.BotCards,{bots,staleAfterMinutes:120,now:Date.parse('2026-01-03')}))
    assert.match(html,/0.123456789123456789/);assert.match(html,/critical/);assert.match(html,/Risk example/);assert.match(html,/first report/);assert.doesNotMatch(html,/<script>/)
  })
  test('unknown-denomination bot cards retain amounts and explicitly label unknown currency',()=>{
    for (const currency of [null, undefined, '', '  ']) {
      const html=renderToStaticMarkup(createElement(components.BotCards,{bots:[{id:'unknown',displayName:'Unknown',platform:'paper',active:true,lastReportAt:null,report:{currency,equity:'123.456',todayPnl:'-2',totalPnl:'3'}}],staleAfterMinutes:120}))
      assert.match(html,/123.46/);assert.match(html,/-2/);assert.match(html,/Unknown currency/)
    }
  })
  test('combined totals explain excluded unknown currencies and missing reports',()=>{
    const reports=[{currency:null,equity:'10'},{currency:'',equity:'20'}]
    const html=renderToStaticMarkup(createElement(components.TradingTotals,{reports}))
    assert.match(html,/unknown currencies/i);assert.doesNotMatch(html,/Combined ·/)
    assert.match(renderToStaticMarkup(createElement(components.TradingTotals,{reports:[]})),/No reported totals/)
    const mixed=renderToStaticMarkup(createElement(components.TradingTotals,{reports:[...reports,{currency:'USD',equity:'5',dayPnl:null,realizedPnlTotal:'1'}]}))
    assert.match(mixed,/Combined · USD/);assert.match(mixed,/unknown currencies/i)
  })
  test('safe settings metadata, disabled revoked action, no key generation or secrets',()=>{
    const html=renderToStaticMarkup(createElement(components.TradingBotList,{bots:[{id:'demo',displayName:'Demo',platform:'example',active:false,keyPrefix:'safe-prefix',lastReportAt:null,keyHash:'NEVER_RENDER_HASH',key:'NEVER_RENDER_KEY'}],onRevoke:()=>{},busy:false}))
    assert.match(html,/safe-prefix/);assert.match(html,/disabled=""/);assert.doesNotMatch(html,/NEVER_RENDER|Generate/)
  })
  test('revoke has an accessible explicit confirmation and cancel',()=>{
    const html=renderToStaticMarkup(createElement(components.RevokeConfirmation,{bot:{displayName:'Demo'},busy:false,onConfirm:()=>{},onCancel:()=>{}}))
    assert.match(html,/role="alertdialog"/);assert.match(html,/Confirm revoke/);assert.match(html,/Cancel/);assert.match(html,/Existing reports remain visible/)
  })
  test('chart has accessible title, currency-specific figures and separate bot legend',()=>{
    const history=[{botId:'a',currency:'USD',equity:'2',reportedAt:'2026-01-01T12:00:00Z'},{botId:'b',currency:'BTC',equity:'0.1',reportedAt:'2026-01-01T12:00:00Z'}]
    const html=renderToStaticMarkup(createElement(components.EquityChart,{history,metric:'equity',bots:[{id:'a',displayName:'Alpha'},{id:'b',displayName:'Beta'}]}))
    assert.equal((html.match(/<figure/g)||[]).length,2);assert.match(html,/<title/);assert.match(html,/Alpha/);assert.match(html,/Beta/);assert.match(html,/America\/New_York/)
  })
  test('180000 historical points render without crashing and bound SVG work per line',()=>{
    const history=Array.from({length:180000},(_,i)=>({botId:'large',currency:'USD',equity:String(i===90001 ? -999999 : i===120001 ? 999999 : i%100),reportedAt:new Date(Date.UTC(2025,0,1)+i*60000).toISOString()}))
    const html=renderToStaticMarkup(createElement(components.EquityChart,{history,metric:'equity',bots:[]}))
    const circles=(html.match(/<circle /g)||[]).length
    assert.ok(circles>0 && circles<=500,`expected at most 500 circles, got ${circles}`)
    const polylines=[...html.matchAll(/<polyline[^>]* points="([^"]*)"/g)]
    assert.equal(polylines.length,1)
    assert.ok(polylines[0][1].split(' ').length<=500)
    assert.doesNotMatch(html,/NaN|Infinity|Invalid Date/)
    assert.match(html,/-999999/);assert.match(html,/999999/)
    assert.match(renderToStaticMarkup(createElement(components.AboutTradingNumbers)),/sampled to at most 500 points/)
  })
  test('tables have horizontal region, headers, exact decimals and empty states',()=>{
    const html=renderToStaticMarkup(createElement(components.TradingTable,{kind:'trades',rows:[{botId:'demo',platform:'example',qty:'9007199254740993.123',executedAt:'2026-01-01T12:00:00Z'}],bots:[]}))
    assert.match(html,/9007199254740993.123/);assert.match(html,/scope="col"/);assert.match(html,/scroll horizontally/);assert.match(html,/7:00/)
    assert.match(renderToStaticMarkup(createElement(components.TradingTable,{kind:'positions',rows:[],bots:[]})),/No positions/)
  })
} finally {await rm(temporary,{recursive:true,force:true})}
