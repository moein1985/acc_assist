import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const repoRoot = process.cwd()

function runPwsh(args: string[]) {
  return spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
}

test('rollback-release restores latest manifest and matching artifacts from backup', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'acc-assist-rollback-'))
  const updatesRoot = path.join(tempRoot, 'updates')
  const backupRoot = path.join(tempRoot, 'backup')

  mkdirSync(updatesRoot, { recursive: true })
  mkdirSync(backupRoot, { recursive: true })

  writeFileSync(path.join(updatesRoot, 'latest.yml'), 'old-manifest\n', 'utf8')
  writeFileSync(path.join(backupRoot, 'latest.yml'), 'restored-manifest\n', 'utf8')
  writeFileSync(path.join(backupRoot, 'app-1.0.0.exe'), 'backup-binary\n', 'utf8')
  writeFileSync(path.join(backupRoot, 'app-1.0.1.exe'), 'should-not-copy\n', 'utf8')

  const result = runPwsh([
    'scripts/ops/rollback-release.ps1',
    '-UpdatesRoot', updatesRoot,
    '-BackupRoot', backupRoot,
    '-PreviousVersion', '1.0.0',
    '-Channel', 'latest'
  ])

  try {
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(readFileSync(path.join(updatesRoot, 'latest.yml'), 'utf8'), 'restored-manifest\n')
    assert.equal(readFileSync(path.join(updatesRoot, 'app-1.0.0.exe'), 'utf8'), 'backup-binary\n')
    assert.equal(existsSync(path.join(updatesRoot, 'app-1.0.1.exe')), false)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
