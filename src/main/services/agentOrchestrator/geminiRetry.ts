/**
 * Gemini retry, fallback, and recovery hint logic extracted from `agentOrchestrator.ts` (FRE Roadmap F2.6).
 */
import type {
  AgentProgressEvent,
  AppSettings,
  GeminiChatResponse,
  GeminiMessage,
  GeminiToolDefinition
} from '../../../shared/contracts'
import type { ToolEvidence, ToolFailureKind } from '../evidenceContract'
import { mapRecoveryErrorHint } from './recovery'

export interface GeminiRetryDeps {
  geminiClient: {
    chat: (
      payload: {
        messages: GeminiMessage[]
        config?: Partial<AppSettings['gemini']>
        temperature?: number
        maxOutputTokens?: number
        tools?: GeminiToolDefinition[]
      },
      savedConfig: AppSettings['gemini'],
      streamOptions?: {
        onTextChunk?: (chunkText: string) => void
        signal?: AbortSignal
      }
    ) => Promise<GeminiChatResponse>
  }
  emitProgress: (
    onProgress: ((event: AgentProgressEvent) => void) | undefined,
    event: AgentProgressEvent
  ) => void
  toErrorInfo: (error: unknown) => { message: string; code?: string; category?: string }
  compactText: (value: string, maxLength: number) => string
}

export function buildExhaustionFallbackAnswer(
  deps: GeminiRetryDeps,
  prompt: string,
  _history: GeminiMessage[],
  toolCallsUsed: number,
  successfulDataFetches: number
): string {
  return [
    '### Summary',
    'در این دور ابزار، محدودیت ابزار به پایان رسید و پاسخ جزئی بازگردانده شد.',
    '',
    '### Findings',
    `تعداد ابزارهای استفاده‌شده ${toolCallsUsed} و داده‌های موفق استخراج‌شده ${successfulDataFetches} مورد ثبت شد.`,
    '',
    '### Evidence',
    `پرسش کاربر: ${deps.compactText(prompt, 220)}`,
    '',
    '### Assumptions',
    'برای ادامه، لازم است پرسش را محدودتر یا با جدول/ستون دقیق‌تر بازفرموله کنید.',
    '',
    '### Actions',
    'پرسش را با نام جدول/ستون دقیق‌تر یا دامنه زمانی محدودتر ارسال کنید.'
  ].join('\n')
}

export async function callGeminiWithProviderRetry(
  deps: GeminiRetryDeps,
  payload: {
    messages: GeminiMessage[]
    temperature?: number
    maxOutputTokens?: number
    tools?: GeminiToolDefinition[]
  },
  savedConfig: AppSettings['gemini'],
  abortSignal: AbortSignal,
  onProgress?: (event: AgentProgressEvent) => void
): Promise<GeminiChatResponse> {
  const maxAttempts = 5

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await deps.geminiClient.chat(payload, savedConfig, {
        onTextChunk: (chunkText) => {
          if (!chunkText) {
            return
          }

          deps.emitProgress(onProgress, {
            type: 'response-chunk',
            message: chunkText
          })
        },
        signal: abortSignal
      })
    } catch (error) {
      const errorInfo = deps.toErrorInfo(error)
      const message = (errorInfo.message || '').toLowerCase()
      const transient =
        message.includes('provider') ||
        message.includes('overloaded') ||
        message.includes('unavailable') ||
        message.includes('service unavailable') ||
        message.includes('bad gateway') ||
        message.includes('gateway timeout') ||
        message.includes('timeout') ||
        message.includes('connect') ||
        message.includes('network') ||
        /\b(4\d\d|5\d\d)\b/.test(message)

      if (!transient || attempt >= maxAttempts) {
        throw error
      }

      const delayMs = 250 * attempt + Math.floor(Math.random() * 150)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw new Error('Provider request failed after retries.')
}

export function shouldReturnDegradedFallback(deps: GeminiRetryDeps, error: unknown): boolean {
  const errorInfo = deps.toErrorInfo(error)
  const message = (errorInfo.message || '').toLowerCase()

  if (
    errorInfo.code === 'AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED' ||
    errorInfo.code === 'AGENT_TOTAL_TOOL_CALLS_EXCEEDED'
  ) {
    return true
  }

  return (
    message.includes('خطای ارتباط') ||
    message.includes('زمان انتظار برای هوش مصنوعی') ||
    message.includes('timeout') ||
    message.includes('connect') ||
    message.includes('network') ||
    message.includes('provider') ||
    message.includes('overloaded') ||
    message.includes('unavailable') ||
    message.includes('service unavailable') ||
    message.includes('bad gateway') ||
    message.includes('gateway timeout') ||
    /\b(4\d\d|5\d\d)\b/.test(message)
  )
}

export function buildRuntimeFailureFallbackAnswer(
  deps: GeminiRetryDeps,
  prompt: string,
  detail: string,
  toolCallsUsed: number,
  successfulDataFetches: number,
  kind: 'provider' | 'budget' = 'provider'
): string {
  const summary =
    kind === 'budget'
      ? 'پاسخ جزئی بازگردانده شد زیرا محدودیت ابزارها از حد مجاز عبور کرد.'
      : 'پاسخ جزئی بازگردانده شد زیرا خطای ارتباط یا زمان‌بندی در مسیر هوش مصنوعی رخ داد.'

  const findings =
    kind === 'budget'
      ? `محدودیت ابزارهای این درخواست باعث توقف قبل از تکمیل تحلیل شد. تعداد ابزارهای استفاده‌شده ${toolCallsUsed} و داده‌های موفق استخراج‌شده ${successfulDataFetches} مورد ثبت شد.`
      : `خطای ارتباط یا زمان‌بندی باعث توقف قبل از تکمیل تحلیل شد. تعداد ابزارهای استفاده‌شده ${toolCallsUsed} و داده‌های موفق استخراج‌شده ${successfulDataFetches} مورد ثبت شد.`

  return [
    '### Summary',
    summary,
    '',
    '### Findings',
    findings,
    '',
    '### Evidence',
    `جزئیات خطا: ${deps.compactText(detail, 240)}`,
    `پرسش کاربر: ${deps.compactText(prompt, 220)}`,
    '',
    '### Assumptions',
    'برای ادامه، لازم است پرسش را محدودتر یا با جدول/ستون دقیق‌تر بازفرموله کنید.',
    '',
    '### Actions',
    'پرسش را دوباره با دامنه زمانی محدودتر یا شرح دقیق‌تر ارسال کنید.'
  ].join('\n')
}

export function validateIntentTableMatch(
  _intentId: string | undefined,
  _evidence: ToolEvidence[]
): string | null {
  // LEGACY_REMOVED: intent-to-table mapping removed (Phase 9). FRE engine handles table validation.
  return null
}

export function buildRecoveryHint(
  failureKind: ToolFailureKind,
  lastErrorCode?: string,
  lastErrorMessage?: string,
  evidence: ToolEvidence[] = [],
  context?: { comparativeMultiPeriod?: boolean; successfulFetches?: number },
  prompt?: string
): string {
  void lastErrorMessage
  const discoveryOnly =
    evidence.length > 0 && evidence.every((entry) => entry.tool !== 'fetch_financial_data')

  if (context?.comparativeMultiPeriod && (context.successfulFetches ?? 0) < 2) {
    const remaining = Math.max(0, 2 - (context.successfulFetches ?? 0))
    return (
      'این یک سوال مقایسه‌ای چنددوره‌ای است: برای هر دوره/سال یک fetch_financial_data جداگانه با ' +
      'یک SELECT SUM/COUNT/AVG و فیلتر FiscalYearRef متفاوت اجرا کن (مثلاً WHERE FiscalYearRef = <Title1> ' +
      `و یک کوئری دوم WHERE FiscalYearRef = <Title2>). حداقل ${remaining} fetch موفق دیگر لازم است.`
    )
  }

  const isPurchaseIntent = prompt && /خرید|purchase/iu.test(prompt)
  const usedPurchaseInvoice = evidence.some(
    (entry) => entry.tool === 'fetch_financial_data' && entry.query?.includes('POM.PurchaseInvoice')
  )

  switch (failureKind) {
    case 'NO_FETCH':
      return discoveryOnly
        ? 'تو فقط جدول‌ها را دیدی ولی عدد نگرفتی. حالا حتماً fetch_financial_data را با یک SELECT SUM/COUNT/AVG روی جدول پیدا شده اجرا کن و نتیجه را از دیتابیس بگیر.'
        : 'برای پاسخ عددی باید fetch_financial_data را با یک کوئری SUM/COUNT/AVG اجرا کنی.'
    case 'EMPTY_RESULT':
      if (isPurchaseIntent && usedPurchaseInvoice) {
        return 'POM.PurchaseInvoice خالی است. برای این فرآیند کسب‌وکار، خرید در INV.InventoryReceipt ثبت می‌شود. INV.InventoryReceipt را با ستون TotalPrice بررسی کن (فقط ردیف‌های غیر مرجوعی با IsReturn = 0 یا Type = خرید). اگر داده یافت شد، در پاسخ صریحاً ذکر کن که مبلغ از رسید انبار است نه فاکتور خرید.'
      }
      return 'مجموع NULL شد. ممکن است ستون مبلغ اشتباه باشد. ستون‌های عددی جایگزین جدول را با get_database_schema بررسی کن (مثلاً PriceInBaseCurrency در برابر NetPriceInBaseCurrency) یا جدول مرتبط دیگر (مثل POM.PurchaseCost) را امتحان کن.'
    case 'NOT_IN_CATALOG':
      return 'جدول مجاز نیست. اول با list_database_tables و get_database_schema جدول درست را پیدا کن.'
    case 'UNKNOWN_OBJECT':
      return 'نام جدول/ستون وجود ندارد. اول با list_database_tables و get_database_schema نام دقیق را پیدا کن، بعد کوئری بزن و نام را از خودت نساز.'
    case 'UNSUPPORTED_FUNCTION':
      return 'این SQL Server توابع FORMAT و dbo.GregorianToShamsi را پشتیبانی نمی‌کند. برای ماه از MONTH(Date) و YEAR(Date) یا بازهٔ تاریخ میلادی صریح استفاده کن.'
    case 'POLICY_ERROR':
      return `${mapRecoveryErrorHint(lastErrorCode)} کوئری را اصلاح کن و دوباره اجرا کن.`
    case 'PROVIDER_ERROR':
      return 'دوباره با همان مسیر تلاش کن.'
    case 'NONE':
    default:
      return 'برای پاسخ عددی باید fetch_financial_data را با یک کوئری SUM/COUNT/AVG اجرا کنی.'
  }
}
