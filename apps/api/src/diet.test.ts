import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultDietPlanInput } from './db.js'

test('default diet plan includes the full four-week meal prep cycle', () => {
  const plan = defaultDietPlanInput()

  assert.equal(plan.weeks.length, 4)
  assert.equal(plan.weeks[0].breakfast, 'Protein oats + banana + peanut butter')
  assert.equal(plan.weeks[3].dinner, 'Beef or chicken potato bowl with vegetables')
  assert.ok(plan.portionGuide.some(portion => portion.label === 'Protein' && portion.amount.includes('30–40 g')))
  assert.ok(plan.groceries.some(group => group.category === 'Proteins' && group.items.includes('Chicken breast or thighs')))
  assert.ok(plan.shoppingAmounts.some(entry => entry.item === 'Chicken' && entry.amount === '4–6 lb'))
  assert.equal(plan.prepSteps.length, 5)
  assert.equal(plan.repeatRules.length, 5)
})
