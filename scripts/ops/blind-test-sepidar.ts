/**
 * Blind Schema Discovery Test on Sepidar database.
 *
 * This script connects to the remote Sepidar SQL Server via SSH,
 * runs INFORMATION_SCHEMA scan queries, builds a discovered adapter,
 * and compares it with the hardcoded SepidarAdapter.
 *
 * Usage:
 *   node --import tsx scripts/ops/blind-test-sepidar.ts
 */
import { execSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// ─── SSH / SQL config ───
const SSH_HOST = '192.168.85.56'
const SSH_PORT = '2211'
const SSH_USER = 'administrator'
const SSH_PASS = 'Hs-co@12321#'
const SSH_HOSTKEY = 'ssh-ed25519 255 SHA256:sEP9p+Bs2vmC7FrAS/CjaodoZVs9LyB2ro4fELRt+iQ'
const SQL_HOST = '127.0.0.1'
const SQL_PORT = '58033'
const SQL_USER = 'damavand'
const SQL_PASS = 'damavand'
const SQL_DB = 'Sepidar01'

// ─── Discovery pipeline imports ───
import {
  scanDatabaseSchema,
  filterRelevantTables,
  type RawSchemaInventory,
  type SqlExecutor,
} from '../../src/main/services/financialEngine/schemaDiscovery'
import {
  heuristicMapTables,
  inferRelationships,
  detectEnums,
  buildAdapter,
} from '../../src/main/services/financialEngine/semanticMapping'
import { AccountingConcept, AccountCategory } from '../../src/main/services/financialEngine/schemaAdapter'
import { SepidarAdapter } from '../../src/main/services/financialEngine/adapters/sepidarAdapter'

const sepidarAdapter = new SepidarAdapter()

// ─── Run sqlcmd via SSH ───
function runSqlViaSsh(sql: string): Record<string, unknown>[] {
  const escapedSql = sql.replace(/'/g, "''")
  const remoteCmd = `sqlcmd -S ${SQL_HOST},${SQL_PORT} -U ${SQL_USER} -P ${SQL_PASS} -d ${SQL_DB} -W -s "," -Q "SET NOCOUNT ON; ${escapedSql}"`
  const b64 = Buffer.from(remoteCmd, 'utf16le').toString('base64')
  const sshCmd = `plink -P ${SSH_PORT} -ssh -batch -hostkey "${SSH_HOSTKEY}" -pw ${SSH_PASS} ${SSH_USER}@${SSH_HOST} "powershell -NoProfile -EncodedCommand ${b64}"`
  
  const output = execSync(sshCmd, { encoding: 'utf-8', timeout: 30000 })
  
  // Parse comma-separated output with headers on first line
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
  console.log('=== Blind Schema Discovery Test on Sepidar ===\n')
  console.log('Step 1: Running INFORMATION_SCHEMA queries via SSH/sqlcmd...\n')

  const cacheFile = resolve(__dirname, '..', '..', 'tests', 'fixtures', 'sepidar-real-schema.json')
  
  let inventory: RawSchemaInventory

  if (existsSync(cacheFile)) {
    console.log('  (Using cached schema from', cacheFile, ')')
    inventory = JSON.parse(readFileSync(cacheFile, 'utf-8'))
  } else {
    // Run all queries
    const executor: SqlExecutor = async (sql: string) => {
      console.log('  Running query:', sql.substring(0, 60), '...')
      return runSqlViaSsh(sql)
    }

    inventory = await scanDatabaseSchema(executor)
    writeFileSync(cacheFile, JSON.stringify(inventory, null, 2), 'utf-8')
    console.log('  Schema saved to', cacheFile)
  }

  console.log(`\n  Server: ${inventory.serverVersion}`)
  console.log(`  Database: ${inventory.databaseName}`)
  console.log(`  Tables: ${inventory.tables.length}`)

  // Step 2: Filter relevant tables
  console.log('\nStep 2: Filtering relevant tables...')
  const relevant = filterRelevantTables(inventory)
  console.log(`  Relevant tables: ${relevant.length}`)
  for (const t of relevant) {
    console.log(`    ${t.tableRef.schema}.${t.tableRef.table} (${t.estimatedRowCount} rows, ${t.columns.length} cols)`)
  }

  // Step 3: Heuristic mapping
  console.log('\nStep 3: Heuristic mapping...')
  const heuristic = heuristicMapTables(inventory)
  console.log(`  Mapped concepts: ${Object.keys(heuristic.tables).length}`)
  for (const [concept, ref] of Object.entries(heuristic.tables)) {
    const tr = ref as { schema: string; table: string }
    console.log(`    ${concept} -> ${tr.schema}.${tr.table}`)
  }
  console.log(`  Unmatched tables: ${heuristic.unmatched.length}`)
  for (const u of heuristic.unmatched) {
    console.log(`    ${u}`)
  }

  // Step 4: Build adapter
  console.log('\nStep 4: Building discovered adapter...')
  const relationships = inferRelationships(inventory, heuristic.tables)
  const enums = detectEnums(inventory, heuristic.tables)
  const discoveredAdapter = buildAdapter({
    softwareId: 'sepidar-discovered',
    softwareName: 'Sepidar (Discovered)',
    tables: heuristic.tables,
    columns: heuristic.columns,
    relationships,
    enums,
    confidence: heuristic.confidence,
  })
  console.log(`  Confidence: ${heuristic.confidence}`)
  console.log(`  Relationships: ${relationships.length}`)
  console.log(`  Enums: ${Object.keys(enums).length}`)

  // Step 5: Compare with SepidarAdapter
  console.log('\nStep 5: Comparing discovered adapter with hardcoded SepidarAdapter...')
  
  const concepts = [
    AccountingConcept.sales_invoice,
    AccountingConcept.voucher,
    AccountingConcept.voucher_item,
    AccountingConcept.account,
    AccountingConcept.fiscal_year,
    AccountingConcept.inventory_receipt,
  ]

  let matches = 0
  let mismatches = 0

  for (const concept of concepts) {
    const sepidarTable = sepidarAdapter.resolveTable(concept)
    const discoveredTable = discoveredAdapter.resolveTable(concept)
    const match = sepidarTable === discoveredTable
    console.log(`  ${concept}: sepidar=${sepidarTable} | discovered=${discoveredTable} | ${match ? 'MATCH' : 'MISMATCH'}`)
    if (match) matches++
    else mismatches++
  }

  // Step 6: Compare column resolution
  console.log('\nStep 6: Comparing column resolution...')
  const columnTests: { concept: AccountingConcept; field: string; label: string }[] = [
    { concept: AccountingConcept.sales_invoice, field: 'net_amount', label: 'sales.net_amount' },
    { concept: AccountingConcept.sales_invoice, field: 'date', label: 'sales.date' },
    { concept: AccountingConcept.voucher, field: 'date', label: 'voucher.date' },
    { concept: AccountingConcept.voucher, field: 'voucher_type', label: 'voucher.type' },
    { concept: AccountingConcept.voucher_item, field: 'debit', label: 'voucher_item.debit' },
    { concept: AccountingConcept.voucher_item, field: 'credit', label: 'voucher_item.credit' },
    { concept: AccountingConcept.account, field: 'code', label: 'account.code' },
    { concept: AccountingConcept.fiscal_year, field: 'title', label: 'fiscal_year.title' },
  ]

  let colMatches = 0
  let colMismatches = 0

  for (const ct of columnTests) {
    const sepidarCol = sepidarAdapter.resolveColumn(ct.concept, ct.field)
    const discoveredCol = discoveredAdapter.resolveColumn(ct.concept, ct.field)
    const sepidarStr = sepidarCol || 'null'
    const discoveredStr = discoveredCol || 'null'
    const match = sepidarStr === discoveredStr
    console.log(`  ${ct.label}: sepidar=${sepidarStr} | discovered=${discoveredStr} | ${match ? 'MATCH' : 'MISMATCH'}`)
    if (match) colMatches++
    else colMismatches++
  }

  // Step 7: Compare account classification
  console.log('\nStep 7: Comparing account classification...')
  for (const cat of [AccountCategory.asset, AccountCategory.liability, AccountCategory.equity, AccountCategory.revenue, AccountCategory.expense]) {
    const sepidarFilter = sepidarAdapter.getAccountClassification(cat)
    const discoveredFilter = discoveredAdapter.getAccountClassification(cat)
    const match = sepidarFilter === discoveredFilter
    console.log(`  ${cat}: sepidar=${sepidarFilter} | discovered=${discoveredFilter} | ${match ? 'MATCH' : 'MISMATCH'}`)
    if (match) matches++
    else mismatches++
  }

  // Summary
  console.log('\n=== BLIND DISCOVERY TEST SUMMARY ===')
  console.log(`Table mappings: ${matches}/${matches + mismatches} match`)
  console.log(`Column mappings: ${colMatches}/${colMatches + colMismatches} match`)
  const totalMatch = matches + colMatches
  const total = matches + mismatches + colMatches + colMismatches
  console.log(`Overall: ${totalMatch}/${total} (${Math.round(totalMatch / total * 100)}%)`)
  console.log(`\nVerdict: ${totalMatch === total ? 'PERFECT — discovered adapter matches hardcoded' : 'PARTIAL — some mappings differ, review needed'}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
