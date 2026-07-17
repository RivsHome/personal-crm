import { useEffect, useMemo, useState } from 'react'
import { CalendarRange, Check, Clock3, Dumbbell, Pencil, Plus, Save, Sparkles, Trash2, TrendingUp, X } from 'lucide-react'

export type GymExercise = { id: string; name: string; sets: string; reps: string; optional: boolean }
export type WorkoutKey = 'A' | 'B' | 'C' | 'D' | 'E'
export type GymRoutineInput = {
  name: string
  description: string
  calendarEnabled: boolean
  trainingDays: string[]
  startDate: string
  workoutOrder: WorkoutKey[]
  workouts: Record<WorkoutKey, GymExercise[]>
  cardioMinutes: Record<WorkoutKey, number>
  scheduleMode: 'rotation' | 'manual'
  dayWorkouts: Record<string, WorkoutKey>
  progression: { method: string; restBigLifts: string; restAccessories: string; duration: string; rules: string[] }
}
export type GymRoutine = GymRoutineInput & { id: string; createdAt: string; updatedAt: string }

const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const workoutKeys: WorkoutKey[] = ['A', 'B', 'C', 'D', 'E']
const dayLabel = (day: string) => day.slice(0, 3).replace(/^./, letter => letter.toUpperCase())
const exercise = (name = 'New exercise'): GymExercise => ({ id: crypto.randomUUID(), name, sets: '3', reps: '8–12', optional: false })

function blankRoutine(): GymRoutineInput {
  return {
    name: 'New routine',
    description: 'Describe the focus of this training plan.',
    calendarEnabled: true,
    trainingDays: ['monday', 'wednesday', 'friday'],
    startDate: new Date().toISOString().slice(0, 10),
    workoutOrder: ['A', 'B'],
    workouts: { A: [], B: [], C: [], D: [], E: [] },
    cardioMinutes: { A: 0, B: 0, C: 0, D: 0, E: 0 },
    scheduleMode: 'rotation',
    dayWorkouts: { monday: 'A', wednesday: 'B', friday: 'A' },
    progression: {
      method: 'Describe how weight or reps should progress over time.',
      restBigLifts: '2–3 minutes',
      restAccessories: '60–90 seconds',
      duration: '60–75 minutes',
      rules: ['Focus on excellent form.', 'Progress gradually.']
    }
  }
}

function cycleWeekIndex(startDate: string) {
  const start = new Date(`${startDate}T12:00:00`)
  if (Number.isNaN(start.getTime())) return 0
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const elapsed = Math.max(0, Date.now() - start.getTime())
  return Math.floor(elapsed / (7 * 24 * 60 * 60 * 1000))
}

function weekPattern(routine: GymRoutine, weekIndex: number) {
  return routine.trainingDays.map((day, dayIndex) => routine.scheduleMode === 'manual'
    ? routine.dayWorkouts[day] ?? routine.workoutOrder[dayIndex % routine.workoutOrder.length]
    : routine.workoutOrder[(weekIndex * routine.trainingDays.length + dayIndex) % routine.workoutOrder.length])
}

export default function GymModule({ request, onRoutinesChange }: { request: (path: string, init?: RequestInit) => Promise<Response>; onRoutinesChange?: (routines: GymRoutine[]) => void }) {
  const [routines, setRoutines] = useState<GymRoutine[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<GymRoutineInput | null>(null)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [deleteArmed, setDeleteArmed] = useState(false)

  useEffect(() => {
    void request('/api/gym/routines').then(async response => {
      if (!response.ok) throw new Error('Unable to load routines')
      const loaded = await response.json() as GymRoutine[]
      setRoutines(loaded)
      onRoutinesChange?.(loaded)
      setSelectedId(loaded[0]?.id ?? '')
    }).catch(() => setMessage('Could not load your gym routines.')).finally(() => setLoading(false))
  }, [request, onRoutinesChange])

  const selected = routines.find(routine => routine.id === selectedId) ?? routines[0]
  const currentWeekIndex = useMemo(() => selected ? cycleWeekIndex(selected.startDate) : 0, [selected])

  function beginEdit() {
    if (!selected) return
    setDraft(structuredClone(selected))
    setEditingId(selected.id)
    setMessage('')
  }

  function beginNew() {
    setDraft(blankRoutine())
    setEditingId('new')
    setDeleteArmed(false)
    setMessage('')
  }

  function cancelEdit() {
    setDraft(null)
    setEditingId(null)
    setMessage('')
  }

  async function saveRoutine(event: React.FormEvent) {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    setMessage('')
    const isNew = editingId === 'new'
    const response = await request(isNew ? '/api/gym/routines' : `/api/gym/routines/${editingId}`, {
      method: isNew ? 'POST' : 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft)
    })
    if (response.ok) {
      const saved = await response.json() as GymRoutine
      const nextRoutines = isNew ? [saved, ...routines] : routines.map(routine => routine.id === saved.id ? saved : routine)
      setRoutines(nextRoutines)
      onRoutinesChange?.(nextRoutines)
      setSelectedId(saved.id)
      setDraft(null)
      setEditingId(null)
      setMessage(isNew ? 'Routine created.' : 'Routine updated.')
    } else setMessage('Check the routine fields and try again.')
    setSaving(false)
  }

  async function removeRoutine() {
    if (!selected) return
    if (!deleteArmed) { setDeleteArmed(true); return }
    const response = await request(`/api/gym/routines/${selected.id}`, { method: 'DELETE' })
    if (response.ok) {
      const remaining = routines.filter(routine => routine.id !== selected.id)
      setRoutines(remaining)
      onRoutinesChange?.(remaining)
      setSelectedId(remaining[0]?.id ?? '')
      setDeleteArmed(false)
      setMessage('Routine deleted.')
    } else setMessage('Unable to delete this routine.')
  }

  function toggleDay(day: string) {
    if (!draft) return
    const active = draft.trainingDays.includes(day)
    if (active && draft.trainingDays.length === 1) return
    const trainingDays = active ? draft.trainingDays.filter(item => item !== day) : days.filter(item => item === day || draft.trainingDays.includes(item))
    const dayWorkouts = active ? Object.fromEntries(Object.entries(draft.dayWorkouts).filter(([key]) => key !== day)) : { ...draft.dayWorkouts, [day]: draft.workoutOrder[trainingDays.indexOf(day) % draft.workoutOrder.length] }
    setDraft({ ...draft, trainingDays, dayWorkouts })
  }

  function updateExercise(workout: WorkoutKey, id: string, patch: Partial<GymExercise>) {
    if (!draft) return
    setDraft({ ...draft, workouts: { ...draft.workouts, [workout]: draft.workouts[workout].map(item => item.id === id ? { ...item, ...patch } : item) } })
  }

  function removeExercise(workout: WorkoutKey, id: string) {
    if (!draft) return
    setDraft({ ...draft, workouts: { ...draft.workouts, [workout]: draft.workouts[workout].filter(item => item.id !== id) } })
  }

  function addWorkout() {
    if (!draft) return
    const workout = workoutKeys.find(key => !draft.workoutOrder.includes(key))
    if (!workout) return
    setDraft({ ...draft, workoutOrder: [...draft.workoutOrder, workout], workouts: { ...draft.workouts, [workout]: [] } })
  }

  function removeWorkout(workout: WorkoutKey) {
    if (!draft || workout === 'A' || workout === 'B') return
    const dayWorkouts = Object.fromEntries(Object.entries(draft.dayWorkouts).map(([day, assigned]) => [day, assigned === workout ? 'A' : assigned])) as Record<string, WorkoutKey>
    setDraft({ ...draft, workoutOrder: draft.workoutOrder.filter(key => key !== workout), workouts: { ...draft.workouts, [workout]: [] }, cardioMinutes: { ...draft.cardioMinutes, [workout]: 0 }, dayWorkouts })
  }

  if (loading) return <section className="gym-loading panel"><Dumbbell size={28} /><p>Loading your training plan...</p></section>

  return <section className="gym-workspace">
    <div className="gym-hero">
      <div><span className="panel-kicker"><Dumbbell size={15} /> TRAINING</span><h2>Gym routines</h2><p>Plan the work. Track the rhythm. Progress with intention.</p></div>
      <button type="button" className="task-creator-toggle" onClick={beginNew}><Plus size={17} /> New routine</button>
    </div>

    <div className="routine-tabs" role="tablist" aria-label="Gym routines">
      {routines.map(routine => <button type="button" role="tab" aria-selected={selected?.id === routine.id} className={selected?.id === routine.id ? 'selected' : ''} onClick={() => { setSelectedId(routine.id); cancelEdit(); setDeleteArmed(false) }} key={routine.id}><Dumbbell size={15} /> {routine.name}</button>)}
    </div>

    {message && <div className="gym-message" role="status"><Check size={15} /> {message}</div>}

    {draft ? <form className="gym-editor panel" onSubmit={saveRoutine}>
      <div className="gym-editor-header"><div><span className="panel-kicker"><Pencil size={15} /> {editingId === 'new' ? 'NEW ROUTINE' : 'EDIT ROUTINE'}</span><h2>{editingId === 'new' ? 'Build your routine' : `Editing ${draft.name}`}</h2></div><button type="button" className="icon-button" onClick={cancelEdit} aria-label="Close editor"><X size={18} /></button></div>
      <div className="gym-basics"><label>Routine name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required /></label><label>Cycle start date<input type="date" value={draft.startDate} onChange={event => setDraft({ ...draft, startDate: event.target.value })} required /></label><label className="wide">Description<textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label><label className="calendar-sync-toggle wide"><span><CalendarRange size={17} /><span><b>Show on main calendar</b><small>Add subtle recurring workout markers to your monthly calendar.</small></span></span><input type="checkbox" checked={draft.calendarEnabled} onChange={event => setDraft({ ...draft, calendarEnabled: event.target.checked })} /></label></div>
      <div className="gym-edit-section"><div><span className="panel-kicker"><CalendarRange size={15} /> SCHEDULE</span><h3>Training days</h3></div><div className="day-picker">{days.map(day => <button type="button" key={day} className={draft.trainingDays.includes(day) ? 'selected' : ''} onClick={() => toggleDay(day)}>{dayLabel(day)}</button>)}</div>
        <div className="schedule-mode-picker"><button type="button" className={draft.scheduleMode === 'rotation' ? 'selected' : ''} onClick={() => setDraft({ ...draft, scheduleMode: 'rotation' })}><b>Continuous rotation</b><small>Move through A–E across every training day.</small></button><button type="button" className={draft.scheduleMode === 'manual' ? 'selected' : ''} onClick={() => setDraft({ ...draft, scheduleMode: 'manual' })}><b>Set each day manually</b><small>Choose the exact workout for every weekday.</small></button></div>
        {draft.scheduleMode === 'manual' && <div className="manual-day-grid">{draft.trainingDays.map((day, index) => <label key={day}><span>{day.replace(/^./, letter => letter.toUpperCase())}</span><select value={draft.dayWorkouts[day] ?? draft.workoutOrder[index % draft.workoutOrder.length]} onChange={event => setDraft({ ...draft, dayWorkouts: { ...draft.dayWorkouts, [day]: event.target.value as WorkoutKey } })}>{draft.workoutOrder.map(workout => <option value={workout} key={workout}>Workout {workout}</option>)}</select></label>)}</div>}
      </div>
      <div className="workout-editor-grid">{draft.workoutOrder.map(workout => <section className={`workout-editor workout-editor-${workout.toLowerCase()}`} key={workout}>
        <div className="workout-title"><span>Workout {workout}</span><b>{draft.workouts[workout].length} exercises</b>{workout !== 'A' && workout !== 'B' && <button type="button" className="icon-button" onClick={() => removeWorkout(workout)} aria-label={`Remove Workout ${workout}`}><Trash2 size={15} /></button>}</div>
        <label className="cardio-field"><span><Clock3 size={15} /> Cardio time</span><span><input type="number" min="0" max="600" step="5" value={draft.cardioMinutes[workout]} onChange={event => setDraft({ ...draft, cardioMinutes: { ...draft.cardioMinutes, [workout]: Number(event.target.value) } })} aria-label={`Workout ${workout} cardio minutes`} /> minutes</span></label>
        {draft.workouts[workout].length === 0 && <div className="empty-exercise-list"><Dumbbell size={17} /><span><b>No strength exercises</b><small>Leave it empty for a cardio-only day, or add an exercise below.</small></span></div>}
        {draft.workouts[workout].map(item => <div className="exercise-editor-row" key={item.id}><input className="exercise-name" value={item.name} onChange={event => updateExercise(workout, item.id, { name: event.target.value })} aria-label={`Workout ${workout} exercise name`} required /><label>Sets<input value={item.sets} onChange={event => updateExercise(workout, item.id, { sets: event.target.value })} required /></label><label>Reps<input value={item.reps} onChange={event => updateExercise(workout, item.id, { reps: event.target.value })} required /></label><label className="optional-check"><input type="checkbox" checked={item.optional} onChange={event => updateExercise(workout, item.id, { optional: event.target.checked })} /> Optional</label><button type="button" className="icon-button" onClick={() => removeExercise(workout, item.id)} aria-label={`Remove ${item.name}`}><Trash2 size={15} /></button></div>)}
        <button type="button" className="add-exercise" onClick={() => setDraft({ ...draft, workouts: { ...draft.workouts, [workout]: [...draft.workouts[workout], exercise()] } })}><Plus size={15} /> Add exercise</button>
      </section>)}</div>
      {draft.workoutOrder.length < workoutKeys.length && <button type="button" className="add-workout" onClick={addWorkout}><Plus size={16} /> Add Workout {workoutKeys.find(key => !draft.workoutOrder.includes(key))}</button>}
      <div className="gym-edit-section progression-editor"><div><span className="panel-kicker"><TrendingUp size={15} /> PROGRESSION</span><h3>Progression and recovery</h3></div><label>Progression method<textarea value={draft.progression.method} onChange={event => setDraft({ ...draft, progression: { ...draft.progression, method: event.target.value } })} /></label><div className="progression-fields"><label>Big lift rest<input value={draft.progression.restBigLifts} onChange={event => setDraft({ ...draft, progression: { ...draft.progression, restBigLifts: event.target.value } })} /></label><label>Accessory rest<input value={draft.progression.restAccessories} onChange={event => setDraft({ ...draft, progression: { ...draft.progression, restAccessories: event.target.value } })} /></label><label>Workout duration<input value={draft.progression.duration} onChange={event => setDraft({ ...draft, progression: { ...draft.progression, duration: event.target.value } })} /></label></div><label>Year-round rules<textarea value={draft.progression.rules.join('\n')} onChange={event => setDraft({ ...draft, progression: { ...draft.progression, rules: event.target.value.split('\n').map(rule => rule.trim()).filter(Boolean) } })} placeholder="One rule per line" /></label></div>
      <div className="gym-editor-actions"><button type="button" className="text-action" onClick={cancelEdit}>Cancel</button><button type="submit" className="task-creator-toggle" disabled={saving}><Save size={16} /> {saving ? 'Saving...' : 'Save routine'}</button></div>
    </form> : selected ? <>
      <article className="gym-overview panel">
        <div className="gym-overview-copy"><span className="panel-kicker"><Sparkles size={15} /> ACTIVE ROUTINE</span><h2>{selected.name}</h2><p>{selected.description}</p><div className="gym-overview-actions"><button type="button" className="task-creator-toggle" onClick={beginEdit}><Pencil size={16} /> Edit routine</button><button type="button" className={`gym-delete ${deleteArmed ? 'armed' : ''}`} onClick={() => void removeRoutine()} onBlur={() => setDeleteArmed(false)}><Trash2 size={15} /> {deleteArmed ? 'Confirm delete' : 'Delete'}</button></div></div>
        <div className="cycle-card"><span>Current cycle</span><b>Week {currentWeekIndex + 1}</b><small>{weekPattern(selected, currentWeekIndex).join(' / ')}</small></div>
      </article>

      <section className="schedule-card panel"><div className="section-heading"><div><span className="panel-kicker"><CalendarRange size={15} /> WEEKLY RHYTHM</span><h2>{selected.scheduleMode === 'manual' ? 'Your manual weekly plan' : 'Continuous workout rotation'}</h2></div><span className="schedule-days">{selected.trainingDays.map(dayLabel).join(' · ')}</span></div><div className="week-patterns">{[currentWeekIndex, currentWeekIndex + 1].map(weekIndex => <div className={weekIndex === currentWeekIndex ? 'week-pattern active' : 'week-pattern'} key={weekIndex}><span>Week {weekIndex + 1}{weekIndex === currentWeekIndex && <small>Current</small>}</span><div>{selected.trainingDays.map((day, dayIndex) => { const workout = weekPattern(selected, weekIndex)[dayIndex]; return <span className={`workout-chip workout-${workout.toLowerCase()}`} key={day}><small>{dayLabel(day)}</small><b>{workout}</b></span> })}</div></div>)}</div></section>

      <div className="gym-workout-grid">{selected.workoutOrder.map(workout => <article className={`workout-card workout-card-${workout.toLowerCase()}`} key={workout}><div className="workout-card-header"><span>Workout</span><b>{workout}</b><small>{selected.workouts[workout].length} movements{selected.cardioMinutes[workout] > 0 && <> · {selected.cardioMinutes[workout]} min cardio</>}</small></div>{selected.workouts[workout].length > 0 ? <ol>{selected.workouts[workout].map(item => <li key={item.id}><span><b>{item.name}</b>{item.optional && <small>Optional</small>}</span><span><b>{item.sets}</b> sets</span><span><b>{item.reps}</b> reps</span></li>)}</ol> : <div className="cardio-only-card"><Clock3 size={18} /><span><b>Cardio-only workout</b><small>No strength exercises planned.</small></span></div>}{selected.cardioMinutes[workout] > 0 && <div className="cardio-summary"><Clock3 size={16} /><span><b>{selected.cardioMinutes[workout]} minutes</b> cardio</span></div>}</article>)}</div>

      <section className="progression-card panel"><div className="section-heading"><div><span className="panel-kicker"><TrendingUp size={15} /> HOW TO PROGRESS</span><h2>Earn the next increase</h2></div></div><p className="progression-copy">{selected.progression.method}</p><div className="recovery-stats"><div><TrendingUp size={18} /><span><small>Big lifts</small><b>{selected.progression.restBigLifts}</b></span></div><div><Clock3 size={18} /><span><small>Accessories</small><b>{selected.progression.restAccessories}</b></span></div><div><Dumbbell size={18} /><span><small>Session target</small><b>{selected.progression.duration}</b></span></div></div><div className="rules-list"><h3>Year-round rules</h3>{selected.progression.rules.map((rule, index) => <div key={`${rule}-${index}`}><Check size={15} /><span>{rule}</span></div>)}</div></section>
    </> : <div className="gym-empty panel"><Dumbbell size={30} /><h2>No routines yet</h2><p>Create a routine to start planning your training week.</p><button type="button" className="task-creator-toggle" onClick={beginNew}><Plus size={16} /> Create routine</button></div>}
  </section>
}
