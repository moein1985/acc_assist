/**
 * S34.8: Per-Deployment Verification Registry
 *
 * Migrates the flat registry (scripts/fixtures/metric-verification-registry.json)
 * to a per-deployment structure: Map<deploymentId, Map<metricId, VerificationRecord>>.
 *
 * The existing Sepidar01 registry is migrated under DEFAULT_DEPLOYMENT_ID.
 *
 * @see FRE_ROADMAP_34_PHASE34_CALIBRATION_RUNTIME_WIRING.fa.md S34.8
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DEFAULT_DEPLOYMENT_ID } from './chartOfAccountsMapping'

// ─── Types ───────────────────────────────────────────────────────────────────

export type VerificationStatus =
  | 'verified'
  | 'oracle_only'
  | 'unverified'
  | 'not_applicable'
  | 'needs_accountant_review'

export interface VerificationRecord {
  metricId: string
  tier: 'T1' | 'T2' | 'T3'
  status: VerificationStatus
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

export interface DeploymentRegistry {
  deploymentId: string
  records: Record<string, VerificationRecord>
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

const registries = new Map<string, DeploymentRegistry>()

// ─── Migration from flat registry ────────────────────────────────────────────

/**
 * S34.8: Load the flat registry from scripts/fixtures/metric-verification-registry.json
 * and migrate it to per-deployment format under DEFAULT_DEPLOYMENT_ID.
 *
 * This function is called once on first access. Subsequent calls use the cache.
 */
function migrateFlatRegistry(): DeploymentRegistry {
  const flatPath = join(__dirname, '..', '..', '..', '..', 'scripts', 'fixtures', 'metric-verification-registry.json')

  if (!existsSync(flatPath)) {
    return { deploymentId: DEFAULT_DEPLOYMENT_ID, records: {} }
  }

  const raw = readFileSync(flatPath, 'utf-8')
  const flatEntries: VerificationRecord[] = JSON.parse(raw)

  const records: Record<string, VerificationRecord> = {}
  for (const entry of flatEntries) {
    records[entry.metricId] = entry
  }

  return {
    deploymentId: DEFAULT_DEPLOYMENT_ID,
    records,
  }
}

/**
 * Get the registry for a specific deployment ID.
 * On first call for DEFAULT_DEPLOYMENT_ID, migrates from the flat registry.
 */
export function getDeploymentRegistry(deploymentId: string): DeploymentRegistry {
  if (!registries.has(deploymentId)) {
    if (deploymentId === DEFAULT_DEPLOYMENT_ID) {
      registries.set(deploymentId, migrateFlatRegistry())
    } else {
      registries.set(deploymentId, { deploymentId, records: {} })
    }
  }
  return registries.get(deploymentId)!
}

/**
 * Get a single verification record for a metric in a deployment.
 */
export function getVerificationRecord(
  deploymentId: string,
  metricId: string
): VerificationRecord | null {
  const reg = getDeploymentRegistry(deploymentId)
  return reg.records[metricId] ?? null
}

/**
 * Check if a metric is verified for a specific deployment.
 */
export function isMetricVerified(deploymentId: string, metricId: string): boolean {
  const record = getVerificationRecord(deploymentId, metricId)
  return record?.status === 'verified'
}

/**
 * Update or insert a verification record for a deployment.
 */
export function upsertVerificationRecord(
  deploymentId: string,
  record: VerificationRecord
): void {
  const reg = getDeploymentRegistry(deploymentId)
  reg.records[record.metricId] = record
}

/**
 * Save a deployment registry to disk (JSON file).
 */
export function saveDeploymentRegistry(
  deploymentId: string,
  outputDir?: string
): string {
  const reg = getDeploymentRegistry(deploymentId)
  const dir = outputDir ?? join(__dirname, '..', '..', '..', '..', 'config')
  const path = join(dir, `deployment-${deploymentId}.json`)

  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(path, JSON.stringify(reg, null, 2), 'utf-8')
  } catch {
    // Best-effort save — if it fails, the in-memory registry still works
  }

  return path
}

/**
 * Get a summary of verification status for a deployment.
 */
export function getDeploymentSummary(deploymentId: string): {
  total: number
  verified: number
  oracleOnly: number
  needsReview: number
  notApplicable: number
  unverified: number
} {
  const reg = getDeploymentRegistry(deploymentId)
  const records = Object.values(reg.records)

  return {
    total: records.length,
    verified: records.filter(r => r.status === 'verified').length,
    oracleOnly: records.filter(r => r.status === 'oracle_only').length,
    needsReview: records.filter(r => r.status === 'needs_accountant_review').length,
    notApplicable: records.filter(r => r.status === 'not_applicable').length,
    unverified: records.filter(r => r.status === 'unverified').length,
  }
}
