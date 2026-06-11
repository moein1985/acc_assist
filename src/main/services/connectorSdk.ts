import { createHash } from 'node:crypto'

import type { AccountingConceptKey, AccountingSoftwareId } from '../../shared/contracts'

export interface ConnectorPreset {
  id: AccountingSoftwareId
  name: string
  detectionPatterns: RegExp[]
  conceptPatterns: Partial<Record<AccountingConceptKey, RegExp[]>>
}

export interface ConnectorCoverageSummary {
  coveredConcepts: AccountingConceptKey[]
  missingConcepts: AccountingConceptKey[]
  coverageScore: number
  validationHints: string[]
}

export interface ConnectorReadinessSummary {
  coverageScore: number
  suggestedCount: number
  selectedCount: number
  status: 'ready' | 'needs-review' | 'unknown'
  summaryText: string
}

export interface ConnectorDetectionCandidate {
  id: AccountingSoftwareId
  name: string
  score: number
  confidence: number
  matchedDetectionPatterns: number
  matchedConcepts: AccountingConceptKey[]
  coverage: ConnectorCoverageSummary
}

export interface ConnectorSchemaFingerprint {
  tableRefCount: number
  normalizedTokenCount: number
  signature: string
}

const DEFAULT_MIN_DETECTION_SCORE = 6

const ALL_ACCOUNTING_CONCEPTS: AccountingConceptKey[] = [
  'accounts',
  'documents',
  'documentLines',
  'counterparties',
  'cashTransactions',
  'costCenters',
  'projects',
  'banks',
  'pettyCash'
]

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

export function buildConnectorReadinessSummary(params: {
  suggestedMappings?: Partial<Record<AccountingConceptKey, string[]>>
  selectedMappings?: Partial<Record<AccountingConceptKey, string>>
  detectedSoftware?: {
    coverage?: ConnectorCoverageSummary
    confidence?: number | null
  } | null
}): ConnectorReadinessSummary {
  const suggestedMappings = params.suggestedMappings ?? {}
  const selectedMappings = params.selectedMappings ?? {}
  const coverage = params.detectedSoftware?.coverage ?? buildMappingCoverageSummary('Connector', suggestedMappings, selectedMappings)
  const suggestedCount = Object.values(suggestedMappings).reduce((sum, values) => sum + values.filter(Boolean).length, 0)
  const selectedCount = Object.values(selectedMappings).filter((value) => typeof value === 'string' && value.trim()).length
  const confidence = params.detectedSoftware?.confidence ?? 0

  let status: ConnectorReadinessSummary['status'] = 'unknown'
  if (coverage.coverageScore >= 80 && confidence >= 0.8) {
    status = 'ready'
  } else if (coverage.coverageScore > 0 || selectedCount > 0 || suggestedCount > 0) {
    status = 'needs-review'
  }

  const summaryText =
    `پوشش نگاشت: ${coverage.coverageScore}% | پیشنهادها: ${suggestedCount} | انتخاب‌ها: ${selectedCount} | وضعیت: ${status === 'ready' ? 'آماده' : status === 'needs-review' ? 'نیاز به بازبینی' : 'ناشناخته'}`

  return {
    coverageScore: coverage.coverageScore,
    suggestedCount,
    selectedCount,
    status,
    summaryText
  }
}

export function buildMappingCoverageSummary(
  presetName: string,
  suggestedMappings: Partial<Record<AccountingConceptKey, string[]>>,
  selectedMappings: Partial<Record<AccountingConceptKey, string>>
): ConnectorCoverageSummary {
  const coveredConcepts = ALL_ACCOUNTING_CONCEPTS.filter((conceptKey) => {
    const suggestion = suggestedMappings[conceptKey]?.find((value) => value.trim().length > 0)
    const selection = selectedMappings[conceptKey]?.trim()
    return Boolean(selection || suggestion)
  })

  const missingConcepts = ALL_ACCOUNTING_CONCEPTS.filter((conceptKey) => !coveredConcepts.includes(conceptKey))
  const coverageScore = Math.round((coveredConcepts.length / ALL_ACCOUNTING_CONCEPTS.length) * 100)

  const validationHints = [
    `پوشش نگاشت برای ${presetName}: ${coveredConcepts.length}/${ALL_ACCOUNTING_CONCEPTS.length} مفهوم شناسایی شد.`,
    'برای هر مفهوم بدون نگاشت، پیشنهاد یا انتخاب دستی را بررسی کنید.'
  ]

  if (missingConcepts.length > 0) {
    validationHints.push(`کمبودهای پیشنهادی: ${missingConcepts.join(', ')}.`)
  }

  return {
    coveredConcepts,
    missingConcepts,
    coverageScore,
    validationHints
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

  const uniqueMatchedConcepts = [...new Set(matchedConcepts)]
  const missingConcepts = ALL_ACCOUNTING_CONCEPTS.filter((conceptKey) => !uniqueMatchedConcepts.includes(conceptKey))
  const coverageScore = Math.round((uniqueMatchedConcepts.length / ALL_ACCOUNTING_CONCEPTS.length) * 100)

  const coverage = buildMappingCoverageSummary(
    preset.name,
    Object.fromEntries(uniqueMatchedConcepts.map((conceptKey) => [conceptKey, [conceptKey]])) as Partial<Record<AccountingConceptKey, string[]>>,
    {}
  )

  const validationHints = [
    `Detected ${uniqueMatchedConcepts.length}/${ALL_ACCOUNTING_CONCEPTS.length} core accounting concepts for ${preset.name}.`
  ]

  if (missingConcepts.length > 0) {
    validationHints.push(`Manual mapping is recommended for: ${missingConcepts.join(', ')}.`)
  }

  if (uniqueMatchedConcepts.length === 0) {
    validationHints.push('No concept mapping evidence matched the current schema fingerprint.')
  }

  return {
    id: preset.id,
    name: preset.name,
    score,
    confidence: 0,
    matchedDetectionPatterns,
    matchedConcepts: uniqueMatchedConcepts,
    coverage: {
      coveredConcepts: coverage.coveredConcepts,
      missingConcepts: coverage.missingConcepts,
      coverageScore,
      validationHints: [...validationHints, ...coverage.validationHints]
    }
  }
}
