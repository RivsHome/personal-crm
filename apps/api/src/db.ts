import pg from 'pg'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
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
  dueDate: string | null
  priority: 'low' | 'normal' | 'high'
  tags: string[]
  listName: string
  sortOrder: number
  completed: boolean
  createdAt: string
}

export type EventRecord = { id: string; title: string; date: string; notes: string; category: string }
export type IdeaRecord = { id: string; title: string; body: string; createdAt: string }
export type FinancialAccount = { id: string; name: string; kind: string; currency: string; openingBalanceMinor: number; balanceMinor: number }
export type FinancialTransaction = { id: string; accountId: string; description: string; amountMinor: number; date: string; category: string }
export type GoalRecord = { id: string; title: string; targetMinor: number | null; currentMinor: number; dueDate: string | null; completed: boolean }
export type MovieRecord = { id: string; title: string; year: number | null; watched: boolean; rating: number | null; notes: string }
export type MusicRecord = { id: string; title: string; artist: string; album: string; listened: boolean }
export type MemoryRecord = { id: string; title: string; body: string; occurredOn: string | null }
export type AttachmentRecord = { id: string; memoryId: string; filename: string; mimeType: string; byteSize: number; storageKey: string }
export type GymExercise = { id: string; name: string; sets: string; reps: string; optional: boolean }
export type WorkoutKey = 'A' | 'B' | 'C' | 'D' | 'E'
export type GymRoutine = {
  id: string
  name: string
  description: string
  calendarEnabled: boolean
  trainingDays: string[]
  startDate: string
  workoutOrder: WorkoutKey[]
  workouts: Record<WorkoutKey, GymExercise[]>
  cardioMinutes: Record<WorkoutKey, number>
  progression: { method: string; restBigLifts: string; restAccessories: string; duration: string; rules: string[] }
  createdAt: string
  updatedAt: string
}
export type GymRoutineInput = Omit<GymRoutine, 'id' | 'createdAt' | 'updatedAt'>
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
let localGymRoutines: GymRoutine[] = []
let localPreferences: Preferences = {
  theme: 'dark', accent: '#c9f253', timezone: 'America/New_York', weekStart: 'sunday',
  modules: { calendar: true, tasks: true, ideas: true }, widgets: { tasks: true, calendar: true, ideas: true }, dashboardOrder: ['tasks', 'calendar', 'ideas']
}
let postgresAvailable = false

function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function normalizeEvent(row: Record<string, unknown>): EventRecord {
  return { ...row, date: dateOnly(row.date) ?? '', category: String(row.category ?? 'General') } as EventRecord
}

function normalizeTask(row: Record<string, unknown>): TaskRecord {
  return { ...row, dueDate: dateOnly(row.dueDate), tags: Array.isArray(row.tags) ? row.tags.map(String) : [], sortOrder: Number(row.sortOrder ?? 0) } as TaskRecord
}

function normalizeGymRoutine(row: Record<string, unknown>): GymRoutine {
  const workouts = row.workouts && typeof row.workouts === 'object' ? row.workouts as Partial<Record<WorkoutKey, GymExercise[]>> : {}
  const cardio = row.cardioMinutes && typeof row.cardioMinutes === 'object' ? row.cardioMinutes as Partial<Record<WorkoutKey, number>> : {}
  const order = Array.isArray(row.workoutOrder) ? row.workoutOrder.filter((key): key is WorkoutKey => ['A', 'B', 'C', 'D', 'E'].includes(String(key))) : []
  return {
    ...row,
    startDate: dateOnly(row.startDate) ?? new Date().toISOString().slice(0, 10),
    workoutOrder: order.length >= 2 ? order : ['A', 'B'],
    workouts: { A: workouts.A ?? [], B: workouts.B ?? [], C: workouts.C ?? [], D: workouts.D ?? [], E: workouts.E ?? [] },
    cardioMinutes: { A: Number(cardio.A ?? 0), B: Number(cardio.B ?? 0), C: Number(cardio.C ?? 0), D: Number(cardio.D ?? 0), E: Number(cardio.E ?? 0) }
  } as GymRoutine
}

export function defaultGymRoutineInput(): GymRoutineInput {
  const exercise = (name: string, sets: string, reps: string, optional = false): GymExercise => ({ id: crypto.randomUUID(), name, sets, reps, optional })
  return {
    name: 'Strength & Size A/B',
    description: 'A focused three-day strength routine that alternates Workout A and Workout B each week.',
    calendarEnabled: true,
    trainingDays: ['monday', 'wednesday', 'friday'],
    startDate: new Date().toISOString().slice(0, 10),
    workoutOrder: ['A', 'B'],
    workouts: {
      A: [
        exercise('Back squat', '3', '5'),
        exercise('Bench press', '3', '5'),
        exercise('Barbell row or chest-supported row', '3', '5–8'),
        exercise('Romanian deadlift', '2–3', '8–10'),
        exercise('Curls', '2', '10–15', true),
        exercise('Triceps pushdowns', '2', '10–15', true)
      ],
      B: [
        exercise('Deadlift', '1–3', '3–5'),
        exercise('Overhead press', '3', '5'),
        exercise('Pull-ups or lat pulldown', '3', '8–12'),
        exercise('Incline dumbbell press', '2–3', '8–12'),
        exercise('Leg press or lunges', '2–3', '10–15'),
        exercise('Abs', '2–3', 'Your choice', true)
      ],
      C: [], D: [], E: []
    },
    cardioMinutes: { A: 0, B: 0, C: 0, D: 0, E: 0 },
    progression: {
      method: 'Use the listed rep range, then add weight once you hit the top end with good form. If you complete all 3 sets of 5 on bench press, add 5 lb next week. If you miss reps, keep the same weight until you earn it.',
      restBigLifts: '2–3 minutes',
      restAccessories: '60–90 seconds',
      duration: '60–75 minutes',
      rules: [
        'Focus on perfect form first.',
        'Add weight slowly.',
        'If you feel beat up, take a lighter week every 6–10 weeks.',
        'Stay in the 5–12 rep range for most work when your goal is size.'
      ]
    }
  }
}

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
    const migrationDirectory = path.resolve(process.cwd(), 'apps', 'api', 'migrations')
    const migrations = (await readdir(migrationDirectory)).filter(file => file.endsWith('.sql')).sort()
    for (const migrationFile of migrations) await pool.query(await readFile(path.join(migrationDirectory, migrationFile), 'utf8'))
    postgresAvailable = true
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error
    await loadLocalTasks()
    localEvents = await loadCollection<EventRecord>('events.json')
    localIdeas = await loadCollection<IdeaRecord>('ideas.json')
    localGymRoutines = await loadCollection<GymRoutine>('gym-routines.json')
    const savedPreferences = await loadCollection<Preferences>('preferences.json')
    if (savedPreferences[0]) localPreferences = { ...localPreferences, ...savedPreferences[0], modules: { ...localPreferences.modules, ...savedPreferences[0].modules }, widgets: { ...localPreferences.widgets, ...savedPreferences[0].widgets } }
    console.warn('PostgreSQL unavailable; using local development data/task storage.')
  }
}

export async function listEvents() {
  if (!postgresAvailable) return localEvents
  const result = await pool.query('SELECT id, title, event_date AS date, notes, category FROM calendar_events WHERE user_id = $1 ORDER BY event_date ASC', ['local'])
  return result.rows.map(normalizeEvent)
}

export async function createEvent(title: string, date: string, notes: string, category: string) {
  const event = { id: crypto.randomUUID(), title, date, notes, category }
  if (!postgresAvailable) { localEvents.push(event); await saveCollection('events.json', localEvents); return event }
  const result = await pool.query('INSERT INTO calendar_events (id, title, event_date, notes, category) VALUES ($1, $2, $3, $4, $5) RETURNING id, title, event_date AS date, notes, category', [event.id, title, date, notes, category])
  return normalizeEvent(result.rows[0])
}

export async function updateEvent(id: string, title: string, date: string, notes: string, category: string) {
  if (!postgresAvailable) {
    const event = localEvents.find(item => item.id === id)
    if (event) { Object.assign(event, { title, date, notes, category }); await saveCollection('events.json', localEvents) }
    return event
  }
  const result = await pool.query('UPDATE calendar_events SET title = $2, event_date = $3, notes = $4, category = $5 WHERE id = $1 AND user_id = $6 RETURNING id, title, event_date AS date, notes, category', [id, title, date, notes, category, 'local'])
  return result.rows[0] ? normalizeEvent(result.rows[0]) : undefined
}

export async function deleteEvent(id: string) {
  if (!postgresAvailable) {
    const count = localEvents.length
    localEvents = localEvents.filter(item => item.id !== id)
    if (localEvents.length !== count) await saveCollection('events.json', localEvents)
    return localEvents.length !== count
  }
  const result = await pool.query('DELETE FROM calendar_events WHERE id = $1 AND user_id = $2', [id, 'local'])
  return Boolean(result.rowCount)
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

export async function listGymRoutines(): Promise<GymRoutine[]> {
  let routines: GymRoutine[]
  if (!postgresAvailable) routines = localGymRoutines.map(routine => normalizeGymRoutine(routine as unknown as Record<string, unknown>))
  else {
    const result = await pool.query(`SELECT id, name, description, calendar_enabled AS "calendarEnabled", training_days AS "trainingDays", start_date AS "startDate", workout_order AS "workoutOrder", workouts, cardio_minutes AS "cardioMinutes", progression,
      created_at AS "createdAt", updated_at AS "updatedAt" FROM gym_routines WHERE user_id = $1 ORDER BY updated_at DESC`, ['local'])
    routines = result.rows.map(normalizeGymRoutine)
  }
  if (routines.length === 0) return [await createGymRoutine(defaultGymRoutineInput())]
  return routines
}

export async function createGymRoutine(input: GymRoutineInput): Promise<GymRoutine> {
  const routine: GymRoutine = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  if (!postgresAvailable) {
    localGymRoutines.unshift(routine)
    await saveCollection('gym-routines.json', localGymRoutines)
    return routine
  }
  const result = await pool.query(`INSERT INTO gym_routines (id, name, description, calendar_enabled, training_days, start_date, workout_order, workouts, cardio_minutes, progression)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
    RETURNING id, name, description, calendar_enabled AS "calendarEnabled", training_days AS "trainingDays", start_date AS "startDate", workout_order AS "workoutOrder", workouts, cardio_minutes AS "cardioMinutes", progression, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [routine.id, input.name, input.description, input.calendarEnabled, JSON.stringify(input.trainingDays), input.startDate, JSON.stringify(input.workoutOrder), JSON.stringify(input.workouts), JSON.stringify(input.cardioMinutes), JSON.stringify(input.progression)])
  return normalizeGymRoutine(result.rows[0])
}

export async function updateGymRoutine(id: string, input: GymRoutineInput): Promise<GymRoutine | null> {
  if (!postgresAvailable) {
    const index = localGymRoutines.findIndex(routine => routine.id === id)
    if (index < 0) return null
    localGymRoutines[index] = { ...localGymRoutines[index], ...input, updatedAt: new Date().toISOString() }
    await saveCollection('gym-routines.json', localGymRoutines)
    return localGymRoutines[index]
  }
  const result = await pool.query(`UPDATE gym_routines SET name=$2, description=$3, calendar_enabled=$4, training_days=$5::jsonb, start_date=$6,
    workout_order=$7::jsonb, workouts=$8::jsonb, cardio_minutes=$9::jsonb, progression=$10::jsonb, updated_at=NOW() WHERE id=$1 AND user_id='local'
    RETURNING id, name, description, calendar_enabled AS "calendarEnabled", training_days AS "trainingDays", start_date AS "startDate", workout_order AS "workoutOrder", workouts, cardio_minutes AS "cardioMinutes", progression, created_at AS "createdAt", updated_at AS "updatedAt"`,
    [id, input.name, input.description, input.calendarEnabled, JSON.stringify(input.trainingDays), input.startDate, JSON.stringify(input.workoutOrder), JSON.stringify(input.workouts), JSON.stringify(input.cardioMinutes), JSON.stringify(input.progression)])
  return result.rows[0] ? normalizeGymRoutine(result.rows[0]) : null
}

export async function deleteGymRoutine(id: string): Promise<boolean> {
  if (!postgresAvailable) {
    const before = localGymRoutines.length
    localGymRoutines = localGymRoutines.filter(routine => routine.id !== id)
    if (localGymRoutines.length !== before) await saveCollection('gym-routines.json', localGymRoutines)
    return localGymRoutines.length !== before
  }
  const result = await pool.query(`DELETE FROM gym_routines WHERE id=$1 AND user_id='local'`, [id])
  return Boolean(result.rowCount)
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
  if (!postgresAvailable) return localTasks.map((task, index) => ({ ...task, sortOrder: task.sortOrder ?? index })).sort((a, b) => Number(a.completed) - Number(b.completed) || a.sortOrder - b.sortOrder || b.createdAt.localeCompare(a.createdAt))
  const result = await pool.query('SELECT id, parent_id AS "parentId", summary, notes, due_date AS "dueDate", priority, tags, list_name AS "listName", sort_order AS "sortOrder", completed, created_at AS "createdAt" FROM tasks WHERE user_id = $1 ORDER BY completed ASC, sort_order ASC, created_at DESC', ['local'])
  return result.rows.map(normalizeTask)
}

export type TaskInput = Pick<TaskRecord, 'summary' | 'notes' | 'dueDate' | 'priority' | 'tags' | 'listName'>

export async function createTask(input: TaskInput, parentId: string | null = null) {
  const sortOrder = postgresAvailable ? 0 : Math.min(0, ...localTasks.filter(item => (item.parentId ?? null) === parentId).map(item => item.sortOrder ?? 0)) - 1000
  const task = { id: crypto.randomUUID(), parentId, ...input, sortOrder, completed: false, createdAt: new Date().toISOString() }
  if (!postgresAvailable) {
    if (parentId && !localTasks.some(item => item.id === parentId)) return null
    localTasks.unshift(task); await saveLocalTasks(); return task
  }
  const result = await pool.query(`INSERT INTO tasks (id, user_id, parent_id, summary, notes, due_date, priority, tags, list_name, sort_order)
    SELECT $1, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9,
      COALESCE((SELECT MIN(sort_order) - 1000 FROM tasks WHERE user_id = $2 AND parent_id IS NOT DISTINCT FROM $3::uuid), 0)
    WHERE $3::uuid IS NULL OR EXISTS (SELECT 1 FROM tasks WHERE id = $3::uuid AND user_id = $2)
    RETURNING id, parent_id AS "parentId", summary, notes, due_date AS "dueDate", priority, tags, list_name AS "listName", sort_order AS "sortOrder", completed, created_at AS "createdAt"`, [task.id, 'local', parentId, input.summary, input.notes, input.dueDate, input.priority, JSON.stringify(input.tags), input.listName])
  if (!result.rowCount) return null
  return normalizeTask(result.rows[0])
}

export async function updateTask(id: string, input: TaskInput) {
  if (!postgresAvailable) {
    const task = localTasks.find(item => item.id === id)
    if (task) { Object.assign(task, input); await saveLocalTasks() }
    return task
  }
  const result = await pool.query('UPDATE tasks SET summary = $2, notes = $3, due_date = $4, priority = $5, tags = $6::jsonb, list_name = $7, updated_at = NOW() WHERE id = $1 AND user_id = $8 RETURNING id, parent_id AS "parentId", summary, notes, due_date AS "dueDate", priority, tags, list_name AS "listName", sort_order AS "sortOrder", completed, created_at AS "createdAt"', [id, input.summary, input.notes, input.dueDate, input.priority, JSON.stringify(input.tags), input.listName, 'local'])
  return result.rows[0] ? normalizeTask(result.rows[0]) : undefined
}

export async function toggleTask(id: string) {
  if (!postgresAvailable) {
    const task = localTasks.find(item => item.id === id)
    if (task) { task.completed = !task.completed; await saveLocalTasks() }
    return task
  }
  const result = await pool.query('UPDATE tasks SET completed = NOT completed, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id, parent_id AS "parentId", summary, notes, due_date AS "dueDate", priority, tags, list_name AS "listName", sort_order AS "sortOrder", completed, created_at AS "createdAt"', [id, 'local'])
  return result.rows[0] ? normalizeTask(result.rows[0]) : undefined
}

export async function reorderTasks(parentId: string | null, taskIds: string[]) {
  if (!postgresAvailable) {
    const siblingIds = new Set(localTasks.filter(task => (task.parentId ?? null) === parentId).map(task => task.id))
    if (taskIds.some(id => !siblingIds.has(id))) return false
    const order = new Map(taskIds.map((id, index) => [id, (index + 1) * 1000]))
    localTasks = localTasks.map(task => order.has(task.id) ? { ...task, sortOrder: order.get(task.id)! } : task)
    await saveLocalTasks()
    return true
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query('SELECT id FROM tasks WHERE user_id = $1 AND parent_id IS NOT DISTINCT FROM $2::uuid', ['local', parentId])
    const existingIds = new Set(existing.rows.map(row => String(row.id)))
    if (taskIds.some(id => !existingIds.has(id))) { await client.query('ROLLBACK'); return false }
    for (const [index, id] of taskIds.entries()) await client.query('UPDATE tasks SET sort_order = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3', [(index + 1) * 1000, id, 'local'])
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
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
    movies: await listMovies(), music: await listMusic(), memories: await listMemories(), gymRoutines: await listGymRoutines()
  }
}

export type RestoreData = {
  tasks: TaskRecord[]; events: EventRecord[]; ideas: IdeaRecord[];
  financialAccounts?: Array<{ id: string; name: string; kind: string; currency: string; openingBalanceMinor: number }>;
  financialTransactions?: FinancialTransaction[]; goals?: GoalRecord[];
  movies?: MovieRecord[]; music?: MusicRecord[]; memories?: MemoryRecord[]; gymRoutines?: GymRoutine[]
}

export async function restoreData(data: RestoreData) {
  if (!postgresAvailable) {
    localTasks = data.tasks.map((task, index) => ({ ...task, sortOrder: task.sortOrder ?? index * 1000 }))
    localEvents = data.events
    localIdeas = data.ideas
    localGymRoutines = data.gymRoutines ?? []
    await saveLocalTasks(); await saveCollection('events.json', localEvents); await saveCollection('ideas.json', localIdeas); await saveCollection('gym-routines.json', localGymRoutines)
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
    await client.query('DELETE FROM gym_routines WHERE user_id = $1', ['local'])
    for (const task of [...data.tasks].sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)))) await client.query('INSERT INTO tasks (id, user_id, parent_id, summary, notes, due_date, priority, tags, list_name, sort_order, completed, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)', [task.id, 'local', task.parentId ?? null, task.summary, task.notes, task.dueDate, task.priority, JSON.stringify(task.tags), task.listName, task.sortOrder ?? 0, task.completed, task.createdAt])
    for (const event of data.events) await client.query('INSERT INTO calendar_events (id, user_id, title, event_date, notes) VALUES ($1,$2,$3,$4,$5)', [event.id, 'local', event.title, event.date, event.notes])
    for (const idea of data.ideas) await client.query('INSERT INTO ideas (id, user_id, title, body, created_at) VALUES ($1,$2,$3,$4,$5)', [idea.id, 'local', idea.title, idea.body, idea.createdAt])
    for (const account of data.financialAccounts ?? []) await client.query('INSERT INTO financial_accounts (id, user_id, name, kind, currency, opening_balance_minor) VALUES ($1,$2,$3,$4,$5,$6)', [account.id, 'local', account.name, account.kind, account.currency, account.openingBalanceMinor])
    for (const transaction of data.financialTransactions ?? []) await client.query('INSERT INTO financial_transactions (id, user_id, account_id, description, amount_minor, transaction_date, category) VALUES ($1,$2,$3,$4,$5,$6,$7)', [transaction.id, 'local', transaction.accountId, transaction.description, transaction.amountMinor, transaction.date, transaction.category])
    for (const goal of data.goals ?? []) await client.query('INSERT INTO goals (id, user_id, title, target_minor, current_minor, due_date, completed) VALUES ($1,$2,$3,$4,$5,$6,$7)', [goal.id, 'local', goal.title, goal.targetMinor, goal.currentMinor, goal.dueDate, goal.completed])
    for (const movie of data.movies ?? []) await client.query('INSERT INTO movies (id, user_id, title, year, watched, rating, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)', [movie.id, 'local', movie.title, movie.year, movie.watched, movie.rating, movie.notes])
    for (const track of data.music ?? []) await client.query('INSERT INTO music_tracks (id, user_id, title, artist, album, listened) VALUES ($1,$2,$3,$4,$5,$6)', [track.id, 'local', track.title, track.artist, track.album, track.listened])
    for (const memory of data.memories ?? []) await client.query('INSERT INTO memory_entries (id, user_id, title, body, occurred_on) VALUES ($1,$2,$3,$4,$5)', [memory.id, 'local', memory.title, memory.body, memory.occurredOn])
    for (const routine of data.gymRoutines ?? []) await client.query(`INSERT INTO gym_routines (id, user_id, name, description, calendar_enabled, training_days, start_date, workout_order, workouts, cardio_minutes, progression, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13)`, [routine.id, 'local', routine.name, routine.description, routine.calendarEnabled ?? true, JSON.stringify(routine.trainingDays), routine.startDate, JSON.stringify(routine.workoutOrder ?? ['A', 'B']), JSON.stringify(routine.workouts), JSON.stringify(routine.cardioMinutes ?? {}), JSON.stringify(routine.progression), routine.createdAt, routine.updatedAt])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
