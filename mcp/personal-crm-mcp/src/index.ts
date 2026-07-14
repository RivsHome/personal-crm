import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v3'
import { operations } from './catalog.js'

type JsonRecord = Record<string, unknown>

class PersonalCrmClient {
  private readonly baseUrl = (process.env.PERSONAL_CRM_URL ?? 'https://life.rivsconsole.shop').replace(/\/$/, '')
  private readonly email = process.env.PERSONAL_CRM_EMAIL
  private readonly password = process.env.PERSONAL_CRM_PASSWORD
  private cookies = new Map<string, string>()
  private csrf = ''

  async request(path: string, method: string, body?: unknown) {
    await this.ensureSession()
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        cookie: this.cookieHeader(),
        ...(method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    this.storeCookies(response)
    const contentType = response.headers.get('content-type') ?? ''
    const data = response.status === 204 ? null : contentType.includes('application/json') ? await response.json() : await response.text()
    return { ok: response.ok, status: response.status, data }
  }

  private async ensureSession() {
    if (this.cookies.has('session') && this.csrf) return
    if (!this.email || !this.password) throw new Error('Set PERSONAL_CRM_EMAIL and PERSONAL_CRM_PASSWORD for this MCP server.')
    const init = await fetch(`${this.baseUrl}/api/auth/me`)
    this.storeCookies(init)
    const login = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.cookieHeader() },
      body: JSON.stringify({ email: this.email, password: this.password })
    })
    this.storeCookies(login)
    if (!login.ok || !this.cookies.has('session') || !this.csrf) throw new Error('Personal CRM login failed. Check PERSONAL_CRM_URL and credentials.')
  }

  private storeCookies(response: Response) {
    const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') ?? '']
    for (const value of values) {
      const [pair] = value.split(';')
      const index = pair.indexOf('=')
      if (index < 1) continue
      const name = pair.slice(0, index).trim()
      const cookie = pair.slice(index + 1).trim()
      this.cookies.set(name, cookie)
      if (name === 'csrf') this.csrf = decodeURIComponent(cookie)
    }
  }

  private cookieHeader() { return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ') }
}

const client = new PersonalCrmClient()
const server = new McpServer({ name: 'personal-crm-mcp', version: '0.1.0' })

server.registerTool('personal_crm_capabilities', {
  title: 'Personal CRM capabilities',
  description: 'List every Personal CRM operation available to Hermes through this MCP server.',
  annotations: { readOnlyHint: true }
}, async () => {
  const structuredContent = { operations: Object.entries(operations).map(([operation, definition]) => ({ operation, ...definition })) }
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent }
})

server.registerTool('personal_crm_workspace_overview', {
  title: 'Personal CRM workspace overview',
  description: 'Read a concise snapshot of tasks, calendar, ideas, finance, goals, media, memories, and preferences.',
  annotations: { readOnlyHint: true }
}, async () => {
  const keys = ['tasks_list', 'calendar_list', 'ideas_list', 'finance_accounts_list', 'finance_transactions_list', 'goals_list', 'movies_list', 'music_list', 'memories_list', 'workspace_preferences_get'] as const
  const results = await Promise.all(keys.map(async key => [key, await client.request(operations[key].path, operations[key].method)] as const))
  const failed = results.find(([, result]) => !result.ok)
  if (failed) return { isError: true, content: [{ type: 'text', text: `Personal CRM request failed: ${failed[0]} (${failed[1].status})` }] }
  const data = Object.fromEntries(results.map(([key, result]) => [key, result.data]))
  const structuredContent = {
    tasks: (data.tasks_list as Array<{ completed: boolean }>).length,
    activeTasks: (data.tasks_list as Array<{ completed: boolean }>).filter(task => !task.completed).length,
    events: (data.calendar_list as unknown[]).length,
    ideas: (data.ideas_list as unknown[]).length,
    accounts: (data.finance_accounts_list as unknown[]).length,
    transactions: (data.finance_transactions_list as unknown[]).length,
    goals: (data.goals_list as unknown[]).length,
    movies: (data.movies_list as unknown[]).length,
    music: (data.music_list as unknown[]).length,
    memories: (data.memories_list as unknown[]).length,
    preferences: data.workspace_preferences_get
  }
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent }
})

const callToolConfig = {
  title: 'Call an allowlisted Personal CRM operation',
  description: 'Operate any supported Personal CRM module. Call personal_crm_capabilities first when the operation name or required body is unclear.',
  inputSchema: {
    operation: z.string().describe('An operation name returned by personal_crm_capabilities.'),
    id: z.string().optional().describe('Required for operation paths containing :id.'),
    body: z.any().optional().describe('JSON request body for create, update, restore, or preference operations.')
  }
} as any

server.registerTool('personal_crm_call', callToolConfig, async (args: any) => {
  const definition = operations[args.operation]
  if (!definition) return { isError: true, content: [{ type: 'text', text: `Unknown operation: ${args.operation}. Use personal_crm_capabilities.` }] }
  if (definition.path.includes(':id') && !args.id) return { isError: true, content: [{ type: 'text', text: `Operation ${args.operation} requires id.` }] }
  const path = definition.path.replace(':id', encodeURIComponent(args.id ?? ''))
  const result = await client.request(path, definition.method, args.body)
  const structuredContent = { operation: args.operation, method: definition.method, path, status: result.status, ok: result.ok, data: result.data }
  return { isError: !result.ok, content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }], structuredContent }
})

async function main() {
  await server.connect(new StdioServerTransport())
  console.error('Personal CRM MCP server running on stdio')
}

main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1) })
