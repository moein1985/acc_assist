/**
 * S27.8-S27.9 — Canonical Concept Map
 *
 * Represents the result of blind schema discovery: a mapping from
 * canonical accounting concepts to physical tables/columns, with
 * per-concept confidence scores and a global discovery confidence.
 *
 * This is cached per-connection and persists across sessions.
 */

import type {
  AccountingConcept,
  AdapterConfidence,
  SchemaTableMapping,
  SchemaColumnMapping,
  SchemaRelationship,
  SchemaEnumMapping,
  TableRef,
} from './schemaAdapter'
import type { RawSchemaInventory, TableSample } from './schemaDiscovery'
import {
  heuristicMapTables,
  inferRelationships,
  detectEnums,
  buildAdapter,
} from './semanticMapping'
import type { SchemaAdapter } from './schemaAdapter'

// ─── S27.8: Per-concept confidence ───

export interface ConceptConfidenceEntry {
  concept: string
  tableRef: TableRef
  confidence: AdapterConfidence
  score: number
  matchedBy: 'heuristic' | 'llm' | 'user' | 'manual'
  notes?: string
}

export interface CanonicalConceptMap {
  /** Cache key: DB name + server version + schema hash */
  cacheKey: string
  /** When the discovery was performed */
  discoveredAt: string
  /** Overall confidence of the entire mapping */
  overallConfidence: AdapterConfidence
  /** Per-concept confidence entries */
  conceptConfidences: ConceptConfidenceEntry[]
  /** The table mapping (same structure as SchemaTableMapping) */
  tables: SchemaTableMapping
  /** The column mapping */
  columns: SchemaColumnMapping
  /** Relationships discovered */
  relationships: SchemaRelationship[]
  /** Enums detected */
  enums: SchemaEnumMapping
  /** Tables that could not be mapped to any concept */
  unmatchedTables: string[]
  /** Software ID if detected, null for unknown */
  detectedSoftwareId: string | null
}

// ─── S27.8: Confidence scoring ───

const CORE_CONCEPTS = ['voucher', 'voucherItem', 'account', 'fiscalYear']
const SUPPORTING_CONCEPTS = ['party', 'salesInvoice', 'purchaseInvoice', 'check', 'inventoryReceipt']

function scoreConcept(concept: string, tableRef: TableRef | undefined, inventory: RawSchemaInventory): number {
  if (!tableRef) return 0

  const tableInfo = inventory.tables.find(
    (t) => t.tableRef.schema === tableRef.schema && t.tableRef.table === tableRef.table
  )
  if (!tableInfo) return 0

  let score = 50 // Base score for having a table mapped

  // Bonus for having columns
  if (tableInfo.columns.length > 3) score += 15
  if (tableInfo.columns.length > 10) score += 5

  // Bonus for having a primary key
  if (tableInfo.columns.some((c) => c.isPrimaryKey)) score += 10

  // Bonus for having foreign keys
  if (tableInfo.foreignKeys.length > 0) score += 10

  // Bonus for row count (non-trivial table)
  if ((tableInfo.estimatedRowCount ?? 0) > 10) score += 10

  // Core concepts get extra weight
  if (CORE_CONCEPTS.includes(concept)) score += 0 // Already base 50

  return Math.min(100, score)
}

function overallConfidenceFromScores(entries: ConceptConfidenceEntry[]): AdapterConfidence {
  const coreMapped = entries.filter(
    (e) => CORE_CONCEPTS.includes(e.concept) && e.score >= 50
  ).length
  const supportingMapped = entries.filter(
    (e) => SUPPORTING_CONCEPTS.includes(e.concept) && e.score >= 50
  ).length

  if (coreMapped >= 4 && supportingMapped >= 2) return 'high'
  if (coreMapped >= 2) return 'medium'
  return 'low'
}

// ─── S27.9: Build canonical concept map from discovery ───

export interface BuildConceptMapInput {
  inventory: RawSchemaInventory
  samples?: TableSample[]
  detectedSoftwareId?: string | null
  /** Override heuristic with LLM-suggested or user-confirmed mappings */
  overrides?: Partial<SchemaTableMapping>
}

export function buildCanonicalConceptMap(input: BuildConceptMapInput): CanonicalConceptMap {
  const { inventory, samples, detectedSoftwareId = null, overrides } = input

  // Run heuristic mapping
  const heuristic = heuristicMapTables(inventory)

  // Apply overrides if provided
  const tables: SchemaTableMapping = { ...heuristic.tables, ...overrides }
  const columns = heuristic.columns

  // Infer relationships
  const relationships = inferRelationships(inventory, tables)

  // Detect enums
  const enums = detectEnums(inventory, tables, samples)

  // Build per-concept confidence entries
  const conceptConfidences: ConceptConfidenceEntry[] = []
  for (const [concept, tableRef] of Object.entries(tables)) {
    const isOverride = overrides && (overrides as Record<string, unknown>)[concept]
    const score = scoreConcept(concept, tableRef, inventory)
    conceptConfidences.push({
      concept,
      tableRef,
      confidence: score >= 80 ? 'high' : score >= 50 ? 'medium' : 'low',
      score,
      matchedBy: isOverride ? 'user' : 'heuristic',
    })
  }

  const overallConfidence = overallConfidenceFromScores(conceptConfidences)

  // Build cache key
  const tableCount = inventory.tables.length
  const cacheKey = [
    inventory.databaseName,
    inventory.serverVersion,
    tableCount,
    detectedSoftwareId ?? 'unknown',
  ].join('|')

  return {
    cacheKey,
    discoveredAt: new Date().toISOString(),
    overallConfidence,
    conceptConfidences,
    tables,
    columns,
    relationships,
    enums,
    unmatchedTables: heuristic.unmatched,
    detectedSoftwareId,
  }
}

// ─── S27.10: Build adapter from concept map ───

export function buildAdapterFromConceptMap(
  conceptMap: CanonicalConceptMap,
  softwareId: string,
  softwareName: string
): SchemaAdapter {
  return buildAdapter({
    softwareId,
    softwareName,
    tables: conceptMap.tables,
    columns: conceptMap.columns,
    relationships: conceptMap.relationships,
    enums: conceptMap.enums,
    confidence: conceptMap.overallConfidence,
  })
}

// ─── S27.10: Check if a concept is available ───

export function isConceptAvailable(conceptMap: CanonicalConceptMap, concept: AccountingConcept): boolean {
  const key = concept.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  const entries = conceptMap.tables as Record<string, TableRef | undefined>
  return !!(entries[key] ?? entries[concept])
}

// ─── S27.15: Get unavailable concepts ───

export function getUnavailableConcepts(
  conceptMap: CanonicalConceptMap,
  requiredConcepts: AccountingConcept[]
): AccountingConcept[] {
  return requiredConcepts.filter((c) => !isConceptAvailable(conceptMap, c))
}
