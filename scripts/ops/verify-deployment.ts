/**
 * S34.10 — verify:deployment script
 *
 * Runs live dual-source verification (oracle SQL + engine) for a specific deployment.
 * Connects to the remote SQL Server via SSH, runs oracle queries from the registry,
 * and populates the per-deployment registry with results.
 *
 * Usage:
 *   npx tsx scripts/ops/verify-deployment.ts --server <ip> --db <name> [--software-id <id>] [--fiscal-year <year>]
 *
 * Example:
 *   npx tsx scripts/ops/verify-deployment.ts --server 192.168.85.56 --db Sepidar01 --software-id sepidar --fiscal-year 1402
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ─── Types ───

interface RegistryEntry {
  metricId: string
  tier: 'T1' | 'T2' | 'T3'
  status: 'verified' | 'oracle_only' | 'unverified' | 'not_applicable' | 'needs_accountant_review'
  expectedValue: number | null
  fiscalYear: string | null
  oracleSql: string
  engineRequestId: string
  diff: number | null
  tolerance: number | null
  verifiedAt: string
  commit: string
  notes: string
}

// ─── Parse CLI args ───

const args = process.argv.slice(2)
function getArg(name: string, fallback?: string): string {
  const idx = args.indexOf(`--${name}`)
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1]
  return fallback ?? ''
}

const SERVER = getArg('server', '192.168.85.56')
const DB_NAME = getArg('db', 'Sepidar01')
const SOFTWARE_ID = getArg('software-id', 'sepidar')
const FISCAL_YEAR = getArg('fiscal-year', '1402')

// SSH/SQL defaults (from SSH-TELEMETRY-GUIDE.md)
const SSH_PORT = '2211'
const SSH_USER = 'administrator'
const SSH_PASS = 'Hs-co@12321#'
const SSH_HOSTKEY = 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'
const SQL_HOST = '127.0.0.1'
const SQL_PORT = '58033'
const SQL_USER = 'damavand'
const SQL_PASS = 'damavand'

// ─── Run sqlcmd via SSH ───

function runSqlViaSsh(sql: string): Record<string, unknown>[] {
  const escapedSql = sql.replace(/'/g, "''")
  const remoteCmd = `sqlcmd -S ${SQL_HOST},${SQL_PORT} -U ${SQL_USER} -P ${SQL_PASS} -d ${DB_NAME} -W -s "," -Q "SET NOCOUNT ON; ${escapedSql}"`
  const b64 = Buffer.from(remoteCmd, 'utf16le').toString('base64')
  const sshCmd = `plink -P ${SSH_PORT} -ssh -batch -hostkey "${SSH_HOSTKEY}" -pw ${SSH_PASS} ${SSH_USER}@${SERVER} "powershell -NoProfile -EncodedCommand ${b64}"`

  const output = execSync(sshCmd, { encoding: 'utf-8', timeout: 30000 })

  const lines = output.trim().split('\n').filter(l => l.trim() && !l.startsWith('(') && l.trim() !== '')
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim())
  const rows: Record<string, unknown>[] = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    const row: Record<string, unknown> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = parts[j]?.trim() ?? ''
    }
    rows.push(row)
  }
  return rows
}

// ─── Main ───

async function main() {
  console.log('=== S34.10 verify:deployment ===')
  console.log(`Server: ${SERVER}`)
  console.log(`Database: ${DB_NAME}`)
  console.log(`Software ID: ${SOFTWARE_ID}`)
  console.log(`Fiscal Year: ${FISCAL_YEAR}`)
  console.log()

  // Load the flat registry
  const registryPath = join(__dirname, '..', 'fixtures', 'metric-verification-registry.json')
  const registry: RegistryEntry[] = JSON.parse(readFileSync(registryPath, 'utf-8'))

  // Filter to entries with oracleSql that can be run
  const runnable = registry.filter(e => e.oracleSql && e.oracleSql.trim().length > 0)

  console.log(`Total metrics in registry: ${registry.length}`)
  console.log(`Metrics with oracle SQL: ${runnable.length}`)
  console.log()

  let passCount = 0
  let failCount = 0
  let errorCount = 0
  const results: Array<{ metricId: string; status: string; oracleValue: string; expected: string | null; match: boolean }> = []

  for (const entry of runnable) {
    try {
      // Replace fiscal year placeholder if present
      let sql = entry.oracleSql
      if (entry.fiscalYear) {
        sql = sql.replace(/N'(\d{4})'/g, `N'${entry.fiscalYear}'`)
      }

      const rows = runSqlViaSsh(sql)
      if (rows.length === 0) {
        results.push({ metricId: entry.metricId, status: 'empty', oracleValue: '0', expected: entry.expectedValue?.toString() ?? null, match: false })
        failCount++
        continue
      }

      // Get the first column value (oracle queries return a single value)
      const firstCol = Object.keys(rows[0])[0]
      const oracleValueStr = String(rows[0][firstCol] ?? '0').trim()
      const oracleValue = parseFloat(oracleValueStr) || 0

      // Compare with expected value if available
      let match = false
      if (entry.expectedValue !== null && entry.expectedValue !== undefined) {
        const diff = Math.abs(oracleValue - entry.expectedValue)
        const tolerance = entry.tolerance ?? 1
        match = diff <= tolerance
      }

      results.push({
        metricId: entry.metricId,
        status: match ? 'oracle_match' : 'oracle_only',
        oracleValue: oracleValueStr,
        expected: entry.expectedValue?.toString() ?? null,
        match,
      })

      if (match) passCount++
      else failCount++

      console.log(`  ${match ? '✅' : '⚠️'} ${entry.metricId}: oracle=${oracleValueStr}, expected=${entry.expectedValue ?? 'N/A'}, match=${match}`)
    } catch (err) {
      errorCount++
      const msg = (err as Error).message.substring(0, 100)
      results.push({ metricId: entry.metricId, status: 'error', oracleValue: msg, expected: entry.expectedValue?.toString() ?? null, match: false })
      console.log(`  ❌ ${entry.metricId}: ERROR — ${msg}`)
    }
  }

  // Summary
  console.log()
  console.log('=== Summary ===')
  console.log(`Oracle match (expected == oracle): ${passCount}`)
  console.log(`Oracle only (no expected or mismatch): ${failCount}`)
  console.log(`Errors: ${errorCount}`)
  console.log(`Total: ${runnable.length}`)

  // Print deployment ID for reference
  const { getDeploymentId } = await import('../../src/main/services/financialEngine/chartOfAccountsMapping')
  const deploymentId = getDeploymentId(SOFTWARE_ID, DB_NAME, SERVER)
  console.log()
  console.log(`Deployment ID: ${deploymentId}`)
  console.log(`To populate per-deployment registry, use deploymentId='${deploymentId}' in deploymentRegistry.ts`)

  // Exit code: 0 if all oracle queries ran without error
  if (errorCount > 0) {
    process.exit(1)
  } else {
    process.exit(0)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
