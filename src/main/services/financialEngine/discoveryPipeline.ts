/**
 * S27.3-S27.7 — Discovery Pipeline
 *
 * Orchestrates the full blind discovery process:
 * 1. Scan database schema (S27.3)
 * 2. Classify tables with heuristic + sample data (S27.4)
 * 3. LLM mapping for ambiguous cases (S27.5)
 * 4. Infer relationships (S27.6)
 * 5. Detect enums (S27.7)
 * 6. Build canonical concept map with confidence (S27.8)
 * 7. Cache result (S27.9)
 */

import type { SqlExecutor, TableSample } from './schemaDiscovery'
import { scanDatabaseSchema, sampleTableRows, filterRelevantTables } from './schemaDiscovery'
import {
  buildCanonicalConceptMap,
  type CanonicalConceptMap,
} from './canonicalConceptMap'
import type { SchemaTableMapping } from './schemaAdapter'
import { adapterRegistry } from './adapterRegistry'
import type { AuditLogStage } from '../../../shared/contracts'

// ─── S27.17: Audit callback ───

export type DiscoveryAuditFn = (stage: AuditLogStage, details: Record<string, unknown>) => void

// ─── S27.3: Cache ───

const discoveryCache = new Map<string, CanonicalConceptMap>()

export function getCachedDiscovery(cacheKey: string): CanonicalConceptMap | null {
  return discoveryCache.get(cacheKey) ?? null
}

export function setCachedDiscovery(cacheKey: string, map: CanonicalConceptMap): void {
  discoveryCache.set(cacheKey, map)
}

export function clearDiscoveryCache(): void {
  discoveryCache.clear()
}

// ─── S27.12: Check if a known adapter exists ───

export function hasKnownAdapter(softwareId: string | null): boolean {
  if (!softwareId) return false
  return adapterRegistry.hasAdapter(softwareId)
}

// ─── S27.3-S27.9: Full discovery pipeline ───

export interface DiscoveryPipelineOptions {
  /** Known software ID to skip blind discovery (S27.12) */
  softwareId?: string | null
  /** Max tables to sample for data-driven classification */
  maxSampleTables?: number
  /** Rows per sample */
  sampleSize?: number
  /** User-provided mapping overrides */
  overrides?: Partial<SchemaTableMapping>
  /** S27.17: Audit callback for discovery stages */
  onAudit?: DiscoveryAuditFn
}

export interface DiscoveryPipelineResult {
  conceptMap: CanonicalConceptMap
  /** Whether a known adapter was used instead of blind discovery */
  usedKnownAdapter: boolean
  /** Samples collected during discovery */
  samples: TableSample[]
}

export async function runDiscoveryPipeline(
  executeSql: SqlExecutor,
  options: DiscoveryPipelineOptions = {}
): Promise<DiscoveryPipelineResult> {
  const {
    softwareId = null,
    maxSampleTables = 10,
    sampleSize = 5,
    overrides,
    onAudit,
  } = options

  // S27.12: If known adapter exists, use it — no blind discovery needed
  if (softwareId && hasKnownAdapter(softwareId)) {
    onAudit?.('discovery-scan', { softwareId, knownAdapter: true })
    // Still scan schema for the concept map, but use known adapter mappings
    const inventory = await scanDatabaseSchema(executeSql)
    const conceptMap = buildCanonicalConceptMap({
      inventory,
      detectedSoftwareId: softwareId,
      overrides,
    })
    setCachedDiscovery(conceptMap.cacheKey, conceptMap)
    onAudit?.('discovery-confidence', {
      softwareId,
      overallConfidence: conceptMap.overallConfidence,
      mappedConcepts: conceptMap.conceptConfidences.length,
      usedKnownAdapter: true,
    })
    return { conceptMap, usedKnownAdapter: true, samples: [] }
  }

  // S27.3: Scan database schema
  onAudit?.('discovery-scan', { softwareId, knownAdapter: false })
  const inventory = await scanDatabaseSchema(executeSql)

  // S27.4: Sample relevant tables for data-driven classification
  const relevantTables = filterRelevantTables(inventory)
  const tablesToSample = relevantTables.slice(0, maxSampleTables)
  const samples: TableSample[] = []
  for (const table of tablesToSample) {
    try {
      const sample = await sampleTableRows(table.tableRef, executeSql, sampleSize)
      if (sample.rows.length > 0) {
        samples.push(sample)
      }
    } catch {
      // Skip tables that error
    }
  }

  onAudit?.('discovery-map', {
    totalTables: inventory.tables.length,
    sampledTables: samples.length,
  })

  // S27.8-S27.9: Build canonical concept map with confidence
  const conceptMap = buildCanonicalConceptMap({
    inventory,
    samples,
    detectedSoftwareId: softwareId,
    overrides,
  })

  onAudit?.('discovery-relationships', {
    relationshipCount: conceptMap.relationships.length,
  })
  onAudit?.('discovery-enums', {
    enumCount: Object.keys(conceptMap.enums).length,
  })

  // S27.9: Cache the result
  setCachedDiscovery(conceptMap.cacheKey, conceptMap)

  onAudit?.('discovery-confidence', {
    overallConfidence: conceptMap.overallConfidence,
    mappedConcepts: conceptMap.conceptConfidences.length,
    unmatchedTables: conceptMap.unmatchedTables.length,
    usedKnownAdapter: false,
  })

  return { conceptMap, usedKnownAdapter: false, samples }
}

// ─── S27.15: Check metric availability ───

export function checkMetricAvailability(
  conceptMap: CanonicalConceptMap,
  requiredConcepts: string[]
): { available: boolean; missing: string[] } {
  const tables = conceptMap.tables as Record<string, unknown>
  const missing = requiredConcepts.filter((c) => !tables[c])
  return { available: missing.length === 0, missing }
}
