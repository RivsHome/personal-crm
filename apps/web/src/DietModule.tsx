import { useEffect, useMemo, useState } from 'react'
import { Apple, Check, ChefHat, CookingPot, Dumbbell, Pencil, Repeat2, Save, ShoppingBasket, Sparkles, Utensils, X } from 'lucide-react'

export type DietPlanInput = {
  name: string
  portionGuide: Array<{ label: string; amount: string }>
  guidance: string[]
  weeks: Array<{ week: number; breakfast: string; lunch: string; dinner: string; snack: string }>
  groceries: Array<{ category: string; items: string[] }>
  shoppingAmounts: Array<{ item: string; amount: string }>
  prepSteps: string[]
  repeatRules: string[]
}
export type DietPlan = DietPlanInput & { id: string; updatedAt: string }

const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean)

export default function DietModule({ request }: { request: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [plan, setPlan] = useState<DietPlan | null>(null)
  const [draft, setDraft] = useState<DietPlanInput | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const currentWeek = useMemo(() => Math.min(4, Math.ceil(new Date().getDate() / 7)), [])

  useEffect(() => {
    void request('/api/diet/plan').then(async response => {
      if (!response.ok) throw new Error('Unable to load meal plan')
      setPlan(await response.json() as DietPlan)
    }).catch(() => setMessage('Could not load your meal prep plan.')).finally(() => setLoading(false))
  }, [request])

  async function savePlan(event: React.FormEvent) {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    setMessage('')
    const response = await request('/api/diet/plan', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
    if (response.ok) {
      setPlan(await response.json() as DietPlan)
      setDraft(null)
      setMessage('Meal prep plan updated.')
    } else setMessage('Check the meal plan fields and try again.')
    setSaving(false)
  }

  if (loading) return <section className="diet-loading panel"><ChefHat size={30} /><p>Loading your meal prep plan...</p></section>
  if (!plan) return <section className="diet-loading panel"><ChefHat size={30} /><p>{message || 'Meal plan unavailable.'}</p></section>

  return <section className="diet-workspace">
    <header className="diet-hero">
      <div><span className="panel-kicker"><ChefHat size={15} /> NUTRITION</span><h2>{plan.name}</h2><p>A repeatable four-week system built for muscle gain, easy shopping, and simple prep.</p></div>
      <div className="diet-hero-actions"><span><small>This month</small><b>Week {currentWeek}</b></span><button type="button" className="task-creator-toggle" onClick={() => { setDraft(structuredClone(plan)); setMessage('') }}><Pencil size={16} /> Edit plan</button></div>
    </header>

    {message && <div className="diet-message" role="status"><Check size={15} /> {message}</div>}

    {draft ? <form className="diet-editor panel" onSubmit={savePlan}>
      <div className="diet-editor-header"><div><span className="panel-kicker"><Pencil size={15} /> EDIT MEAL PLAN</span><h2>Shape the plan around your goals</h2></div><button type="button" className="icon-button" onClick={() => setDraft(null)} aria-label="Close editor"><X size={18} /></button></div>
      <label className="diet-name-field">Plan name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required /></label>

      <div className="diet-edit-block"><h3><Dumbbell size={17} /> Portion guide</h3><div className="portion-edit-grid">{draft.portionGuide.map((portion, index) => <div key={index}><input value={portion.label} onChange={event => setDraft({ ...draft, portionGuide: draft.portionGuide.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} aria-label={`Portion ${index + 1} label`} required /><textarea value={portion.amount} onChange={event => setDraft({ ...draft, portionGuide: draft.portionGuide.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item) })} aria-label={`${portion.label} amount`} required /></div>)}</div><label>Goal guidance<textarea value={draft.guidance.join('\n')} onChange={event => setDraft({ ...draft, guidance: lines(event.target.value) })} placeholder="One note per line" /></label></div>

      <div className="diet-edit-block"><h3><Utensils size={17} /> Four-week menu</h3><div className="meal-week-edit-grid">{draft.weeks.map((week, index) => <section key={week.week}><b>Week {week.week}</b>{(['breakfast', 'lunch', 'dinner', 'snack'] as const).map(meal => <label key={meal}>{meal.replace(/^./, letter => letter.toUpperCase())}<textarea value={week[meal]} onChange={event => setDraft({ ...draft, weeks: draft.weeks.map((item, itemIndex) => itemIndex === index ? { ...item, [meal]: event.target.value } : item) })} /></label>)}</section>)}</div></div>

      <div className="diet-edit-block"><h3><ShoppingBasket size={17} /> Grocery list</h3><div className="grocery-edit-grid">{draft.groceries.map((group, index) => <section key={index}><input value={group.category} onChange={event => setDraft({ ...draft, groceries: draft.groceries.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value } : item) })} aria-label={`Grocery category ${index + 1}`} required /><textarea value={group.items.join('\n')} onChange={event => setDraft({ ...draft, groceries: draft.groceries.map((item, itemIndex) => itemIndex === index ? { ...item, items: lines(event.target.value) } : item) })} placeholder="One item per line" /></section>)}</div></div>

      <div className="diet-edit-block"><h3><ShoppingBasket size={17} /> Weekly shopping amounts</h3><div className="amount-edit-grid">{draft.shoppingAmounts.map((entry, index) => <div key={index}><input value={entry.item} onChange={event => setDraft({ ...draft, shoppingAmounts: draft.shoppingAmounts.map((item, itemIndex) => itemIndex === index ? { ...item, item: event.target.value } : item) })} aria-label={`Shopping item ${index + 1}`} required /><input value={entry.amount} onChange={event => setDraft({ ...draft, shoppingAmounts: draft.shoppingAmounts.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item) })} aria-label={`${entry.item} amount`} required /></div>)}</div></div>

      <div className="diet-edit-columns"><div className="diet-edit-block"><h3><CookingPot size={17} /> Prep method</h3><textarea value={draft.prepSteps.join('\n')} onChange={event => setDraft({ ...draft, prepSteps: lines(event.target.value) })} placeholder="One step per line" /></div><div className="diet-edit-block"><h3><Repeat2 size={17} /> Repeat rules</h3><textarea value={draft.repeatRules.join('\n')} onChange={event => setDraft({ ...draft, repeatRules: lines(event.target.value) })} placeholder="One rule per line" /></div></div>
      <div className="gym-editor-actions"><button type="button" className="text-action" onClick={() => setDraft(null)}>Cancel</button><button type="submit" className="task-creator-toggle" disabled={saving}><Save size={16} /> {saving ? 'Saving...' : 'Save meal plan'}</button></div>
    </form> : <>
      <section className="portion-panel panel"><div className="section-heading"><div><span className="panel-kicker"><Dumbbell size={15} /> PORTION GUIDE</span><h2>Build every plate with purpose</h2></div><span className="diet-badge">Default starting point</span></div><div className="portion-grid">{plan.portionGuide.map((portion, index) => <article key={portion.label}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{portion.label}</b><p>{portion.amount}</p></div></article>)}</div><div className="diet-guidance">{plan.guidance.map(note => <p key={note}><Sparkles size={15} /> {note}</p>)}</div></section>

      <section className="monthly-menu"><div className="section-heading"><div><span className="panel-kicker"><Utensils size={15} /> MONTHLY MENU</span><h2>Your four-week rotation</h2></div><span className="diet-badge">Repeat monthly</span></div><div className="meal-week-grid">{plan.weeks.map(week => <article className={week.week === currentWeek ? 'active' : ''} key={week.week}><header><span>Week</span><b>{week.week}</b>{week.week === currentWeek && <small>Current</small>}</header><div>{(['breakfast', 'lunch', 'dinner', 'snack'] as const).map(meal => <p key={meal}><small>{meal}</small><b>{week[meal]}</b></p>)}</div></article>)}</div></section>

      <section className="grocery-panel panel"><div className="section-heading"><div><span className="panel-kicker"><ShoppingBasket size={15} /> GROCERY LIST</span><h2>The weekly staples</h2></div><span className="diet-badge">Buy once a week</span></div><div className="grocery-category-grid">{plan.groceries.map((group, index) => <article key={group.category}><span className={`grocery-icon grocery-icon-${index + 1}`}><Apple size={18} /></span><h3>{group.category}</h3><ul>{group.items.map(item => <li key={item}><Check size={13} /> {item}</li>)}</ul></article>)}</div></section>

      <section className="shopping-panel panel"><div className="section-heading"><div><span className="panel-kicker"><ShoppingBasket size={15} /> EASY WEEKLY AMOUNTS</span><h2>Start here, then adjust</h2></div></div><div className="shopping-amount-grid">{plan.shoppingAmounts.map(entry => <div key={entry.item}><span>{entry.item}</span><b>{entry.amount}</b></div>)}</div></section>

      <div className="diet-bottom-grid"><section className="prep-panel panel"><span className="panel-kicker"><CookingPot size={15} /> BEST PREP METHOD</span><h2>One focused prep session</h2><ol>{plan.prepSteps.map((step, index) => <li key={step}><b>{index + 1}</b><span>{step}</span></li>)}</ol></section><section className="repeat-panel panel"><span className="panel-kicker"><Repeat2 size={15} /> KEEP IT GOING</span><h2>How to repeat it forever</h2><div>{plan.repeatRules.map(rule => <p key={rule}><Check size={15} /> {rule}</p>)}</div></section></div>
    </>}
  </section>
}
