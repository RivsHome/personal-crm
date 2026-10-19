// Financial totals stay in decimal strings/BigInt. Number conversion is chart-only.
export function sumDecimal(values) {
  const valid = values.filter(v => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))
  if (!valid.length) return null
  const scale = Math.max(...valid.map(v => (v.split('.')[1] || '').length))
  const sum = valid.reduce((total, v) => {
    const negative = v.startsWith('-'); const [whole, fraction = ''] = v.replace('-', '').split('.')
    return total + BigInt(whole + fraction.padEnd(scale, '0')) * (negative ? -1n : 1n)
  }, 0n)
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0')
  return `${sum < 0n ? '-' : ''}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`
}
export function totalsByCurrency(reports) {
  // An unknown denomination cannot be combined, even with another unknown.
  const currencies = [...new Set(reports.map(r => r.currency).filter(currency => typeof currency === 'string' && currency.trim()))]
  return currencies.map(currency => {
    const rows = reports.filter(r => r.currency === currency)
    return {currency, ...Object.fromEntries(['equity','dayPnl','realizedPnlTotal'].map(k => [k,rows.some(r=>r[k] == null) ? null : sumDecimal(rows.map(r=>r[k]))]))}
  })
}
const timeFormatter = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'})
export function formatTime(value) { return value && Number.isFinite(Date.parse(value)) ? timeFormatter.format(new Date(value)) : 'No report' }
export function freshness(value, staleAfterMinutes = 120, now = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'never'
  const minutes = (now - Date.parse(value)) / 60000
  return minutes > 1440 ? 'critical' : minutes > staleAfterMinutes ? 'stale' : 'fresh'
}
const dayFormatter = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'})
export function filterRows(rows, filters = {}, now = Date.now()) {
  return rows.filter(row => {
    if (filters.bot && row.botId !== filters.bot || filters.platform && row.platform !== filters.platform) return false
    const stamp = row.executedAt || row.occurredAt || row.reportedAt
    if (!stamp) return !filters.from && !filters.to && (!filters.range || filters.range === 'all')
    const time = Date.parse(stamp)
    if (!Number.isFinite(time)) return false
    const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(time)).map(p=>[p.type,p.value]))
    const date = `${parts.year}-${parts.month}-${parts.day}`
    if (filters.from && date < filters.from || filters.to && date > filters.to) return false
    const days = { '7d':7, '30d':30, '90d':90 }[filters.range]
    return !days || time >= now - days * 86400000
  })
}
// Rendering only: retain endpoints and chronological min/max within each bucket.
// 249 interior buckets * 2 extrema + 2 endpoints = at most 500 points per line.
// Input snapshots and exact financial totals are never modified or aggregated.
function sampleChartPoints(points) {
  if (points.length <= 500) return points
  const sampled = [points[0]]
  const interior = points.length - 2
  for (let bucket = 0; bucket < 249; bucket++) {
    const start = 1 + Math.floor(bucket * interior / 249)
    const end = 1 + Math.floor((bucket + 1) * interior / 249)
    let min = start; let max = start
    for (let index = start + 1; index < end; index++) {
      if (points[index].value < points[min].value) min = index
      if (points[index].value > points[max].value) max = index
    }
    if (min === max) sampled.push(points[min])
    else if (min < max) sampled.push(points[min], points[max])
    else sampled.push(points[max], points[min])
  }
  sampled.push(points[points.length - 1])
  return sampled
}
export function chartSeries(history) {
  const groups = new Map()
  for (const row of history) {
    if (row.equity == null || !Number.isFinite(Number(row.equity)) || !Number.isFinite(Date.parse(row.reportedAt))) continue
    const key = JSON.stringify([row.botId,row.currency])
    if (!groups.has(key)) groups.set(key,{botId:row.botId,currency:row.currency,points:[]})
    groups.get(key).points.push({time:Date.parse(row.reportedAt),value:Number(row.equity),exact:row.equity})
  }
  return [...groups.values()].map(line=>({...line,points:sampleChartPoints(line.points.sort((a,b)=>a.time-b.time))}))
}
