import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const repoRoot = process.cwd()

test('release readiness script exits cleanly in advisory mode', () => {
  const result = spawnSync('node', ['scripts/ops/release-readiness.mjs', '--no-write-plan'], {
    cwd: repoRoot,
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /Final status: READY/)
})
