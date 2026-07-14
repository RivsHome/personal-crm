import { useEffect, useState } from 'react'
import { CalendarDays, CheckSquare, ChevronRight, CircleUserRound, Download, LayoutDashboard, Plus, Settings, Sparkles, Trash2 } from 'lucide-react'
import './module.css'

type Task = { id: string; summary: string; notes: string; completed: boolean; createdAt: string }
type EventItem = { id: string; title: string; date: string; notes: string }
type Idea = { id: string; title: string; body: string; createdAt: string }
type User = { email: string; name: string }
type Preferences = { theme: 'dark' | 'light'; accent: string; timezone: string; weekStart: 'sunday' | 'monday'; modules: { calendar: boolean; tasks: boolean; ideas: boolean }; widgets: { tasks: boolean; calendar: boolean; ideas: boolean } }
const API = import.meta.env.VITE_API_URL || ''
const apiFetch = (path: string, init?: RequestInit) => fetch(`${API}${path}`, { ...init, credentials: 'include' })

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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<'dashboard' | 'calendar' | 'tasks' | 'ideas' | 'settings'>('dashboard')
  const [events, setEvents] = useState<EventItem[]>([])
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [eventTitle, setEventTitle] = useState('')
  const [eventDate, setEventDate] = useState('2026-07-14')
  const [ideaTitle, setIdeaTitle] = useState('')
  const [ideaBody, setIdeaBody] = useState('')
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [preferencesSaving, setPreferencesSaving] = useState(false)
  const [restoreStatus, setRestoreStatus] = useState('')

  useEffect(() => {
    void apiFetch('/api/auth/me').then(response => response.json()).then(data => setUser(data.user)).finally(() => setAuthChecked(true))
  }, [])

  async function loadTasks() {
    setLoading(true)
    const response = await apiFetch('/api/tasks')
    setTasks(await response.json())
    setLoading(false)
  }

  useEffect(() => {
    void loadTasks()
    if (!user) return
    void apiFetch('/api/preferences').then(response => response.json()).then(setPreferences)
    void apiFetch('/api/events').then(response => response.json()).then(setEvents)
    void apiFetch('/api/ideas').then(response => response.json()).then(setIdeas)
  }, [user])

  async function savePreferences(next: Preferences) {
    setPreferences(next); setPreferencesSaving(true)
    const response = await apiFetch('/api/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) })
    if (response.ok) setPreferences(await response.json())
    setPreferencesSaving(false)
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

  async function submitAuth(event: React.FormEvent) {
    event.preventDefault()
    setAuthSaving(true); setAuthError('')
    const response = await apiFetch(`/api/auth/${authMode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: authEmail, name: authName, password: authPassword }) })
    const data = await response.json()
    if (!response.ok) setAuthError(data.error ?? 'Unable to continue.')
    else setUser(data.user ?? data)
    setAuthSaving(false)
  }

  async function signOut() {
    await apiFetch('/api/auth/logout', { method: 'POST' }); setUser(null)
  }

  async function downloadExport() {
    const response = await apiFetch('/api/export')
    if (!response.ok) return
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a')
    link.href = url; link.download = `personal-crm-export-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url)
  }

  if (!authChecked) return <div className="auth-screen"><div className="auth-card"><Sparkles size={24} /><p>Loading your workspace...</p></div></div>
  if (!user) return <div className="auth-screen"><form className="auth-card" onSubmit={submitAuth}><div className="brand"><Sparkles size={20} /><strong>Personal CRM</strong></div><h1>{authMode === 'login' ? 'Welcome back' : 'Create your workspace'}</h1><p className="muted">Keep your personal life organized in one calm place.</p>{authMode === 'register' && <input value={authName} onChange={event => setAuthName(event.target.value)} placeholder="Your name" required />}{<input type="email" value={authEmail} onChange={event => setAuthEmail(event.target.value)} placeholder="Email address" required />}<input type="password" value={authPassword} onChange={event => setAuthPassword(event.target.value)} placeholder="Password (8+ characters)" minLength={8} required />{authError && <p className="auth-error">{authError}</p>}<button className="auth-submit" disabled={authSaving}>{authSaving ? 'Working...' : authMode === 'login' ? 'Sign in' : 'Create workspace'}</button><button type="button" className="auth-switch" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }}>{authMode === 'login' ? 'Need a workspace? Create one' : 'Already have a workspace? Sign in'}</button></form></div>

  async function createEvent(event: React.FormEvent) {
    event.preventDefault()
    if (!eventTitle.trim()) return
    const response = await apiFetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: eventTitle, date: eventDate }) })
    if (response.ok) { const created = await response.json() as EventItem; setEvents(current => [...current, created]); setEventTitle('') }
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

  async function toggleTask(id: string) {
    await apiFetch(`/api/tasks/${id}/toggle`, { method: 'PATCH' })
    await loadTasks()
  }

  async function deleteTask(id: string) {
    await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' })
    await loadTasks()
  }

  return <div className="app-shell" data-theme={preferences?.theme ?? 'dark'} style={{ '--accent': preferences?.accent ?? '#c9f253' } as React.CSSProperties}>
    <aside className="sidebar">
      <div className="brand"><Sparkles size={18} /> <strong>Personal CRM</strong></div>
      <label className="search"><span>⌕</span><input placeholder="Search modules..." /></label>
      <nav>
        <a className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}><LayoutDashboard size={16} /> Dashboard</a>
        <p>PRODUCTIVITY</p>{(!preferences || preferences.modules.calendar) && <a className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}><CalendarDays size={16} /> Calendar</a>}{(!preferences || preferences.modules.tasks) && <a className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}><CheckSquare size={16} /> Tasks</a>}{(!preferences || preferences.modules.ideas) && <a className={view === 'ideas' ? 'active' : ''} onClick={() => setView('ideas')}><Sparkles size={16} /> Ideas</a>}
        <p>LIFE</p><a><CircleUserRound size={16} /> Goals</a><a className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><Settings size={16} /> Settings</a>
      </nav>
      <button className="account" onClick={() => void signOut}><CircleUserRound size={18} /><span><b>{user.name}</b><small>Sign out</small></span></button>
    </aside>
    <main className="content">
      <header className="page-header"><div><div className="eyebrow">TUESDAY, JULY 14, 2026</div><h1>{view === 'dashboard' ? 'Dashboard' : view[0].toUpperCase() + view.slice(1)}</h1><p>Your personal command center.</p></div><div className="header-actions"><button className="icon-button" onClick={() => void downloadExport()} title="Download data export"><Download size={18} /></button><button className="icon-button" title="Settings"><Settings size={18} /></button></div></header>
      <section className="date-strip"><div><span className="date-number">14</span><span><b>Tuesday</b><small>July 2026</small></span></div><span className="status-dot">All systems ready</span></section>
      {view === 'settings' && preferences && <section className="module-workspace panel settings-workspace"><div className="panel-header"><div><span className="panel-kicker"><Settings size={15} /> WORKSPACE</span><h2>Preferences</h2></div></div><div className="settings-grid"><label>Theme<select value={preferences.theme} onChange={event => void savePreferences({ ...preferences, theme: event.target.value as Preferences['theme'] })}><option value="dark">Dark</option><option value="light">Light</option></select></label><label>Accent color<input type="color" value={preferences.accent} onChange={event => void savePreferences({ ...preferences, accent: event.target.value })} /></label><label>Timezone<select value={preferences.timezone} onChange={event => void savePreferences({ ...preferences, timezone: event.target.value })}><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Los_Angeles</option><option>UTC</option></select></label><label>Week starts<select value={preferences.weekStart} onChange={event => void savePreferences({ ...preferences, weekStart: event.target.value as Preferences['weekStart'] })}><option value="sunday">Sunday</option><option value="monday">Monday</option></select></label></div><h3>Enabled modules</h3><div className="toggle-list">{(['calendar', 'tasks', 'ideas'] as const).map(module => <label key={module}><input type="checkbox" checked={preferences.modules[module]} onChange={event => void savePreferences({ ...preferences, modules: { ...preferences.modules, [module]: event.target.checked } })} /> {module[0].toUpperCase() + module.slice(1)}</label>)}</div><h3>Dashboard widgets</h3><div className="toggle-list">{(['tasks', 'calendar', 'ideas'] as const).map(widget => <label key={widget}><input type="checkbox" checked={preferences.widgets[widget]} onChange={event => void savePreferences({ ...preferences, widgets: { ...preferences.widgets, [widget]: event.target.checked } })} /> {widget[0].toUpperCase() + widget.slice(1)}</label>)}</div><h3>Backup and restore</h3><label className="restore-control">Choose a Personal CRM JSON export<input type="file" accept="application/json,.json" onChange={event => void restoreBackup(event)} /></label>{preferencesSaving && <p className="muted">Saving preferences...</p>}{restoreStatus && <p className="restore-status">{restoreStatus}</p>}</section>}
      {view === 'calendar' && <section className="module-workspace panel"><div className="panel-header"><div><span className="panel-kicker"><CalendarDays size={15} /> UPCOMING</span><h2>Calendar events</h2></div></div><form className="module-form" onSubmit={createEvent}><input value={eventTitle} onChange={event => setEventTitle(event.target.value)} placeholder="Event title" /><input type="date" value={eventDate} onChange={event => setEventDate(event.target.value)} /><button type="submit"><Plus size={17} /> Add event</button></form>{events.length === 0 ? <div className="empty compact"><CalendarDays size={28} /><p>No events yet</p></div> : <ul className="simple-list">{events.map(item => <li key={item.id}><b>{item.title}</b><span>{item.date}</span></li>)}</ul>}</section>}
      {view === 'ideas' && <section className="module-workspace panel"><div className="panel-header"><div><span className="panel-kicker"><Sparkles size={15} /> CAPTURE</span><h2>Idea box</h2></div></div><form className="module-form stacked" onSubmit={createIdea}><input value={ideaTitle} onChange={event => setIdeaTitle(event.target.value)} placeholder="Idea title" /><textarea value={ideaBody} onChange={event => setIdeaBody(event.target.value)} placeholder="Capture the thought..." /><button type="submit"><Plus size={17} /> Save idea</button></form>{ideas.length === 0 ? <div className="empty compact"><Sparkles size={28} /><p>No ideas yet</p></div> : <ul className="simple-list">{ideas.map(item => <li key={item.id}><b>{item.title}</b><span>{item.body}</span></li>)}</ul>}</section>}
      {view !== 'settings' && <section className="dashboard-grid">
        {(!preferences || preferences.widgets.tasks) && <article className="panel tasks-panel"><div className="panel-header"><div><span className="panel-kicker"><CheckSquare size={15} /> PRODUCTIVITY</span><h2>To-Do List</h2></div><span className="count">{tasks.length}</span></div>
          <form className="quick-add" onSubmit={createTask}><input value={summary} onChange={event => setSummary(event.target.value)} placeholder="What needs doing?" /><button disabled={saving} title="Create task"><Plus size={18} /></button></form>
          {loading ? <p className="muted">Loading tasks...</p> : tasks.length === 0 ? <div className="empty"><CheckSquare size={30} /><p>No tasks yet</p><small>Add your first task above.</small></div> : <ul className="task-list">{tasks.map(task => <li key={task.id}><button className={`check ${task.completed ? 'done' : ''}`} onClick={() => void toggleTask(task.id)} title="Toggle task"><CheckSquare size={17} /></button><span className={task.completed ? 'completed' : ''}>{task.summary}</span><button className="delete" onClick={() => void deleteTask(task.id)} title="Delete task"><Trash2 size={15} /></button></li>)}</ul>}
          <button className="text-action" onClick={() => setView('tasks')}>Open task manager <ChevronRight size={15} /></button>
        </article>}
        {(!preferences || preferences.widgets.calendar) && <article className="panel calendar-panel"><div className="panel-header"><div><span className="panel-kicker"><CalendarDays size={15} /> PLANNING</span><h2>Calendar</h2></div><button className="icon-button" onClick={() => setView('calendar')} title="Open calendar"><ChevronRight size={17} /></button></div><div className="calendar-empty"><CalendarDays size={38} /><p>{events.length ? `${events.length} event${events.length === 1 ? '' : 's'} scheduled` : 'Your schedule is clear'}</p><small>{events.length ? 'Open the calendar to review your upcoming events.' : 'Create an event when something needs a place on the calendar.'}</small></div></article>}
        {(!preferences || preferences.widgets.ideas) && <article className="panel notes-panel"><div className="panel-header"><div><span className="panel-kicker"><Sparkles size={15} /> CAPTURE</span><h2>Ideas</h2></div><button className="icon-button" onClick={() => setView('ideas')} title="Open ideas"><Plus size={17} /></button></div><div className="empty compact"><Sparkles size={28} /><p>{ideas.length ? `${ideas.length} idea${ideas.length === 1 ? '' : 's'} captured` : 'Nothing captured yet'}</p><small>{ideas.length ? 'Open the idea box to review your notes.' : 'Keep a thought before it gets away.'}</small></div></article>}
      </section>}
    </main>
  </div>
}

export default App
