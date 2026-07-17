import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultGymRoutineInput } from './db.js'

test('default gym routine preserves the requested A/B schedule and progression rules', () => {
  const routine = defaultGymRoutineInput()

  assert.deepEqual(routine.trainingDays, ['monday', 'wednesday', 'friday'])
  assert.equal(routine.workouts.A[0].name, 'Back squat')
  assert.equal(routine.workouts.A[0].sets, '3')
  assert.equal(routine.workouts.A[0].reps, '5')
  assert.equal(routine.workouts.B[0].name, 'Deadlift')
  assert.equal(routine.workouts.B[0].sets, '1–3')
  assert.equal(routine.progression.restBigLifts, '2–3 minutes')
  assert.equal(routine.progression.restAccessories, '60–90 seconds')
  assert.equal(routine.progression.duration, '60–75 minutes')
  assert.ok(routine.progression.rules.some(rule => rule.includes('6–10 weeks')))
})
