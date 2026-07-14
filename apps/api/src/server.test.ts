import test from 'node:test'
import assert from 'node:assert/strict'

test('foundation test runner is configured', () => {
  assert.equal(typeof crypto.randomUUID, 'function')
})
