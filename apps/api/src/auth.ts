import { promisify } from 'node:util'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const scrypt = promisify(scryptCallback)
const file = path.resolve(process.cwd(), 'data', 'auth.json')
type User = { email: string; name: string; password: string }
type Session = { token: string; email: string; expires: number }
type AuthStore = { user: User | null; sessions: Session[] }
let user: User | null = null
const sessions = new Map<string, Session>()

async function load() {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as User | AuthStore
    if ('user' in parsed) { user = parsed.user; for (const session of parsed.sessions ?? []) if (session.expires > Date.now()) sessions.set(session.token, session) }
    else user = parsed
  } catch { user = null }
}
async function save() { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify({ user, sessions: [...sessions.values()] }, null, 2)) }
async function hash(password: string) { const salt = randomBytes(16).toString('hex'); const key = await scrypt(password, salt, 64) as Buffer; return `${salt}:${key.toString('hex')}` }
async function verify(password: string, stored: string) { const [salt, hex] = stored.split(':'); const key = await scrypt(password, salt, 64) as Buffer; return timingSafeEqual(key, Buffer.from(hex, 'hex')) }
export async function initializeAuth() { await load() }
export async function register(email: string, name: string, password: string) { if (user) return null; user = { email, name, password: await hash(password) }; await save(); return { email, name } }
export async function login(email: string, password: string) { if (!user || user.email !== email || !(await verify(password, user.password))) return null; const session = { token: randomBytes(32).toString('hex'), email, expires: Date.now() + 1000 * 60 * 60 * 24 * 30 }; sessions.set(session.token, session); await save(); return session }
export async function changePassword(email: string, currentPassword: string, newPassword: string) {
  if (!user || user.email !== email || !(await verify(currentPassword, user.password))) return false
  user.password = await hash(newPassword)
  for (const [token, session] of sessions) if (session.email === email) sessions.delete(token)
  await save()
  return true
}
export function current(token?: string) { const session = token ? sessions.get(token) : undefined; return session && session.expires > Date.now() && user ? { email: user.email, name: user.name } : null }
export async function logout(token?: string) { if (token) { sessions.delete(token); await save() } }
