import pg from 'pg'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://personal_crm:personal_crm_dev@localhost:5433/personal_crm'
})

export type TaskRecord = {
  id: string
  summary: string
  notes: string
  completed: boolean
  createdAt: string
}

export type EventRecord = { id: string; title: string; date: string; notes: string }
export type IdeaRecord = { id: string; title: string; body: string; createdAt: string }
export type Preferences = {
  theme: 'dark' | 'light'
  accent: string
  timezone: string
  weekStart: 'sunday' | 'monday'
  modules: { calendar: boolean; tasks: boolean; ideas: boolean }
  widgets: { tasks: boolean; calendar: boolean; ideas: boolean }
}
export type PreferencesPatch = Partial<Omit<Preferences, 'modules' | 'widgets'>> & { modules?: Partial<Preferences['modules']>; widgets?: Partial<Preferences['widgets']> }

const localDataPath = path.resolve(process.cwd(), 'data', 'tasks.json')
let localTasks: TaskRecord[] = []
let localEvents: EventRecord[] = []
let localIdeas: IdeaRecord[] = []
let localPreferences: Preferences = {
  theme: 'dark', accent: '#c9f253', timezone: 'America/New_York', weekStart: 'sunday',
  modules: { calendar: true, tasks: true, ideas: true }, widgets: { tasks: true, calendar: true, ideas: true }
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
  const result = await pool.query('SELECT theme, accent, timezone, week_start AS "weekStart", modules, widgets FROM user_preferences WHERE user_id = $1', ['local'])
  return (result.rows[0] as Preferences | undefined) ?? localPreferences
}

export async function updatePreferences(input: PreferencesPatch): Promise<Preferences> {
  const base = await getPreferences()
  const current: Preferences = { ...base, ...input, modules: { ...base.modules, ...(input.modules ?? {}) }, widgets: { ...base.widgets, ...(input.widgets ?? {}) } }
  if (!postgresAvailable) { localPreferences = current; await saveCollection('preferences.json', [current]); return current }
  await pool.query(`INSERT INTO user_preferences (user_id, theme, accent, timezone, week_start, modules, widgets) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (user_id) DO UPDATE SET theme=$2, accent=$3, timezone=$4, week_start=$5, modules=$6, widgets=$7, updated_at=NOW()`, ['local', current.theme, current.accent, current.timezone, current.weekStart, JSON.stringify(current.modules), JSON.stringify(current.widgets)])
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

export async function listTasks() {
  if (!postgresAvailable) return localTasks
  const result = await pool.query('SELECT id, summary, notes, completed, created_at AS "createdAt" FROM tasks WHERE user_id = $1 ORDER BY created_at DESC', ['local'])
  return result.rows as TaskRecord[]
}

export async function createTask(summary: string, notes: string) {
  const task = { id: crypto.randomUUID(), summary, notes, completed: false, createdAt: new Date().toISOString() }
  if (!postgresAvailable) { localTasks.unshift(task); await saveLocalTasks(); return task }
  const result = await pool.query('INSERT INTO tasks (id, user_id, summary, notes) VALUES ($1, $2, $3, $4) RETURNING id, summary, notes, completed, created_at AS "createdAt"', [task.id, 'local', summary, notes])
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
    localTasks = localTasks.filter(item => item.id !== id)
    if (before !== localTasks.length) await saveLocalTasks()
    return before !== localTasks.length
  }
  const result = await pool.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [id, 'local'])
  return Boolean(result.rowCount)
}

export async function exportData() {
  return { tasks: await listTasks(), events: await listEvents(), ideas: await listIdeas() }
}

export type RestoreData = { tasks: TaskRecord[]; events: EventRecord[]; ideas: IdeaRecord[] }

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
    for (const task of data.tasks) await client.query('INSERT INTO tasks (id, user_id, summary, notes, completed, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [task.id, 'local', task.summary, task.notes, task.completed, task.createdAt])
    for (const event of data.events) await client.query('INSERT INTO calendar_events (id, user_id, title, event_date, notes) VALUES ($1,$2,$3,$4,$5)', [event.id, 'local', event.title, event.date, event.notes])
    for (const idea of data.ideas) await client.query('INSERT INTO ideas (id, user_id, title, body, created_at) VALUES ($1,$2,$3,$4,$5)', [idea.id, 'local', idea.title, idea.body, idea.createdAt])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
