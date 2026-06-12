import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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

test('release readiness rejects placeholder update URLs', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'acc-release-readiness-'))

  await mkdir(path.join(tempRoot, 'src', 'main', 'services'), { recursive: true })
  await mkdir(path.join(tempRoot, 'scripts', 'ops'), { recursive: true })

  await writeFile(
    path.join(tempRoot, 'package.json'),
    JSON.stringify({ name: 'temp-release-check', version: '1.0.0' }, null, 2),
    'utf8'
  )

  await writeFile(
    path.join(tempRoot, 'electron-builder.yml'),
    ['appId: com.example.app', 'productName: Example', 'publish:', '  - provider: generic', '    url: https://example.com/desktop', '    channel: latest'].join('\n'),
    'utf8'
  )

  await writeFile(path.join(tempRoot, 'src', 'main', 'types.ts'), "export const apiKey = ''\n", 'utf8')
  await writeFile(path.join(tempRoot, 'src', 'main', 'services', 'settingsStore.ts'), "export const bearerToken = ''\n", 'utf8')
  await writeFile(path.join(tempRoot, 'scripts', 'ops', 'remote-server-control.ps1'), 'param()\n', 'utf8')
  await writeFile(path.join(tempRoot, 'scripts', 'ops', 'telemetry-smoke-test.mjs'), 'export default {}\n', 'utf8')

  const result = spawnSync('node', [path.join(repoRoot, 'scripts', 'ops', 'release-readiness.mjs'), '--no-write-plan'], {
    cwd: tempRoot,
    encoding: 'utf8'
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /placeholder/i)
})

test('release readiness flags hardcoded remote credentials in smoke helper scripts', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'acc-release-readiness-secret-'))

  await mkdir(path.join(tempRoot, 'src', 'main', 'services'), { recursive: true })
  await mkdir(path.join(tempRoot, 'scripts', 'ops'), { recursive: true })

  await writeFile(
    path.join(tempRoot, 'package.json'),
    JSON.stringify({ name: 'temp-release-check', version: '1.0.0' }, null, 2),
    'utf8'
  )

  await writeFile(
    path.join(tempRoot, 'electron-builder.yml'),
    ['appId: com.example.app', 'productName: Example', 'publish:', '  - provider: generic', '    url: https://example.com/desktop', '    channel: latest'].join('\n'),
    'utf8'
  )

  await writeFile(path.join(tempRoot, 'src', 'main', 'types.ts'), "export const apiKey = ''\n", 'utf8')
  await writeFile(path.join(tempRoot, 'src', 'main', 'services', 'settingsStore.ts'), "export const bearerToken = ''\n", 'utf8')
  await writeFile(path.join(tempRoot, 'scripts', 'ops', 'remote-server-control.ps1'), 'param()\n', 'utf8')
  await writeFile(
    path.join(tempRoot, 'scripts', 'ops', 'smoke-live-agent.ps1'),
    [
      'param(',
      "  [string]$Password = 'Hs-co@12321#',",
      "  [string]$HostKey = 'ssh-ed25519 255 SHA256:test'",
      ')'
    ].join('\n'),
    'utf8'
  )
  await writeFile(path.join(tempRoot, 'scripts', 'ops', 'telemetry-smoke-test.mjs'), 'export default {}\n', 'utf8')

  const result = spawnSync('node', [path.join(process.cwd(), 'scripts', 'ops', 'release-readiness.mjs'), '--no-write-plan'], {
    cwd: tempRoot,
    encoding: 'utf8'
  })

  assert.notEqual(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /hardcoded.*(password|host key|credential)/i)
})
