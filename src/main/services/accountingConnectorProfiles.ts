import type { AccountingConceptKey } from '../../shared/contracts'

export type AccountingSoftwareId = 'sepidar' | 'mahak'

export interface AccountingSoftwareDetectionCandidate {
  id: AccountingSoftwareId
  name: string
  score: number
  confidence: number
}

type AccountingConnectorProfile = {
  id: AccountingSoftwareId
  name: string
  detectionPatterns: RegExp[]
  conceptPatterns: Partial<Record<AccountingConceptKey, RegExp[]>>
}

const CONNECTOR_PROFILES: AccountingConnectorProfile[] = [
  {
    id: 'sepidar',
    name: 'Sepidar',
    detectionPatterns: [
      /\bacc_(documents?|documentitems?|accounts?|vouchers?)\b/i,
      /\bbas_(persons?|customers?|parties?)\b/i,
      /\btre_(cash|bank|payments?|receipts?)\b/i
    ],
    conceptPatterns: {
      accounts: [/\bacc_accounts?\b/i, /\bacc_chartofaccounts\b/i, /\bacc_ledger\b/i],
      documents: [/\bacc_documents?\b/i, /\bacc_vouchers?\b/i],
      documentLines: [/\bacc_documentitems?\b/i, /\bacc_documentlines?\b/i],
      counterparties: [/\bbas_persons?\b/i, /\bbas_customers?\b/i],
      cashTransactions: [/\btre_(cash|payments?|receipts?)\b/i, /\bcash_transactions?\b/i],
      costCenters: [/\bacc_costcenters?\b/i, /\bcost_centers?\b/i],
      projects: [/\bprj_projects?\b/i, /\bacc_projects?\b/i],
      banks: [/\btre_bank(accounts?|transactions?)\b/i, /\bbank_accounts?\b/i],
      pettyCash: [/\btre_pettycash\b/i, /\bpetty_cash\b/i, /\btan(kh|x)ah\b/i]
    }
  },
  {
    id: 'mahak',
    name: 'Mahak',
    detectionPatterns: [
      /\bsanad\b/i,
      /\bhesab(kol|moin|tafzil(i|y)|tafzili)?\b/i,
      /\b(ashkhas|daryaft|pardakht|markazhazine)\b/i
    ],
    conceptPatterns: {
      accounts: [/\bhesab(kol|moin|tafzil(i|y)|tafzili)\b/i, /\bchart_accounts?\b/i],
      documents: [/\bsanad(head|headers?)?\b/i, /\bvouchers?\b/i],
      documentLines: [/\bsanad(items?|lines?)\b/i, /\barticles?\b/i],
      counterparties: [/\bashkhas\b/i, /\btaraf(hesab)?\b/i, /\bcustomers?\b/i],
      cashTransactions: [/\b(daryaft|pardakht)\b/i, /\bcash(transactions?)?\b/i],
      costCenters: [/\bmarkazhazine\b/i, /\bcost_centers?\b/i],
      projects: [/\bproject(s)?\b/i, /\bproje(h)?\b/i],
      banks: [/\bbank(accounts?|transactions?)?\b/i, /\bcheques?\b/i],
      pettyCash: [/\bsandogh\b/i, /\bpetty_cash\b/i, /\btan(kh|x)ah\b/i]
    }
  }
]

const MIN_DETECTION_SCORE = 6

export function getAccountingConnectorProfile(id: AccountingSoftwareId): AccountingConnectorProfile | undefined {
  return CONNECTOR_PROFILES.find((profile) => profile.id === id)
}

export function detectAccountingSoftware(tableRefs: string[]): {
  primary: AccountingSoftwareDetectionCandidate | null
  candidates: AccountingSoftwareDetectionCandidate[]
} {
  const normalizedTableRefs = tableRefs.map((tableRef) => tableRef.trim().toLowerCase()).filter(Boolean)

  if (normalizedTableRefs.length === 0) {
    return {
      primary: null,
      candidates: []
    }
  }

  const scoredCandidates = CONNECTOR_PROFILES.map((profile) => {
    const score = calculateProfileScore(profile, normalizedTableRefs)

    return {
      id: profile.id,
      name: profile.name,
      score,
      confidence: 0
    } satisfies AccountingSoftwareDetectionCandidate
  })
    .filter((candidate) => candidate.score >= MIN_DETECTION_SCORE)
    .sort((left, right) => right.score - left.score)

  if (scoredCandidates.length === 0) {
    return {
      primary: null,
      candidates: []
    }
  }

  const topScore = scoredCandidates[0].score
  const normalizedCandidates = scoredCandidates.map((candidate) => ({
    ...candidate,
    confidence: Number((candidate.score / topScore).toFixed(2))
  }))

  return {
    primary: normalizedCandidates[0],
    candidates: normalizedCandidates
  }
}

export function scoreTableForSoftwareConcept(
  softwareId: AccountingSoftwareId | null | undefined,
  conceptKey: AccountingConceptKey,
  tableRef: string
): number {
  if (!softwareId) {
    return 0
  }

  const profile = getAccountingConnectorProfile(softwareId)

  if (!profile) {
    return 0
  }

  const conceptPatterns = profile.conceptPatterns[conceptKey] ?? []
  const normalizedTableRef = tableRef.trim().toLowerCase()

  if (!normalizedTableRef) {
    return 0
  }

  return conceptPatterns.some((pattern) => pattern.test(normalizedTableRef)) ? 6 : 0
}

function calculateProfileScore(profile: AccountingConnectorProfile, tableRefs: string[]): number {
  let score = 0

  for (const pattern of profile.detectionPatterns) {
    if (tableRefs.some((tableRef) => pattern.test(tableRef))) {
      score += 5
    }
  }

  for (const conceptKey of Object.keys(profile.conceptPatterns) as AccountingConceptKey[]) {
    const conceptPatterns = profile.conceptPatterns[conceptKey] ?? []

    if (conceptPatterns.some((pattern) => tableRefs.some((tableRef) => pattern.test(tableRef)))) {
      score += 2
    }
  }

  return score
}
