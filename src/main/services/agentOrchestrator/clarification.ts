/**
 * Clarification response builders extracted from `agentOrchestrator.ts`
 * (FRE Roadmap F2.6). Behaviour-preserving — the orchestrator delegates
 * to these free functions via a {@link ClarificationDeps} context.
 */
import type {
  AccountingConceptKey,
  AppSettings,
  SchemaCatalogEntry
} from '../../../shared/contracts'
import {
  detectSalesKpiContractCandidates,
  type FinancialIntentId
} from '../financialIntentRegistry'
import { transition, type RouteState } from '../intentFsm'
import { isRelaxedExploratoryIntent } from './intentRouting'
import type { DeterministicFinancialIntent } from './intentRouting'
import type {
  ConversationMemorySnapshot,
  ConversationMemoryState,
  ExtractedConversationFacts
} from './conversationMemory'
import type { PreferredMapping } from './promptBuilder'

const FINANCIAL_INTENT_FA_LABELS: Record<FinancialIntentId, string> = {
  count_fiscal_years: 'تعداد سال‌های مالی',
  list_fiscal_years: 'فهرست سال‌های مالی',
  get_party_balance: 'مانده طرف حساب',
  get_account_balance: 'مانده حساب',
  get_account_turnover: 'گردش حساب',
  get_cash_bank_balance: 'مانده نقد و بانک',
  get_trial_balance: 'تراز آزمایشی',
  get_sales_summary_by_period: 'خلاصه فروش',
  get_purchase_summary: 'خلاصه خرید',
  get_receivables_summary: 'خلاصه دریافتنی‌ها',
  get_payables_summary: 'خلاصه پرداختنی‌ها',
  get_cashflow_summary: 'خلاصه جریان نقد',
  get_recent_or_suspicious_documents: 'اسناد اخیر یا مشکوک'
}

const DATE_RANGE_AMBIGUITY_SIGNAL_PATTERN =
  /(بازه(?:\s*زمانی)?|دوره(?:\s*زمانی)?|range|period|date\s*range|time\s*range)/iu

const DATE_RANGE_EXPLICIT_SCOPE_PATTERN =
  /((?:13|14|19|20)\d{2}|this|current|today|امسال|سال\s*جاری|ماه\s*جاری|فصل\s*جاری|month\s*to\s*date|quarter\s*to\s*date)/iu

export interface ClarificationDeps {
  createConversationMemorySnapshot: (memory: ConversationMemoryState) => ConversationMemorySnapshot
  detectPromptConcepts: (prompt: string) => AccountingConceptKey[]
  findActiveSchemaCatalog: (settings: AppSettings) => SchemaCatalogEntry | null
  detectDeterministicFinancialIntent: (prompt: string) => DeterministicFinancialIntent | null
  resolvePreferredMapping: (
    activeCatalog: SchemaCatalogEntry,
    conceptKey: AccountingConceptKey,
    prompt?: string
  ) => PreferredMapping | null
  extractConversationFacts: (text: string) => ExtractedConversationFacts
  normalizePersianDigits: (value: string) => string
  schemaContextConceptLabels: Record<AccountingConceptKey, string>
}

export function buildDeterministicIntentClarificationResponse(
  intentId: DeterministicFinancialIntent
): string {
  return [
    '### Summary',
    'Cannot answer reliably: این intent نیاز به مسیر deterministic و mapping دقیق schema دارد.',
    '',
    '### Findings',
    `- intent شناسایی شده: ${intentId}`,
    '- پاسخ بدون نگاشت و شواهد read-only قابل اتکا نیست.',
    '',
    '### Evidence',
    '- مسیر قطعی برای این intent در نسخه فعلی نیاز به validation دقیق schema و query دارد.',
    '',
    '### Actions',
    '- نگاشت جدول/ستون مربوطه را در schema catalog تکمیل کنید و سپس دوباره امتحان کنید.'
  ].join('\n')
}

export function buildClarificationResponseIfNeeded(
  deps: ClarificationDeps,
  settings: AppSettings,
  prompt: string,
  conversationMemory: ConversationMemoryState
): string | null {
  const memorySnapshot = deps.createConversationMemorySnapshot(conversationMemory)
  const routeState = transition(prompt, memorySnapshot)

  const intentClarification = buildRouteStateClarification(prompt, routeState)

  if (intentClarification) {
    return intentClarification
  }

  return buildSchemaReadinessClarificationIfNeeded(deps, settings, prompt, conversationMemory)
}

function buildRouteStateClarification(prompt: string, routeState: RouteState): string | null {
  switch (routeState.kind) {
    case 'ambiguous':
      return buildAmbiguousIntentClarificationResponse(routeState.candidates)
    case 'classified':
      if (routeState.intentId === 'get_sales_summary_by_period') {
        return buildSalesKpiClarificationResponseIfNeeded(prompt)
      }
      return null
    case 'need-slot':
    case 'unroutable':
    default:
      return null
  }
}

export function buildSchemaReadinessClarificationIfNeeded(
  deps: ClarificationDeps,
  settings: AppSettings,
  prompt: string,
  conversationMemory: ConversationMemoryState
): string | null {
  const detectedConcepts = deps.detectPromptConcepts(prompt)

  if (detectedConcepts.length === 0) {
    return null
  }

  const activeCatalog = deps.findActiveSchemaCatalog(settings)

  if (!activeCatalog) {
    return null
  }

  const detectedExploratoryIntent = deps.detectDeterministicFinancialIntent(prompt)
  if (detectedExploratoryIntent && isRelaxedExploratoryIntent(detectedExploratoryIntent)) {
    return null
  }

  const missingConceptMappings = detectedConcepts.filter(
    (conceptKey) => !deps.resolvePreferredMapping(activeCatalog, conceptKey, prompt)
  )

  if (missingConceptMappings.length > 0) {
    return buildMissingMappingsClarificationResponse(
      deps.schemaContextConceptLabels,
      activeCatalog,
      missingConceptMappings
    )
  }

  const extractedFacts = deps.extractConversationFacts(prompt)
  const hasPromptDateScope =
    extractedFacts.fiscalYears.length > 0 || Boolean(extractedFacts.dateRange)
  const hasMemoryDateScope =
    conversationMemory.facts.fiscalYears.length > 0 || Boolean(conversationMemory.facts.dateRange)
  const normalizedPromptDigits = deps.normalizePersianDigits(prompt)
  const hasAmbiguousDateSignal = DATE_RANGE_AMBIGUITY_SIGNAL_PATTERN.test(normalizedPromptDigits)
  const hasExplicitDateScope = DATE_RANGE_EXPLICIT_SCOPE_PATTERN.test(normalizedPromptDigits)

  if (
    hasAmbiguousDateSignal &&
    !hasPromptDateScope &&
    !hasMemoryDateScope &&
    !hasExplicitDateScope
  ) {
    return buildDateRangeClarificationResponse(activeCatalog)
  }

  return null
}

function buildAmbiguousIntentClarificationResponse(candidates: FinancialIntentId[]): string {
  const optionLabels = candidates.map(
    (intentId) => FINANCIAL_INTENT_FA_LABELS[intentId] ?? intentId
  )

  return [
    '### Summary',
    'پرسش شما به بیش از یک گزارش مالی هم‌رده اشاره دارد و باید یکی را انتخاب کنید.',
    '',
    '### Findings',
    `- گزینه‌های محتمل: ${optionLabels.join('، ')}.`,
    '',
    '### Evidence',
    '- موتور وزنی تشخیص نیت این گزینه‌ها را با امتیاز یکسان و هم‌رده تشخیص داد.',
    '',
    '### Actions',
    '- لطفا مشخص کنید کدام‌یک از گزارش‌های بالا مدنظر شماست تا همان مسیر اجرا شود.'
  ].join('\n')
}

function buildSalesKpiClarificationResponseIfNeeded(prompt: string): string | null {
  const detection = detectSalesKpiContractCandidates(prompt)

  if (!detection.isAmbiguous) {
    return null
  }

  const contractLabels = ['فروش ناخالص', 'فروش خالص', 'فروش دفتری']

  return [
    '### Summary',
    'برای پاسخ دقیق فروش سالانه، باید نوع KPI را مشخص کنید.',
    '',
    '### Findings',
    '- پرسش شما بدون تعیین نوع فروش مطرح شده است.',
    `- گزینه‌های قابل قبول: ${contractLabels.join('، ')}.`,
    '',
    '### Evidence',
    '- در متن سوال، «فروش سالانه» به‌صورت کلی آمده و به بیش از یک قرارداد KPI اشاره می‌کند.',
    '',
    '### Actions',
    '- لطفا یکی از این گزینه‌ها را انتخاب کنید:',
    '- 1) فروش ناخالص',
    '- 2) فروش خالص',
    '- 3) فروش دفتری'
  ].join('\n')
}

function buildMissingMappingsClarificationResponse(
  schemaContextConceptLabels: Record<AccountingConceptKey, string>,
  activeCatalog: SchemaCatalogEntry,
  missingConceptMappings: AccountingConceptKey[]
): string {
  const missingLabels = missingConceptMappings
    .slice(0, 4)
    .map((conceptKey) => schemaContextConceptLabels[conceptKey])
    .join(', ')

  return [
    '### Summary',
    'برای جلوگیری از تحلیل اشتباه، قبل از اجرای SQL باید نگاشت چند مفهوم مالی تایید شود.',
    '',
    '### Findings',
    `- دیتابیس فعال: ${activeCatalog.databaseName}.`,
    `- برای این مفاهیم نگاشت معتبر پیدا نشد: ${missingLabels}.`,
    '',
    '### Evidence',
    '- در catalog فعلی برای این مفاهیم neither selected mapping nor suggested mapping موجود نیست.',
    '',
    '### Actions',
    '- در بخش نگاشت schema، جدول مربوط به مفاهیم بالا را انتخاب و ذخیره کنید.',
    '- سپس همین سوال را دوباره ارسال کنید تا استخراج داده واقعی انجام شود.'
  ].join('\n')
}

function buildDateRangeClarificationResponse(activeCatalog: SchemaCatalogEntry): string {
  return [
    '### Summary',
    'برای جلوگیری از حدس زدن بازه زمانی، قبل از اجرای کوئری به تعیین بازه دقیق نیاز دارم.',
    '',
    '### Findings',
    `- دیتابیس فعال: ${activeCatalog.databaseName}.`,
    '- در پیام فعلی، بازه زمانی به صورت مبهم بیان شده است.',
    '',
    '### Evidence',
    '- هیچ سال مالی یا تاریخ شروع/پایان صریح در این turn پیدا نشد.',
    '',
    '### Actions',
    '- لطفا یکی از این دو حالت را مشخص کنید:',
    '- حالت ۱) سال مالی دقیق (مثل 1402 یا 1403).',
    '- حالت ۲) تاریخ شروع و پایان دقیق (مثل 1403/01/01 تا 1403/03/31).'
  ].join('\n')
}
