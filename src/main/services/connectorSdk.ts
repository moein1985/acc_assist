import { createHash } from 'node:crypto'

import type { AccountingConceptKey, AccountingSoftwareId } from '../../shared/contracts'

export interface ConnectorPreset {
  id: AccountingSoftwareId
  name: string
  detectionPatterns: RegExp[]
  conceptPatterns: Partial<Record<AccountingConceptKey, RegExp[]>>
}

export interface ConnectorDetectionCandidate {
  id: AccountingSoftwareId
  name: string
  score: number
  confidence: number
  matchedDetectionPatterns: number
  matchedConcepts: AccountingConceptKey[]
}

export interface ConnectorSchemaFingerprint {
  tableRefCount: number
  normalizedTokenCount: number
  signature: string
}

const DEFAULT_MIN_DETECTION_SCORE = 6

export function normalizeTableRefs(tableRefs: string[]): string[] {
  return tableRefs.map((tableRef) => tableRef.trim().toLowerCase()).filter(Boolean)
}

export function buildConnectorSchemaFingerprint(tableRefs: string[]): ConnectorSchemaFingerprint {
  const normalizedRefs = normalizeTableRefs(tableRefs)
  const sortedUniqueRefs = [...new Set(normalizedRefs)].sort((left, right) => left.localeCompare(right))
  const tokenSet = new Set<string>()

  for (const tableRef of sortedUniqueRefs) {
    const tokens = tableRef.split(/[^a-z0-9\u0600-\u06ff]+/iu).filter(Boolean)
    for (const token of tokens) {
      tokenSet.add(token)
    }
  }

  const signatureSource = `${sortedUniqueRefs.join('|')}::${[...tokenSet].sort((a, b) => a.localeCompare(b)).join('|')}`
  const signature = createHash('sha256').update(signatureSource).digest('hex').slice(0, 24)

  return {
    tableRefCount: sortedUniqueRefs.length,
    normalizedTokenCount: tokenSet.size,
    signature
  }
}

export function detectConnectorByPresets(params: {
  presets: ConnectorPreset[]
  tableRefs: string[]
  minScore?: number
}): {
  primary: ConnectorDetectionCandidate | null
  candidates: ConnectorDetectionCandidate[]
  fingerprint: ConnectorSchemaFingerprint
} {
  const minScore = params.minScore ?? DEFAULT_MIN_DETECTION_SCORE
  const normalizedTableRefs = normalizeTableRefs(params.tableRefs)
  const fingerprint = buildConnectorSchemaFingerprint(normalizedTableRefs)

  if (normalizedTableRefs.length === 0) {
    return {
      primary: null,
      candidates: [],
      fingerprint
    }
  }

  const scoredCandidates = params.presets
    .map((preset) => scorePreset(preset, normalizedTableRefs))
    .filter((candidate) => candidate.score >= minScore)
    .sort((left, right) => right.score - left.score)

  if (scoredCandidates.length === 0) {
    return {
      primary: null,
      candidates: [],
      fingerprint
    }
  }

  const topScore = scoredCandidates[0].score
  const candidates = scoredCandidates.map((candidate) => ({
    ...candidate,
    confidence: Number((candidate.score / topScore).toFixed(2))
  }))

  return {
    primary: candidates[0],
    candidates,
    fingerprint
  }
}

export function scoreTableForPresetConcept(
  preset: ConnectorPreset | null | undefined,
  conceptKey: AccountingConceptKey,
  tableRef: string
): number {
  if (!preset) {
    return 0
  }

  const conceptPatterns = preset.conceptPatterns[conceptKey] ?? []
  const normalizedTableRef = tableRef.trim().toLowerCase()

  if (!normalizedTableRef) {
    return 0
  }

  return conceptPatterns.some((pattern) => pattern.test(normalizedTableRef)) ? 6 : 0
}

function scorePreset(preset: ConnectorPreset, tableRefs: string[]): ConnectorDetectionCandidate {
  let score = 0
  let matchedDetectionPatterns = 0
  const matchedConcepts: AccountingConceptKey[] = []

  for (const pattern of preset.detectionPatterns) {
    if (tableRefs.some((tableRef) => pattern.test(tableRef))) {
      score += 5
      matchedDetectionPatterns += 1
    }
  }

  for (const conceptKey of Object.keys(preset.conceptPatterns) as AccountingConceptKey[]) {
    const conceptPatterns = preset.conceptPatterns[conceptKey] ?? []

    if (conceptPatterns.some((pattern) => tableRefs.some((tableRef) => pattern.test(tableRef)))) {
      score += 2
      matchedConcepts.push(conceptKey)
    }
  }

  return {
    id: preset.id,
    name: preset.name,
    score,
    confidence: 0,
    matchedDetectionPatterns,
    matchedConcepts
  }
}
