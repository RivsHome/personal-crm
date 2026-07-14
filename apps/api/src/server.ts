import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import { z } from 'zod'
import { createEvent, createIdea, createTask, databaseReady, deleteTask, exportData, getPreferences, initializeDatabase, listEvents, listIdeas, listTasks, restoreData, toggleTask, updatePreferences } from './db.js'
import { current, initializeAuth, login, logout, register } from './auth.js'

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

app.addHook('preHandler', async (request, reply) => {
  const protectedPath = request.url.startsWith('/api/tasks') || request.url.startsWith('/api/events') || request.url.startsWith('/api/ideas') || request.url.startsWith('/api/export') || request.url.startsWith('/api/preferences') || request.url.startsWith('/api/restore')
  if (protectedPath && !current(request.cookies.session)) return reply.code(401).send({ error: 'Sign in required.' })
})

const taskInput = z.object({
  summary: z.string().trim().min(1).max(240),
  notes: z.string().max(5000).default('')
})
const eventInput = z.object({ title: z.string().trim().min(1).max(240), date: z.string().date(), notes: z.string().max(5000).default('') })
const ideaInput = z.object({ title: z.string().trim().min(1).max(240), body: z.string().max(10000).default('') })
const credentials = z.object({ email: z.string().email(), password: z.string().min(8).max(200), name: z.string().trim().min(1).max(80).optional() })
const preferencesInput = z.object({ theme: z.enum(['dark', 'light']).optional(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), timezone: z.string().min(1).max(80).optional(), weekStart: z.enum(['sunday', 'monday']).optional(), modules: z.object({ calendar: z.boolean().optional(), tasks: z.boolean().optional(), ideas: z.boolean().optional() }).optional(), widgets: z.object({ tasks: z.boolean().optional(), calendar: z.boolean().optional(), ideas: z.boolean().optional() }).optional() })
const restoreInput = z.object({ tasks: z.array(z.object({ id: z.string().uuid(), summary: z.string().min(1).max(240), notes: z.string(), completed: z.boolean(), createdAt: z.string().datetime() })), events: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(240), date: z.string().date(), notes: z.string() })), ideas: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(240), body: z.string(), createdAt: z.string().datetime() })) })

app.get('/api/auth/me', async request => ({ user: current(request.cookies.session) }))
app.post('/api/auth/register', async (request, reply) => {
  const parsed = credentials.safeParse(request.body)
  if (!parsed.success || !parsed.data.name) return reply.code(400).send({ error: 'Email, name, and an 8-character password are required.' })
  const created = await register(parsed.data.email, parsed.data.name, parsed.data.password)
  if (!created) return reply.code(409).send({ error: 'A workspace owner already exists.' })
  const session = await login(parsed.data.email, parsed.data.password)
  reply.setCookie('session', session!.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return created
})
app.post('/api/auth/login', async (request, reply) => {
  const parsed = credentials.safeParse(request.body)
  if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid email and password.' })
  const session = await login(parsed.data.email, parsed.data.password)
  if (!session) return reply.code(401).send({ error: 'Invalid email or password.' })
  reply.setCookie('session', session.token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return current(session.token)
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

  return reply.code(201).send(await createTask(parsed.data.summary, parsed.data.notes))
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

const port = Number(process.env.API_PORT ?? 3636)
await initializeDatabase()
await initializeAuth()
await app.listen({ port, host: '0.0.0.0' })
