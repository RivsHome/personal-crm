import test from 'node:test'
import assert from 'node:assert/strict'
import { sumDecimal, totalsByCurrency, formatTime, freshness, filterRows, chartSeries } from './src/trading-helpers.mjs'
test('exact decimal addition, null and negatives', () => {
  assert.equal(sumDecimal(['9007199254740993.12345678', '0.00000002', '-1']), '9007199254740992.12345680')
  assert.equal(sumDecimal([null, null]), null)
})
test('totals never combine currencies and use latest report per bot', () => {
  assert.deepEqual(totalsByCurrency([{currency:'USD',equity:'2',dayPnl:null,realizedPnlTotal:'1'},{currency:'BTC',equity:'0.1',dayPnl:'0.01',realizedPnlTotal:null}]).map(x=>[x.currency,x.equity]), [['USD','2'],['BTC','0.1']])
})
test('mixed unknown amounts do not silently understate totals', () => {
  assert.equal(totalsByCurrency([{currency:'USD',equity:'10',dayPnl:'1',realizedPnlTotal:'2'},{currency:'USD',equity:null,dayPnl:'2',realizedPnlTotal:null}])[0].equity,null)
})
test('freshness uses configured threshold and critical 24 hours', () => {
  const now = Date.parse('2026-01-02T12:00:00Z')
  assert.equal(freshness(null, 120, now), 'never')
  assert.equal(freshness('2026-01-02T10:00:00Z', 60, now), 'stale')
  assert.equal(freshness('2026-01-01T11:59:00Z', 120, now), 'critical')
})
test('all displayed times are New York, including DST', () => {
  assert.match(formatTime('2026-07-01T12:00:00Z'), /8:00/)
  assert.match(formatTime('2026-01-01T12:00:00Z'), /7:00/)
  assert.match(formatTime('2026-01-01T12:00:00Z'), /EST|GMT-5/)
})
test('platform, bot and New York date range filter', () => {
  const rows = [{botId:'a',platform:'p',executedAt:'2026-01-02T02:00:00Z'},{botId:'b',platform:'q',executedAt:'2026-01-02T12:00:00Z'}]
  assert.equal(filterRows(rows,{bot:'a',platform:'p',from:'2026-01-01',to:'2026-01-01',range:'all'}).length,1)
  assert.equal(filterRows(rows,{platform:'q',range:'all'}).length,1)
})
test('history is separate per bot/currency, sorted, never sums snapshots', () => {
  const lines = chartSeries([{botId:'a',currency:'USD',reportedAt:'2026-01-02',equity:'20'},{botId:'b',currency:'USD',reportedAt:'2026-01-01',equity:'4'},{botId:'a',currency:'USD',reportedAt:'2026-01-01',equity:'10'}])
  assert.equal(lines.length,2)
  assert.deepEqual(lines[0].points.map(p=>p.value),[10,20])
})

test('unknown denominations never combine even for two bots with the same missing currency', () => {
  for (const currency of [null, undefined, '', '  ', '\t\n']) {
    const reports = [{currency,equity:'10',dayPnl:'1',realizedPnlTotal:'2'},{currency,equity:'20',dayPnl:'2',realizedPnlTotal:'3'}]
    assert.deepEqual(totalsByCurrency(reports), [])
    assert.deepEqual(totalsByCurrency([...reports,{currency:'USD',equity:'5',dayPnl:'0',realizedPnlTotal:'1'}]), [{currency:'USD',equity:'5',dayPnl:'0',realizedPnlTotal:'1'}])
  }
})
