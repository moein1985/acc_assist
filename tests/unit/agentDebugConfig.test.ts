import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isTruthyEnvValue, resolveAgentDebugToken, shouldStartAgentDebugServer } from '../../src/main/services/agentDebugConfig'

test('agent debug config requires explicit opt-in or server-only flag', () => {
  assert.equal(
    shouldStartAgentDebugServer({ isAgentDebugServerOnly: false, env: {} as NodeJS.ProcessEnv }),
    false
  )

  assert.equal(
    shouldStartAgentDebugServer({
      isAgentDebugServerOnly: false,
      env: { ACC_ENABLE_AGENT_DEBUG_SERVER: '1' } as NodeJS.ProcessEnv
    }),
    true
  )

  assert.equal(
    shouldStartAgentDebugServer({ isAgentDebugServerOnly: true, env: {} as NodeJS.ProcessEnv }),
    true
  )
})

test('agent debug config resolves token from env only', () => {
  assert.equal(resolveAgentDebugToken({} as NodeJS.ProcessEnv), null)
  assert.equal(resolveAgentDebugToken({ ACC_AGENT_DEBUG_TOKEN: '  abc123  ' } as NodeJS.ProcessEnv), 'abc123')
})

test('truthy env parser accepts release-safe values', () => {
  assert.equal(isTruthyEnvValue('1'), true)
  assert.equal(isTruthyEnvValue('true'), true)
  assert.equal(isTruthyEnvValue('yes'), true)
  assert.equal(isTruthyEnvValue('on'), true)
  assert.equal(isTruthyEnvValue('0'), false)
  assert.equal(isTruthyEnvValue(undefined), false)
})
