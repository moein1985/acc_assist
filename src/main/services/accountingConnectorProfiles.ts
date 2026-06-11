import type { AccountingConceptKey } from '../../shared/contracts'
import { detectConnectorByPresets, scoreTableForPresetConcept, type ConnectorPreset } from './connectorSdk'

export type AccountingSoftwareId = 'sepidar' | 'mahak'

export interface AccountingSoftwareDetectionCandidate {
  id: AccountingSoftwareId
  name: string
  score: number
  confidence: number
  matchedConcepts?: AccountingConceptKey[]
  coverage?: {
    coveredConcepts: AccountingConceptKey[]
    missingConcepts: AccountingConceptKey[]
    coverageScore: number
    validationHints: string[]
  }
}

type AccountingConnectorProfile = ConnectorPreset

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
  const detection = detectConnectorByPresets({
    presets: CONNECTOR_PROFILES,
    tableRefs,
    minScore: MIN_DETECTION_SCORE
  })

  return {
    primary: detection.primary,
    candidates: detection.candidates
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

  return scoreTableForPresetConcept(profile, conceptKey, tableRef)
}
