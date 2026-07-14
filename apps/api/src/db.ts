import pg from 'pg'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://personal_crm:personal_crm_dev@localhost:5433/personal_crm'
})

export type TaskRecord = {
  id: string
  parentId: string | null
  summary: string
  notes: string
  completed: boolean
  createdAt: string
}

export type EventRecord = { id: string; title: string; date: string; notes: string }
export type IdeaRecord = { id: string; title: string; body: string; createdAt: string }
export type FinancialAccount = { id: string; name: string; kind: string; currency: string; openingBalanceMinor: number; balanceMinor: number }
export type FinancialTransaction = { id: string; accountId: string; description: string; amountMinor: number; date: string; category: string }
export type GoalRecord = { id: string; title: string; targetMinor: number | null; currentMinor: number; dueDate: string | null; completed: boolean }
export type MovieRecord = { id: string; title: string; year: number | null; watched: boolean; rating: number | null; notes: string }
export type MusicRecord = { id: string; title: string; artist: string; album: string; listened: boolean }
export type MemoryRecord = { id: string; title: string; body: string; occurredOn: string | null }
export type AttachmentRecord = { id: string; memoryId: string; filename: string; mimeType: string; byteSize: number; storageKey: string }
export type Preferences = {
  theme: 'dark' | 'light'
  accent: string
  timezone: string
  weekStart: 'sunday' | 'monday'
  modules: { calendar: boolean; tasks: boolean; ideas: boolean }
  widgets: { tasks: boolean; calendar: boolean; ideas: boolean }
  dashboardOrder: Array<'tasks' | 'calendar' | 'ideas'>
}
export type PreferencesPatch = Partial<Omit<Preferences, 'modules' | 'widgets'>> & { modules?: Partial<Preferences['modules']>; widgets?: Partial<Preferences['widgets']> }

const localDataPath = path.resolve(process.cwd(), 'data', 'tasks.json')
let localTasks: TaskRecord[] = []
let localEvents: EventRecord[] = []
let localIdeas: IdeaRecord[] = []
let localPreferences: Preferences = {
  theme: 'dark', accent: '#c9f253', timezone: 'America/New_York', weekStart: 'sunday',
  modules: { calendar: true, tasks: true, ideas: true }, widgets: { tasks: true, calendar: true, ideas: true }, dashboardOrder: ['tasks', 'calendar', 'ideas']
}
let postgresAvailable = false

export function databaseReady() { return postgresAvailable }

async function loadLocalTasks() {
  try {
    localTasks = JSON.parse(await readFile(localDataPath, 'utf8')) as TaskRecord[]
  } catch {
    localTasks = []
  }
}

async function saveLocalTasks() {
  await mkdir(path.dirname(localDataPath), { recursive: true })
  await writeFile(localDataPath, JSON.stringify(localTasks, null, 2))
}

async function loadCollection<T>(name: string): Promise<T[]> {
  try { return JSON.parse(await readFile(path.resolve(process.cwd(), 'data', name), 'utf8')) as T[] } catch { return [] }
}

async function saveCollection<T>(name: string, value: T[]) {
  await mkdir(path.dirname(localDataPath), { recursive: true })
  await writeFile(path.resolve(process.cwd(), 'data', name), JSON.stringify(value, null, 2))
}

export async function initializeDatabase() {
  try {
    const migration = await readFile(path.resolve(process.cwd(), 'apps', 'api', 'migrations', '001_initial.sql'), 'utf8')
    await pool.query(migration)
    postgresAvailable = true
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error
    await loadLocalTasks()
    localEvents = await loadCollection<EventRecord>('events.json')
    localIdeas = await loadCollection<IdeaRecord>('ideas.json')
    const savedPreferences = await loadCollection<Preferences>('preferences.json')
    if (savedPreferences[0]) localPreferences = { ...localPreferences, ...savedPreferences[0], modules: { ...localPreferences.modules, ...savedPreferences[0].modules }, widgets: { ...localPreferences.widgets, ...savedPreferences[0].widgets } }
    console.warn('PostgreSQL unavailable; using local development data/task storage.')
  }
}

export async function listEvents() {
  if (!postgresAvailable) return localEvents
  const result = await pool.query('SELECT id, title, event_date AS date, notes FROM calendar_events WHERE user_id = $1 ORDER BY event_date ASC', ['local'])
  return result.rows as EventRecord[]
}

export async function createEvent(title: string, date: string, notes: string) {
  const event = { id: crypto.randomUUID(), title, date, notes }
  if (!postgresAvailable) { localEvents.push(event); await saveCollection('events.json', localEvents); return event }
  const result = await pool.query('INSERT INTO calendar_events (id, title, event_date, notes) VALUES ($1, $2, $3, $4) RETURNING id, title, event_date AS date, notes', [event.id, title, date, notes])
  return result.rows[0] as EventRecord
}

export async function getPreferences(): Promise<Preferences> {
  if (!postgresAvailable) return localPreferences
  const result = await pool.query('SELECT theme, accent, timezone, week_start AS "weekStart", modules, widgets, dashboard_order AS "dashboardOrder" FROM user_preferences WHERE user_id = $1', ['local'])
  return (result.rows[0] as Preferences | undefined) ?? localPreferences
}

export async function updatePreferences(input: PreferencesPatch): Promise<Preferences> {
  const base = await getPreferences()
  const current: Preferences = { ...base, ...input, modules: { ...base.modules, ...(input.modules ?? {}) }, widgets: { ...base.widgets, ...(input.widgets ?? {}) } }
  if (!postgresAvailable) { localPreferences = current; await saveCollection('preferences.json', [current]); return current }
  await pool.query(`INSERT INTO user_preferences (user_id, theme, accent, timezone, week_start, modules, widgets, dashboard_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (user_id) DO UPDATE SET theme=$2, accent=$3, timezone=$4, week_start=$5, modules=$6, widgets=$7, dashboard_order=$8, updated_at=NOW()`, ['local', current.theme, current.accent, current.timezone, current.weekStart, JSON.stringify(current.modules), JSON.stringify(current.widgets), JSON.stringify(current.dashboardOrder)])
  return current
}

export async function listIdeas() {
  if (!postgresAvailable) return localIdeas
  const result = await pool.query('SELECT id, title, body, created_at AS "createdAt" FROM ideas WHERE user_id = $1 ORDER BY created_at DESC', ['local'])
  return result.rows as IdeaRecord[]
}

export async function createIdea(title: string, body: string) {
  const idea = { id: crypto.randomUUID(), title, body, createdAt: new Date().toISOString() }
  if (!postgresAvailable) { localIdeas.unshift(idea); await saveCollection('ideas.json', localIdeas); return idea }
  const result = await pool.query('INSERT INTO ideas (id, title, body) VALUES ($1, $2, $3) RETURNING id, title, body, created_at AS "createdAt"', [idea.id, title, body])
  return result.rows[0] as IdeaRecord
}

export async function listFinancialAccounts(): Promise<FinancialAccount[]> {
  if (!postgresAvailable) return []
  const result = await pool.query(`SELECT a.id, a.name, a.kind, a.currency, a.opening_balance_minor AS "openingBalanceMinor", a.opening_balance_minor + COALESCE(SUM(t.amount_minor), 0) AS "balanceMinor"
    FROM financial_accounts a LEFT JOIN financial_transactions t ON t.account_id = a.id AND t.user_id = a.user_id
    WHERE a.user_id = $1 GROUP BY a.id ORDER BY a.created_at DESC`, ['local'])
  return result.rows.map(row => ({ ...row, openingBalanceMinor: Number(row.openingBalanceMinor), balanceMinor: Number(row.balanceMinor) })) as FinancialAccount[]
}

export async function createFinancialAccount(name: string, kind: string, currency: string, openingBalanceMinor: number) {
  const result = await pool.query(`INSERT INTO financial_accounts (id, name, kind, currency, opening_balance_minor) VALUES ($1,$2,$3,$4,$5)
    RETURNING id, name, kind, currency, opening_balance_minor AS "openingBalanceMinor"`, [crypto.randomUUID(), name, kind, currency, openingBalanceMinor])
  return { ...result.rows[0], openingBalanceMinor: Number(result.rows[0].openingBalanceMinor), balanceMinor: Number(result.rows[0].openingBalanceMinor) } as FinancialAccount
}

export async function listFinancialTransactions(): Promise<FinancialTransaction[]> {
  if (!postgresAvailable) return []
  const result = await pool.query(`SELECT id, account_id AS "accountId", description, amount_minor AS "amountMinor", transaction_date AS date, category
    FROM financial_transactions WHERE user_id = $1 ORDER BY transaction_date DESC, created_at DESC`, ['local'])
  return result.rows.map(row => ({ ...row, amountMinor: Number(row.amountMinor) })) as FinancialTransaction[]
}

export async function createFinancialTransaction(accountId: string, description: string, amountMinor: number, date: string, category: string) {
  const result = await pool.query(`INSERT INTO financial_transactions (id, account_id, description, amount_minor, transaction_date, category)
    SELECT $1, id, $3, $4, $5, $6 FROM financial_accounts WHERE id = $2 AND user_id = 'local'
    RETURNING id, account_id AS "accountId", description, amount_minor AS "amountMinor", transaction_date AS date, category`, [crypto.randomUUID(), accountId, description, amountMinor, date, category])
  if (!result.rowCount) return null
  return { ...result.rows[0], amountMinor: Number(result.rows[0].amountMinor) } as FinancialTransaction
}

export async function listGoals(): Promise<GoalRecord[]> {
  if (!postgresAvailable) return []
  const result = await pool.query(`SELECT id, title, target_minor AS "targetMinor", current_minor AS "currentMinor", due_date AS "dueDate", completed
    FROM goals WHERE user_id = $1 ORDER BY completed ASC, created_at DESC`, ['local'])
  return result.rows.map(row => ({ ...row, targetMinor: row.targetMinor === null ? null : Number(row.targetMinor), currentMinor: Number(row.currentMinor) })) as GoalRecord[]
}

export async function createGoal(title: string, targetMinor: number | null, dueDate: string | null) {
  const result = await pool.query(`INSERT INTO goals (id, title, target_minor, due_date) VALUES ($1,$2,$3,$4)
    RETURNING id, title, target_minor AS "targetMinor", current_minor AS "currentMinor", due_date AS "dueDate", completed`, [crypto.randomUUID(), title, targetMinor, dueDate])
  return { ...result.rows[0], targetMinor: result.rows[0].targetMinor === null ? null : Number(result.rows[0].targetMinor), currentMinor: Number(result.rows[0].currentMinor) } as GoalRecord
}

export async function toggleGoal(id: string) {
  const result = await pool.query(`UPDATE goals SET completed = NOT completed, updated_at = NOW() WHERE id = $1 AND user_id = 'local'
    RETURNING id, title, target_minor AS "targetMinor", current_minor AS "currentMinor", due_date AS "dueDate", completed`, [id])
  if (!result.rowCount) return null
  return { ...result.rows[0], targetMinor: result.rows[0].targetMinor === null ? null : Number(result.rows[0].targetMinor), currentMinor: Number(result.rows[0].currentMinor) } as GoalRecord
}

export async function listMovies(): Promise<MovieRecord[]> {
  if (!postgresAvailable) return []
  const result = await pool.query(`SELECT id, title, year, watched, rating, notes FROM movies WHERE user_id = $1 ORDER BY created_at DESC`, ['local'])
  return result.rows as MovieRecord[]
}
export async function createMovie(title: string, year: number | null, notes: string) {
  const result = await pool.query(`INSERT INTO movies (id, title, year, notes) VALUES ($1,$2,$3,$4) RETURNING id, title, year, watched, rating, notes`, [crypto.randomUUID(), title, year, notes])
  return result.rows[0] as MovieRecord
}
export async function listMusic(): Promise<MusicRecord[]> {
  if (!postgresAvailable) return []
  const result = await pool.query(`SELECT id, title, artist, album, listened FROM music_tracks WHERE user_id = $1 ORDER BY created_at DESC`, ['local'])
  return result.rows as MusicRecord[]
}
export async function createMusic(title: string, artist: string, album: string) {
  const result = await pool.query(`INSERT INTO music_tracks (id, title, artist, album) VALUES ($1,$2,$3,$4) RETURNING id, title, artist, album, listened`, [crypto.randomUUID(), title, artist, album])
  return result.rows[0] as MusicRecord
}
export async function listMemories(): Promise<MemoryRecord[]> {
  if (!postgresAvailable) return []
  const result = await pool.query(`SELECT id, title, body, occurred_on AS "occurredOn" FROM memory_entries WHERE user_id = $1 ORDER BY occurred_on DESC NULLS LAST, created_at DESC`, ['local'])
  return result.rows as MemoryRecord[]
}
export async function createMemory(title: string, body: string, occurredOn: string | null) {
  const result = await pool.query(`INSERT INTO memory_entries (id, title, body, occurred_on) VALUES ($1,$2,$3,$4) RETURNING id, title, body, occurred_on AS "occurredOn"`, [crypto.randomUUID(), title, body, occurredOn])
  return result.rows[0] as MemoryRecord
}

export async function listAttachments(memoryId: string): Promise<AttachmentRecord[]> {
  if (!postgresAvailable) return []
  const result = await pool.query(`SELECT id, memory_id AS "memoryId", filename, mime_type AS "mimeType", byte_size AS "byteSize", storage_key AS "storageKey"
    FROM attachments WHERE memory_id = $1 AND user_id = 'local' ORDER BY created_at DESC`, [memoryId])
  return result.rows.map(row => ({ ...row, byteSize: Number(row.byteSize) })) as AttachmentRecord[]
}

export async function createAttachment(memoryId: string, filename: string, mimeType: string, storageKey: string, byteSize: number) {
  const result = await pool.query(`INSERT INTO attachments (id, memory_id, filename, mime_type, storage_key, byte_size)
    SELECT $1, id, $3, $4, $5, $6 FROM memory_entries WHERE id = $2 AND user_id = 'local'
    RETURNING id, memory_id AS "memoryId", filename, mime_type AS "mimeType", byte_size AS "byteSize", storage_key AS "storageKey"`, [crypto.randomUUID(), memoryId, filename, mimeType, storageKey, byteSize])
  if (!result.rowCount) return null
  return { ...result.rows[0], byteSize: Number(result.rows[0].byteSize) } as AttachmentRecord
}

export async function getAttachment(id: string) {
  const result = await pool.query(`SELECT id, memory_id AS "memoryId", filename, mime_type AS "mimeType", byte_size AS "byteSize", storage_key AS "storageKey"
    FROM attachments WHERE id = $1 AND user_id = 'local'`, [id])
  return result.rows[0] ? { ...result.rows[0], byteSize: Number(result.rows[0].byteSize) } as AttachmentRecord : null
}

export async function deleteAttachment(id: string) {
  const attachment = await getAttachment(id)
  if (!attachment) return null
  await pool.query(`DELETE FROM attachments WHERE id = $1 AND user_id = 'local'`, [id])
  return attachment
}

export async function listTasks() {
  if (!postgresAvailable) return localTasks
  const result = await pool.query('SELECT id, parent_id AS "parentId", summary, notes, completed, created_at AS "createdAt" FROM tasks WHERE user_id = $1 ORDER BY created_at DESC', ['local'])
  return result.rows as TaskRecord[]
}

export async function createTask(summary: string, notes: string, parentId: string | null = null) {
  const task = { id: crypto.randomUUID(), parentId, summary, notes, completed: false, createdAt: new Date().toISOString() }
  if (!postgresAvailable) {
    if (parentId && !localTasks.some(item => item.id === parentId)) return null
    localTasks.unshift(task); await saveLocalTasks(); return task
  }
  const result = await pool.query('INSERT INTO tasks (id, user_id, parent_id, summary, notes) SELECT $1, $2, $3::uuid, $4, $5 WHERE $3::uuid IS NULL OR EXISTS (SELECT 1 FROM tasks WHERE id = $3::uuid AND user_id = $2) RETURNING id, parent_id AS "parentId", summary, notes, completed, created_at AS "createdAt"', [task.id, 'local', parentId, summary, notes])
  if (!result.rowCount) return null
  return result.rows[0] as TaskRecord
}

export async function toggleTask(id: string) {
  if (!postgresAvailable) {
    const task = localTasks.find(item => item.id === id)
    if (task) { task.completed = !task.completed; await saveLocalTasks() }
    return task
  }
  const result = await pool.query('UPDATE tasks SET completed = NOT completed, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id, summary, notes, completed, created_at AS "createdAt"', [id, 'local'])
  return result.rows[0] as TaskRecord | undefined
}

export async function deleteTask(id: string) {
  if (!postgresAvailable) {
    const before = localTasks.length
    const removed = new Set([id])
    let changed = true
    while (changed) { changed = false; for (const item of localTasks) if (item.parentId && removed.has(item.parentId) && !removed.has(item.id)) { removed.add(item.id); changed = true } }
    localTasks = localTasks.filter(item => !removed.has(item.id))
    if (before !== localTasks.length) await saveLocalTasks()
    return before !== localTasks.length
  }
  const result = await pool.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [id, 'local'])
  return Boolean(result.rowCount)
}

export async function exportData() {
  return {
    tasks: await listTasks(), events: await listEvents(), ideas: await listIdeas(),
    financialAccounts: await listFinancialAccounts(), financialTransactions: await listFinancialTransactions(), goals: await listGoals(),
    movies: await listMovies(), music: await listMusic(), memories: await listMemories()
  }
}

export type RestoreData = {
  tasks: TaskRecord[]; events: EventRecord[]; ideas: IdeaRecord[];
  financialAccounts?: Array<{ id: string; name: string; kind: string; currency: string; openingBalanceMinor: number }>;
  financialTransactions?: FinancialTransaction[]; goals?: GoalRecord[];
  movies?: MovieRecord[]; music?: MusicRecord[]; memories?: MemoryRecord[]
}

export async function restoreData(data: RestoreData) {
  if (!postgresAvailable) {
    localTasks = data.tasks; localEvents = data.events; localIdeas = data.ideas
    await saveLocalTasks(); await saveCollection('events.json', localEvents); await saveCollection('ideas.json', localIdeas)
    return
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM tasks WHERE user_id = $1', ['local'])
    await client.query('DELETE FROM calendar_events WHERE user_id = $1', ['local'])
    await client.query('DELETE FROM ideas WHERE user_id = $1', ['local'])
    await client.query('DELETE FROM financial_transactions WHERE user_id = $1', ['local'])
    await client.query('DELETE FROM financial_accounts WHERE user_id = $1', ['local'])
    await client.query('DELETE FROM goals WHERE user_id = $1', ['local'])
    await client.query('DELETE FROM movies WHERE user_id = $1', ['local'])
    await client.query('DELETE FROM music_tracks WHERE user_id = $1', ['local'])
    await client.query('DELETE FROM memory_entries WHERE user_id = $1', ['local'])
    for (const task of [...data.tasks].sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)))) await client.query('INSERT INTO tasks (id, user_id, parent_id, summary, notes, completed, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [task.id, 'local', task.parentId ?? null, task.summary, task.notes, task.completed, task.createdAt])
    for (const event of data.events) await client.query('INSERT INTO calendar_events (id, user_id, title, event_date, notes) VALUES ($1,$2,$3,$4,$5)', [event.id, 'local', event.title, event.date, event.notes])
    for (const idea of data.ideas) await client.query('INSERT INTO ideas (id, user_id, title, body, created_at) VALUES ($1,$2,$3,$4,$5)', [idea.id, 'local', idea.title, idea.body, idea.createdAt])
    for (const account of data.financialAccounts ?? []) await client.query('INSERT INTO financial_accounts (id, user_id, name, kind, currency, opening_balance_minor) VALUES ($1,$2,$3,$4,$5,$6)', [account.id, 'local', account.name, account.kind, account.currency, account.openingBalanceMinor])
    for (const transaction of data.financialTransactions ?? []) await client.query('INSERT INTO financial_transactions (id, user_id, account_id, description, amount_minor, transaction_date, category) VALUES ($1,$2,$3,$4,$5,$6,$7)', [transaction.id, 'local', transaction.accountId, transaction.description, transaction.amountMinor, transaction.date, transaction.category])
    for (const goal of data.goals ?? []) await client.query('INSERT INTO goals (id, user_id, title, target_minor, current_minor, due_date, completed) VALUES ($1,$2,$3,$4,$5,$6,$7)', [goal.id, 'local', goal.title, goal.targetMinor, goal.currentMinor, goal.dueDate, goal.completed])
    for (const movie of data.movies ?? []) await client.query('INSERT INTO movies (id, user_id, title, year, watched, rating, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)', [movie.id, 'local', movie.title, movie.year, movie.watched, movie.rating, movie.notes])
    for (const track of data.music ?? []) await client.query('INSERT INTO music_tracks (id, user_id, title, artist, album, listened) VALUES ($1,$2,$3,$4,$5,$6)', [track.id, 'local', track.title, track.artist, track.album, track.listened])
    for (const memory of data.memories ?? []) await client.query('INSERT INTO memory_entries (id, user_id, title, body, occurred_on) VALUES ($1,$2,$3,$4,$5)', [memory.id, 'local', memory.title, memory.body, memory.occurredOn])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
