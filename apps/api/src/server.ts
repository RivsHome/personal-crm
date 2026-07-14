import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { createAttachment, createEvent, createFinancialAccount, createFinancialTransaction, createGoal, createIdea, createMemory, createMovie, createMusic, createTask, databaseReady, deleteAttachment, deleteTask, exportData, getAttachment, getPreferences, initializeDatabase, listAttachments, listEvents, listFinancialAccounts, listFinancialTransactions, listGoals, listIdeas, listMemories, listMovies, listMusic, listTasks, restoreData, toggleGoal, toggleTask, updatePreferences } from './db.js'
import { changePassword, current, initializeAuth, login, logout, register } from './auth.js'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const app = Fastify({ logger: true })
app.setErrorHandler((error, request, reply) => {
  request.log.error(error)
  const details = error as { statusCode?: number; message?: string }
  const statusCode = details.statusCode && details.statusCode < 500 ? details.statusCode : 500
  return reply.code(statusCode).send({ error: statusCode === 500 ? 'Unexpected server error.' : details.message, correlationId: request.id })
})
const corsOrigin = process.env.CORS_ORIGIN === '' ? false : (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
await app.register(cors, { origin: corsOrigin, credentials: true })
await app.register(cookie)
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } })
const uploadDirectory = path.resolve(process.cwd(), 'data', 'uploads')
await mkdir(uploadDirectory, { recursive: true })

const csrfCookie = 'csrf'
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const attempts = new Map<string, { count: number; resetAt: number }>()

app.addHook('onRequest', async (request, reply) => {
  if (!request.cookies[csrfCookie]) reply.setCookie(csrfCookie, randomBytes(24).toString('hex'), { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 })
  const isAuthEntry = request.url === '/api/auth/login' || request.url === '/api/auth/register'
  if (!safeMethods.has(request.method) && !isAuthEntry && request.headers['x-csrf-token'] !== request.cookies[csrfCookie]) return reply.code(403).send({ error: 'Invalid CSRF token.' })
})

app.addHook('preHandler', async (request, reply) => {
  const protectedPath = request.url.startsWith('/api/tasks') || request.url.startsWith('/api/events') || request.url.startsWith('/api/ideas') || request.url.startsWith('/api/finance') || request.url.startsWith('/api/goals') || request.url.startsWith('/api/movies') || request.url.startsWith('/api/music') || request.url.startsWith('/api/memories') || request.url.startsWith('/api/export') || request.url.startsWith('/api/preferences') || request.url.startsWith('/api/restore')
  if (protectedPath && !current(request.cookies.session)) return reply.code(401).send({ error: 'Sign in required.' })
})

const taskInput = z.object({
  summary: z.string().trim().min(1).max(240),
  notes: z.string().max(5000).default(''),
  parentId: z.string().uuid().nullable().optional().default(null)
})
const eventInput = z.object({ title: z.string().trim().min(1).max(240), date: z.string().date(), notes: z.string().max(5000).default('') })
const ideaInput = z.object({ title: z.string().trim().min(1).max(240), body: z.string().max(10000).default('') })
const accountInput = z.object({ name: z.string().trim().min(1).max(120), kind: z.string().trim().min(1).max(40), currency: z.string().regex(/^[A-Z]{3}$/), openingBalanceMinor: z.number().int().safe() })
const transactionInput = z.object({ accountId: z.string().uuid(), description: z.string().trim().min(1).max(240), amountMinor: z.number().int().safe(), date: z.string().date(), category: z.string().trim().min(1).max(80) })
const goalInput = z.object({ title: z.string().trim().min(1).max(240), targetMinor: z.number().int().positive().nullable(), dueDate: z.string().date().nullable() })
const movieInput = z.object({ title: z.string().trim().min(1).max(240), year: z.number().int().min(1888).max(2200).nullable(), notes: z.string().max(5000).default('') })
const musicInput = z.object({ title: z.string().trim().min(1).max(240), artist: z.string().max(160).default(''), album: z.string().max(160).default('') })
const memoryInput = z.object({ title: z.string().trim().min(1).max(240), body: z.string().max(10000).default(''), occurredOn: z.string().date().nullable() })
const loginCredentials = z.object({ email: z.string().email(), password: z.string().min(8).max(200) })
const registrationCredentials = loginCredentials.extend({ name: z.string().trim().min(1).max(80) })
const preferencesInput = z.object({ theme: z.enum(['dark', 'light']).optional(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), timezone: z.string().min(1).max(80).optional(), weekStart: z.enum(['sunday', 'monday']).optional(), modules: z.object({ calendar: z.boolean().optional(), tasks: z.boolean().optional(), ideas: z.boolean().optional() }).optional(), widgets: z.object({ tasks: z.boolean().optional(), calendar: z.boolean().optional(), ideas: z.boolean().optional() }).optional(), dashboardOrder: z.array(z.enum(['tasks', 'calendar', 'ideas'])).length(3).optional() })
const restoreInput = z.object({
  tasks: z.array(z.object({ id: z.string().uuid(), parentId: z.string().uuid().nullable().optional().default(null), summary: z.string().min(1).max(240), notes: z.string(), completed: z.boolean(), createdAt: z.string().datetime() })),
  events: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(240), date: z.string().date(), notes: z.string() })),
  ideas: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(240), body: z.string(), createdAt: z.string().datetime() })),
  financialAccounts: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(120), kind: z.string(), currency: z.string().regex(/^[A-Z]{3}$/), openingBalanceMinor: z.number().int() })).optional().default([]),
  financialTransactions: z.array(z.object({ id: z.string().uuid(), accountId: z.string().uuid(), description: z.string().min(1).max(240), amountMinor: z.number().int(), date: z.string().date(), category: z.string().min(1).max(80) })).optional().default([]),
  goals: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(240), targetMinor: z.number().int().positive().nullable(), currentMinor: z.number().int(), dueDate: z.string().date().nullable(), completed: z.boolean() })).optional().default([]),
  movies: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(240), year: z.number().int().nullable(), watched: z.boolean(), rating: z.number().int().nullable(), notes: z.string() })).optional().default([]),
  music: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(240), artist: z.string(), album: z.string(), listened: z.boolean() })).optional().default([]),
  memories: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(240), body: z.string(), occurredOn: z.string().date().nullable() })).optional().default([])
})

app.get('/api/auth/me', async request => ({ user: current(request.cookies.session) }))
app.post('/api/auth/register', async (request, reply) => {
  const parsed = registrationCredentials.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Email, name, and an 8-character password are required.' })
  const created = await register(parsed.data.email, parsed.data.name, parsed.data.password)
  if (!created) return reply.code(409).send({ error: 'A workspace owner already exists.' })
  const session = await login(parsed.data.email, parsed.data.password)
  reply.setCookie('session', session!.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return created
})
app.post('/api/auth/login', async (request, reply) => {
  const parsed = loginCredentials.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid email and password.' })
  const address = request.ip
  const now = Date.now()
  const attempt = attempts.get(address)
  if (attempt && attempt.resetAt > now && attempt.count >= 5) return reply.code(429).send({ error: 'Too many login attempts. Try again later.' })
  const session = await login(parsed.data.email, parsed.data.password)
  if (!session) {
    const next = attempt && attempt.resetAt > now ? { count: attempt.count + 1, resetAt: attempt.resetAt } : { count: 1, resetAt: now + 15 * 60 * 1000 }
    attempts.set(address, next)
    return reply.code(401).send({ error: 'Invalid email or password.' })
  }
  attempts.delete(address)
  reply.setCookie('session', session.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return current(session.token)
})
app.post('/api/auth/password', async (request, reply) => {
  const parsed = z.object({ currentPassword: z.string().min(8).max(200), newPassword: z.string().min(8).max(200) }).safeParse(request.body)
  const sessionUser = current(request.cookies.session)
  if (!sessionUser) return reply.code(401).send({ error: 'Sign in required.' })
  if (!parsed.success) return reply.code(400).send({ error: 'Passwords must be at least 8 characters.' })
  if (!await changePassword(sessionUser.email, parsed.data.currentPassword, parsed.data.newPassword)) return reply.code(400).send({ error: 'Current password is incorrect.' })
  return { changed: true }
})
app.post('/api/auth/logout', async (request, reply) => { await logout(request.cookies.session); reply.clearCookie('session', { path: '/' }); return { ok: true } })
app.get('/api/export', async (request, reply) => {
  if (!current(request.cookies.session)) return reply.code(401).send({ error: 'Sign in required.' })
  return { exportedAt: new Date().toISOString(), ...(await exportData()) }
})
app.post('/api/restore/validate', async (request, reply) => {
  const parsed = restoreInput.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ valid: false, error: 'The backup format is invalid.', issues: parsed.error.issues })
  return { valid: true, counts: { tasks: parsed.data.tasks.length, events: parsed.data.events.length, ideas: parsed.data.ideas.length } }
})
app.post('/api/restore', async (request, reply) => {
  const parsed = restoreInput.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ valid: false, error: 'The backup format is invalid.', issues: parsed.error.issues })
  await restoreData(parsed.data)
  return { restored: true, counts: { tasks: parsed.data.tasks.length, events: parsed.data.events.length, ideas: parsed.data.ideas.length } }
})

app.get('/api/health', async () => ({ status: 'ok', service: 'api' }))
app.get('/api/preferences', async () => getPreferences())
app.put('/api/preferences', async (request, reply) => {
  const parsed = preferencesInput.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid preferences', issues: parsed.error.issues })
  return updatePreferences(parsed.data)
})
app.get('/api/ready', async (_request, reply) => {
  if (!databaseReady()) return reply.code(503).send({ status: 'not_ready', database: 'unavailable' })
  return { status: 'ready', database: 'ok' }
})

app.get('/api/tasks', async () => {
  return listTasks()
})

app.post('/api/tasks', async (request, reply) => {
  const parsed = taskInput.safeParse(request.body)
  if (!parsed.success) {
    return reply.code(400).send({ error: 'Invalid task', issues: parsed.error.issues })
  }

  const created = await createTask(parsed.data.summary, parsed.data.notes, parsed.data.parentId)
  if (!created) return reply.code(404).send({ error: 'Parent task not found' })
  return reply.code(201).send(created)
})

app.patch('/api/tasks/:id/toggle', async (request, reply) => {
  const task = await toggleTask((request.params as { id: string }).id)
  if (!task) return reply.code(404).send({ error: 'Task not found' })
  return task
})

app.delete('/api/tasks/:id', async (request, reply) => {
  if (!await deleteTask((request.params as { id: string }).id)) return reply.code(404).send({ error: 'Task not found' })
  return reply.code(204).send()
})

app.get('/api/events', async () => listEvents())
app.post('/api/events', async (request, reply) => {
  const parsed = eventInput.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid event', issues: parsed.error.issues })
  return reply.code(201).send(await createEvent(parsed.data.title, parsed.data.date, parsed.data.notes))
})

app.get('/api/ideas', async () => listIdeas())
app.post('/api/ideas', async (request, reply) => {
  const parsed = ideaInput.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid idea', issues: parsed.error.issues })
  return reply.code(201).send(await createIdea(parsed.data.title, parsed.data.body))
})

app.get('/api/finance/accounts', async () => listFinancialAccounts())
app.post('/api/finance/accounts', async (request, reply) => {
  const parsed = accountInput.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid account' })
  return reply.code(201).send(await createFinancialAccount(parsed.data.name, parsed.data.kind, parsed.data.currency, parsed.data.openingBalanceMinor))
})
app.get('/api/finance/transactions', async () => listFinancialTransactions())
app.post('/api/finance/transactions', async (request, reply) => {
  const parsed = transactionInput.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid transaction' })
  const created = await createFinancialTransaction(parsed.data.accountId, parsed.data.description, parsed.data.amountMinor, parsed.data.date, parsed.data.category)
  if (!created) return reply.code(404).send({ error: 'Account not found' })
  return reply.code(201).send(created)
})
app.get('/api/goals', async () => listGoals())
app.post('/api/goals', async (request, reply) => {
  const parsed = goalInput.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid goal' })
  return reply.code(201).send(await createGoal(parsed.data.title, parsed.data.targetMinor, parsed.data.dueDate))
})
app.patch('/api/goals/:id/toggle', async (request, reply) => {
  const goal = await toggleGoal((request.params as { id: string }).id)
  if (!goal) return reply.code(404).send({ error: 'Goal not found' })
  return goal
})
app.get('/api/movies', async () => listMovies())
app.post('/api/movies', async (request, reply) => {
  const parsed = movieInput.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid movie' })
  return reply.code(201).send(await createMovie(parsed.data.title, parsed.data.year, parsed.data.notes))
})
app.get('/api/music', async () => listMusic())
app.post('/api/music', async (request, reply) => {
  const parsed = musicInput.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid track' })
  return reply.code(201).send(await createMusic(parsed.data.title, parsed.data.artist, parsed.data.album))
})
app.get('/api/memories', async () => listMemories())
app.post('/api/memories', async (request, reply) => {
  const parsed = memoryInput.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Invalid memory' })
  return reply.code(201).send(await createMemory(parsed.data.title, parsed.data.body, parsed.data.occurredOn))
})
app.get('/api/memories/:id/attachments', async request => listAttachments((request.params as { id: string }).id))
app.post('/api/memories/:id/attachments', async (request, reply) => {
  const file = await request.file()
  if (!file) return reply.code(400).send({ error: 'Choose a file to upload.' })
  const content = await file.toBuffer()
  const filename = file.filename.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 240) || 'attachment'
  const storageKey = `${randomBytes(16).toString('hex')}-${filename}`
  await writeFile(path.join(uploadDirectory, storageKey), content, { flag: 'wx' })
  const created = await createAttachment((request.params as { id: string }).id, filename, file.mimetype, storageKey, content.byteLength)
  if (!created) { await unlink(path.join(uploadDirectory, storageKey)); return reply.code(404).send({ error: 'Memory not found' }) }
  return reply.code(201).send(created)
})
app.get('/api/attachments/:id', async (request, reply) => {
  const attachment = await getAttachment((request.params as { id: string }).id)
  if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
  try {
    const content = await readFile(path.join(uploadDirectory, attachment.storageKey))
    return reply.type(attachment.mimeType).header('content-disposition', `attachment; filename="${attachment.filename.replace(/"/g, '')}"`).send(content)
  } catch { return reply.code(404).send({ error: 'Attachment file not found' }) }
})
app.delete('/api/attachments/:id', async (request, reply) => {
  const attachment = await deleteAttachment((request.params as { id: string }).id)
  if (!attachment) return reply.code(404).send({ error: 'Attachment not found' })
  await unlink(path.join(uploadDirectory, attachment.storageKey)).catch(() => undefined)
  return reply.code(204).send()
})

const port = Number(process.env.API_PORT ?? 3636)
await initializeDatabase()
await initializeAuth()
await app.listen({ port, host: '0.0.0.0' })
