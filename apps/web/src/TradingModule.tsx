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
 return <span className="trading-platform"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13V8h3v5m2 0V3h3v10m2 0V6h3v7" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>{name}</span>
}
export function BotCards({bots,staleAfterMinutes,now=Date.now()}:{bots:TradingBot[];staleAfterMinutes:number;now?:number}) {
 return <div className="trading-cards">{bots.map(bot=>{
  const report=bot.report;const received=report?.receivedAt || null;const state=freshness(received,staleAfterMinutes,now)
  const delayed=report && Math.abs(Date.parse(report.receivedAt)-Date.parse(report.reportedAt))>600000
  return <article className="trading-card" key={bot.id}><div className="trading-heading"><h3>{bot.displayName}</h3><span className={`trading-badge ${state}`}>{state==='never'?'No report':`${state} · ${age(received,now)}`}</span></div><p><Platform name={bot.platform}/> · {bot.active?'Active':'Revoked'}{report?.accountLabel?` · ${report.accountLabel}`:''}</p><dl>{(['equity','totalPnl','todayPnl'] as const).map(key=><div key={key}><dt>{metricLabels.find(m=>m[0]===key)?.[1]}</dt><dd title={String(report?.[key] ?? '0')}>{key==='equity'?formatMoney(report?.equity,report?.currency??null):<Pnl value={report?.[key] ?? (key==='todayPnl'?report?.dayPnl:undefined)} currency={report?.currency??null}/>}</dd></div>)}<div><dt>Open positions</dt><dd>{bot.positionsCount ?? 0}</dd></div></dl><p>Received: <time dateTime={received || undefined}>{formatTime(received)}</time></p>{delayed&&<p>Data as of: <time dateTime={report.reportedAt}>{formatTime(report.reportedAt)}</time></p>}{report ? <><details><summary>Strategy notes</summary><p className="trading-notes">{report.strategyNotes || 'No strategy notes.'}</p></details>{report.riskFlags?.length?<ul className="trading-risks">{report.riskFlags.map((flag,i)=><li key={i} className={flag.level}><strong>{flag.level.toUpperCase()}</strong> {flag.message}</li>)}</ul>:<p className="muted">No reported risk flags.</p>}</>:<p className="muted">Waiting for this bot’s first report.</p>}</article>
 })}</div>
}
export function TradingTotals({reports}:{reports:Totals[]}) {
 const totals=totalsByCurrency(reports);const unknown=reports.some(r=>!r.currency?.trim())
 return <>{totals.map(total=><section key={total.currency}><h3>Combined · {total.currency}</h3><div className="trading-kpis">{metricLabels.map(([key,label])=><article className="panel trading-kpi" key={key}><h4>{label}</h4><div title={String(total[key])}>{key.toLowerCase().includes('pnl')?<Pnl value={total[key]} currency={total.currency}/>:formatMoney(total[key],total.currency)}</div>{key==='totalPnl'&&<small>{pnlPercent(total.totalPnl,total.netDeposits)} of net deposits</small>}</article>)}</div></section>)}{unknown?<p className="muted">Reports with unknown currencies are excluded from combined totals; their amounts remain on individual bot cards.</p>:!totals.length&&<p className="trading-empty">No reported totals for these bots yet.</p>}</>
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
  return <figure className="trading-chart" key={currency}><figcaption>{label} over time · {currency||"Unknown currency"} (approximate chart)</figcaption><svg viewBox="0 0 800 225" role="img" aria-labelledby={`${id}-${currencyIndex}`}><title id={`${id}-${currencyIndex}`}>{`${label} over time in ${currency||"unknown currency"}. Combined and individual bots. Times America/New_York.`}</title><line x1="90" y1="40" x2="90" y2="170" stroke="currentColor" opacity=".3"/><line className="zero-line" x1="90" y1={y(0)} x2="730" y2={y(0)} stroke="currentColor" strokeDasharray="4 4" opacity=".5"/><text x="4" y="35">{maxV.toPrecision(5)}</text><text x="4" y="170">{minV.toPrecision(5)}</text><text x="4" y="20">{currency||"Unknown"}</text>{series.map((line,index)=><g key={line.botId}><polyline fill="none" stroke={colors[index%colors.length]} strokeWidth={line.botId==="__combined__"?4:2} strokeDasharray={line.botId==="__combined__"?"6 3":undefined} points={line.points.map(p=>`${x(p.time)},${y(p.value)}`).join(" ")}/>{line.points.map((point,i)=>{
   const text=`${bots.find(b=>b.id===line.botId)?.displayName||(line.botId==="__combined__"?"Combined":line.botId)}: ${point.exact} ${currency||"Unknown currency"} · ${formatTime(new Date(point.time).toISOString())}`
   return <circle key={i} cx={x(point.time)} cy={y(point.value)} r={line.points.length===1?5:3} fill={colors[index%colors.length]} tabIndex={0} aria-label={text} aria-describedby={`${id}-tooltip`} onFocus={()=>setTooltip(text)} onBlur={()=>setTooltip("")} onMouseEnter={()=>setTooltip(text)} onMouseLeave={()=>setTooltip("")}><title>{text}</title></circle>
  })}</g>)}<text x="90" y="195">{formatTime(new Date(minT).toISOString())}</text><text x="730" y="213" textAnchor="end">{formatTime(new Date(maxT).toISOString())}</text></svg><ul className="trading-legend">{series.map((line,index)=><li key={line.botId}><span style={{background:colors[index%colors.length]}}/>{bots.find(b=>b.id===line.botId)?.displayName||(line.botId==="__combined__"?"Combined":line.botId)}</li>)}</ul></figure>
 })}<p id={`${id}-tooltip`} role="tooltip" className="trading-tooltip">{tooltip||"Hover or focus a point for its exact amount and New York time."}</p><p className="muted">Combined lines carry each bot’s latest known snapshot forward in its own currency; unknown currencies are never combined. Long histories are sampled to at most 500 points per line, preserving endpoints and bucket minima/maxima. Financial totals are not sampled.</p></>
}
const tableColumns:Record<string,[string,string][]> = {
  positions:[['symbol','Symbol'],['market','Market'],['outcome','Outcome'],['side','Side'],['size','Size'],['entryPrice','Entry'],['markPrice','Mark'],['marketValue','Market value'],['unrealizedPnl','Unrealized PnL'],['leverage','Leverage'],['liquidationPrice','Liquidation'],['reportedAt','Reported']],
  trades:[['externalId','Trade ID'],['symbol','Symbol'],['market','Market'],['side','Side'],['qty','Quantity'],['price','Price'],['fee','Fee'],['realizedPnl','Realized PnL'],['executedAt','Executed']],
  orders:[['externalId','Order ID'],['symbol','Symbol'],['market','Market'],['outcome','Outcome'],['side','Side'],['type','Type'],['qty','Quantity'],['price','Price'],['status','Status'],['reportedAt','Reported']],
  'cash-flows':[['externalId','Transfer ID'],['type','Type'],['amount','Amount'],['occurredAt','Occurred'],['note','Note']]
}
export function TradingTable({kind,rows,bots}:{kind:string;rows:Row[];bots:TradingBot[]}) {
  if (!rows.length) return <p className="trading-empty">No {kind === 'cash-flows' ? 'deposits or withdrawals' : kind} match these filters.</p>
  return <div className="trading-table-wrap" role="region" aria-label={`${kind} table, scroll horizontally for more columns`} tabIndex={0}><table><caption>{kind === 'cash-flows' ? 'Deposits and withdrawals' : kind} · amounts rounded to 2 decimals; hover values for exact amounts</caption><thead><tr><th scope="col">Bot</th><th scope="col">Platform</th><th scope="col">Currency</th>{tableColumns[kind].map(([key,label])=><th scope="col" key={key}>{label}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}><th scope="row">{bots.find(bot=>bot.id===row.botId)?.displayName || row.botId}</th><td>{row.platform}</td><td>{exact(row.currency)}</td>{tableColumns[kind].map(([key])=><td key={key} title={row[key]==null?undefined:String(row[key])}>{key.endsWith('At') ? (row[key] ? formatTime(String(row[key])) : '—') : /Pnl|marketValue|fee|amount/.test(key) ? <Money value={row[key]} currency={row.currency??null} signed={key.includes('Pnl')}/> : /size|qty|Price|price|leverage/.test(key) ? <span title={String(row[key]??'')}>{formatQuantity(row[key])}</span> : exact(row[key])}</td>)}</tr>)}</tbody></table></div>
}
export default function TradingModule({apiFetch}:{apiFetch:ApiFetch}) {
  const [overview,setOverview]=useState<Overview|null>(null);const [data,setData]=useState<Partial<Resources>>({});const [errors,setErrors]=useState<Record<string,string>>({});const [loading,setLoading]=useState(true)
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
  return <section className="module-workspace trading-workspace" aria-label="Trading dashboard"><div className="panel trading-intro"><div className="trading-heading"><div><span className="panel-kicker">FINANCE · READ ONLY</span><h2>Trading</h2></div><button type="button" onClick={()=>setRefresh(v=>v+1)} disabled={loading}>Refresh</button></div><p>Reported account snapshots. No trading actions. All times America/New_York.</p><div className="trading-filters"><label>Bot<select value={bot} onChange={e=>setBot(e.target.value)}><option value="">All bots</option>{overview?.bots.map(b=><option key={b.id} value={b.id}>{b.displayName}</option>)}</select></label><label>Platform<select value={platform} onChange={e=>setPlatform(e.target.value)}><option value="">All platforms</option>{[...new Set(overview?.bots.map(b=>b.platform))].map(p=><option key={p}>{p}</option>)}</select></label><label>History / activity range<select value={range} onChange={e=>setRange(e.target.value)}><option value="7d">7 days</option><option value="30d">30 days</option><option value="90d">90 days</option><option value="all">All time</option></select></label><label>From (New York)<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through (New York)<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div><p className="muted">Date filters apply to performance history, trades and cash flows. Totals, positions and orders show latest snapshots. Totals include revoked bots with reports; P&L is computed when not reported; absent P&L inputs default to zero.</p>{invalidDates&&<p role="alert">From date must be on or before the through date.</p>}{loading&&<p role="status">Loading trading reports…</p>}{errors.overview&&<p role="alert">{errors.overview}</p>}</div>
    {overview&&<><TradingTotals reports={reports}/>{bots.length ? <BotCards bots={bots} staleAfterMinutes={overview.staleAfterMinutes || 120} now={now}/> : <div className="panel trading-empty">{overview.bots.length ? 'No bots match these filters.' : 'No trading bots yet. Reports will appear once a bot is provisioned outside this dashboard.'}</div>}<p className="muted">Stale after {overview.staleAfterMinutes || 120} minutes; critical after 24 hours. Freshness is not a guarantee of accuracy.</p></>}
    <section className="panel"><h3>Performance over time</h3>{errors.history ? <p role="alert">{errors.history}</p> : data.history && <EquityChart history={invalidDates?[]:filterRows(history,filters,now)} bots={overview?.bots||[]}/>}</section>
    {(['positions','trades','orders','cash-flows'] as const).map(kind=><section className="panel" key={kind}><h3>{{positions:'Open positions / prediction markets',trades:'Recent trades',orders:'Open orders / prediction markets','cash-flows':'Deposits and withdrawals'}[kind]}</h3>{errors[kind] ? <p role="alert">{errors[kind]}</p> : data[kind] && <TradingTable kind={kind} rows={invalidDates&&['trades','cash-flows'].includes(kind)?[]:filterRows(data[kind]!,kind==='positions'||kind==='orders'?{bot,platform,range:'all'}:filters,now).sort((a,b)=>Date.parse(b.executedAt||b.occurredAt||b.reportedAt||'')-Date.parse(a.executedAt||a.occurredAt||a.reportedAt||''))} bots={overview?.bots||[]}/>}</section>)}
  </section>
}
