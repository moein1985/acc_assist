/**
 * Response contract helpers extracted from `agentOrchestrator.ts`
 * (FRE Roadmap F2.3). Behaviour-preserving — the orchestrator delegates
 * to these free functions via a {@link ResponseContractDeps} context.
 */
import { evaluateEvidence, type ExecutionTrace, type ToolEvidence } from '../evidenceContract'
import type { ConversationMemoryState } from './conversationMemory'
import {
  renderValidEmptyFinancialAnswer,
  buildEvidenceContractFailureResponse
} from './responseBuilder'

export type FinancialTemplateSections = {
  summary: string
  findings: string
  evidence: string
  assumptions: string
  actions: string
  freeform: string
}

export interface ResponseContractDeps {
  normalizePersianDigits: (value: string) => string
  ensureFinancialResponseTemplate: (
    rawText: string,
    conversationMemory: ConversationMemoryState,
    totalToolCallCount: number
  ) => string
  enforcePromptIntentAlignment: (prompt: string, text: string) => string
  validateIntentTableMatch: (intentId: string, evidence: ToolEvidence[]) => string | null
  emitEvidenceContractTelemetry: (
    requestId: string | undefined,
    conversationId: string | undefined,
    failureText: string,
    recoveryAttempts: number | undefined
  ) => void
  appearsToContainFinancialClaim: (text: string) => boolean
  parseFinancialTemplateSections: (text: string) => FinancialTemplateSections
  hasRequiredFinancialResponseSections: (sections: FinancialTemplateSections) => boolean
  hasStructuredEvidence: (evidence: string) => boolean
  requiresStrictFinancialDataFetch: (prompt: string, narrative: string) => boolean
  requiresStrictQuantitativeDataFetch: (prompt: string) => boolean
  hasQuantitativeResultSignal: (narrative: string) => boolean
  appearsToBeNoDataResult: (narrative: string) => boolean
  extractNumericClaims: (narrative: string) => string[]
  containsUnsupportedNumericClaim: (
    narrative: string,
    evidence: string,
    sections: FinancialTemplateSections
  ) => boolean
  containsFinancialMarkedNumericClaim: (narrative: string) => boolean
  traceSupportsNumericClaim: (trace: ExecutionTrace) => boolean
}

export function annotateManagerUx(
  deps: ResponseContractDeps,
  rawText: string,
  routeMode: 'deterministic' | 'model-assisted' | 'clarification'
): string {
  const normalizedText = deps.normalizePersianDigits(rawText)

  if (/^### Summary\n/i.test(normalizedText)) {
    const routeLine = `- مسیر پاسخ: ${routeMode}`
    if (normalizedText.includes('نوع KPI:')) {
      return rawText.replace(
        '### Findings',
        `${routeLine}\n- نوع KPI: ${rawText.match(/نوع KPI: ([^\n]+)/)?.[1] ?? 'نامشخص'}\n\n### Findings`
      )
    }

    return rawText.replace('### Findings', `${routeLine}\n\n### Findings`)
  }

  return [
    '### Summary',
    'مدیریت پاسخ با شفافیت مسیر و KPI فعال شد.',
    '',
    '### Findings',
    `- مسیر پاسخ: ${routeMode}`,
    '',
    '### Evidence',
    rawText,
    '',
    '### Actions',
    '- برای بررسی بیشتر، خروجی را با شواهد و scope مقایسه کنید.'
  ].join('\n')
}

export function finalizeFinancialResponse(
  deps: ResponseContractDeps,
  prompt: string,
  rawText: string,
  conversationMemory: ConversationMemoryState,
  totalToolCallCount: number,
  successfulDataFetchCount: number,
  routeMode: 'deterministic' | 'model-assisted' | 'clarification' = 'model-assisted',
  executionTrace?: ExecutionTrace,
  recoveryContext?: { attempts: number },
  requestId?: string
): string {
  const templatedText = deps.ensureFinancialResponseTemplate(
    rawText,
    conversationMemory,
    totalToolCallCount
  )
  const alignedText = deps.enforcePromptIntentAlignment(prompt, templatedText)
  const routedText = annotateManagerUx(deps, alignedText, routeMode)

  if (routeMode === 'deterministic') {
    return routedText
  }

  const finalizedText = enforceEvidenceFirstContract(
    deps,
    prompt,
    routedText,
    totalToolCallCount,
    successfulDataFetchCount,
    executionTrace,
    recoveryContext,
    requestId,
    conversationMemory.conversationId
  )

  return finalizedText
}

export function enforceEvidenceFirstContract(
  deps: ResponseContractDeps,
  prompt: string,
  finalText: string,
  totalToolCallCount: number,
  successfulDataFetchCount: number,
  executionTrace?: ExecutionTrace,
  recoveryContext?: { attempts: number },
  requestId?: string,
  conversationId?: string
): string {
  const normalizedText = deps.normalizePersianDigits(finalText)

  if (/cannot\s+answer\s+reliably/iu.test(normalizedText)) {
    return finalText
  }

  if (executionTrace && executionTrace.intentId) {
    const intentMismatch = deps.validateIntentTableMatch(
      executionTrace.intentId,
      executionTrace.evidence
    )
    if (intentMismatch) {
      const failureText = buildEvidenceContractFailureResponse(
        `تطابق intent و جدول برقرار نیست: ${intentMismatch}`,
        prompt,
        recoveryContext?.attempts
      )
      deps.emitEvidenceContractTelemetry(
        requestId,
        conversationId,
        failureText,
        recoveryContext?.attempts
      )
      return failureText
    }
  }

  const hasFinancialNumericClaimInResponse =
    /(?:[+-]?\d+(?:[.,]\d+)?(?:\s*%|\s*درصد)|\b(?:تومان|ریال|مبلغ|موجودی|مانده|جمع|مجموع|تعداد|سهم|نسبت|amount|balance|total|count)\b)/iu.test(
      normalizedText
    )
  const isClarificationOnlyResponse =
    /برای\s+پاسخ\s+دقیق|برای\s+جلوگیری\s+از\s+حدس\s+زدن|برای\s+جلوگیری\s+از\s+تحلیل\s+اشتباه|لطفا\s+یکی\s+از\s+این\s+گزینه‌ها|سال\s+مالی\s+دقیق|تاریخ\s+شروع\s+و\s+پایان|درخواست\s+صرفاً\s+استعلامی/i.test(
      normalizedText
    ) && !hasFinancialNumericClaimInResponse

  if (isClarificationOnlyResponse) {
    return finalText
  }

  const sections = deps.parseFinancialTemplateSections(finalText)
  const narrative = `${sections.summary}\n${sections.findings}`.trim()
  const evidence = sections.evidence
  const appearsFinancialClaim =
    deps.appearsToContainFinancialClaim(prompt) || deps.appearsToContainFinancialClaim(narrative)
  const hasRequiredContractSections = deps.hasRequiredFinancialResponseSections(sections)
  const hasStructuredEvidence = deps.hasStructuredEvidence(evidence)
  const requiresStrictFinancialFetch = deps.requiresStrictFinancialDataFetch(prompt, narrative)
  const requiresStrictQuantResult = deps.requiresStrictQuantitativeDataFetch(prompt)
  const hasQuantitativeResult = deps.hasQuantitativeResultSignal(narrative)
  const statesNoData = deps.appearsToBeNoDataResult(narrative)
  const numericClaims = deps.extractNumericClaims(narrative)
  const needsStrictData = requiresStrictFinancialFetch || requiresStrictQuantResult

  if (appearsFinancialClaim && !hasRequiredContractSections) {
    const failureText = buildEvidenceContractFailureResponse(
      'پاسخ مالی فاقد بلوک‌های قرارداد استاندارد Summary/Findings/Evidence/Assumptions/Actions بود.',
      prompt,
      recoveryContext?.attempts
    )
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    )
    return failureText
  }

  if (totalToolCallCount === 0 && appearsFinancialClaim && !statesNoData) {
    const failureText = buildEvidenceContractFailureResponse(
      'پاسخ مالی عددی بدون اجرای ابزار read-only تولید شد و قابل اتکا نیست.',
      prompt,
      recoveryContext?.attempts
    )
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    )
    return failureText
  }

  if (deps.containsUnsupportedNumericClaim(narrative, evidence, sections)) {
    const failureText = buildEvidenceContractFailureResponse(
      'پاسخ شامل ادعای عددی/درصدی بدون شواهد ساخت‌یافته و بدون داده‌ی اجرا شده بود.',
      prompt,
      recoveryContext?.attempts
    )
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    )
    return failureText
  }

  const hasFinancialMarkedClaim = deps.containsFinancialMarkedNumericClaim(narrative)
  if (
    executionTrace &&
    numericClaims.length > 0 &&
    hasFinancialMarkedClaim &&
    !statesNoData &&
    (appearsFinancialClaim || needsStrictData)
  ) {
    if (!deps.traceSupportsNumericClaim(executionTrace)) {
      const failureText = buildEvidenceContractFailureResponse(
        'پاسخ شامل عدد/درصدی است که در trace اجرای واقعی وجود ندارد و بنابراین به‌عنوان ادعای بی‌شاهد رد می‌شود. برای پذیرش، عدد باید از اجرای واقعی و شواهد trace پشتیبانی شود.',
        prompt,
        recoveryContext?.attempts
      )
      deps.emitEvidenceContractTelemetry(
        requestId,
        conversationId,
        failureText,
        recoveryContext?.attempts
      )
      return failureText
    }
  }

  if (
    totalToolCallCount > 0 &&
    !hasStructuredEvidence &&
    (appearsFinancialClaim || needsStrictData || hasQuantitativeResult)
  ) {
    const failureText = buildEvidenceContractFailureResponse(
      'پاسخ مالی فاقد شواهد ساخت یافته کافی (ابزار/کوئری/جدول/ردیف) بود.',
      prompt,
      recoveryContext?.attempts
    )
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    )
    return failureText
  }

  if (executionTrace && needsStrictData) {
    const verdict = evaluateEvidence(executionTrace)

    if (verdict.kind === 'INSUFFICIENT') {
      const failureText = buildEvidenceContractFailureResponse(
        'برای پاسخ عددی/مقایسه ای مالی، اجرای موفق و scope دار fetch_financial_data الزامی است و مسیرهای بدون آن معتبر نیستند.',
        prompt,
        recoveryContext?.attempts
      )
      deps.emitEvidenceContractTelemetry(
        requestId,
        conversationId,
        failureText,
        recoveryContext?.attempts
      )
      return failureText
    }

    if (verdict.kind === 'VALID_EMPTY') {
      return renderValidEmptyFinancialAnswer(finalText, sections, statesNoData)
    }

    if (requiresStrictQuantResult && !hasQuantitativeResult && !statesNoData) {
      const failureText = buildEvidenceContractFailureResponse(
        'برای سوال درصد رشد/کاهش، پاسخ نهایی باید عدد درصد معتبر (+x% یا -x%) یا پیام صریح نبود داده داشته باشد.',
        prompt
      )
      deps.emitEvidenceContractTelemetry(
        requestId,
        conversationId,
        failureText,
        recoveryContext?.attempts
      )
      return failureText
    }

    return finalText
  }

  if (requiresStrictFinancialFetch && successfulDataFetchCount === 0 && !statesNoData) {
    const failureText = buildEvidenceContractFailureResponse(
      'برای پاسخ عددی/مقایسه ای مالی، اجرای موفق fetch_financial_data الزامی است و مسیرهای بدون آن معتبر نیستند.',
      prompt,
      recoveryContext?.attempts
    )
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    )
    return failureText
  }

  if (requiresStrictQuantResult && successfulDataFetchCount === 0 && !statesNoData) {
    const failureText = buildEvidenceContractFailureResponse(
      'برای سوال درصد رشد/کاهش، پاسخ نهایی بدون اجرای موفق fetch_financial_data مجاز نیست.',
      prompt,
      recoveryContext?.attempts
    )
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    )
    return failureText
  }

  if (requiresStrictQuantResult && !hasQuantitativeResult && !statesNoData) {
    const failureText = buildEvidenceContractFailureResponse(
      'برای سوال درصد رشد/کاهش، پاسخ نهایی باید عدد درصد معتبر (+x% یا -x%) یا پیام صریح نبود داده داشته باشد.',
      prompt,
      recoveryContext?.attempts
    )
    deps.emitEvidenceContractTelemetry(
      requestId,
      conversationId,
      failureText,
      recoveryContext?.attempts
    )
    return failureText
  }

  return finalText
}
