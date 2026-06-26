import { normalizePersianText } from './textNormalization'

export type FinancialIntentId =
  | 'count_fiscal_years'
  | 'list_fiscal_years'
  | 'get_party_balance'
  | 'get_account_balance'
  | 'get_account_turnover'
  | 'get_cash_bank_balance'
  | 'get_trial_balance'
  | 'get_sales_summary_by_period'
  | 'get_purchase_summary'
  | 'get_receivables_summary'
  | 'get_payables_summary'
  | 'get_cashflow_summary'
  | 'get_recent_or_suspicious_documents'

type FinancialIntentResponseMode = 'deterministic' | 'model-assisted'

export type FinancialIntentSlot =
  | 'partyName'
  | 'accountCodeOrName'
  | 'dateRange'
  | 'fiscalYear'
  | 'period'

/**
 * A single weighted detection signal. The weight expresses how strongly a match
 * contributes to an intent's absolute score (anchors are intent-defining, support
 * signals are weak corroboration).
 */
export type WeightedSignal = {
  pattern: RegExp
  weight: number
}

export type FinancialIntentDefinition = {
  id: FinancialIntentId
  description: string
  responseMode: FinancialIntentResponseMode
  requiredSlots: FinancialIntentSlot[]
  patterns: RegExp[]
  /** Strong, intent-defining signals. When omitted, `patterns` are used as weight-1 anchors. */
  anchors?: WeightedSignal[]
  /** Weak corroborating signals that boost confidence but do not gate selection on their own. */
  support?: WeightedSignal[]
  /** Hard negative guards. Any match forces the intent score to 0 (disambiguation). */
  exclude?: RegExp[]
  /** Absolute acceptance threshold for the weighted engine. Defaults to 1 when omitted. */
  minScore?: number
  isGoldenFastPath?: boolean
  targetTables?: string[]
  requiredScopeFilters?: string[]
  aggregate?: string
  projection?: string[]
}

export type FinancialIntentSlotHints = Partial<Record<FinancialIntentSlot, string>>

export type FinancialIntentMatch = {
  intentId: FinancialIntentId
  confidence: number
}

export type SalesKpiContractId = 'gross_sales' | 'net_sales' | 'booked_sales'

export type SalesKpiContractDefinition = {
  id: SalesKpiContractId
  label: string
  description: string
  aliases: RegExp[]
}

export type SalesKpiContractDetectionResult = {
  contractIds: SalesKpiContractId[]
  isAmbiguous: boolean
}

const SALES_KPI_CONTRACT_REGISTRY: SalesKpiContractDefinition[] = [
  {
    id: 'gross_sales',
    label: 'فروش ناخالص',
    description: 'فروش بدون کسر تخفیف و برگشت فروش',
    aliases: [/فروش\s*ناخالص|gross\s*sales|gross_sales/iu, /ناخالص\s*فروش/iu]
  },
  {
    id: 'net_sales',
    label: 'فروش خالص',
    description: 'فروش پس از کسر تخفیف و برگشت فروش',
    aliases: [/فروش\s*خالص|net\s*sales|net_sales/iu, /خالص\s*فروش/iu]
  },
  {
    id: 'booked_sales',
    label: 'فروش دفتری',
    description: 'فروش ثبت‌شده در اسناد حسابداری',
    aliases: [/فروش\s*دفتری|booked\s*sales|booked_sales/iu, /دفتری\s*فروش/iu]
  }
]

const FINANCIAL_INTENT_REGISTRY: FinancialIntentDefinition[] = [
  {
    id: 'count_fiscal_years',
    description: 'Count distinct fiscal years in the active database. [DEPRECATED: superseded by FRE metric fiscal_year_count — retained as rollback safety net]',
    responseMode: 'deterministic',
    requiredSlots: [],
    isGoldenFastPath: true,
    targetTables: ['documents'],
    requiredScopeFilters: ['fiscal_year'],
    aggregate: 'COUNT(DISTINCT fiscal_year)',
    projection: ['fiscal_year'],
    patterns: [
      /\bhow\s+many\s+fiscal\s+years\b/iu,
      /\bfiscal\s+year\s+count\b/iu,
      /\bcount\s+of\s+fiscal\s+years\b/iu,
      /(?:تعداد|چند)\s*سال\s*مالی/iu,
      /سال\s*مالی\s*(?:چند|تعداد)/iu,
      /\b(?:how\s+many|what\s+is\s+the\s+count)\s+(?:fiscal\s+)?years?\b/iu,
      /\b(?:count|number)\s+of\s+(?:fiscal\s+)?years?\b/iu
    ]
  },
  {
    id: 'list_fiscal_years',
    description: 'List fiscal years in the active database. [DEPRECATED: superseded by FRE metric fiscal_year_list — retained as rollback safety net]',
    responseMode: 'deterministic',
    requiredSlots: [],
    isGoldenFastPath: true,
    targetTables: ['documents'],
    requiredScopeFilters: ['fiscal_year'],
    aggregate: 'COUNT(DISTINCT fiscal_year)',
    projection: ['fiscal_year'],
    patterns: [
      /\b(?:list|show|display|find)\s+(?:the\s+)?(?:of\s+)?(?:available\s+)?fiscal\s+years\b/iu,
      /\bfiscal\s+years?\s+(?:available|list|show|display)\b/iu,
      /\bshow\s+the\s+fiscal\s+years\s+available\b/iu,
      /(?:لیست|فهرست|نمایش)\s*(?:سال(?:\s|\u200c)?های?|سال)\s*مالی/iu,
      /سال(?:\s|\u200c)?های?\s*مالی\s*را\s*(?:لیست|فهرست|نمایش)/iu,
      /(?:لیست|فهرست|نمایش)\s*(?:سال(?:\s|\u200c)?های?|سال)\s*مالی\s*(?:از|تا|موجود|در\s*دیتابیس)/iu,
      /سال(?:\s|\u200c)?های?\s*مالی\s*(?:از\s*\d{4}\s*تا\s*\d{4})/iu,
      /\b(?:available|existing|present)\s+(?:fiscal\s+)?years?\b/iu,
      /\b(?:لیست|فهرست|نمایش)\s+سال\s*های?\s*مالی\s*(?:موجود|در\s*دیتابیس)?\b/iu
    ]
  },
  {
    id: 'get_party_balance',
    description: 'Return balance for a person/counterparty. [DEPRECATED: superseded by FRE metric party_balance — retained as rollback safety net]',
    responseMode: 'deterministic',
    requiredSlots: ['partyName'],
    patterns: [
      /مانده\s*(?:شخص|طرف\s*حساب|مشتری|فروشنده|شریک)/iu,
      /\bparty\s+balance\b/iu,
      /\bcounterparty\s+balance\b/iu,
      /\b(?:balance|مانده)\s+(?:of\s+)?(?:party|counterparty|customer|vendor)\b/iu,
      /\b(?:party|counterparty|customer|vendor)\s+(?:balance|مانده)\b/iu,
      /\bمانده\s+طرف\s*حساب\b/iu
    ]
  },
  {
    id: 'get_account_balance',
    description: 'Return balance for an account/chart item from ACC.Voucher/ACC.VoucherItem. [DEPRECATED: superseded by FRE metric account_balance — retained as rollback safety net]',
    responseMode: 'deterministic',
    requiredSlots: ['accountCodeOrName'],
    isGoldenFastPath: true,
    targetTables: ['ACC.Voucher', 'ACC.VoucherItem'],
    requiredScopeFilters: ['account_id', 'fiscal_year'],
    aggregate: 'SUM(Debit) - SUM(Credit)',
    projection: ['AccountRef', 'AccountSLRef', 'Debit', 'Credit'],
    patterns: [
      /مانده\s*(?:بدهکار|بستانکار|خالص)?\s*(?:حساب|سرفصل|تنخواه|معین|تفضیلی)/iu,
      /\baccount\s+balance\b/iu,
      /\bbalance\s+of\s+(?:account|ledger|chart)\b/iu,
      /\b(?:ledger|chart)\s+(?:balance|مانده)\b/iu,
      /\b(?:حساب|سرفصل|معین|تفضیلی)\s+(?:مانده|balance)\b/iu
    ]
  },
  {
    id: 'get_account_turnover',
    description: 'Return account turnover in a date range. [DEPRECATED: superseded by FRE metric account_turnover — retained as rollback safety net]',
    responseMode: 'model-assisted',
    requiredSlots: ['accountCodeOrName', 'dateRange'],
    patterns: [/گردش\s*حساب/iu, /\baccount\s+turnover\b/iu]
  },
  {
    id: 'get_cash_bank_balance',
    description: 'Return cash and bank account balances from RPA.CashBalance and RPA.BankAccountBalance. [DEPRECATED: superseded by FRE metric cash_bank_balance — retained as rollback safety net]',
    responseMode: 'deterministic',
    requiredSlots: ['fiscalYear'],
    isGoldenFastPath: true,
    targetTables: ['RPA.CashBalance', 'RPA.BankAccountBalance'],
    requiredScopeFilters: ['fiscal_year'],
    aggregate: 'SUM(Balance)',
    projection: ['Balance', 'FiscalYearRef'],
    patterns: [
      /مانده\s*(?:نقد|صندوق|کش|کیش|بانک|حساب\s*بانکی)/iu,
      /\b(?:cash|bank)\s+balance\b/iu,
      /\bbalance\s+(?:of\s+)?(?:cash|bank)\b/iu
    ]
  },
  {
    id: 'get_trial_balance',
    description: 'Return trial balance (sum of debit/credit by account) from ACC.VoucherItem. [DEPRECATED: superseded by FRE metric trial_balance — retained as rollback safety net]',
    responseMode: 'deterministic',
    requiredSlots: ['fiscalYear'],
    isGoldenFastPath: true,
    targetTables: ['ACC.Voucher', 'ACC.VoucherItem'],
    requiredScopeFilters: ['fiscal_year'],
    aggregate: 'SUM(Debit), SUM(Credit)',
    projection: ['AccountRef', 'AccountSLRef', 'Debit', 'Credit'],
    patterns: [
      /تراز\s*آزمایشی/iu,
      /\btrial\s+balance\b/iu,
      /بدهکار\s*بستانکار\s*حساب‌ها/iu
    ]
  },
  {
    id: 'get_sales_summary_by_period',
    description: 'Return monthly/quarterly/yearly sales summary from the sales facts table. [DEPRECATED: superseded by FRE metric sales_by_period — retained as rollback safety net]',
    responseMode: 'model-assisted',
    requiredSlots: ['period'],
    targetTables: ['MRP.SaleFacts'],
    patterns: [/فروش\s*(?:ماهانه|فصلی|سالانه)/iu, /\bsales\s+summary\b/iu],
    anchors: [
      // Standalone فروش (sales), but NOT the compound words فروشگاه (store) or فروشنده/فروشندگان (seller).
      { pattern: /فروش(?!گاه|نده|ند)/iu, weight: 3 },
      { pattern: /\bsales\b|\brevenue\b/iu, weight: 3 },
      { pattern: /فاکتور\s*فروش|\bsale\s+invoice\b/iu, weight: 2 }
    ],
    support: [{ pattern: /(?:ماهانه|فصلی|سالانه|monthly|quarterly|yearly)/iu, weight: 1 }],
    exclude: [/برگشت\s*از\s*فروش/iu, /\bsales\s+returns?\b/iu],
    minScore: 3
  },
  {
    id: 'get_purchase_summary',
    description:
      'Return purchase summary. Fallback from POM.PurchaseInvoice to INV.InventoryReceipt (non-returns). [DEPRECATED: superseded by FRE metric purchases — retained as rollback safety net]',
    responseMode: 'deterministic',
    requiredSlots: ['period'],
    isGoldenFastPath: true,
    targetTables: ['POM.PurchaseInvoice', 'INV.InventoryReceipt'],
    requiredScopeFilters: ['fiscal_year'],
    patterns: [/خرید(?!ار)/iu, /\bpurchase\b/iu, /رسید\s*انبار/iu],
    anchors: [
      // Standalone خرید (purchase), but NOT خریدار/خریداران (buyer).
      { pattern: /خرید(?!ار)/iu, weight: 3 },
      { pattern: /\bpurchase\b|\bprocurement\b/iu, weight: 3 },
      // Inventory receipt vouchers ARE the purchase signal in this business process.
      { pattern: /رسید\s*انبار|\bgoods?\s*receipts?\b/iu, weight: 3 },
      { pattern: /فاکتور\s*خرید|\bpurchase\s+invoice\b/iu, weight: 2 }
    ],
    support: [{ pattern: /(?:ماهانه|فصلی|سالانه|monthly|quarterly|yearly)/iu, weight: 1 }],
    exclude: [/برگشت\s*از\s*خرید/iu, /\bpurchase\s+returns?\b/iu],
    minScore: 3
  },
  {
    id: 'get_receivables_summary',
    description: 'Return receivables summary. [DEPRECATED: superseded by FRE metric receivables — retained as rollback safety net]',
    responseMode: 'deterministic',
    requiredSlots: [],
    isGoldenFastPath: true,
    targetTables: ['accounts', 'documents'],
    requiredScopeFilters: ['fiscal_year'],
    aggregate: 'SUM(balance)',
    projection: ['account_name', 'balance'],
    patterns: [
      /\breceivables\b/iu,
      /\b(?:accounts?\s*receivable|debtors?)\b/iu,
      /(?:بدهکاران|دریافتنی|دریافتنی‌ها|دریافتنی ها)/iu,
      /(?:جمع|مجموع|خلاصه)\s*(?:بدهکاران|دریافتنی)/iu,
      /بدهکاران\s+ماهانه/iu
    ]
  },
  {
    id: 'get_payables_summary',
    description: 'Return payables summary. [DEPRECATED: superseded by FRE metric payables — retained as rollback safety net]',
    responseMode: 'deterministic',
    requiredSlots: [],
    isGoldenFastPath: true,
    targetTables: ['accounts', 'documents'],
    requiredScopeFilters: ['fiscal_year'],
    aggregate: 'SUM(balance)',
    projection: ['account_name', 'balance'],
    patterns: [
      /\bpayables\b/iu,
      /\b(?:accounts?\s*payable|creditors?)\b/iu,
      /(?:بستانکاران|پرداختنی|پرداختنی‌ها|پرداختنی ها|به\s*پرداخت)/iu,
      /(?:جمع|مجموع|خلاصه)\s*(?:بستانکاران|پرداختنی)/iu,
      /بستانکاران\s+(?:این\s+)?ماه/iu
    ]
  },
  {
    id: 'get_cashflow_summary',
    description: 'Return cashflow summary. [DEPRECATED: superseded by FRE metric cashflow — retained as rollback safety net]',
    responseMode: 'deterministic',
    requiredSlots: ['dateRange'],
    patterns: [
      /جریان\s*نقد/iu,
      /جریان\s*وجه/iu,
      /\bcash\s*flow\b/iu,
      /\bcashflow\b/iu,
      /\b(?:خلاصه|جمع|مجموع)\s*(?:جریان\s*نقد|جریان\s*وجه|cashflow)\b/iu,
      /\b(?:cash|cashflow)\s+(?:summary|overview)\b/iu
    ]
  },
  {
    id: 'get_recent_or_suspicious_documents',
    description: 'Return recent or suspicious accounting documents. [DEPRECATED: superseded by FRE metric recent_documents — retained as rollback safety net]',
    responseMode: 'model-assisted',
    requiredSlots: [],
    patterns: [/اسناد\s*(?:اخیر|مشکوک)/iu, /\b(?:recent|suspicious)\s+documents\b/iu]
  }
]

export function listFinancialIntentDefinitions(): FinancialIntentDefinition[] {
  return FINANCIAL_INTENT_REGISTRY.map((entry) => {
    const copy: FinancialIntentDefinition = { ...entry, patterns: [...entry.patterns] }
    if (entry.anchors) {
      copy.anchors = entry.anchors.map((signal) => ({ ...signal }))
    }
    if (entry.support) {
      copy.support = entry.support.map((signal) => ({ ...signal }))
    }
    if (entry.exclude) {
      copy.exclude = [...entry.exclude]
    }
    return copy
  })
}

export function listSalesKpiContracts(): SalesKpiContractDefinition[] {
  return SALES_KPI_CONTRACT_REGISTRY.map((entry) => ({ ...entry, aliases: [...entry.aliases] }))
}

export function detectSalesKpiContractCandidates(prompt: string): SalesKpiContractDetectionResult {
  const normalizedPrompt = normalizeFinancialIntentPrompt(prompt)

  if (!normalizedPrompt) {
    return { contractIds: [], isAmbiguous: false }
  }

  const explicitMatches = SALES_KPI_CONTRACT_REGISTRY.filter((entry) =>
    entry.aliases.some((alias) => alias.test(normalizedPrompt))
  )

  if (explicitMatches.length > 0) {
    return {
      contractIds: explicitMatches.map((entry) => entry.id),
      isAmbiguous: false
    }
  }

  const hasSalesSignal = /(?:فروش|sales|revenue)/iu.test(normalizedPrompt)
  const hasAnnualSignal = /(?:سالانه|annual|yearly)/iu.test(normalizedPrompt)

  if (hasSalesSignal && hasAnnualSignal) {
    return {
      contractIds: SALES_KPI_CONTRACT_REGISTRY.map((entry) => entry.id),
      isAmbiguous: true
    }
  }

  return { contractIds: [], isAmbiguous: false }
}

function normalizeFinancialIntentPrompt(prompt: string): string {
  return normalizePersianText(prompt)
}

export function extractFinancialIntentSlots(prompt: string): FinancialIntentSlotHints {
  const normalizedPrompt = normalizeFinancialIntentPrompt(prompt)
  const slots: FinancialIntentSlotHints = {}

  if (/(?:حساب|سرفصل|ledger|account)/iu.test(normalizedPrompt)) {
    slots.accountCodeOrName = 'detected'
  }

  if (/(?:طرف\s*حساب|شخص|party|counterparty)/iu.test(normalizedPrompt)) {
    slots.partyName = 'detected'
  }

  if (/(?:بازه|از\s+.*\s+تا|to\s+\d{4}|between\s+\d{4})/iu.test(normalizedPrompt)) {
    slots.dateRange = 'detected'
  }

  if (/(?:سال\s*مالی|fiscal\s*year)/iu.test(normalizedPrompt)) {
    slots.fiscalYear = 'detected'
  }

  if (/(?:ماهانه|فصلی|سالانه|monthly|quarterly|yearly)/iu.test(normalizedPrompt)) {
    slots.period = 'detected'
  }

  return slots
}

function resolveIntentAnchors(definition: FinancialIntentDefinition): WeightedSignal[] {
  if (definition.anchors && definition.anchors.length > 0) {
    return definition.anchors
  }

  // Backward-compatible fallback: treat each legacy pattern as a weight-1 anchor.
  return definition.patterns.map((pattern) => ({ pattern, weight: 1 }))
}

function resolveIntentMinScore(definition: FinancialIntentDefinition): number {
  if (typeof definition.minScore === 'number' && definition.minScore > 0) {
    return definition.minScore
  }

  return 1
}

/**
 * Absolute, additive intent scorer. A hard negative guard (`exclude`) short-circuits
 * the score to 0; otherwise anchor and support weights are summed. This is the core
 * fix for the ratio penalty: the score is an absolute sum, never divided by the number
 * of patterns, so well-specified intents are no longer penalized for having many signals.
 *
 * Expects already-normalized text (see `normalizePersianText`).
 */
export function scoreIntent(normalizedText: string, definition: FinancialIntentDefinition): number {
  if (!normalizedText) {
    return 0
  }

  if (definition.exclude?.some((pattern) => pattern.test(normalizedText))) {
    return 0
  }

  let anchorScore = 0

  for (const { pattern, weight } of resolveIntentAnchors(definition)) {
    if (pattern.test(normalizedText)) {
      anchorScore += weight
    }
  }

  // Support signals are weak corroboration only; they never stand in for an anchor.
  // Without at least one anchor hit the intent is not a candidate, so support is ignored.
  if (anchorScore === 0) {
    return 0
  }

  let score = anchorScore

  for (const { pattern, weight } of definition.support ?? []) {
    if (pattern.test(normalizedText)) {
      score += weight
    }
  }

  return score
}

/**
 * Score every registered intent against the prompt and return all candidates that clear
 * their acceptance threshold, ranked by confidence (descending). Ties preserve registry
 * order because `Array.prototype.sort` is stable, so the first element is always the
 * deterministic winner — exactly what `detectFinancialIntent` returns. The FSM uses the
 * full ranked list to detect genuine ambiguity (two distinct intents tied at the top).
 *
 * The weighted engine is the single source of truth; the legacy ratio engine and its
 * `ACC_INTENT_SCORING` A/B flag were retired once the golden fixtures were green.
 */
export function scoreFinancialIntentCandidates(prompt: string): FinancialIntentMatch[] {
  const normalizedPrompt = normalizeFinancialIntentPrompt(prompt)

  if (!normalizedPrompt) {
    return []
  }

  const matches: FinancialIntentMatch[] = []

  for (const intent of FINANCIAL_INTENT_REGISTRY) {
    const rawScore = scoreIntent(normalizedPrompt, intent)
    const minScore = resolveIntentMinScore(intent)

    if (rawScore < minScore) {
      continue
    }

    // Squash the unbounded additive score into a comparable 0..1 confidence.
    matches.push({
      intentId: intent.id,
      confidence: 1 - Math.exp(-rawScore / minScore)
    })
  }

  return matches.sort((a, b) => b.confidence - a.confidence)
}

export function detectFinancialIntent(prompt: string): FinancialIntentMatch | null {
  return scoreFinancialIntentCandidates(prompt)[0] ?? null
}