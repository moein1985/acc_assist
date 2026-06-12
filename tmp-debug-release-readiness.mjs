import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const repoRoot = process.cwd()

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'acc-release-readiness-debug-'))
await mkdir(path.join(tempRoot, 'src', 'main', 'services'), { recursive: true })
await mkdir(path.join(tempRoot, 'scripts', 'ops'), { recursive: true })
await writeFile(path.join(tempRoot, 'package.json'), JSON.stringify({ name: 'temp-release-check', version: '1.0.0' }, null, 2), 'utf8')
await writeFile(path.join(tempRoot, 'electron-builder.yml'), ['appId: com.example.app', 'productName: Example', 'publish:', '  - provider: generic', '    url: https://example.com/desktop', '    channel: latest'].join('\n'), 'utf8')
await writeFile(path.join(tempRoot, 'src', 'main', 'types.ts'), "export const apiKey = ''\n", 'utf8')
await writeFile(path.join(tempRoot, 'src', 'main', 'services', 'settingsStore.ts'), "export const bearerToken = ''\n", 'utf8')
await writeFile(path.join(tempRoot, 'scripts', 'ops', 'remote-server-control.ps1'), 'param()\n', 'utf8')
await writeFile(path.join(tempRoot, 'scripts', 'ops', 'smoke-live-agent.ps1'), ['param(', "  [string]$Password = 'Hs-co@12321#',", "  [string]$HostKey = 'ssh-ed25519 255 SHA256:test'", ')'].join('\n'), 'utf8')
await writeFile(path.join(tempRoot, 'scripts', 'ops', 'telemetry-smoke-test.mjs'), 'export default {}\n', 'utf8')

const result = spawnSync('node', [path.join(repoRoot, 'scripts', 'ops', 'release-readiness.mjs'), '--no-write-plan'], { cwd: tempRoot, encoding: 'utf8' })
console.log('STATUS', result.status)
console.log('STDOUT_START')
console.log(result.stdout)
console.log('STDOUT_END')
console.log('STDERR_START')
console.log(result.stderr)
console.log('STDERR_END')
