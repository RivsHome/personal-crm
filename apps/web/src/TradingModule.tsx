import { useEffect, useId, useState } from 'react'
import { chartSeries, filterRows, formatTime, freshness, totalsByCurrency, type History, type Totals } from './trading-helpers.mjs'
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
export function BotCards({bots,staleAfterMinutes,now=Date.now()}:{bots:TradingBot[];staleAfterMinutes:number;now?:number}) {
  return <div className="trading-cards">{bots.map(bot => {
    const report=bot.report; const state=freshness(bot.lastReportAt,staleAfterMinutes,now)
    return <article className="trading-card" key={bot.id}><div className="trading-heading"><h3>{bot.displayName}</h3><span className={`trading-badge ${state}`}>{state === 'never' ? 'No report' : state}</span></div><p>{bot.platform} · {bot.active ? 'Active' : 'Revoked'}{report?.accountLabel ? ` · ${report.accountLabel}` : ''}</p><dl><div><dt>Equity</dt><dd>{report?.currency?.trim() ? report.currency : 'Unknown currency'} {exact(report?.equity)}</dd></div><div><dt>Day PnL</dt><dd>{report?.currency?.trim() ? report.currency : 'Unknown currency'} {exact(report?.dayPnl)}</dd></div><div><dt>Realized PnL</dt><dd>{report?.currency?.trim() ? report.currency : 'Unknown currency'} {exact(report?.realizedPnlTotal)}</dd></div><div><dt>Open positions</dt><dd>{bot.positionsCount ?? 0}</dd></div></dl><p>Last report: {age(bot.lastReportAt,now)}<br/><time dateTime={bot.lastReportAt || undefined}>{formatTime(bot.lastReportAt)}</time></p>{report ? <><p className="trading-notes">{report.strategyNotes || 'No strategy notes.'}</p>{report.riskFlags?.length ? <ul className="trading-risks">{report.riskFlags.map((flag,i)=><li key={i} className={flag.level}><strong>{flag.level.toUpperCase()}</strong> {flag.message}</li>)}</ul> : <p className="muted">No reported risk flags.</p>}</> : <p className="muted">Waiting for this bot’s first report.</p>}</article>
  })}</div>
}
export function TradingTotals({reports}:{reports:Totals[]}) {
  const totals=totalsByCurrency(reports)
  const hasUnknown=reports.some(report=>!report.currency?.trim())
  return <><div className="trading-totals">{totals.map(total=><article className="panel" key={total.currency}><h3>Combined · {total.currency}</h3><dl><div><dt>Equity</dt><dd>{exact(total.equity)}</dd></div><div><dt>Day PnL</dt><dd>{exact(total.dayPnl)}</dd></div><div><dt>Realized PnL total</dt><dd>{exact(total.realizedPnlTotal)}</dd></div></dl></article>)}</div>{hasUnknown ? <p className="muted">Reports with unknown currencies are excluded from combined totals; their amounts remain on individual bot cards.</p> : !totals.length && <p className="trading-empty">No reported totals for these bots yet.</p>}</>
}
export function EquityChart({history,bots}:{history:History[];bots:TradingBot[]}) {
  const id=useId(); const lines=chartSeries(history)
  if (!lines.length) return <p className="trading-empty">No equity history in this date range.</p>
  return <>{[...new Set(lines.map(line=>line.currency))].map((currency,currencyIndex)=>{
    const series=lines.filter(line=>line.currency===currency)
    let minT=Infinity; let maxT=-Infinity; let minV=Infinity; let maxV=-Infinity
    for (const line of series) for (const point of line.points) {
      minT=Math.min(minT,point.time); maxT=Math.max(maxT,point.time)
      minV=Math.min(minV,point.value); maxV=Math.max(maxV,point.value)
    }
    const x=(time:number)=>60+(time-minT)/(maxT-minT||1)*680; const y=(value:number)=>165-(value-minV)/(maxV-minV||1)*135
    return <figure className="trading-chart" key={currency}><figcaption>Equity · {currency} (approximate chart)</figcaption><svg viewBox="0 0 800 210" role="img" aria-labelledby={`${id}-${currencyIndex}`}><title id={`${id}-${currencyIndex}`}>{`Equity over time in ${currency}, separate line for each bot. Times America/New_York.`}</title><line x1="60" y1="165" x2="740" y2="165" stroke="currentColor" opacity=".3"/><text x="4" y="35">{maxV.toPrecision(5)}</text><text x="4" y="165">{minV.toPrecision(5)}</text>{series.map((line,index)=><g key={line.botId}><polyline fill="none" stroke={colors[index%colors.length]} strokeWidth="2.5" points={line.points.map(p=>`${x(p.time)},${y(p.value)}`).join(' ')}/>{line.points.map((point,i)=><circle key={i} cx={x(point.time)} cy={y(point.value)} r="3" fill={colors[index%colors.length]}><title>{`${bots.find(b=>b.id===line.botId)?.displayName || line.botId}: ${point.exact} ${currency} · ${formatTime(new Date(point.time).toISOString())}`}</title></circle>)}</g>)}<text x="60" y="195">{formatTime(new Date(minT).toISOString())}</text><text x="740" y="195" textAnchor="end">{formatTime(new Date(maxT).toISOString())}</text></svg><ul className="trading-legend">{series.map((line,index)=><li key={line.botId}><span style={{background:colors[index%colors.length]}}/>{bots.find(b=>b.id===line.botId)?.displayName || line.botId}</li>)}</ul></figure>
  })}<p className="muted">Each line shows one bot’s reported equity, not a sum of historical snapshots. Long histories are sampled to at most 500 points per line, preserving endpoints and bucket minima/maxima. Exact reported amounts are available on retained chart point tooltips; financial totals are not sampled.</p></>
}
const tableColumns:Record<string,[string,string][]> = {
  positions:[['symbol','Symbol'],['market','Market'],['outcome','Outcome'],['side','Side'],['size','Size'],['entryPrice','Entry'],['markPrice','Mark'],['marketValue','Market value'],['unrealizedPnl','Unrealized PnL'],['leverage','Leverage'],['liquidationPrice','Liquidation'],['reportedAt','Reported']],
  trades:[['externalId','Trade ID'],['symbol','Symbol'],['market','Market'],['side','Side'],['qty','Quantity'],['price','Price'],['fee','Fee'],['realizedPnl','Realized PnL'],['executedAt','Executed']],
  orders:[['externalId','Order ID'],['symbol','Symbol'],['market','Market'],['outcome','Outcome'],['side','Side'],['type','Type'],['qty','Quantity'],['price','Price'],['status','Status'],['reportedAt','Reported']],
  'cash-flows':[['externalId','Transfer ID'],['type','Type'],['amount','Amount'],['occurredAt','Occurred'],['note','Note']]
}
export function TradingTable({kind,rows,bots}:{kind:string;rows:Row[];bots:TradingBot[]}) {
  if (!rows.length) return <p className="trading-empty">No {kind === 'cash-flows' ? 'deposits or withdrawals' : kind} match these filters.</p>
  return <div className="trading-table-wrap" role="region" aria-label={`${kind} table, scroll horizontally for more columns`} tabIndex={0}><table><caption>{kind === 'cash-flows' ? 'Deposits and withdrawals' : kind} · exact reported values</caption><thead><tr><th scope="col">Bot</th><th scope="col">Platform</th><th scope="col">Currency</th>{tableColumns[kind].map(([key,label])=><th scope="col" key={key}>{label}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}><th scope="row">{bots.find(bot=>bot.id===row.botId)?.displayName || row.botId}</th><td>{row.platform}</td><td>{exact(row.currency)}</td>{tableColumns[kind].map(([key])=><td key={key}>{key.endsWith('At') ? (row[key] ? formatTime(String(row[key])) : '—') : exact(row[key])}</td>)}</tr>)}</tbody></table></div>
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
  return <section className="module-workspace trading-workspace" aria-label="Trading dashboard"><div className="panel trading-intro"><div className="trading-heading"><div><span className="panel-kicker">FINANCE · READ ONLY</span><h2>Trading</h2></div><button type="button" onClick={()=>setRefresh(v=>v+1)} disabled={loading}>Refresh</button></div><p>Reported account snapshots. No trading actions. All times America/New_York.</p><div className="trading-filters"><label>Bot<select value={bot} onChange={e=>setBot(e.target.value)}><option value="">All bots</option>{overview?.bots.map(b=><option key={b.id} value={b.id}>{b.displayName}</option>)}</select></label><label>Platform<select value={platform} onChange={e=>setPlatform(e.target.value)}><option value="">All platforms</option>{[...new Set(overview?.bots.map(b=>b.platform))].map(p=><option key={p}>{p}</option>)}</select></label><label>History / activity range<select value={range} onChange={e=>setRange(e.target.value)}><option value="7d">7 days</option><option value="30d">30 days</option><option value="90d">90 days</option><option value="all">All time</option></select></label><label>From (New York)<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through (New York)<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div><p className="muted">Date filters apply to equity history, trades and cash flows. Totals, positions and orders show latest snapshots. Totals include revoked bots with reports; missing values are unknown, not zero.</p>{invalidDates&&<p role="alert">From date must be on or before the through date.</p>}{loading&&<p role="status">Loading trading reports…</p>}{errors.overview&&<p role="alert">{errors.overview}</p>}</div>
    {overview&&<><TradingTotals reports={reports}/>{bots.length ? <BotCards bots={bots} staleAfterMinutes={overview.staleAfterMinutes || 120} now={now}/> : <div className="panel trading-empty">{overview.bots.length ? 'No bots match these filters.' : 'No trading bots yet. Reports will appear once a bot is provisioned outside this dashboard.'}</div>}<p className="muted">Stale after {overview.staleAfterMinutes || 120} minutes; critical after 24 hours. Freshness is not a guarantee of accuracy.</p></>}
    <section className="panel"><h3>Equity over time</h3>{errors.history ? <p role="alert">{errors.history}</p> : data.history && <EquityChart history={invalidDates?[]:filterRows(history,filters,now)} bots={overview?.bots||[]}/>}</section>
    {(['positions','trades','orders','cash-flows'] as const).map(kind=><section className="panel" key={kind}><h3>{{positions:'Open positions / prediction markets',trades:'Recent trades',orders:'Open orders / prediction markets','cash-flows':'Deposits and withdrawals'}[kind]}</h3>{errors[kind] ? <p role="alert">{errors[kind]}</p> : data[kind] && <TradingTable kind={kind} rows={invalidDates&&['trades','cash-flows'].includes(kind)?[]:filterRows(data[kind]!,kind==='positions'||kind==='orders'?{bot,platform,range:'all'}:filters,now).sort((a,b)=>Date.parse(b.executedAt||b.occurredAt||b.reportedAt||'')-Date.parse(a.executedAt||a.occurredAt||a.reportedAt||''))} bots={overview?.bots||[]}/>}</section>)}
  </section>
}
