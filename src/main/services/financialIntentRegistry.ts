export type FinancialIntentId =
  | 'count_fiscal_years'
  | 'list_fiscal_years'
  | 'get_party_balance'
  | 'get_account_balance'
  | 'get_account_turnover'
  | 'get_sales_summary_by_period'
  | 'get_receivables_summary'
  | 'get_payables_summary'
  | 'get_cashflow_summary'
  | 'get_recent_or_suspicious_documents'

type FinancialIntentResponseMode = 'deterministic' | 'model-assisted'

type FinancialIntentSlot = 'partyName' | 'accountCodeOrName' | 'dateRange' | 'fiscalYear' | 'period'

export type FinancialIntentDefinition = {
  id: FinancialIntentId
  description: string
  responseMode: FinancialIntentResponseMode
  requiredSlots: FinancialIntentSlot[]
  patterns: RegExp[]
}

export type FinancialIntentSlotHints = Partial<Record<FinancialIntentSlot, string>>

export type FinancialIntentMatch = {
  intentId: FinancialIntentId
  confidence: number
}

const FINANCIAL_INTENT_REGISTRY: FinancialIntentDefinition[] = [
  {
    id: 'count_fiscal_years',
    description: 'Count distinct fiscal years in the active database.',
    responseMode: 'deterministic',
    requiredSlots: [],
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
    description: 'List fiscal years in the active database.',
    responseMode: 'deterministic',
    requiredSlots: [],
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
    description: 'Return balance for a person/counterparty.',
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
    description: 'Return balance for an account/chart item.',
    responseMode: 'deterministic',
    requiredSlots: ['accountCodeOrName'],
    patterns: [
      /مانده\s*(?:حساب|سرفصل|تنخواه|معین|تفضیلی)/iu,
      /\baccount\s+balance\b/iu,
      /\bbalance\s+of\s+(?:account|ledger|chart)\b/iu,
      /\b(?:ledger|chart)\s+(?:balance|مانده)\b/iu,
      /\b(?:حساب|سرفصل|معین|تفضیلی)\s+(?:مانده|balance)\b/iu
    ]
  },
  {
    id: 'get_account_turnover',
    description: 'Return account turnover in a date range.',
    responseMode: 'model-assisted',
    requiredSlots: ['accountCodeOrName', 'dateRange'],
    patterns: [/گردش\s*حساب/iu, /\baccount\s+turnover\b/iu]
  },
  {
    id: 'get_sales_summary_by_period',
    description: 'Return monthly/quarterly/yearly sales summary.',
    responseMode: 'model-assisted',
    requiredSlots: ['period'],
    patterns: [/فروش\s*(?:ماهانه|فصلی|سالانه)/iu, /\bsales\s+summary\b/iu]
  },
  {
    id: 'get_receivables_summary',
    description: 'Return receivables summary.',
    responseMode: 'deterministic',
    requiredSlots: [],
    patterns: [
      /\breceivables\b/iu,
      /\b(?:accounts?\s*receivable|debtors?)\b/iu,
      /(?:بدهکاران|دریافتنی|دریافتنی‌ها|دریافتنی ها)/iu,
      /(?:جمع|مجموع|خلاصه)\s*(?:بدهکاران|دریافتنی)/iu
    ]
  },
  {
    id: 'get_payables_summary',
    description: 'Return payables summary.',
    responseMode: 'deterministic',
    requiredSlots: [],
    patterns: [
      /\bpayables\b/iu,
      /\b(?:accounts?\s*payable|creditors?)\b/iu,
      /(?:بستانکاران|پرداختنی|پرداختنی‌ها|پرداختنی ها|به\s*پرداخت)/iu,
      /(?:جمع|مجموع|خلاصه)\s*(?:بستانکاران|پرداختنی)/iu
    ]
  },
  {
    id: 'get_cashflow_summary',
    description: 'Return cashflow summary.',
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
    description: 'Return recent or suspicious accounting documents.',
    responseMode: 'model-assisted',
    requiredSlots: [],
    patterns: [/اسناد\s*(?:اخیر|مشکوک)/iu, /\b(?:recent|suspicious)\s+documents\b/iu]
  }
]

export function listFinancialIntentDefinitions(): FinancialIntentDefinition[] {
  return FINANCIAL_INTENT_REGISTRY.map((entry) => ({ ...entry, patterns: [...entry.patterns] }))
}

export function extractFinancialIntentSlots(prompt: string): FinancialIntentSlotHints {
  const normalizedPrompt = normalizePersianDigits(prompt).trim()
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

export function detectFinancialIntent(prompt: string): FinancialIntentMatch | null {
  const normalizedPrompt = normalizePersianDigits(prompt).trim()

  if (!normalizedPrompt) {
    return null
  }

  let bestMatch: FinancialIntentMatch | null = null

  for (const intent of FINANCIAL_INTENT_REGISTRY) {
    let matchedPatterns = 0

    for (const pattern of intent.patterns) {
      if (pattern.test(normalizedPrompt)) {
        matchedPatterns += 1
      }
    }

    if (matchedPatterns === 0) {
      continue
    }

    const confidence = matchedPatterns / intent.patterns.length

    if (!bestMatch || confidence > bestMatch.confidence) {
      bestMatch = {
        intentId: intent.id,
        confidence
      }
    }
  }

  return bestMatch
}

function normalizePersianDigits(value: string): string {
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']

  return value
    .split('')
    .map((char) => {
      const persianIndex = persianDigits.indexOf(char)
      if (persianIndex >= 0) {
        return String(persianIndex)
      }

      const arabicIndex = arabicDigits.indexOf(char)
      if (arabicIndex >= 0) {
        return String(arabicIndex)
      }

      return char
    })
    .join('')
}