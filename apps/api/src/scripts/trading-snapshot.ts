import pg from "pg"
import type {Pool} from "pg"
import {pathToFileURL} from "node:url"
import {readTrading} from "../trading.js"

export async function runSnapshot(args:string[],pool:Pick<Pool,"query">,write:(value:string)=>void) {
 const [route="overview",...rest]=args
 if(rest.length || !["overview","history","positions","trades","orders","cash-flows"].includes(route)) throw new Error("Usage: trading-snapshot [overview|history|positions|trades|orders|cash-flows]")
 write(JSON.stringify(await readTrading(pool,route,route==="history"?{range:"all"}:{}))+"\n")
}
export async function main(args=process.argv.slice(2)) {
 if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.")
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL})
 try {await runSnapshot(args,pool,value=>process.stdout.write(value))} finally {await pool.end()}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(()=>{process.stderr.write("Trading snapshot failed. Check command and database configuration.\n");process.exitCode=1})
