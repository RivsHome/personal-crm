import assert from 'node:assert/strict'
import test from 'node:test'
import { current, initializeAuth, login } from './auth.js'

test('authentication rejects invalid credentials and unauthenticated sessions', async () => {
  await initializeAuth()
  assert.equal(await login('not-the-owner@example.com', 'password123'), null)
  assert.equal(current('not-a-real-session'), null)
})
