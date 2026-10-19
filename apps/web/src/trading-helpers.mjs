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
  const currencies=[...new Set(reports.map(r=>r.currency).filter(c=>typeof c==='string' && c.trim()))]
  return currencies.map(currency=>{
    const rows=reports.filter(r=>r.currency===currency)
    return {currency,...Object.fromEntries(['equity','totalPnl','todayPnl','netDeposits','unrealizedPnl','realizedPnl'].map(k=>[k,sumDecimal(rows.map(r=>r[k] ?? (k==='todayPnl'?r.dayPnl:k==='realizedPnl'?r.realizedPnlTotal:undefined) ?? '0')) ?? '0']))}
  })
}
function decimalParts(value) {
  const text=String(value ?? '0')
  if(!/^-?\d+(\.\d+)?$/.test(text)) return {integer:0n,scale:0}
  const [whole,fraction='']=text.replace('-','').split('.')
  return {integer:BigInt(whole+fraction)*(text.startsWith('-')?-1n:1n),scale:fraction.length}
}
export function formatMoney(value,currency='USD',signed=false) {
  const {integer,scale}=decimalParts(value)
  const absolute=integer<0n?-integer:integer
  const divisor=10n**BigInt(scale)
  const cents=(absolute*100n+divisor/2n)/divisor
  const whole=(cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')
  const symbol={USD:'$',EUR:'€',GBP:'£'}[currency] ?? `${currency?.trim() || 'Unknown currency'} `
  return `${cents===0n?'':integer<0n?'-':signed?'+':''}${symbol}${whole}.${(cents%100n).toString().padStart(2,'0')}`
}
export function formatQuantity(value) {
  if(value==null || value==='') return '—'
  const text=String(value)
  return text.includes('.') ? text.replace(/0+$/,'').replace(/\.$/,'') : text
}
export function pnlPercent(pnl,deposits) {
  const a=decimalParts(pnl);const b=decimalParts(deposits)
  if(b.integer<=0n) return 'N/A'
  const numerator=a.integer*10000n*10n**BigInt(b.scale)
  const denominator=b.integer*10n**BigInt(a.scale)
  const abs=numerator<0n?-numerator:numerator
  const result=(abs+denominator/2n)/denominator
  return `${result===0n?'':numerator<0n?'-':'+'}${result/100n}.${(result%100n).toString().padStart(2,'0')}%`
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
export function chartSeries(history, metric = 'equity') {
  const groups = new Map()
  for (const source of history) {
    const row={...source,equity:source[metric]}
    if (row.equity == null || !Number.isFinite(Number(row.equity)) || !Number.isFinite(Date.parse(row.reportedAt))) continue
    const key = JSON.stringify([row.botId,row.currency])
    if (!groups.has(key)) groups.set(key,{botId:row.botId,currency:row.currency,points:[]})
    groups.get(key).points.push({time:Date.parse(row.reportedAt),value:Number(row.equity),exact:row.equity})
  }
  return [...groups.values()].map(line=>({...line,points:sampleChartPoints(line.points.sort((a,b)=>a.time-b.time))}))
}

export function combinedChartSeries(history,metric='totalPnl') {
 const result=chartSeries(history,metric)
 const counts=new Map()
 for(const row of history) {
  if(!row.currency?.trim() || row[metric]==null || !Number.isFinite(Date.parse(row.reportedAt)))continue
  if(!counts.has(row.currency))counts.set(row.currency,new Set())
  counts.get(row.currency).add(row.botId)
 }
 const combined=combinedHistory(history,metric).filter(row=>counts.get(row.currency)?.size>1)
 return [...result,...chartSeries(combined,metric)]
}

// Carry each bot's latest observed snapshot forward at the union of timestamps.
// Never add snapshots from the same bot; never mix denominations.
export function combinedHistory(history,metric='totalPnl') {
 const currencies=new Map()
 for(const row of history) {
  if(!row.currency?.trim() || row[metric]==null || !Number.isFinite(Date.parse(row.reportedAt))) continue
  if(!currencies.has(row.currency)) currencies.set(row.currency,[])
  currencies.get(row.currency).push(row)
 }
 const output=[]
 for(const [currency,rows] of currencies) {
  rows.sort((a,b)=>Date.parse(a.reportedAt)-Date.parse(b.reportedAt))
  const latest=new Map()
  for(let i=0;i<rows.length;) {
   const time=Date.parse(rows[i].reportedAt)
   do {latest.set(rows[i].botId,rows[i][metric]);i++} while(i<rows.length && Date.parse(rows[i].reportedAt)===time)
   output.push({botId:'__combined__',currency,reportedAt:new Date(time).toISOString(),[metric]:sumDecimal([...latest.values()])})
  }
 }
 return output
}
