import { pathToFileURL } from 'node:url'

import { SchemaDiscoveryService } from '../src/main/services/schemaDiscoveryService'
import { SqlConnectionManager } from '../src/main/services/sqlConnectionManager'
import { buildConnectorReadinessSummary } from '../src/main/services/connectorSdk'
import type {
  AccountingConceptKey,
  AccountingSoftwareId,
  SchemaCatalogEntry,
  SchemaDateMode,
  SqlConnectionConfig
} from '../src/shared/contracts'

type ValidationIssueLevel = 'info' | 'warn' | 'error'

type ValidationIssue = {
  level: ValidationIssueLevel
  message: string
}

type EffectiveSoftware = {
  id: AccountingSoftwareId | null
  name: string | null
  confidence: number | null
  source: 'selected' | 'detected' | 'unknown'
}

const REQUIRED_CONCEPTS_BY_SOFTWARE: Record<AccountingSoftwareId, AccountingConceptKey[]> = {
  sepidar: ['documents', 'documentLines', 'counterparties'],
  mahak: ['documents', 'documentLines', 'counterparties']
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback
  }

  const normalized = value.trim().toLowerCase()

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true
  }

  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false
  }

  return fallback
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseSoftwareId(value: string | undefined): AccountingSoftwareId | null {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'sepidar' || normalized === 'mahak') {
    return normalized
  }

  return null
}

function parseDateMode(value: string | undefined): SchemaDateMode | null {
  if (!value) {
    return null
  }

  const normalized = value.trim()
  if (
    normalized === 'unknown' ||
    normalized === 'gregorian' ||
    normalized === 'shamsiText' ||
    normalized === 'shamsiNumeric' ||
    normalized === 'fiscalPeriod' ||
    normalized === 'mixed'
  ) {
    return normalized
  }

  return null
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function buildConnectionFromEnv(): SqlConnectionConfig {
  return {
    server: readRequiredEnv('ACC_SQL_SERVER'),
    database: readRequiredEnv('ACC_SQL_DATABASE'),
    user: readRequiredEnv('ACC_SQL_USER'),
    password: readRequiredEnv('ACC_SQL_PASSWORD'),
    port: parseNumber(process.env['ACC_SQL_PORT'], 1433),
    encrypt: parseBoolean(process.env['ACC_SQL_ENCRYPT'], true),
    trustServerCertificate: parseBoolean(process.env['ACC_SQL_TRUST_CERT'], true),
    connectionTimeoutMs: parseNumber(process.env['ACC_SQL_CONNECTION_TIMEOUT_MS'], 15000),
    requestTimeoutMs: parseNumber(process.env['ACC_SQL_REQUEST_TIMEOUT_MS'], 45000),
    connectionRetryCount: parseNumber(process.env['ACC_SQL_CONNECTION_RETRY_COUNT'], 2),
    connectionRetryDelayMs: parseNumber(process.env['ACC_SQL_CONNECTION_RETRY_DELAY_MS'], 2000)
  }
}

function resolveEffectiveSoftware(catalog: SchemaCatalogEntry): EffectiveSoftware {
  if (catalog.selectedSoftwareId) {
    const selectedCandidate = (catalog.softwareCandidates ?? []).find(
      (candidate) => candidate.id === catalog.selectedSoftwareId
    )

    return {
      id: catalog.selectedSoftwareId,
      name: catalog.selectedSoftwareId,
      confidence: selectedCandidate?.confidence ?? null,
      source: 'selected'
    }
  }

  if (catalog.detectedSoftware) {
    return {
      id: catalog.detectedSoftware.id,
      name: catalog.detectedSoftware.name,
      confidence: catalog.detectedSoftware.confidence,
      source: 'detected'
    }
  }

  return {
    id: null,
    name: null,
    confidence: null,
    source: 'unknown'
  }
}

function collectConceptCoverage(
  catalog: SchemaCatalogEntry,
  requiredConcepts: AccountingConceptKey[]
): Array<{
  concept: AccountingConceptKey
  selected: string | null
  suggested: string | null
  covered: boolean
}> {
  return requiredConcepts.map((concept) => {
    const selected = catalog.selectedMappings[concept]?.trim() || null
    const suggested = catalog.suggestedMappings[concept]?.[0]?.trim() || null

    return {
      concept,
      selected,
      suggested,
      covered: Boolean(selected || suggested)
    }
  })
}

function validateCatalog(params: {
  catalog: SchemaCatalogEntry
  expectedSoftware: AccountingSoftwareId | null
  expectedDateMode: SchemaDateMode | null
  minConfidence: number
  requireReadOnly: boolean
  isReadOnlyLogin: boolean
}): ValidationIssue[] {
  const { catalog, expectedSoftware, expectedDateMode, minConfidence, requireReadOnly, isReadOnlyLogin } = params
  const issues: ValidationIssue[] = []
  const effectiveSoftware = resolveEffectiveSoftware(catalog)

  if (requireReadOnly && !isReadOnlyLogin) {
    issues.push({
      level: 'error',
      message: 'SQL login has write permissions, but ACC_REQUIRE_READONLY=true is set.'
    })
  } else if (!isReadOnlyLogin) {
    issues.push({
      level: 'warn',
      message: 'SQL login has write permissions. Using a read-only user is strongly recommended.'
    })
  }

  if (expectedSoftware && effectiveSoftware.id !== expectedSoftware) {
    issues.push({
      level: 'error',
      message: `Expected software=${expectedSoftware}, detected effective software=${effectiveSoftware.id ?? 'unknown'}.`
    })
  }

  if (effectiveSoftware.id && effectiveSoftware.confidence !== null && effectiveSoftware.confidence < minConfidence) {
    issues.push({
      level: expectedSoftware ? 'error' : 'warn',
      message: `Software confidence ${effectiveSoftware.confidence.toFixed(2)} is below threshold ${minConfidence.toFixed(2)}.`
    })
  }

  if (!effectiveSoftware.id) {
    issues.push({
      level: expectedSoftware ? 'error' : 'warn',
      message: 'No effective accounting software could be detected from schema catalog.'
    })
  }

  if (expectedDateMode && catalog.detectedDateMode !== expectedDateMode) {
    issues.push({
      level: 'error',
      message: `Expected date mode=${expectedDateMode}, detected=${catalog.detectedDateMode ?? 'unknown'}.`
    })
  }

  if (!catalog.detectedDateMode || catalog.detectedDateMode === 'unknown') {
    issues.push({
      level: 'warn',
      message: 'Date mode detection is unknown. Consider manual review of date columns.'
    })
  }

  const coverageSoftware = expectedSoftware ?? effectiveSoftware.id
  if (coverageSoftware) {
    const requiredConcepts = REQUIRED_CONCEPTS_BY_SOFTWARE[coverageSoftware]
    const conceptCoverage = collectConceptCoverage(catalog, requiredConcepts)

    for (const item of conceptCoverage) {
      if (!item.covered) {
        issues.push({
          level: 'error',
          message: `Missing mapping suggestion for concept=${item.concept}.`
        })
      }
    }
  }

  if (catalog.includedTables === 0) {
    issues.push({
      level: 'error',
      message: 'No tables were included in schema catalog.'
    })
  }

  return issues
}

export function summarizeConnectorValidationReadiness(params: {
  suggestedMappings?: Record<string, string[]>
  selectedMappings?: Record<string, string>
  detectedSoftware?: {
    coverage?: {
      coveredConcepts?: AccountingConceptKey[]
      missingConcepts?: AccountingConceptKey[]
      coverageScore?: number
      validationHints?: string[]
    }
    confidence?: number | null
  } | null
}) {
  return buildConnectorReadinessSummary({
    suggestedMappings: params.suggestedMappings as any,
    selectedMappings: params.selectedMappings as any,
    detectedSoftware: params.detectedSoftware as any
  })
}

function printUsage(): void {
  console.log('Live connector validation for ACC Assist')
  console.log('Required env vars:')
  console.log('  ACC_SQL_SERVER, ACC_SQL_DATABASE, ACC_SQL_USER, ACC_SQL_PASSWORD')
  console.log('Optional env vars:')
  console.log('  ACC_SQL_PORT=1433')
  console.log('  ACC_SQL_ENCRYPT=true|false')
  console.log('  ACC_SQL_TRUST_CERT=true|false')
  console.log('  ACC_SQL_CONNECTION_TIMEOUT_MS=15000')
  console.log('  ACC_SQL_REQUEST_TIMEOUT_MS=45000')
  console.log('  ACC_EXPECTED_SOFTWARE=sepidar|mahak')
  console.log('  ACC_EXPECTED_DATE_MODE=unknown|gregorian|shamsiText|shamsiNumeric|fiscalPeriod|mixed')
  console.log('  ACC_VALIDATE_MIN_CONFIDENCE=0.70')
  console.log('  ACC_REQUIRE_READONLY=true|false (default: false)')
  console.log('  ACC_VALIDATION_PROFILE_ID=connector-live')
  console.log('  ACC_SELECTED_SOFTWARE=sepidar|mahak (manual override for discovery)')
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage()
    return
  }

  const connection = buildConnectionFromEnv()
  const expectedSoftware = parseSoftwareId(process.env['ACC_EXPECTED_SOFTWARE'])
  const expectedDateMode = parseDateMode(process.env['ACC_EXPECTED_DATE_MODE'])
  const selectedSoftwareOverride = parseSoftwareId(process.env['ACC_SELECTED_SOFTWARE'])
  const minConfidence = Math.min(Math.max(parseNumber(process.env['ACC_VALIDATE_MIN_CONFIDENCE'], 0.7), 0), 1)
  const requireReadOnly = parseBoolean(process.env['ACC_REQUIRE_READONLY'], false)
  const profileId = process.env['ACC_VALIDATION_PROFILE_ID']?.trim() || 'connector-live'

  const sqlManager = new SqlConnectionManager()
  const discoveryService = new SchemaDiscoveryService()

  try {
    const health = await sqlManager.getHealthCheck(connection)

    const catalog = await discoveryService.discoverCatalog({
      profileId,
      databaseName: connection.database,
      softwareOverrideId: selectedSoftwareOverride,
      executeSql: async (query: string) => {
        return sqlManager.executeReadOnlyQuery(connection, query, 'discovery')
      }
    })

    const effectiveSoftware = resolveEffectiveSoftware(catalog)
    const readiness = summarizeConnectorValidationReadiness({
      suggestedMappings: catalog.suggestedMappings,
      selectedMappings: catalog.selectedMappings,
      detectedSoftware: catalog.detectedSoftware ?? null
    })
    const issues = validateCatalog({
      catalog,
      expectedSoftware,
      expectedDateMode,
      minConfidence,
      requireReadOnly,
      isReadOnlyLogin: health.isReadOnly
    })

    console.log('[connector-live] SQL health')
    console.log(`  serverVersion: ${health.serverVersion}`)
    console.log(`  databaseName: ${health.databaseName}`)
    console.log(`  loginUser: ${health.loginUser}`)
    console.log(`  readOnly: ${health.isReadOnly}`)
    console.log(`  writeCapabilities: ${health.writeCapabilities.join(', ') || '(none)'}`)

    console.log('[connector-live] discovery summary')
    console.log(`  discoveredAt: ${catalog.discoveredAt}`)
    console.log(`  includedTables: ${catalog.includedTables}/${catalog.totalTables}`)
    console.log(`  sampledTables: ${catalog.sampledTables}`)
    console.log(`  detectedDateMode: ${catalog.detectedDateMode ?? 'unknown'}`)
    console.log(
      `  effectiveSoftware: ${effectiveSoftware.id ?? 'unknown'} (source=${effectiveSoftware.source}, confidence=${
        effectiveSoftware.confidence !== null ? effectiveSoftware.confidence.toFixed(2) : 'n/a'
      })`
    )
    console.log(`[connector-live] readiness summary: ${readiness.summaryText}`)
    const candidateText = (catalog.softwareCandidates ?? [])
      .slice(0, 4)
      .map((candidate) => `${candidate.id}:${candidate.confidence.toFixed(2)}`)
      .join(' | ')
    console.log(`  softwareCandidates: ${candidateText || '(none)'}`)

    const conceptRows = Object.entries(catalog.suggestedMappings)
      .map(([concept, suggestions]) => {
        const topSuggestion = suggestions?.[0] ?? '(none)'
        return `${concept} -> ${topSuggestion}`
      })
      .slice(0, 12)

    if (conceptRows.length > 0) {
      console.log('[connector-live] top concept suggestions')
      for (const line of conceptRows) {
        console.log(`  ${line}`)
      }
    }

    const info = issues.filter((item) => item.level === 'info')
    const warnings = issues.filter((item) => item.level === 'warn')
    const errors = issues.filter((item) => item.level === 'error')

    for (const issue of info) {
      console.log(`[info] ${issue.message}`)
    }

    for (const issue of warnings) {
      console.log(`[warn] ${issue.message}`)
    }

    for (const issue of errors) {
      console.log(`[error] ${issue.message}`)
    }

    if (errors.length > 0) {
      throw new Error(`Connector live validation failed with ${errors.length} error(s).`)
    }

    console.log('[connector-live] validation passed.')
  } finally {
    await sqlManager.close()
  }
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false

if (isDirectExecution) {
  void main().catch((error) => {
    printUsage()
    console.error('[connector-live] validation failed.')
    console.error(error)
    process.exitCode = 1
  })
}
