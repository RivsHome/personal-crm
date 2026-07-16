import { useEffect, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, CheckSquare, ChevronDown, ChevronRight, CircleUserRound, Download, GripVertical, LayoutDashboard, Pencil, Plus, Settings, Sparkles, Target, Trash2, WalletCards } from 'lucide-react'
import './module.css'

type Task = { id: string; parentId: string | null; summary: string; notes: string; dueDate: string | null; priority: 'low' | 'normal' | 'high'; tags: string[]; listName: string; sortOrder: number; completed: boolean; createdAt: string }
type EventItem = { id: string; title: string; date: string; notes: string; category: string }
type Idea = { id: string; title: string; body: string; createdAt: string }
type Account = { id: string; name: string; kind: string; currency: string; openingBalanceMinor: number; balanceMinor: number }
type Transaction = { id: string; accountId: string; description: string; amountMinor: number; date: string; category: string }
type Goal = { id: string; title: string; targetMinor: number | null; currentMinor: number; dueDate: string | null; completed: boolean }
type Movie = { id: string; title: string; year: number | null; watched: boolean; rating: number | null; notes: string }
type MusicTrack = { id: string; title: string; artist: string; album: string; listened: boolean }
type Memory = { id: string; title: string; body: string; occurredOn: string | null }

function TaskTree({ tasks, onToggle, onDelete, onAddSubtask, onEdit, onReorder, subtaskParentId, subtaskSummary, saving, onSubtaskSummaryChange, onCreateSubtask, onCancelSubtask }: { tasks: Task[]; onToggle: (id: string) => void; onDelete: (id: string) => void; onAddSubtask: (id: string) => void; onEdit: (task: Task) => void; onReorder: (parentId: string | null, sourceId: string, targetId: string) => void; subtaskParentId: string | null; subtaskSummary: string; saving: boolean; onSubtaskSummaryChange: (value: string) => void; onCreateSubtask: (event: React.FormEvent) => void; onCancelSubtask: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [draggingId, setDraggingId] = useState<string | null>(null)
  useEffect(() => {
    if (!subtaskParentId) return
    setExpanded(current => new Set(current).add(subtaskParentId))
  }, [subtaskParentId])
  useEffect(() => {
    if (!draggingId) return
    window.addEventListener('pointerup', stopDrag)
    window.addEventListener('pointercancel', stopDrag)
    return () => {
      window.removeEventListener('pointerup', stopDrag)
      window.removeEventListener('pointercancel', stopDrag)
    }
  }, [draggingId])
  function toggleExpanded(id: string) { setExpanded(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next }) }
  function startDrag(event: React.PointerEvent, taskId: string) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingId(taskId)
  }
  function moveDrag(target: Task, sourceId = draggingId) {
    if (!sourceId || sourceId === target.id) return
    const source = tasks.find(task => task.id === sourceId)
    if (!source || (source.parentId ?? null) !== (target.parentId ?? null) || source.completed !== target.completed) return
    onReorder(target.parentId ?? null, sourceId, target.id)
  }
  function moveDragOverPointer(event: React.PointerEvent, sourceId: string) {
    if (!draggingId) return
    const element = document.elementFromPoint(event.clientX, event.clientY)
    const row = element?.closest<HTMLElement>('[data-task-id]')
    const targetId = row?.dataset.taskId
    const target = targetId ? tasks.find(task => task.id === targetId) : undefined
    if (target) moveDrag(target, sourceId)
  }
  function stopDrag() { setDraggingId(null) }
  function render(parentId: string | null): React.ReactNode[] {
    return tasks.filter(task => (task.parentId ?? null) === parentId).map(task => {
      const hasChildren = tasks.some(child => child.parentId === task.id)
      const isAddingSubtask = subtaskParentId === task.id
      return <li key={task.id} data-task-id={task.id} className={`task-item ${draggingId === task.id ? 'dragging' : ''}`}><div className="task-row"><button className="drag-handle" type="button" onPointerDown={event => startDrag(event, task.id)} onPointerMove={event => moveDragOverPointer(event, task.id)} onPointerUp={stopDrag} onPointerCancel={stopDrag} title="Drag to reorder"><GripVertical size={17} /></button><button className={`check ${task.completed ? 'done' : ''}`} onClick={() => onToggle(task.id)} title="Toggle task"><CheckSquare size={17} /></button><span className={task.completed ? 'completed' : ''}><b>{task.summary}</b><small className="task-meta">{task.listName} · {task.priority}{task.dueDate ? ` · due ${task.dueDate}` : ''}{task.tags.length ? ` · ${task.tags.map(tag => `#${tag}`).join(' ')}` : ''}</small></span>{hasChildren && <button className="subtask" onClick={() => toggleExpanded(task.id)} title={expanded.has(task.id) ? 'Hide subtasks' : 'Show subtasks'}><ChevronDown className={expanded.has(task.id) ? 'expanded' : ''} size={16} /></button>}<button className="subtask" onClick={() => onEdit(task)} title="Edit task"><Pencil size={15} /></button><button className="subtask" onClick={() => onAddSubtask(task.id)} title="Add subtask"><Plus size={15} /></button><button className="delete" onClick={() => onDelete(task.id)} title="Delete task"><Trash2 size={15} /></button></div>{isAddingSubtask && <form className="subtask-dropdown" onSubmit={onCreateSubtask}><input autoFocus value={subtaskSummary} onChange={event => onSubtaskSummaryChange(event.target.value)} placeholder={`Subtask of ${task.summary}`} /><button type="submit" disabled={saving}><Plus size={16} /> Add</button><button type="button" className="text-action" onClick={onCancelSubtask}>Cancel</button></form>}{hasChildren && expanded.has(task.id) && <ul className="task-list nested-tasks">{render(task.id)}</ul>}</li>
    })
  }
  return <ul className="task-list">{render(null)}</ul>
}
type User = { email: string; name: string }
type Preferences = { theme: 'dark' | 'light'; accent: string; timezone: string; weekStart: 'sunday' | 'monday'; modules: { calendar: boolean; tasks: boolean; ideas: boolean }; widgets: { tasks: boolean; calendar: boolean; ideas: boolean }; dashboardOrder: Array<'tasks' | 'calendar' | 'ideas'> }
const API = import.meta.env.VITE_API_URL || ''
const apiFetch = (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  if (init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase())) {
    const csrf = document.cookie.split('; ').find(item => item.startsWith('csrf='))?.split('=')[1]
    if (csrf) headers.set('x-csrf-token', decodeURIComponent(csrf))
  }
  return fetch(`${API}${path}`, { ...init, headers, credentials: 'include' })
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first); start.setDate(start.getDate() - start.getDay())
  return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date })
}

function isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function localToday() { return isoDate(new Date()) }
function startOfLocalMonth(date = new Date()) { return new Date(date.getFullYear(), date.getMonth(), 1, 12) }
function dateParts(date: Date, timezone?: string) {
  const parts = new Intl.DateTimeFormat(undefined, { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).formatToParts(date)
  return {
    weekday: parts.find(part => part.type === 'weekday')?.value ?? '',
    month: parts.find(part => part.type === 'month')?.value ?? '',
    day: parts.find(part => part.type === 'day')?.value ?? '',
    year: parts.find(part => part.type === 'year')?.value ?? ''
  }
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authName, setAuthName] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authSaving, setAuthSaving] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [summary, setSummary] = useState('')
  const [managerSummary, setManagerSummary] = useState('')
  const [managerNotes, setManagerNotes] = useState('')
  const [managerDueDate, setManagerDueDate] = useState('')
  const [managerPriority, setManagerPriority] = useState<Task['priority']>('normal')
  const [managerTags, setManagerTags] = useState('')
  const [managerListName, setManagerListName] = useState('Inbox')
  const [taskEditorOpen, setTaskEditorOpen] = useState(false)
  const [taskFilter, setTaskFilter] = useState<'active' | 'completed' | 'all'>('active')
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [subtaskParentId, setSubtaskParentId] = useState<string | null>(null)
  const [subtaskSummary, setSubtaskSummary] = useState('')
  const [view, setView] = useState<'dashboard' | 'calendar' | 'tasks' | 'ideas' | 'finance' | 'goals' | 'movies' | 'music' | 'memories' | 'settings'>('dashboard')
  const [events, setEvents] = useState<EventItem[]>([])
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState(() => localToday())
  const [eventNotes, setEventNotes] = useState('')
  const [eventCategory, setEventCategory] = useState('General')
  const [calendarMonth, setCalendarMonth] = useState(() => startOfLocalMonth())
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null)
  const [today, setToday] = useState(() => new Date())
  const [ideaTitle, setIdeaTitle] = useState('')
  const [ideaBody, setIdeaBody] = useState('')
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const [restoreStatus, setRestoreStatus] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [accountName, setAccountName] = useState('')
  const [accountBalance, setAccountBalance] = useState('0')
  const [transactionAccount, setTransactionAccount] = useState('')
  const [transactionDescription, setTransactionDescription] = useState('')
  const [transactionAmount, setTransactionAmount] = useState('')
  const [goalTitle, setGoalTitle] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalDueDate, setGoalDueDate] = useState('')
  const [movies, setMovies] = useState<Movie[]>([])
  const [music, setMusic] = useState<MusicTrack[]>([])
  const [memories, setMemories] = useState<Memory[]>([])
  const [movieTitle, setMovieTitle] = useState('')
  const [movieYear, setMovieYear] = useState('')
  const [musicTitle, setMusicTitle] = useState('')
  const [musicArtist, setMusicArtist] = useState('')
  const [musicAlbum, setMusicAlbum] = useState('')
  const [memoryTitle, setMemoryTitle] = useState('')
  const [memoryBody, setMemoryBody] = useState('')
  const [memoryDate, setMemoryDate] = useState('')
  const [memoryFile, setMemoryFile] = useState<File | null>(null)
  const [memoryStatus, setMemoryStatus] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordStatus, setPasswordStatus] = useState('')

  useEffect(() => {
    void apiFetch('/api/auth/me').then(response => response.json()).then(data => setUser(data.user)).finally(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setToday(new Date()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  async function loadTasks() {
    setLoading(true)
    const response = await apiFetch('/api/tasks')
    if (response.ok) setTasks(await response.json())
    else setTasks([])
    setLoading(false)
  }

  useEffect(() => {
    if (!user) { setTasks([]); setLoading(false); return }
    void loadTasks()
    void apiFetch('/api/preferences').then(response => response.json()).then(setPreferences)
    void apiFetch('/api/events').then(response => response.json()).then(setEvents)
    void apiFetch('/api/ideas').then(response => response.json()).then(setIdeas)
    void apiFetch('/api/finance/accounts').then(response => response.ok ? response.json() : []).then(setAccounts)
    void apiFetch('/api/finance/transactions').then(response => response.ok ? response.json() : []).then(setTransactions)
    void apiFetch('/api/goals').then(response => response.ok ? response.json() : []).then(setGoals)
    void apiFetch('/api/movies').then(response => response.ok ? response.json() : []).then(setMovies)
    void apiFetch('/api/music').then(response => response.ok ? response.json() : []).then(setMusic)
    void apiFetch('/api/memories').then(response => response.ok ? response.json() : []).then(setMemories)
  }, [user])

  async function savePreferences(next: Preferences) {
    setPreferences(next); setPreferencesSaving(true)
    const response = await apiFetch('/api/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) })
    if (response.ok) setPreferences(await response.json())
    setPreferencesSaving(false)
  }

  function moveWidget(widget: Preferences['dashboardOrder'][number], direction: -1 | 1) {
    if (!preferences) return
    const order = [...preferences.dashboardOrder]
    const index = order.indexOf(widget)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return
    ;[order[index], order[nextIndex]] = [order[nextIndex], order[index]]
    void savePreferences({ ...preferences, dashboardOrder: order })
  }

  async function restoreBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setRestoreStatus('Validating backup...')
    try {
      const payload = JSON.parse(await file.text())
      const validation = await apiFetch('/api/restore/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const result = await validation.json()
      if (!validation.ok) { setRestoreStatus(result.error ?? 'Backup validation failed.'); return }
      const restored = await apiFetch('/api/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      if (!restored.ok) { setRestoreStatus('Restore failed.'); return }
      await loadTasks(); const [eventResponse, ideaResponse] = await Promise.all([apiFetch('/api/events'), apiFetch('/api/ideas')]); setEvents(await eventResponse.json()); setIdeas(await ideaResponse.json()); setRestoreStatus(`Restored ${result.counts.tasks} tasks, ${result.counts.events} events, and ${result.counts.ideas} ideas.`)
    } catch { setRestoreStatus('Choose a valid Personal CRM JSON export.') }
    event.target.value = ''
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthSaving(true); setAuthError('')
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? authEmail)
    const name = String(form.get('name') ?? authName)
    const password = String(form.get('password') ?? authPassword)
    const credentials = authMode === 'register' ? { email, name, password } : { email, password }
    const response = await apiFetch(`/api/auth/${authMode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) })
    const data = await response.json()
    if (!response.ok) setAuthError(data.error ?? 'Unable to continue.')
    else setUser(data.user ?? data)
    setAuthSaving(false)
  }

  async function signOut() {
    await apiFetch('/api/auth/logout', { method: 'POST' }); setUser(null)
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault()
    setPasswordStatus('')
    const response = await apiFetch('/api/auth/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword }) })
    const result = await response.json()
    setPasswordStatus(response.ok ? 'Password changed. All other sessions were signed out.' : result.error ?? 'Unable to change password.')
    if (response.ok) { setCurrentPassword(''); setNewPassword('') }
  }

  async function downloadExport() {
    const response = await apiFetch('/api/export')
    if (!response.ok) return
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a')
    link.href = url; link.download = `personal-crm-export-${localToday()}.json`; link.click(); URL.revokeObjectURL(url)
  }

  if (!authChecked) return <div className="auth-screen"><div className="auth-card"><Sparkles size={24} /><p>Loading your workspace...</p></div></div>
  if (!user) return <div className="auth-screen"><form className="auth-card" onSubmit={submitAuth}><div className="brand"><Sparkles size={20} /><strong>Personal CRM</strong></div><h1>{authMode === 'login' ? 'Welcome back' : 'Create your workspace'}</h1><p className="muted">Keep your personal life organized in one calm place.</p>{authMode === 'register' && <input name="name" value={authName} onChange={event => setAuthName(event.target.value)} placeholder="Your name" required />}{<input name="email" type="email" value={authEmail} onChange={event => setAuthEmail(event.target.value)} placeholder="Email address" required />}<input name="password" type="password" value={authPassword} onChange={event => setAuthPassword(event.target.value)} placeholder="Password (8+ characters)" minLength={8} required />{authError && <p className="auth-error">{authError}</p>}<button className="auth-submit" disabled={authSaving}>{authSaving ? 'Working...' : authMode === 'login' ? 'Sign in' : 'Create workspace'}</button><button type="button" className="auth-switch" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>{authMode === 'login' ? 'Need a workspace? Create one' : 'Already have a workspace? Sign in'}</button></form></div>

  async function createEvent(event: React.FormEvent) {
    event.preventDefault()
    if (!eventTitle.trim()) return
    const payload = { title: eventTitle, date: eventDate, notes: eventNotes, category: eventCategory }
    const response = await apiFetch(editingEvent ? `/api/events/${editingEvent.id}` : '/api/events', { method: editingEvent ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    if (response.ok) {
      const saved = await response.json() as EventItem
      setEvents(current => editingEvent ? current.map(item => item.id === saved.id ? saved : item).sort((a, b) => a.date.localeCompare(b.date)) : [...current, saved].sort((a, b) => a.date.localeCompare(b.date)))
      setEventTitle(''); setEventDate(localToday()); setEventNotes(''); setEventCategory('General'); setEditingEvent(null)
    }
  }

  function startEditEvent(item: EventItem) {
    setEditingEvent(item); setEventTitle(item.title); setEventDate(item.date); setEventNotes(item.notes); setEventCategory(item.category); setCalendarMonth(new Date(`${item.date}T12:00:00`))
  }

  async function deleteEvent(id: string) {
    const response = await apiFetch(`/api/events/${id}`, { method: 'DELETE' })
    if (response.ok) { setEvents(current => current.filter(item => item.id !== id)); if (editingEvent?.id === id) setEditingEvent(null) }
  }

  async function createIdea(event: React.FormEvent) {
    event.preventDefault()
    if (!ideaTitle.trim()) return
    const response = await apiFetch('/api/ideas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: ideaTitle, body: ideaBody }) })
    if (response.ok) { const created = await response.json() as Idea; setIdeas(current => [created, ...current]); setIdeaTitle(''); setIdeaBody('') }
  }

  async function createTask(event: React.FormEvent) {
    event.preventDefault()
    if (!summary.trim()) return
    setSaving(true)
    const response = await apiFetch('/api/tasks', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary })
    })
    if (response.ok) { setSummary(''); await loadTasks() }
    setSaving(false)
  }

  async function createManagerTask(event: React.FormEvent) {
    event.preventDefault()
    if (!managerSummary.trim()) return
    setSaving(true)
    const payload = { summary: managerSummary, notes: managerNotes, dueDate: managerDueDate || null, priority: managerPriority, tags: managerTags.split(',').map(tag => tag.trim()).filter(Boolean), listName: managerListName.trim() || 'Inbox' }
    const response = await apiFetch(editingTask ? `/api/tasks/${editingTask.id}` : '/api/tasks', { method: editingTask ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    if (response.ok) { resetManagerTaskForm(); setTaskEditorOpen(false); await loadTasks() }
    setSaving(false)
  }

  function resetManagerTaskForm() {
    setEditingTask(null)
    setManagerSummary('')
    setManagerNotes('')
    setManagerDueDate('')
    setManagerTags('')
    setManagerListName('Inbox')
    setManagerPriority('normal')
  }

  function openNewTaskForm() {
    resetManagerTaskForm()
    setTaskEditorOpen(true)
  }

  async function createSubtask(event: React.FormEvent) {
    event.preventDefault()
    if (!subtaskParentId || !subtaskSummary.trim()) return
    setSaving(true)
    const response = await apiFetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ summary: subtaskSummary, parentId: subtaskParentId }) })
    if (response.ok) { setSubtaskSummary(''); setSubtaskParentId(null); await loadTasks() }
    setSaving(false)
  }

  function startSubtask(parentId: string) {
    setSubtaskParentId(parentId)
    setSubtaskSummary('')
    setView('tasks')
  }

  function startEditTask(task: Task) {
    setEditingTask(task); setManagerSummary(task.summary); setManagerNotes(task.notes); setManagerDueDate(task.dueDate ?? ''); setManagerPriority(task.priority); setManagerTags(task.tags.join(', ')); setManagerListName(task.listName); setTaskEditorOpen(true); setView('tasks')
  }

  async function toggleTask(id: string) {
    await apiFetch(`/api/tasks/${id}/toggle`, { method: 'PATCH' })
    await loadTasks()
  }

  async function deleteTask(id: string) {
    await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' })
    await loadTasks()
  }

  function reorderTask(parentId: string | null, sourceId: string, targetId: string) {
    setTasks(current => {
      const source = current.find(task => task.id === sourceId)
      const target = current.find(task => task.id === targetId)
      if (!source || !target || (source.parentId ?? null) !== parentId || (target.parentId ?? null) !== parentId || source.completed !== target.completed) return current
      const siblingIds = current.filter(task => (task.parentId ?? null) === parentId && task.completed === source.completed).map(task => task.id)
      const from = siblingIds.indexOf(sourceId)
      const to = siblingIds.indexOf(targetId)
      if (from < 0 || to < 0 || from === to) return current
      const nextSiblingIds = [...siblingIds]
      const [moved] = nextSiblingIds.splice(from, 1)
      nextSiblingIds.splice(to, 0, moved)
      const order = new Map(nextSiblingIds.map((id, index) => [id, (index + 1) * 1000]))
      const next = current.map(task => order.has(task.id) ? { ...task, sortOrder: order.get(task.id)! } : task).sort((a, b) => Number(a.completed) - Number(b.completed) || a.sortOrder - b.sortOrder || b.createdAt.localeCompare(a.createdAt))
      void apiFetch('/api/tasks/reorder', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parentId, taskIds: nextSiblingIds }) })
      return next
    })
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault()
    if (!accountName.trim()) return
    const response = await apiFetch('/api/finance/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: accountName, kind: 'cash', currency: 'USD', openingBalanceMinor: Math.round(Number(accountBalance || 0) * 100) }) })
    if (response.ok) { const created = await response.json() as Account; setAccounts(current => [created, ...current]); setAccountName(''); setAccountBalance('0') }
  }

  async function createTransaction(event: React.FormEvent) {
    event.preventDefault()
    if (!transactionAccount || !transactionDescription.trim() || !transactionAmount) return
    const response = await apiFetch('/api/finance/transactions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId: transactionAccount, description: transactionDescription, amountMinor: Math.round(Number(transactionAmount) * 100), date: localToday(), category: 'General' }) })
    if (response.ok) { const created = await response.json() as Transaction; setTransactions(current => [created, ...current]); setTransactionDescription(''); setTransactionAmount('') }
  }

  async function createGoal(event: React.FormEvent) {
    event.preventDefault()
    if (!goalTitle.trim()) return
    const response = await apiFetch('/api/goals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: goalTitle, targetMinor: goalTarget ? Math.round(Number(goalTarget) * 100) : null, dueDate: goalDueDate || null }) })
    if (response.ok) { const created = await response.json() as Goal; setGoals(current => [created, ...current]); setGoalTitle(''); setGoalTarget(''); setGoalDueDate('') }
  }

  async function toggleGoal(id: string) {
    const response = await apiFetch(`/api/goals/${id}/toggle`, { method: 'PATCH' })
    if (response.ok) { const updated = await response.json() as Goal; setGoals(current => current.map(goal => goal.id === id ? updated : goal)) }
  }

  async function createMovie(event: React.FormEvent) {
    event.preventDefault()
    if (!movieTitle.trim()) return
    const response = await apiFetch('/api/movies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: movieTitle, year: movieYear ? Number(movieYear) : null, notes: '' }) })
    if (response.ok) { const created = await response.json() as Movie; setMovies(current => [created, ...current]); setMovieTitle(''); setMovieYear('') }
  }
  async function createMusic(event: React.FormEvent) {
    event.preventDefault()
    if (!musicTitle.trim()) return
    const response = await apiFetch('/api/music', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: musicTitle, artist: musicArtist, album: musicAlbum }) })
    if (response.ok) { const created = await response.json() as MusicTrack; setMusic(current => [created, ...current]); setMusicTitle(''); setMusicArtist(''); setMusicAlbum('') }
  }
  async function createMemory(event: React.FormEvent) {
    event.preventDefault()
    if (!memoryTitle.trim()) return
    const response = await apiFetch('/api/memories', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: memoryTitle, body: memoryBody, occurredOn: memoryDate || null }) })
    if (response.ok) {
      const created = await response.json() as Memory
      setMemories(current => [created, ...current]); setMemoryTitle(''); setMemoryBody(''); setMemoryDate('')
      if (memoryFile) {
        const form = new FormData(); form.append('file', memoryFile)
        const upload = await apiFetch(`/api/memories/${created.id}/attachments`, { method: 'POST', body: form })
        setMemoryStatus(upload.ok ? `Saved ${memoryFile.name} with the memory.` : 'Memory saved, but the attachment upload failed.')
      }
      setMemoryFile(null)
    }
  }

  const visibleTasks = tasks.filter(task => taskFilter === 'all' || (taskFilter === 'completed' ? task.completed : !task.completed))
  const activeTaskCount = tasks.filter(task => !task.completed).length
  const monthEvents = events.filter(item => item.date.startsWith(`${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}`))
  const displayDate = dateParts(today, preferences?.timezone)

  return <div className="app-shell" data-theme={preferences?.theme ?? 'dark'} style={{ '--accent': preferences?.accent ?? '#c9f253' } as React.CSSProperties}>
    <aside className="sidebar">
      <div className="brand"><Sparkles size={18} /> <strong>Personal CRM</strong></div>
      <label className="search"><span>⌕</span><input placeholder="Search modules..." /></label>
      <nav>
        <a className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}><LayoutDashboard size={16} /> Dashboard</a>
        <p>PRODUCTIVITY</p>{(!preferences || preferences.modules.calendar) && <a className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}><CalendarDays size={16} /> Calendar</a>}{(!preferences || preferences.modules.tasks) && <a className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}><CheckSquare size={16} /> Tasks</a>}{(!preferences || preferences.modules.ideas) && <a className={view === 'ideas' ? 'active' : ''} onClick={() => setView('ideas')}><Sparkles size={16} /> Ideas</a>}
        <p>FINANCE</p><a className={view === 'finance' ? 'active' : ''} onClick={() => setView('finance')}><WalletCards size={16} /> Wallet</a>
        <p>LIFE</p><a className={view === 'goals' ? 'active' : ''} onClick={() => setView('goals')}><Target size={16} /> Goals</a><a className={view === 'memories' ? 'active' : ''} onClick={() => setView('memories')}><CircleUserRound size={16} /> Memories</a>
        <p>MEDIA</p><a className={view === 'movies' ? 'active' : ''} onClick={() => setView('movies')}><CalendarDays size={16} /> Movies</a><a className={view === 'music' ? 'active' : ''} onClick={() => setView('music')}><Sparkles size={16} /> Music</a><a className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><Settings size={16} /> Settings</a>
      </nav>
      <button className="account" onClick={() => void signOut}><CircleUserRound size={18} /><span><b>{user.name}</b><small>Sign out</small></span></button>
    </aside>
    <main className="content">
      <header className="page-header"><div><div className="eyebrow">{`${displayDate.weekday}, ${displayDate.month} ${displayDate.day}, ${displayDate.year}`.toUpperCase()}</div><h1>{view === 'dashboard' ? 'Dashboard' : view[0].toUpperCase() + view.slice(1)}</h1><p>Your personal command center.</p></div><div className="header-actions"><button className="icon-button" onClick={() => void downloadExport()} title="Download data export"><Download size={18} /></button><button className="icon-button" title="Settings"><Settings size={18} /></button></div></header>
      <section className="date-strip"><div><span className="date-number">{displayDate.day}</span><span><b>{displayDate.weekday}</b><small>{displayDate.month} {displayDate.year}</small></span></div><span className="status-dot">All systems ready</span></section>
      {view === 'settings' && preferences && <section className="module-workspace panel settings-workspace"><div className="panel-header"><div><span className="panel-kicker"><Settings size={15} /> WORKSPACE</span><h2>Preferences</h2></div></div><div className="settings-grid"><label>Theme<select value={preferences.theme} onChange={event => void savePreferences({ ...preferences, theme: event.target.value as Preferences['theme'] })}><option value="dark">Dark</option><option value="light">Light</option></select></label><label>Accent color<input type="color" value={preferences.accent} onChange={event => void savePreferences({ ...preferences, accent: event.target.value })} /></label><label>Timezone<select value={preferences.timezone} onChange={event => void savePreferences({ ...preferences, timezone: event.target.value })}><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option><option>UTC</option></select></label><label>Week starts<select value={preferences.weekStart} onChange={event => void savePreferences({ ...preferences, weekStart: event.target.value as Preferences['weekStart'] })}><option value="sunday">Sunday</option><option value="monday">Monday</option></select></label></div><h3>Enabled modules</h3><div className="toggle-list">{(['calendar', 'tasks', 'ideas'] as const).map(module => <label key={module}><input type="checkbox" checked={preferences.modules[module]} onChange={event => void savePreferences({ ...preferences, modules: { ...preferences.modules, [module]: event.target.checked } })} /> {module[0].toUpperCase() + module.slice(1)}</label>)}</div><h3>Dashboard widgets</h3><div className="toggle-list">{(['tasks', 'calendar', 'ideas'] as const).map(widget => <label key={widget}><input type="checkbox" checked={preferences.widgets[widget]} onChange={event => void savePreferences({ ...preferences, widgets: { ...preferences.widgets, [widget]: event.target.checked } })} /> {widget[0].toUpperCase() + widget.slice(1)}</label>)}</div><h3>Dashboard order</h3><div className="toggle-list">{preferences.dashboardOrder.map((widget, index) => <div key={widget} className="order-row"><span>{index + 1}. {widget[0].toUpperCase() + widget.slice(1)}</span><span><button type="button" className="icon-button" onClick={() => moveWidget(widget, -1)} disabled={index === 0} title="Move up"><ArrowUp size={15} /></button><button type="button" className="icon-button" onClick={() => moveWidget(widget, 1)} disabled={index === preferences.dashboardOrder.length - 1} title="Move down"><ArrowDown size={15} /></button></span></div>)}</div><h3>Change password</h3><form className="module-form stacked" onSubmit={changePassword}><input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} placeholder="Current password" minLength={8} required /><input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="New password (8+ characters)" minLength={8} required /><button type="submit">Change password</button></form>{passwordStatus && <p className="restore-status">{passwordStatus}</p>}<h3>Backup and restore</h3><label className="restore-control">Choose a Personal CRM JSON export<input type="file" accept="application/json,.json" onChange={event => void restoreBackup(event)} /></label>{preferencesSaving && <p className="muted">Saving preferences...</p>}{restoreStatus && <p className="restore-status">{restoreStatus}</p>}</section>}
      {view === 'tasks' && <section className="module-workspace panel"><div className="panel-header"><div><span className="panel-kicker"><CheckSquare size={15} /> PRODUCTIVITY</span><h2>Task manager</h2></div><div className="panel-actions"><span className="count">{activeTaskCount}</span><button type="button" className="task-creator-toggle" onClick={openNewTaskForm}><Plus size={16} /> New task</button></div></div>{taskEditorOpen && <form className="module-form task-editor" onSubmit={createManagerTask}><input value={managerSummary} onChange={event => setManagerSummary(event.target.value)} placeholder="Task title" required autoFocus /><select value={managerListName} onChange={event => setManagerListName(event.target.value)}><option>Inbox</option><option>Personal</option><option>Work</option></select><select value={managerPriority} onChange={event => setManagerPriority(event.target.value as Task['priority'])}><option value="low">Low priority</option><option value="normal">Normal priority</option><option value="high">High priority</option></select><input type="date" value={managerDueDate} onChange={event => setManagerDueDate(event.target.value)} /><input value={managerTags} onChange={event => setManagerTags(event.target.value)} placeholder="Tags, comma separated" /><textarea value={managerNotes} onChange={event => setManagerNotes(event.target.value)} placeholder="Notes" /><button type="submit" disabled={saving}><Plus size={17} /> {editingTask ? 'Save task' : 'Add task'}</button><button type="button" className="text-action" onClick={() => { resetManagerTaskForm(); setTaskEditorOpen(false) }}>Cancel</button></form>}<div className="segmented" role="group" aria-label="Task filter"><button className={taskFilter === 'active' ? 'selected' : ''} onClick={() => setTaskFilter('active')}>Active</button><button className={taskFilter === 'completed' ? 'selected' : ''} onClick={() => setTaskFilter('completed')}>Completed</button><button className={taskFilter === 'all' ? 'selected' : ''} onClick={() => setTaskFilter('all')}>All</button></div>{visibleTasks.length === 0 ? <div className="empty compact"><CheckSquare size={28} /><p>No {taskFilter === 'all' ? '' : taskFilter} tasks</p></div> : <TaskTree tasks={visibleTasks} onToggle={id => void toggleTask(id)} onDelete={id => void deleteTask(id)} onAddSubtask={startSubtask} onEdit={startEditTask} onReorder={reorderTask} subtaskParentId={subtaskParentId} subtaskSummary={subtaskSummary} saving={saving} onSubtaskSummaryChange={setSubtaskSummary} onCreateSubtask={createSubtask} onCancelSubtask={() => setSubtaskParentId(null)} />}</section>}
      {view === 'calendar' && <section className="module-workspace panel"><div className="panel-header"><div><span className="panel-kicker"><CalendarDays size={15} /> PLANNING</span><h2>Calendar</h2></div></div><form className="module-form task-editor" onSubmit={createEvent}><input value={eventTitle} onChange={event => setEventTitle(event.target.value)} placeholder="Event title" required /><input type="date" value={eventDate} onChange={event => setEventDate(event.target.value)} required /><input value={eventCategory} onChange={event => setEventCategory(event.target.value)} placeholder="Category" required /><textarea value={eventNotes} onChange={event => setEventNotes(event.target.value)} placeholder="Event notes" /><button type="submit"><Plus size={17} /> {editingEvent ? 'Save event' : 'Add event'}</button>{editingEvent && <button type="button" className="text-action" onClick={() => { setEditingEvent(null); setEventTitle(''); setEventNotes(''); setEventCategory('General') }}>Cancel</button>}</form><div className="calendar-toolbar"><button className="icon-button" onClick={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))} title="Previous month"><ArrowLeft size={17} /></button><h3>{calendarMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h3><button className="icon-button" onClick={() => setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))} title="Next month"><ArrowRight size={17} /></button></div><div className="month-grid">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <b key={day} className="month-heading">{day}</b>)}{calendarDays(calendarMonth).map(day => { const date = isoDate(day); const dayEvents = events.filter(item => item.date === date); return <div className={`month-day ${day.getMonth() === calendarMonth.getMonth() ? '' : 'outside'}`} key={date}><span>{day.getDate()}</span>{dayEvents.slice(0, 2).map(item => <button key={item.id} className="calendar-event" onClick={() => startEditEvent(item)} title={`${item.category}: ${item.notes || item.title}`}>{item.title}</button>)}</div> })}</div><h3>Agenda</h3>{monthEvents.length === 0 ? <div className="empty compact"><CalendarDays size={28} /><p>No events this month</p></div> : <ul className="simple-list">{monthEvents.map(item => <li key={item.id}><span><b>{item.title}</b><small>{item.date} · {item.category}{item.notes ? ` · ${item.notes}` : ''}</small></span><span><button className="subtask" onClick={() => startEditEvent(item)} title="Edit event"><Pencil size={15} /></button><button className="delete" onClick={() => void deleteEvent(item.id)} title="Delete event"><Trash2 size={15} /></button></span></li>)}</ul>}</section>}
      {view === 'ideas' && <section className="module-workspace panel"><div className="panel-header"><div><span className="panel-kicker"><Sparkles size={15} /> CAPTURE</span><h2>Idea box</h2></div></div><form className="module-form stacked" onSubmit={createIdea}><input value={ideaTitle} onChange={event => setIdeaTitle(event.target.value)} placeholder="Idea title" /><textarea value={ideaBody} onChange={event => setIdeaBody(event.target.value)} placeholder="Capture the thought..." /><button type="submit"><Plus size={17} /> Save idea</button></form>{ideas.length === 0 ? <div className="empty compact"><Sparkles size={28} /><p>No ideas yet</p></div> : <ul className="simple-list">{ideas.map(item => <li key={item.id}><b>{item.title}</b><span>{item.body}</span></li>)}</ul>}</section>}
      {view === 'finance' && <section className="module-workspace panel"><div className="panel-header"><div><span className="panel-kicker"><WalletCards size={15} /> FINANCE</span><h2>Wallet</h2></div></div><form className="module-form" onSubmit={createAccount}><input value={accountName} onChange={event => setAccountName(event.target.value)} placeholder="Account name" /><input type="number" step="0.01" value={accountBalance} onChange={event => setAccountBalance(event.target.value)} placeholder="Opening balance" /><button type="submit"><Plus size={17} /> Add account</button></form>{accounts.length === 0 ? <div className="empty compact"><WalletCards size={28} /><p>No accounts yet</p></div> : <ul className="simple-list">{accounts.map(account => <li key={account.id}><b>{account.name}</b><span>{account.currency} {(account.balanceMinor / 100).toFixed(2)}</span></li>)}</ul>}<h3>Record transaction</h3><form className="module-form" onSubmit={createTransaction}><select value={transactionAccount} onChange={event => setTransactionAccount(event.target.value)}><option value="">Choose account</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select><input value={transactionDescription} onChange={event => setTransactionDescription(event.target.value)} placeholder="Description" /><input type="number" step="0.01" value={transactionAmount} onChange={event => setTransactionAmount(event.target.value)} placeholder="Amount (+ income, - expense)" /><button type="submit"><Plus size={17} /> Record</button></form>{transactions.length > 0 && <ul className="simple-list">{transactions.slice(0, 8).map(transaction => <li key={transaction.id}><b>{transaction.description}</b><span>{(transaction.amountMinor / 100).toFixed(2)} · {transaction.date}</span></li>)}</ul>}</section>}
      {view === 'goals' && <section className="module-workspace panel"><div className="panel-header"><div><span className="panel-kicker"><Target size={15} /> PROGRESS</span><h2>Goals</h2></div></div><form className="module-form" onSubmit={createGoal}><input value={goalTitle} onChange={event => setGoalTitle(event.target.value)} placeholder="Goal title" /><input type="number" step="0.01" value={goalTarget} onChange={event => setGoalTarget(event.target.value)} placeholder="Target amount (optional)" /><input type="date" value={goalDueDate} onChange={event => setGoalDueDate(event.target.value)} /><button type="submit"><Plus size={17} /> Add goal</button></form>{goals.length === 0 ? <div className="empty compact"><Target size={28} /><p>No goals yet</p></div> : <ul className="task-list">{goals.map(goal => <li key={goal.id}><button className={`check ${goal.completed ? 'done' : ''}`} onClick={() => void toggleGoal(goal.id)} title="Toggle goal"><Target size={17} /></button><span className={goal.completed ? 'completed' : ''}>{goal.title}{goal.dueDate ? ` · due ${goal.dueDate}` : ''}</span></li>)}</ul>}</section>}
      {view === 'movies' && <section className="module-workspace panel"><div className="panel-header"><div><span className="panel-kicker"><CalendarDays size={15} /> MEDIA</span><h2>Movie library</h2></div></div><form className="module-form" onSubmit={createMovie}><input value={movieTitle} onChange={event => setMovieTitle(event.target.value)} placeholder="Movie title" /><input type="number" value={movieYear} onChange={event => setMovieYear(event.target.value)} placeholder="Release year" /><button type="submit"><Plus size={17} /> Add movie</button></form>{movies.length === 0 ? <div className="empty compact"><CalendarDays size={28} /><p>No movies yet</p></div> : <ul className="simple-list">{movies.map(movie => <li key={movie.id}><b>{movie.title}</b><span>{movie.year ?? 'Year unknown'}</span></li>)}</ul>}</section>}
      {view === 'music' && <section className="module-workspace panel"><div className="panel-header"><div><span className="panel-kicker"><Sparkles size={15} /> MEDIA</span><h2>Music library</h2></div></div><form className="module-form" onSubmit={createMusic}><input value={musicTitle} onChange={event => setMusicTitle(event.target.value)} placeholder="Track title" /><input value={musicArtist} onChange={event => setMusicArtist(event.target.value)} placeholder="Artist" /><input value={musicAlbum} onChange={event => setMusicAlbum(event.target.value)} placeholder="Album" /><button type="submit"><Plus size={17} /> Add track</button></form>{music.length === 0 ? <div className="empty compact"><Sparkles size={28} /><p>No music yet</p></div> : <ul className="simple-list">{music.map(track => <li key={track.id}><b>{track.title}</b><span>{track.artist}{track.album ? ` · ${track.album}` : ''}</span></li>)}</ul>}</section>}
      {view === 'memories' && <section className="module-workspace panel"><div className="panel-header"><div><span className="panel-kicker"><CircleUserRound size={15} /> LIFE</span><h2>Memory vault</h2></div></div><form className="module-form stacked" onSubmit={createMemory}><input value={memoryTitle} onChange={event => setMemoryTitle(event.target.value)} placeholder="Memory title" /><input type="date" value={memoryDate} onChange={event => setMemoryDate(event.target.value)} /><textarea value={memoryBody} onChange={event => setMemoryBody(event.target.value)} placeholder="Write down the moment..." /><label className="restore-control">Attach a file<input type="file" onChange={event => setMemoryFile(event.target.files?.[0] ?? null)} /></label><button type="submit"><Plus size={17} /> Save memory</button></form>{memoryStatus && <p className="restore-status">{memoryStatus}</p>}{memories.length === 0 ? <div className="empty compact"><CircleUserRound size={28} /><p>No memories yet</p></div> : <ul className="simple-list">{memories.map(memory => <li key={memory.id}><b>{memory.title}</b><span>{memory.occurredOn ?? 'Undated'} · {memory.body}</span></li>)}</ul>}</section>}
      {view === 'dashboard' && <section className="dashboard-grid">
        {(!preferences || preferences.widgets.tasks) && <article className="panel tasks-panel" style={{ order: preferences?.dashboardOrder.indexOf('tasks') ?? 0 }}><div className="panel-header"><div><span className="panel-kicker"><CheckSquare size={15} /> PRODUCTIVITY</span><h2>To-Do List</h2></div><span className="count">{tasks.length}</span></div>
          <form className="quick-add" onSubmit={createTask}><input value={summary} onChange={event => setSummary(event.target.value)} placeholder="What needs doing?" /><button disabled={saving} title="Create task"><Plus size={18} /></button></form>
          {loading ? <p className="muted">Loading tasks...</p> : tasks.length === 0 ? <div className="empty"><CheckSquare size={30} /><p>No tasks yet</p><small>Add your first task above.</small></div> : <TaskTree tasks={tasks} onToggle={id => void toggleTask(id)} onDelete={id => void deleteTask(id)} onAddSubtask={startSubtask} onEdit={startEditTask} onReorder={reorderTask} subtaskParentId={subtaskParentId} subtaskSummary={subtaskSummary} saving={saving} onSubtaskSummaryChange={setSubtaskSummary} onCreateSubtask={createSubtask} onCancelSubtask={() => setSubtaskParentId(null)} />}
          <button className="text-action" onClick={() => setView('tasks')}>Open task manager <ChevronRight size={15} /></button>
        </article>}
        {(!preferences || preferences.widgets.calendar) && <article className="panel calendar-panel" style={{ order: preferences?.dashboardOrder.indexOf('calendar') ?? 1 }}><div className="panel-header"><div><span className="panel-kicker"><CalendarDays size={15} /> PLANNING</span><h2>Calendar</h2></div><button className="icon-button" onClick={() => setView('calendar')} title="Open calendar"><ChevronRight size={17} /></button></div>{events.length ? <ul className="dashboard-agenda">{events.slice(0, 3).map(item => <li key={item.id}><b>{item.title}</b><span>{item.date} · {item.category}</span></li>)}</ul> : <div className="calendar-empty"><CalendarDays size={38} /><p>Your schedule is clear</p><small>Create an event when something needs a place on the calendar.</small></div>}</article>}
        {(!preferences || preferences.widgets.ideas) && <article className="panel notes-panel" style={{ order: preferences?.dashboardOrder.indexOf('ideas') ?? 2 }}><div className="panel-header"><div><span className="panel-kicker"><Sparkles size={15} /> CAPTURE</span><h2>Ideas</h2></div><button className="icon-button" onClick={() => setView('ideas')} title="Open ideas"><Plus size={17} /></button></div><div className="empty compact"><Sparkles size={28} /><p>{ideas.length ? `${ideas.length} idea${ideas.length === 1 ? '' : 's'} captured` : 'Nothing captured yet'}</p><small>{ideas.length ? 'Open the idea box to review your notes.' : 'Keep a thought before it gets away.'}</small></div></article>}
      </section>}
    </main>
  </div>
}

export default App
