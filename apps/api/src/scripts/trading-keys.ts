import pg from 'pg'
import type { Pool } from 'pg'
import { pathToFileURL } from 'node:url'

type IO = {read:()=>Promise<string>;write:(value:string)=>void}
export async function runKeys(args:string[],pool:Pick<Pool,'query'>,io:IO) {
  const [command,slug,name,platform,...options]=args
  if(command==='register') {
    if(!slug || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(slug) || !name || name.length>2000 || !platform || platform.length>2000 || (options.length!==0 && (options.length!==2 || options[0]!=='--prefix' || !/^[\w-]{0,8}$/.test(options[1])))) throw new Error('Usage: register <slug> <display name> <platform> [--prefix xxx]')
    const hash=(await io.read()).trim()
    if(!/^[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Expected a SHA256 hex digest on stdin.')
    await pool.query(`INSERT INTO trading_bots(id,display_name,platform,key_hash,key_prefix) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,platform=EXCLUDED.platform,key_hash=EXCLUDED.key_hash,key_prefix=EXCLUDED.key_prefix,active=true,revoked_at=NULL`,[slug,name,platform,hash.toLowerCase(),options[1]??''])
    io.write('Registered.\n');return
  }
  if(command==='list' && args.length===1) {
    const result=await pool.query('SELECT id AS slug,key_prefix AS prefix,active,last_report_at FROM trading_bots ORDER BY id')
    io.write(JSON.stringify(result.rows)+'\n');return
  }
  if(command==='revoke' && slug && args.length===2) {
    const result=await pool.query('UPDATE trading_bots SET active=false,revoked_at=now() WHERE id=$1 RETURNING id',[slug])
    if(!result.rowCount) throw new Error('Bot not found.')
    io.write('Revoked.\n');return
  }
  if(command==='delete' && slug && args.length===3 && name==='--with-data') {
    const result=await pool.query('DELETE FROM trading_bots WHERE id=$1 RETURNING id',[slug])
    if(!result.rowCount) throw new Error('Bot not found.')
    io.write('Deleted with data.\n');return
  }
  throw new Error('Usage: register <slug> <display name> <platform> [--prefix xxx] | revoke <slug> | delete <slug> --with-data | list')
}
export async function main(args=process.argv.slice(2)) {
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL})
  try {
    await runKeys(args,pool,{read:async()=>{
      let value=''
      for await(const chunk of process.stdin) { value+=chunk.toString();if(value.length>1024)throw new Error('Invalid digest input.') }
      return value
    },write:value=>process.stdout.write(value)})
  } finally {await pool.end()}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(()=>{process.stderr.write('Trading key operation failed. Check command, digest input, and database configuration.\n');process.exitCode=1})
}
