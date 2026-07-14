export type Operation = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  description: string
}

export const operations: Record<string, Operation> = {
  workspace_preferences_get: { method: 'GET', path: '/api/preferences', description: 'Get workspace personalization settings.' },
  workspace_preferences_update: { method: 'PUT', path: '/api/preferences', description: 'Update workspace personalization settings.' },
  tasks_list: { method: 'GET', path: '/api/tasks', description: 'List all tasks and nested subtasks.' },
  tasks_create: { method: 'POST', path: '/api/tasks', description: 'Create a task or subtask.' },
  tasks_update: { method: 'PUT', path: '/api/tasks/:id', description: 'Update a task title, notes, due date, priority, tags, or list.' },
  tasks_toggle: { method: 'PATCH', path: '/api/tasks/:id/toggle', description: 'Toggle task completion.' },
  tasks_delete: { method: 'DELETE', path: '/api/tasks/:id', description: 'Delete a task and its subtasks.' },
  calendar_list: { method: 'GET', path: '/api/events', description: 'List calendar events.' },
  calendar_create: { method: 'POST', path: '/api/events', description: 'Create a categorized calendar event.' },
  calendar_update: { method: 'PUT', path: '/api/events/:id', description: 'Update a calendar event.' },
  calendar_delete: { method: 'DELETE', path: '/api/events/:id', description: 'Delete a calendar event.' },
  ideas_list: { method: 'GET', path: '/api/ideas', description: 'List captured ideas.' },
  ideas_create: { method: 'POST', path: '/api/ideas', description: 'Create an idea.' },
  finance_accounts_list: { method: 'GET', path: '/api/finance/accounts', description: 'List financial accounts and balances.' },
  finance_accounts_create: { method: 'POST', path: '/api/finance/accounts', description: 'Create a financial account.' },
  finance_transactions_list: { method: 'GET', path: '/api/finance/transactions', description: 'List financial transactions.' },
  finance_transactions_create: { method: 'POST', path: '/api/finance/transactions', description: 'Record a financial transaction.' },
  goals_list: { method: 'GET', path: '/api/goals', description: 'List goals.' },
  goals_create: { method: 'POST', path: '/api/goals', description: 'Create a goal.' },
  goals_toggle: { method: 'PATCH', path: '/api/goals/:id/toggle', description: 'Toggle goal completion.' },
  movies_list: { method: 'GET', path: '/api/movies', description: 'List movies.' },
  movies_create: { method: 'POST', path: '/api/movies', description: 'Create a movie entry.' },
  music_list: { method: 'GET', path: '/api/music', description: 'List music tracks.' },
  music_create: { method: 'POST', path: '/api/music', description: 'Create a music track.' },
  memories_list: { method: 'GET', path: '/api/memories', description: 'List memory entries.' },
  memories_create: { method: 'POST', path: '/api/memories', description: 'Create a memory entry.' },
  memory_attachments_list: { method: 'GET', path: '/api/memories/:id/attachments', description: 'List attachments for a memory.' },
  memory_attachments_delete: { method: 'DELETE', path: '/api/attachments/:id', description: 'Delete a memory attachment.' },
  backup_export: { method: 'GET', path: '/api/export', description: 'Export all Personal CRM data as JSON.' },
  backup_restore_validate: { method: 'POST', path: '/api/restore/validate', description: 'Validate a Personal CRM backup before restore.' },
  backup_restore: { method: 'POST', path: '/api/restore', description: 'Replace Personal CRM data with a validated backup.' },
  service_health: { method: 'GET', path: '/api/health', description: 'Check API health.' },
  service_ready: { method: 'GET', path: '/api/ready', description: 'Check database readiness.' }
}
