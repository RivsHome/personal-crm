export type Decimal = string | null
export type Totals = {currency:string|null; equity:Decimal; dayPnl:Decimal; realizedPnlTotal:Decimal}
export type History = Totals & {botId:string; reportedAt:string; platform?:string}
export type Filters = {bot?:string;platform?:string;range?:string;from?:string;to?:string}
export function sumDecimal(values: (string|null|undefined)[]): Decimal
export function totalsByCurrency(reports: Totals[]): (Totals & {currency:string})[]
export function formatTime(value?:string|null):string
export function freshness(value?:string|null, staleAfterMinutes?:number, now?:number): 'fresh'|'stale'|'critical'|'never'
export function filterRows<T extends {botId?:string;platform?:string;executedAt?:string;occurredAt?:string;reportedAt?:string}>(rows:T[],filters?:Filters,now?:number):T[]
export function chartSeries(history:History[]): {botId:string;currency:string|null;points:{time:number;value:number;exact:string}[]}[]
