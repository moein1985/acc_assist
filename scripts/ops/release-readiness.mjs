#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const packageJsonPath = path.join(rootDir, 'package.json')
const builderConfigPath = path.join(rootDir, 'electron-builder.yml')
const rollbackPlanPath = path.join(rootDir, 'build', 'release-rollback-plan.json')

const args = parseArgs(process.argv.slice(2))

async function main() {
  const checks = []
  const failures = []
  const warnings = []

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const electronBuilderYaml = await readFile(builderConfigPath, 'utf8')

  const version = String(packageJson.version || '').trim()
  const versionCheck = isValidSemver(version)
  checks.push(result(versionCheck, `Package version is valid semver: ${version || 'missing'}`))
  if (!versionCheck) {
    failures.push('package.json version is missing or invalid semver.')
  }

  const channel = resolveReleaseChannel(version)
  checks.push(result(true, `Resolved release channel: ${channel}`))

  const hasGenericPublish = /publish\s*:\s*(?:\n\s*-\s*)?provider\s*:\s*generic/i.test(electronBuilderYaml)
  checks.push(result(hasGenericPublish, 'electron-builder has generic publish provider configured'))
  if (!hasGenericPublish) {
    failures.push('electron-builder.yml does not define a generic publish provider.')
  }

  const publishUrlMatch = electronBuilderYaml.match(/url\s*:\s*(https?:\/\/[^\s'"#]+)/i)
  const hasPublishUrl = Boolean(publishUrlMatch)
  const publishUrl = publishUrlMatch?.[1] || ''
  const hasPlaceholderPublishUrl = /https?:\/\/(localhost|127\.0\.0\.1|example\.com|example\.org|placeholder|example\.net|updates\.example)/i.test(publishUrl)

  checks.push(result(hasPublishUrl, 'electron-builder publish URL is configured'))
  if (!hasPublishUrl) {
    failures.push('electron-builder publish URL is missing.')
  }

  checks.push(result(!hasPlaceholderPublishUrl, 'electron-builder publish URL is not a placeholder/test URL'))
  if (hasPlaceholderPublishUrl) {
    failures.push(`electron-builder publish URL must not use placeholder/test hosts: ${publishUrl || '(missing)'}`)
  }

  const hasPublishChannel = /channel\s*:\s*[a-z0-9_-]+/i.test(electronBuilderYaml)
  checks.push(result(hasPublishChannel, 'electron-builder publish channel is configured'))
  if (!hasPublishChannel) {
    failures.push('electron-builder publish channel is missing.')
  }

  await runSecretBaselineCheck(checks, failures)
  runSigningCheck(args.strictSigning, checks, failures, warnings)

  const rollbackPlan = {
    generatedAt: new Date().toISOString(),
    channel,
    targetVersion: version,
    previousVersion: process.env.ACC_PREVIOUS_RELEASE_VERSION || '',
    updateArtifactHints: [
      'latest.yml / beta.yml / alpha.yml',
      '*.exe + *.blockmap (win)',
      '*.AppImage + *.blockmap (linux)',
      '*.dmg + *.zip (mac)'
    ],
    requiredBackups: [
      'publish manifest before release',
      'channel yaml before release',
      'artifacts of previous stable version'
    ],
    rollbackSteps: [
      'Stop publishing pipeline for the affected channel',
      'Restore previous channel yaml + artifacts',
      'Verify update endpoint serves previous version metadata',
      'Smoke test update flow on a canary machine',
      'Document incident and keep target version blocked'
    ]
  }

  if (args.writePlan) {
    await mkdir(path.dirname(rollbackPlanPath), { recursive: true })
    await writeFile(rollbackPlanPath, `${JSON.stringify(rollbackPlan, null, 2)}\n`, 'utf8')
    checks.push(result(true, `Rollback plan file generated at: ${path.relative(rootDir, rollbackPlanPath)}`))
  }

  printReport({ checks, failures, warnings, channel, version, strictSigning: args.strictSigning })

  if (failures.length > 0) {
    process.exitCode = 1
  }
}

function parseArgs(argv) {
  let strictSigning = false
  let writePlan = true

  for (const arg of argv) {
    if (arg === '--strict-signing') {
      strictSigning = true
      continue
    }

    if (arg === '--no-write-plan') {
      writePlan = false
    }
  }

  return { strictSigning, writePlan }
}

function isValidSemver(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
}

function resolveReleaseChannel(version) {
  const lower = version.toLowerCase()

  if (lower.includes('-alpha')) {
    return 'alpha'
  }

  if (lower.includes('-beta')) {
    return 'beta'
  }

  if (lower.includes('-rc')) {
    return 'rc'
  }

  return 'latest'
}

async function runSecretBaselineCheck(checks, failures) {
  const baselineFiles = [
    path.join(rootDir, 'src', 'main', 'types.ts'),
    path.join(rootDir, 'src', 'main', 'services', 'settingsStore.ts'),
    path.join(rootDir, 'scripts', 'ops', 'remote-server-control.ps1'),
    path.join(rootDir, 'scripts', 'ops', 'telemetry-smoke-test.mjs')
  ]

  const issues = []

  for (const filePath of baselineFiles) {
    const content = await readFile(filePath, 'utf8')
    const rel = path.relative(rootDir, filePath)

    if (/apiKey\s*:\s*'[^']+'/.test(content)) {
      issues.push(`${rel}: hardcoded apiKey found`)
    }

    if (/bearerToken\s*:\s*'[^']+'/.test(content)) {
      issues.push(`${rel}: hardcoded bearer token found`)
    }

    if (/ACC_TELEMETRY_BEARER_TOKEN\s*=\s*['\"][^'\"]+['\"]/.test(content)) {
      issues.push(`${rel}: telemetry token literal assignment found`)
    }

    if (/password\s*:\s*'[^']+'/.test(content) && !/password\s*:\s*''/.test(content)) {
      issues.push(`${rel}: potential hardcoded password found`)
    }
  }

  const passed = issues.length === 0
  checks.push(result(passed, 'Secret baseline files do not contain obvious hardcoded credentials'))

  if (!passed) {
    failures.push(...issues)
  }
}

function runSigningCheck(strictSigning, checks, failures, warnings) {
  const hasWinSigning =
    hasEnv('WIN_CSC_LINK') && hasEnv('WIN_CSC_KEY_PASSWORD')
      ? true
      : hasEnv('CSC_LINK') && hasEnv('CSC_KEY_PASSWORD')

  const hasMacSigning =
    hasEnv('APPLE_ID') && hasEnv('APPLE_APP_SPECIFIC_PASSWORD') && hasEnv('APPLE_TEAM_ID')

  if (strictSigning) {
    checks.push(result(hasWinSigning, 'Windows code-signing env vars are present'))
    checks.push(result(hasMacSigning, 'macOS notarization env vars are present'))

    if (!hasWinSigning) {
      failures.push('Strict mode: missing Windows signing env vars (WIN_CSC_* or CSC_*).')
    }

    if (!hasMacSigning) {
      failures.push('Strict mode: missing macOS notarization env vars (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID).')
    }
  } else {
    checks.push(result(true, 'Signing check executed in advisory mode (use --strict-signing to enforce)'))

    if (!hasWinSigning) {
      warnings.push('Windows signing vars not detected (WIN_CSC_* or CSC_*).')
    }

    if (!hasMacSigning) {
      warnings.push('macOS notarization vars not detected (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID).')
    }
  }
}

function hasEnv(name) {
  return String(process.env[name] || '').trim().length > 0
}

function result(ok, message) {
  return {
    ok,
    message
  }
}

function printReport(summary) {
  const { checks, failures, warnings, channel, version, strictSigning } = summary

  console.log('Release Readiness Report')
  console.log(`Version: ${version}`)
  console.log(`Channel: ${channel}`)
  console.log(`Strict signing: ${strictSigning ? 'enabled' : 'disabled'}`)
  console.log('')

  for (const check of checks) {
    console.log(`${check.ok ? '[PASS]' : '[FAIL]'} ${check.message}`)
  }

  if (warnings.length > 0) {
    console.log('')
    console.log('Warnings:')
    for (const warning of warnings) {
      console.log(`- ${warning}`)
    }
  }

  if (failures.length > 0) {
    console.log('')
    console.log('Failures:')
    for (const failure of failures) {
      console.log(`- ${failure}`)
    }
  }

  console.log('')
  console.log(`Final status: ${failures.length === 0 ? 'READY' : 'NOT READY'}`)
}

main().catch((error) => {
  console.error('release-readiness failed:', error)
  process.exitCode = 1
})
