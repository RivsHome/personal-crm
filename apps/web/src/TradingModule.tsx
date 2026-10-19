import { useEffect, useId, useState } from 'react'
import { combinedChartSeries, formatMoney, formatQuantity, pnlPercent, filterRows, formatTime, freshness, totalsByCurrency, type History, type Totals } from './trading-helpers.mjs'
import './trading.css'

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>
export type TradingBot = { id:string; displayName:string; platform:string; active:boolean; keyPrefix:string; lastReportAt:string|null; report: (Totals & {id:string;reportedAt:string;receivedAt:string;accountLabel:string|null;strategyNotes:string|null;riskFlags:{level:'info'|'warn'|'critical';message:string}[]})|null; positionsCount:number; freshness?:string }
type Overview = {bots:TradingBot[];totals:Totals[];staleAfterMinutes:number}
type Row = {botId:string;platform:string;currency?:string;reportedAt?:string;executedAt?:string;occurredAt?:string;[key:string]:unknown}
type Resources = {history:History[];positions:Row[];trades:Row[];orders:Row[];'cash-flows':Row[]}
const resources = ['history','positions','trades','orders','cash-flows'] as const
const colors = ['#b7df54','#63b5ef','#e7a6fa','#f4b66c','#67d7bd','#f18c9c']
const exact = (value:unknown) => value == null || value === '' ? '—' : String(value)
async function read<T>(apiFetch:ApiFetch,path:string,signal?:AbortSignal):Promise<T> {
  const response = await apiFetch(path,{signal})
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session expired. Please sign in again.' : `Trading request failed (${response.status}). Please retry.`)
  return response.json() as Promise<T>
}
function age(value:string|null,now:number) { return value ? `${Math.max(0,Math.floor((now-Date.parse(value))/60000))} min ago` : 'Never reported' }
const pnlClass=(value:unknown)=>String(value??"0").startsWith("-")?"pnl-negative":/^0([.]0+)?$/.test(String(value??"0"))?"pnl-neutral":"pnl-positive"
function Money({value,currency,signed=false}:{value:unknown;currency?:string|null;signed?:boolean}) {
 return <span className={signed?pnlClass(value):undefined} title={value==null?undefined:String(value)}>{formatMoney(value,currency,signed)}</span>
}
const metricLabels=[['equity','Equity'],['totalPnl','Total P&L'],['todayPnl','Today P&L'],['netDeposits','Net deposits'],['unrealizedPnl','Unrealized P&L'],['realizedPnl','Realized P&L']] as const
function Pnl({value,currency}:{value:unknown;currency?:string|null}) {
 const sign=String(value ?? '0').startsWith('-')?'negative':/^0(?:\.0*)?$/.test(String(value ?? '0'))?'neutral':'positive'
 return <span className={`trading-pnl ${sign}`}>{formatMoney(value,currency,true)}</span>
}
function Platform({name}:{name:string}) {
 const platform=name.toLowerCase().replace(/[\s_-]/g,'')
 const chip=({robinhood:'RH',hyperliquid:'HL',crypto:'CR',polymarket:'PM'} as Record<string,string>)[platform] || name.slice(0,2).toUpperCase()
 return <span className="trading-platform" data-platform={platform}><span className="trading-monogram" aria-hidden="true">{chip}</span>{name}</span>
}
export function BotCards({bots,staleAfterMinutes,now=Date.now()}:{bots:TradingBot[];staleAfterMinutes:number;now?:number}) {
 return <div className="trading-cards">{bots.map(bot=>{
  const report=bot.report;const received=report?.receivedAt || null;const state=freshness(received,staleAfterMinutes,now)
  const delayed=report && Math.abs(Date.parse(report.receivedAt)-Date.parse(report.reportedAt))>600000
  return <article className="trading-card" key={bot.id}>
   <div className="trading-card-header"><div className="trading-heading"><h3>{bot.displayName}</h3><span className={`trading-badge ${state}`}>{state==='never'?'No report':`${state[0].toUpperCase()}${state.slice(1)} - ${age(received,now)}`}</span></div><p><Platform name={bot.platform}/> · {bot.active?'Active':'Revoked'}{report?.accountLabel?` · ${report.accountLabel}`:''}</p></div>
   <dl>{(['equity','totalPnl','todayPnl','unrealizedPnl','realizedPnl'] as const).map(key=>{
    const computed=key==='unrealizedPnl'||key==='realizedPnl'
    const value=report?.[key] ?? (key==='todayPnl'?report?.dayPnl:key==='realizedPnl'?report?.realizedPnlTotal:undefined)
    return <div key={key}><dt title={computed?'May be computed from reported account inputs when not supplied.':undefined}>{key==='unrealizedPnl'?'Unrealized':key==='realizedPnl'?'Realized':metricLabels.find(m=>m[0]===key)?.[1]}</dt><dd title={String(value ?? '0')}>{key==='equity'?formatMoney(value,report?.currency??null):<Pnl value={value} currency={report?.currency??null}/>}</dd></div>
   })}<div><dt>Open positions</dt><dd>{bot.positionsCount ?? 0}</dd></div></dl>
   <div className="trading-card-footer"><p>Received: <time dateTime={received || undefined}>{formatTime(received)}</time></p>{delayed&&<p>Data as of: <time dateTime={report.reportedAt}>{formatTime(report.reportedAt)}</time></p>}{report ? <><details><summary>Strategy notes</summary><p className="trading-notes">{report.strategyNotes || 'No strategy notes.'}</p></details>{!!report.riskFlags?.length&&<ul className="trading-risks">{report.riskFlags.map((flag,i)=><li key={i} className={flag.level}><strong>{flag.level.toUpperCase()}</strong> {flag.message}</li>)}</ul>}</>:<p className="muted">Waiting for this bot’s first report.</p>}</div>
  </article>
 })}</div>
}
export function TradingTotals({reports}:{reports:Totals[]}) {
 const totals=totalsByCurrency(reports);const unknown=reports.some(r=>!r.currency?.trim())
 return <>{totals.map(total=><section key={total.currency}><h3>Combined · {total.currency}</h3><div className="trading-kpis">{metricLabels.map(([key,label])=><article className={`panel trading-kpi${key==='totalPnl'?' trading-kpi-primary':''}`} key={key}><h4>{label}</h4><div title={String(total[key])}>{key.toLowerCase().includes('pnl')?<Pnl value={total[key]} currency={total.currency}/>:formatMoney(total[key],total.currency)}</div>{key==='totalPnl'&&<small>{pnlPercent(total.totalPnl,total.netDeposits)} of net deposits</small>}</article>)}</div></section>)}{unknown?<p className="muted">Reports with unknown currencies are excluded from combined totals; their amounts remain on individual bot cards.</p>:!totals.length&&<p className="trading-empty">No reported totals for these bots yet.</p>}</>
}
export function EquityChart({history,bots,metric:initialMetric="totalPnl"}:{history:History[];bots:TradingBot[];metric?:string}) {
 const id=useId();const [metric,setMetric]=useState(initialMetric);const [tooltip,setTooltip]=useState("")
 const lines=combinedChartSeries(history,metric)
 if(!lines.length)return <p className="trading-empty">No P&amp;L or equity history in this date range.</p>
 const label=metric==="totalPnl"?"P&L":"Equity"
 return <><div className="trading-chart-controls" role="group" aria-label="Chart metric"><button type="button" aria-pressed={metric==="totalPnl"} onClick={()=>setMetric("totalPnl")}>P&amp;L</button><button type="button" aria-pressed={metric==="equity"} onClick={()=>setMetric("equity")}>Equity</button></div>{[...new Set(lines.map(l=>l.currency))].map((currency,currencyIndex)=>{
  const series=lines.filter(l=>l.currency===currency)
  let minT=Infinity,maxT=-Infinity,minV=0,maxV=0
  for(const line of series)for(const point of line.points){minT=Math.min(minT,point.time);maxT=Math.max(maxT,point.time);minV=Math.min(minV,point.value);maxV=Math.max(maxV,point.value)}
  const x=(time:number)=>90+(maxT===minT?320:(time-minT)/(maxT-minT)*640)
  const y=(value:number)=>170-(maxV===minV?65:(value-minV)/(maxV-minV)*130)
  // Four labeled gridlines, including a zero baseline for flat histories.
  if(maxV===minV) maxV=minV+1
  const ticks=Array.from({length:4},(_,i)=>minV+(maxV-minV)*i/3)
  return <figure className="trading-chart" key={currency}><figcaption>{label} over time · {currency||"Unknown currency"}</figcaption><svg viewBox="0 0 800 225" role="img" aria-labelledby={`${id}-${currencyIndex}`}><title id={`${id}-${currencyIndex}`}>{`${label} over time in ${currency||"unknown currency"}. Combined and individual bots. Times America/New_York.`}</title>{ticks.map((value,i)=><g key={i}><line className="trading-gridline" x1="90" y1={y(value)} x2="730" y2={y(value)}/><text className="trading-y-label" x="82" y={y(value)+3} textAnchor="end">{formatMoney(value.toFixed(2),currency)}</text></g>)}<line className="zero-line" x1="90" y1={y(0)} x2="730" y2={y(0)}/>{series.map((line,index)=><g key={line.botId}><polyline fill="none" stroke={colors[index%colors.length]} strokeWidth={line.botId==="__combined__"?3:1.5} points={line.points.map(p=>`${x(p.time)},${y(p.value)}`).join(" ")}/>{line.points.map((point,i)=>{
   const text=`${bots.find(b=>b.id===line.botId)?.displayName||(line.botId==="__combined__"?"Combined":line.botId)}: ${point.exact} ${currency||"Unknown currency"} · ${formatTime(new Date(point.time).toISOString())}`
   return <circle key={i} cx={x(point.time)} cy={y(point.value)} r={line.points.length===1?5:3} fill={colors[index%colors.length]} tabIndex={0} aria-label={text} aria-describedby={tooltip?`${id}-tooltip`:undefined} onFocus={()=>setTooltip(text)} onBlur={()=>setTooltip("")} onMouseEnter={()=>setTooltip(text)} onMouseLeave={()=>setTooltip("")}><title>{text}</title></circle>
  })}</g>)}<text x="90" y="195">{formatTime(new Date(minT).toISOString())}</text><text x="730" y="213" textAnchor="end">{formatTime(new Date(maxT).toISOString())}</text></svg><ul className="trading-legend">{series.map((line,index)=><li key={line.botId}><span style={{background:colors[index%colors.length]}}/>{bots.find(b=>b.id===line.botId)?.displayName||(line.botId==="__combined__"?"Combined":line.botId)}</li>)}</ul></figure>
 })}{tooltip&&<p id={`${id}-tooltip`} role="tooltip" className="trading-tooltip">{tooltip}</p>}</>
}
export function AboutTradingNumbers() {
 return <details className="trading-methodology"><summary>About these numbers</summary>
  <p>Reported account snapshots only; this dashboard cannot place trades. All times are America/New_York. Freshness is based on receipt time, not a guarantee of accuracy.</p>
  <p>Date filters apply to performance history, trades and cash flows. Totals, positions and orders show latest snapshots. Totals include revoked bots with reports; P&amp;L is computed when not reported; absent P&amp;L inputs default to zero.</p>
  <p>Combined lines carry each bot’s latest known snapshot forward in its own currency; unknown currencies are never combined. Long histories are sampled to at most 500 points per line, preserving endpoints and bucket minima/maxima. Chart coordinates are approximate; hover or focus a point for exact values. Financial totals are not sampled.</p>
 </details>
}
const tableColumns:Record<string,[string,string][]> = {
  positions:[['symbol','Symbol'],['market','Market'],['outcome','Outcome'],['side','Side'],['size','Size'],['entryPrice','Entry'],['markPrice','Mark'],['marketValue','Market value'],['unrealizedPnl','Unrealized PnL'],['leverage','Leverage'],['liquidationPrice','Liquidation'],['reportedAt','Reported']],
  trades:[['externalId','Trade ID'],['symbol','Symbol'],['market','Market'],['side','Side'],['qty','Quantity'],['price','Price'],['fee','Fee'],['realizedPnl','Realized PnL'],['executedAt','Executed']],
  orders:[['externalId','Order ID'],['symbol','Symbol'],['market','Market'],['outcome','Outcome'],['side','Side'],['type','Type'],['qty','Quantity'],['price','Price'],['status','Status'],['reportedAt','Reported']],
  'cash-flows':[['externalId','Transfer ID'],['type','Type'],['amount','Amount'],['occurredAt','Occurred'],['note','Note']]
}
export function TradingTable({kind,rows,bots}:{kind:string;rows:Row[];bots:TradingBot[]}) {
  if (!rows.length) return <p className="trading-empty">No {kind === 'cash-flows' ? 'deposits or withdrawals' : kind} match these filters.</p>
  const columns: [string,string][]=[['botId','Bot'],['platform','Platform'],['currency','Currency'],...tableColumns[kind]]
  const visibleColumns=columns.filter(([key])=>rows.some(row=>row[key]!=null&&String(row[key]).trim()!==''))
  const numeric=(key:string)=>/Pnl|marketValue|fee|amount|size|qty|Price|price|leverage/.test(key)
  return <div className="trading-table-wrap" role="region" aria-label={`${kind} table, scroll horizontally for more columns`} tabIndex={0}><table><caption>{kind === 'cash-flows' ? 'Deposits and withdrawals' : kind} · amounts rounded to 2 decimals; hover values for exact amounts</caption><thead><tr>{visibleColumns.map(([key,label])=><th scope="col" className={numeric(key)?'trading-numeric':undefined} key={key}>{label}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{visibleColumns.map(([key])=>key==='botId'?<th scope="row" key={key}>{bots.find(bot=>bot.id===row.botId)?.displayName || row.botId}</th>:<td key={key} className={numeric(key)?'trading-numeric':undefined} title={row[key]==null?undefined:String(row[key])}>{row[key]==null||String(row[key]).trim()===''?'—':key.endsWith('At') ? formatTime(String(row[key])) : /Pnl|marketValue|fee|amount/.test(key) ? <Money value={row[key]} currency={row.currency??null} signed={key.includes('Pnl')}/> : numeric(key) ? <span title={String(row[key])}>{formatQuantity(row[key])}</span> : exact(row[key])}</td>)}</tr>)}</tbody></table></div>
}
export default function TradingModule({apiFetch}:{apiFetch:ApiFetch}) {
  const [overview,setOverview]=useState<Overview|null>(null);const [data,setData]=useState<Partial<Resources>>({});const [errors,setErrors]=useState<Record<string,string>>({});const [loading,setLoading]=useState(true)
  const [filtersOpen,setFiltersOpen]=useState(false)
  useEffect(()=>{
    const media=window.matchMedia('(min-width:601px)')
    const update=()=>setFiltersOpen(media.matches)
    update();media.addEventListener('change',update)
    return()=>media.removeEventListener('change',update)
  },[])
  const [bot,setBot]=useState('');const [platform,setPlatform]=useState('');const [range,setRange]=useState('30d');const [from,setFrom]=useState('');const [to,setTo]=useState('');const [refresh,setRefresh]=useState(0);const [now,setNow]=useState(Date.now())
  useEffect(()=>{const timer=setInterval(()=>{setNow(Date.now());setRefresh(v=>v+1)},60000);return()=>clearInterval(timer)},[])
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setErrors({});setData({})
    const query=new URLSearchParams({range});if(bot)query.set('bot',bot)
    const requests=[read<Overview>(apiFetch,'/api/trading/overview',controller.signal).then(value=>{if(!controller.signal.aborted)setOverview(value)}).catch(error=>{if(!controller.signal.aborted){setOverview(null);setErrors(old=>({...old,overview:error.message}))}}),...resources.map(key=>read<Resources[typeof key]>(apiFetch,`/api/trading/${key}?${query}`,controller.signal).then(value=>{if(!controller.signal.aborted)setData(old=>({...old,[key]:value}))}).catch(error=>{if(!controller.signal.aborted)setErrors(old=>({...old,[key]:error.message}))}))]
    void Promise.all(requests).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[apiFetch,bot,range,refresh])
  const bots=(overview?.bots || []).filter(b=>(!bot || b.id===bot)&&(!platform || b.platform===platform))
  const reports=bots.flatMap(b=>b.report ? [b.report] : [])
  const filters={bot,platform,range,from,to};const invalidDates=Boolean(from&&to&&from>to)
  const history=(data.history||[]).map(row=>({...row,platform:row.platform || overview?.bots.find(b=>b.id===row.botId)?.platform}))
  return <section className="module-workspace trading-workspace" aria-label="Trading dashboard"><div className="panel trading-intro"><div className="trading-heading"><div><span className="panel-kicker">FINANCE · READ ONLY</span><h2>Trading</h2></div><button type="button" onClick={()=>setRefresh(v=>v+1)} disabled={loading}>Refresh</button></div><p>Account snapshots · Read only · New York time.</p><details className="trading-filter-disclosure" open={filtersOpen} onToggle={e=>setFiltersOpen(e.currentTarget.open)}><summary>Filters</summary><div className="trading-filters"><label>Bot<select value={bot} onChange={e=>setBot(e.target.value)}><option value="">All bots</option>{overview?.bots.map(b=><option key={b.id} value={b.id}>{b.displayName}</option>)}</select></label><label>Platform<select value={platform} onChange={e=>setPlatform(e.target.value)}><option value="">All platforms</option>{[...new Set(overview?.bots.map(b=>b.platform))].map(p=><option key={p}>{p}</option>)}</select></label><label>History / activity range<select value={range} onChange={e=>setRange(e.target.value)}><option value="7d">7 days</option><option value="30d">30 days</option><option value="90d">90 days</option><option value="all">All time</option></select></label><label>From (New York)<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through (New York)<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div></details><p className="muted">Dates filter history and activity; snapshots stay current.</p>{invalidDates&&<p role="alert">From date must be on or before the through date.</p>}{loading&&<p role="status">Loading trading reports…</p>}{errors.overview&&<p role="alert">{errors.overview}</p>}</div>
    {overview&&<><TradingTotals reports={reports}/>{bots.length ? <BotCards bots={bots} staleAfterMinutes={overview.staleAfterMinutes || 120} now={now}/> : <div className="panel trading-empty">{overview.bots.length ? 'No bots match these filters.' : 'No trading bots yet. Reports will appear once a bot is provisioned outside this dashboard.'}</div>}<p className="muted">Stale after {overview.staleAfterMinutes || 120} minutes; critical after 24 hours. Freshness is not a guarantee of accuracy.</p></>}
    <section className="panel"><h3>Performance over time</h3>{errors.history ? <p role="alert">{errors.history}</p> : data.history && <EquityChart history={invalidDates?[]:filterRows(history,filters,now)} bots={overview?.bots||[]}/>}<AboutTradingNumbers/></section>
    {(['positions','trades','orders','cash-flows'] as const).map(kind=><section className="panel" key={kind}><h3>{{positions:'Open positions / prediction markets',trades:'Recent trades',orders:'Open orders / prediction markets','cash-flows':'Deposits and withdrawals'}[kind]}</h3>{errors[kind] ? <p role="alert">{errors[kind]}</p> : data[kind] && <TradingTable kind={kind} rows={invalidDates&&['trades','cash-flows'].includes(kind)?[]:filterRows(data[kind]!,kind==='positions'||kind==='orders'?{bot,platform,range:'all'}:filters,now).sort((a,b)=>Date.parse(b.executedAt||b.occurredAt||b.reportedAt||'')-Date.parse(a.executedAt||a.occurredAt||a.reportedAt||''))} bots={overview?.bots||[]}/>}</section>)}
  </section>
}
