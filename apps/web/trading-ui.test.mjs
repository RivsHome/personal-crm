import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
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
    Object.assign(components,await import(pathToFileURL(outfile)))
  }
  test('bot cards show precise amounts, strategy, risks and no-report state',()=>{
    const bots=[{id:'demo',displayName:'Demo',platform:'example',active:true,keyPrefix:'prefix',lastReportAt:'2026-01-01T00:00:00Z',positionsCount:2,report:{currency:'BTC',equity:'0.123456789123456789',dayPnl:null,realizedPnlTotal:'-2',strategyNotes:'<script>notes</script>',riskFlags:[{level:'critical',message:'Risk example'}]}},{id:'empty',displayName:'Empty',platform:'example',active:true,lastReportAt:null,report:null,positionsCount:0}]
    const html=renderToStaticMarkup(createElement(components.BotCards,{bots,staleAfterMinutes:120,now:Date.parse('2026-01-03')}))
    assert.match(html,/0.123456789123456789/);assert.match(html,/critical/);assert.match(html,/Risk example/);assert.match(html,/first report/);assert.doesNotMatch(html,/<script>/)
  })
  test('unknown-denomination bot cards retain amounts and explicitly label unknown currency',()=>{
    for (const currency of [null, undefined, '', '  ']) {
      const html=renderToStaticMarkup(createElement(components.BotCards,{bots:[{id:'unknown',displayName:'Unknown',platform:'paper',active:true,lastReportAt:null,report:{currency,equity:'123.456',dayPnl:'-2',realizedPnlTotal:'3'}}],staleAfterMinutes:120}))
      assert.match(html,/123.456/);assert.match(html,/-2/);assert.match(html,/Unknown currency/)
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
    const html=renderToStaticMarkup(createElement(components.EquityChart,{history,bots:[{id:'a',displayName:'Alpha'},{id:'b',displayName:'Beta'}]}))
    assert.equal((html.match(/<figure/g)||[]).length,2);assert.match(html,/<title/);assert.match(html,/Alpha/);assert.match(html,/Beta/);assert.match(html,/America\/New_York/)
  })
  test('180000 historical points render without crashing and bound SVG work per line',()=>{
    const history=Array.from({length:180000},(_,i)=>({botId:'large',currency:'USD',equity:String(i===90001 ? -999999 : i===120001 ? 999999 : i%100),reportedAt:new Date(Date.UTC(2025,0,1)+i*60000).toISOString()}))
    const html=renderToStaticMarkup(createElement(components.EquityChart,{history,bots:[]}))
    const circles=(html.match(/<circle /g)||[]).length
    assert.ok(circles>0 && circles<=500,`expected at most 500 circles, got ${circles}`)
    const polylines=[...html.matchAll(/<polyline[^>]* points="([^"]*)"/g)]
    assert.equal(polylines.length,1)
    assert.ok(polylines[0][1].split(' ').length<=500)
    assert.doesNotMatch(html,/NaN|Infinity|Invalid Date/)
    assert.match(html,/-999999/);assert.match(html,/999999/)
    assert.match(html,/sampl/i)
  })
  test('tables have horizontal region, headers, exact decimals and empty states',()=>{
    const html=renderToStaticMarkup(createElement(components.TradingTable,{kind:'trades',rows:[{botId:'demo',platform:'example',qty:'9007199254740993.123',executedAt:'2026-01-01T12:00:00Z'}],bots:[]}))
    assert.match(html,/9007199254740993.123/);assert.match(html,/scope="col"/);assert.match(html,/scroll horizontally/);assert.match(html,/7:00/)
    assert.match(renderToStaticMarkup(createElement(components.TradingTable,{kind:'positions',rows:[],bots:[]})),/No positions/)
  })
} finally {await rm(temporary,{recursive:true,force:true})}
