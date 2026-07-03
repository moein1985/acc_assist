import type {
  AgentProgressEvent,
  AgentSendMessageRequest,
  AgentSendMessageResult,
  AppSettings,
  GeminiChatResponse,
  GeminiMessage,
  GeminiToolDefinition,
  RefusalReason,
  ResponseEvidenceEntry,
  ResponseMetadata,
  SqlQueryRow
} from '../../shared/contracts'
import type { AuditLogEntry } from './auditLogService'
import { normalizePersianDigits } from './textNormalization'
import { isFinancialNumericQuery as isFinancialNumericQueryFn } from './agentOrchestrator/routing'
import {
  type ConversationMemoryState as ConversationMemoryStateType,
  getOrCreateConversationMemory as getOrCreateConversationMemoryFn,
  updateContextEntities as updateContextEntitiesFn,
  pushConversationTurn as pushConversationTurnFn
} from './agentOrchestrator/conversationMemory'

export type ConversationMemoryState = ConversationMemoryStateType

type ActiveAgentExecution = {
  requestId: string
  conversationId: string
  abortController: AbortController
}

// Budget arithmetic for the capped tool loop used by the production MVP path.
// The runtime policy keeps the loop small to avoid runaway token bleed and noisy retries.
const MAX_TOOL_CALL_ROUNDS = 4
const MAX_TOOL_CALLS_PER_ROUND = 7
const MAX_TOTAL_TOOL_CALLS = 14

interface AgentOrchestratorDeps {
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
  getSettings: () => AppSettings
  executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  auditLog: {
    write: (entry: AuditLogEntry) => Promise<void>
  }
  telemetry?: {
    capture: (input: {
      event: string
      category: string
      level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
      process?: 'main' | 'renderer'
      message?: string
      details?: Record<string, unknown>
      requestId?: string
      conversationId?: string
      correlationId?: string
    }) => void
  }
  mobileBridge?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    broadcast: (message: any) => void
  }
}

export class AgentOrchestrator {
  private readonly geminiClient: AgentOrchestratorDeps['geminiClient']
  private readonly getSettings: () => AppSettings
  private readonly executeReadOnlySql: (
    query: string,
    signal?: AbortSignal
  ) => Promise<SqlQueryRow[]>
  private readonly auditLog: AgentOrchestratorDeps['auditLog']
  private readonly telemetry?: AgentOrchestratorDeps['telemetry']
  private readonly activeExecutions = new Map<string, ActiveAgentExecution>()
  private readonly conversationMemoryById = new Map<string, ConversationMemoryState>()

  constructor(deps: AgentOrchestratorDeps) {
    this.geminiClient = deps.geminiClient
    this.getSettings = deps.getSettings
    this.executeReadOnlySql = deps.executeReadOnlySql
    this.auditLog = deps.auditLog
    this.telemetry = deps.telemetry
  }

  /**
   * Wrapper to call Gemini model for the financial engine planner.
   * Returns the raw text response from the model.
   */
  private async callPlannerModel(plannerPrompt: string): Promise<string> {
    const settings = this.getSettings()
    const response = await this.geminiClient.chat(
      {
        messages: [{ role: 'user', content: plannerPrompt }],
        temperature: 0,
        maxOutputTokens: 2048
      },
      settings.gemini
    )
    return response.text
  }

  /**
   * S15.22: Resolve adapter and softwareId for the current settings.
   * Returns { adapter, softwareId } for injection into FinancialEngine.
   */
  private async resolveAdapter(): Promise<{
    adapter: import('./financialEngine/schemaAdapter').SchemaAdapter
    softwareId: string
  }> {
    const settings = this.getSettings()
    const mode = settings.softwareMode ?? 'sepidar'

    if (mode === 'auto') {
      const adapters = settings.discoveredAdapters ?? {}
      const key = `auto-${settings.sql.server.replace(/[^a-zA-Z0-9._-]/g, '')}-${settings.sql.database.replace(/[^a-zA-Z0-9._-]/g, '')}`
      const entry = adapters[key]
      if (entry?.confirmed && entry.adapter) {
        const adapter = entry.adapter as import('./financialEngine/schemaAdapter').SchemaAdapter
        return { adapter, softwareId: adapter.softwareId }
      }
    }

    const { SepidarAdapter } = await import('./financialEngine/adapters/sepidarAdapter')
    const sepidar = new SepidarAdapter()
    return { adapter: sepidar, softwareId: 'sepidar' }
  }

  async sendMessage(
    payload: AgentSendMessageRequest,
    onProgress?: (event: AgentProgressEvent) => void
  ): Promise<AgentSendMessageResult> {
    void onProgress

    const isFinancial = isFinancialNumericQueryFn(payload.prompt)

    void this.safeAuditWrite({
      timestamp: new Date().toISOString(),
      requestId: payload.requestId,
      conversationId: payload.conversationId,
      stage: isFinancial ? 'engine-mode' : 'text-guidance',
      prompt: isFinancial ? 'ENGINE_ONLY_ENTRY' : 'TEXT_ONLY_GUIDANCE'
    })

    if (isFinancial) {
      const engineResponse = await this.tryEngineResponse(payload)
      if (engineResponse !== null) {
        return engineResponse
      }

      // Engine could not answer → explicit refusal (no legacy fallback)
      void this.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        stage: 'engine-refuse',
        prompt: payload.prompt,
        refusalReason: this.categorizeRefusalReason(payload.prompt, engineResponse),
        normalizedPrompt: this.normalizePromptPattern(payload.prompt)
      })

      return {
        history: [],
        finalText: 'برای این پرسش دادهٔ قابل‌اتکا در دسترس ندارم. لطفاً پرسش خود را دقیق‌تر کنید یا از گزارش‌های مالی نرم‌افزار استفاده کنید.',
        rounds: 0,
        toolCallsUsed: 0
      }
    }

    // Non-financial guidance query → text-only path (S24.11)
    return this.answerTextOnly(payload)
  }

  /**
   * S24.11: Text-only guidance path — for non-financial queries (how-to, help, explanations).
   * No SQL is executed. A numeric guard strips any financial numbers from the model response.
   */
  private async answerTextOnly(
    payload: AgentSendMessageRequest
  ): Promise<AgentSendMessageResult> {
    try {
      const settings = this.getSettings()
      const response = await this.geminiClient.chat(
        {
          messages: [{ role: 'user', content: payload.prompt }],
          temperature: 0.3,
          maxOutputTokens: 1024
        },
        settings.gemini
      )

      // S24.11: Numeric guard — strip financial numbers from the response
      const guardedText = this.stripFinancialNumbers(response.text)

      return {
        history: [],
        finalText: guardedText,
        rounds: 0,
        toolCallsUsed: 0
      }
    } catch (err) {
      void this.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        stage: 'text-guidance-error',
        prompt: `text-only error: ${err instanceof Error ? err.message : String(err)}`
      })

      return {
        history: [],
        finalText: 'متأسفانه در پاسخ‌گویی به درخواست شما خطایی رخ داد. لطفاً دوباره تلاش کنید.',
        rounds: 0,
        toolCallsUsed: 0
      }
    }
  }

  /**
   * S24.11: Strips financial numeric claims from text-only responses.
   * Removes amounts, balances, and currency-marked numbers, replacing them
   * with a guidance message.
   */
  private stripFinancialNumbers(text: string): string {
    const normalized = normalizePersianDigits(text)

    // If the text contains financial marked numeric claims, replace them
    const hasFinancialNumber =
      /(?:\d[\d,]*(?:\.\d+)?\s*(?:تومان|ریال|IRR|USD|EUR|\$)|(?:مبلغ|مانده|جمع|مجموع|موجودی)\s*[:：]?\s*\d[\d,]*)/iu.test(normalized)

    if (hasFinancialNumber) {
      return 'برای اعداد مالی باید از گزارش‌های مالی نرم‌افزار استفاده کنید. آیا راهنمایی دیگری نیاز دارید؟'
    }

    return text
  }

  private async tryEngineResponse(
    payload: AgentSendMessageRequest
  ): Promise<AgentSendMessageResult | null> {
    try {
      const { FinancialEngine } = await import('./financialEngine/index')
      const { quoteSqlIdentifier, quoteSqlTableRef } = await import('./agentOrchestrator/sqlUtils')
      const { normalizePersianText } = await import('./textNormalization')
      const { composeEngineResponseMarkdown, composeMultiMetricMarkdown, composeMultiStepMarkdown } = await import('./financialEngine/explainer')
      const { checkIntentAlignment } = await import('./financialEngine/verifier')
      const { generateSmartSuggestions } = await import('./financialEngine/smartSuggestions')
      const { detectAnomalies } = await import('./financialEngine/anomalyDetector')

      // S15.22: Resolve adapter based on softwareMode
      const { adapter, softwareId } = await this.resolveAdapter()

      const engine = new FinancialEngine({
        quoteSqlTableRef,
        quoteSqlIdentifier,
        normalizePersianText,
        executeReadOnlySql: (query, signal) => this.executeReadOnlySql(query, signal ?? undefined),
        adapter,
        softwareId,
        plannerModel: {
          callModel: (plannerPrompt: string) => this.callPlannerModel(plannerPrompt)
        }
      })

      // S14.41: Pass lastMetricPlan from conversation memory for drill-down follow-up
      // S20.6: Pass conversation context (history + contextEntities) for planner
      const memory = this.getOrCreateConversationMemory(payload.conversationId)
      updateContextEntitiesFn(memory, payload.prompt)
      const conversationContext = {
        history: memory.history.map(t => ({ userMessage: t.userMessage, resultSummary: t.resultSummary })),
        contextEntities: memory.contextEntities
      }
      const engineRun = await engine.run(payload.prompt, undefined, memory.lastMetricPlan, undefined, conversationContext)

      // Handle multi-metric or multi-step result (has 'results' array)
      if ('results' in engineRun && 'verdicts' in engineRun) {
        const multi = engineRun
        const allOk = multi.verdicts.every((v) => v.ok)
        if (!allOk || multi.results.length === 0) {
          void this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId: payload.requestId,
            conversationId: payload.conversationId,
            stage: 'engine-mode',
            prompt: payload.prompt,
            refusalReason: 'empty_data',
            normalizedPrompt: this.normalizePromptPattern(payload.prompt),
            error: `engine-multi-no-result: ${multi.verdicts.map((v) => v.reason ?? 'ok').join(', ')}`
          })
          return null
        }

        // S20.4: MultiStepResult — compose combined explanation
        if ('steps' in multi.plan) {
          const stepResult = multi as import('./financialEngine/index').MultiStepResult
          const finalText = composeMultiStepMarkdown(stepResult, payload.prompt)
          const metricIds = stepResult.results.map((r) => r.plan.metricId).join(' → ')

          void this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId: payload.requestId,
            conversationId: payload.conversationId,
            stage: 'engine-mode',
            prompt: `engine-served: multi-step [${metricIds}] verdict=ok`
          })

          return {
            history: [],
            finalText,
            rounds: 1,
            toolCallsUsed: stepResult.results.length
          }
        }

        const finalText = composeMultiMetricMarkdown(multi as import('./financialEngine/index').MultiMetricResult, payload.prompt)
        const metricIds = multi.results.map((r) => r.plan.metricId).join(', ')

        void this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId: payload.requestId,
          conversationId: payload.conversationId,
          stage: 'engine-mode',
          prompt: `engine-served: multi-metric [${metricIds}] verdict=ok`
        })

        return {
          history: [],
          finalText,
          rounds: 1,
          toolCallsUsed: multi.results.length
        }
      }

      if (!engineRun.result || !engineRun.verdict.ok) {
        const reason = engineRun.verdict.reason ?? 'unknown'
        const refusalReason: RefusalReason = reason.includes('clarif') || reason.includes('ambiguous')
          ? 'ambiguous'
          : reason.includes('empty') || reason.includes('no data')
            ? 'empty_data'
            : 'no_metric'
        void this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId: payload.requestId,
          conversationId: payload.conversationId,
          stage: 'engine-mode',
          prompt: payload.prompt,
          refusalReason,
          normalizedPrompt: this.normalizePromptPattern(payload.prompt),
          error: `engine-no-result: ${reason}`
        })
        return null
      }

      // V5.2: Intent alignment check
      const intentCheck = checkIntentAlignment(payload.prompt, engineRun.result.plan, softwareId)
      if (!intentCheck.passed) {
        void this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId: payload.requestId,
          conversationId: payload.conversationId,
          stage: 'engine-mode',
          prompt: payload.prompt,
          refusalReason: 'no_metric',
          normalizedPrompt: this.normalizePromptPattern(payload.prompt),
          error: `intent-mismatch: ${intentCheck.reason}`
        })
        return null
      }

      const finalText = composeEngineResponseMarkdown(
        engineRun.result,
        engineRun.verdict,
        payload.prompt
      )

      void this.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        stage: 'engine-mode',
        prompt: `engine-served: metricId=${engineRun.result.plan.metricId} verdict=ok`
      })

      // S14.41: Store the successful plan for future drill-down
      memory.lastMetricPlan = engineRun.result.plan

      // S20.5: Push conversation turn into history
      pushConversationTurnFn(memory, {
        userMessage: payload.prompt,
        plan: engineRun.result.plan,
        resultSummary: finalText.slice(0, 200),
        timestamp: Date.now()
      })

      // S20.9: Detect anomalies in the result data
      const anomalies = detectAnomalies({
        metricId: engineRun.result.plan.metricId,
        rows: engineRun.result.rows,
        plan: engineRun.result.plan
      })

      // S20.7: Generate smart suggestions based on the executed metric
      const suggestions = generateSmartSuggestions({
        metricId: engineRun.result.plan.metricId,
        filters: engineRun.result.plan.filters,
        contextEntities: memory.contextEntities,
        hasAnomaly: anomalies.length > 0
      })

      // S20.10: Append anomaly warnings to the final text
      let finalTextWithAnomalies = finalText
      if (anomalies.length > 0) {
        const anomalyLines = anomalies.map((a) => {
          const icon = a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟡' : '🟢'
          return `${icon} **${a.description}**`
        })
        finalTextWithAnomalies += '\n\n---\n\n⚠️ **هشدار ناهنجاری:**\n' + anomalyLines.join('\n')
      }

      // S21.1-S21.3: Build response metadata for SQL transparency, confidence score, evidence
      const { computeConfidenceScore } = await import('./financialEngine/confidenceScore')
      const sqlText = engineRun.result.compiled.sql
      const rowCount = engineRun.result.rows.length
      const evidenceEntries: ResponseEvidenceEntry[] = []
      if (rowCount > 0) {
        const firstRow = engineRun.result.rows[0]
        for (const [col, val] of Object.entries(firstRow)) {
          if (typeof val === 'number' || typeof val === 'string') {
            evidenceEntries.push({
              metric: engineRun.result.plan.metricId,
              value: val,
              sqlColumn: col,
              rowCount
            })
          }
        }
      }
      const confidence = computeConfidenceScore({
        sqlRowsReturned: rowCount > 0,
        evidenceMatch: rowCount > 0 && engineRun.verdict.ok,
        anomalyDetected: anomalies.length > 0,
        planConfidence: engineRun.result.plan.confidence >= 0.8 ? 'high' : engineRun.result.plan.confidence >= 0.5 ? 'medium' : 'low',
        fallbackUsed: false
      })

      const responseMetadata: ResponseMetadata = {
        sql: sqlText,
        evidence: evidenceEntries.slice(0, 10),
        confidenceScore: confidence.score,
        confidenceFactors: confidence.factors,
        metricId: engineRun.result.plan.metricId,
        pythonOutputFiles: engineRun.pythonOutput?.outputFiles,
        pythonOutputType: engineRun.pythonOutput?.outputType
      }

      return {
        history: [],
        finalText: finalTextWithAnomalies,
        rounds: 1,
        toolCallsUsed: 1,
        suggestions: suggestions.map((s) => s.text),
        responseMetadata
      }
    } catch (error) {
      void this.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        stage: 'engine-mode',
        prompt: `engine-error: ${error instanceof Error ? error.message : String(error)}`
      })
      return null
    }
  }

  cancelMessage(requestId: string, reason?: string): boolean {
    const trimmedRequestId = requestId.trim()
    const execution = this.activeExecutions.get(trimmedRequestId)

    if (!execution) {
      return false
    }

    if (!execution.abortController.signal.aborted) {
      execution.abortController.abort(reason?.trim() || 'Request canceled by user.')
    }

    return true
  }

  private async safeAuditWrite(entry: AuditLogEntry): Promise<void> {
    try {
      await this.auditLog.write(entry)
      this.telemetry?.capture({
        event: 'agent.orchestrator.audit',
        category: 'agent.orchestrator',
        level: 'info',
        process: 'main',
        message: entry.stage,
        details: {
          requestId: entry.requestId,
          conversationId: entry.conversationId,
          stage: entry.stage,
          round: entry.round,
          recoveryAttempts: entry.recoveryAttempts,
          failureKind: entry.failureKind,
          errorCode: entry.errorCode,
          errorCategory: entry.errorCategory
        },
        requestId: entry.requestId,
        conversationId: entry.conversationId
      })
    } catch (error) {
      console.warn('[AgentOrchestrator] Failed to write audit log:', error)
    }
  }

  private getOrCreateConversationMemory(conversationId: string): ConversationMemoryState {
    return getOrCreateConversationMemoryFn(this.conversationMemoryById, conversationId)
  }

  private compactText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim()

    if (normalized.length <= maxLength) {
      return normalized
    }

    return `${normalized.slice(0, maxLength - 1)}…`
  }

  /**
   * S31.1: Categorize refusal reason from prompt content and engine response.
   */
  private categorizeRefusalReason(prompt: string, engineResponse: AgentSendMessageResult | null): RefusalReason {
    // If engine returned a clarify-style response, it's ambiguous
    if (engineResponse && engineResponse.finalText.includes('دقیق‌تر')) {
      return 'ambiguous'
    }
    // Check for non-financial / out-of-scope patterns
    const outOfScopePatterns = [
      /هواشناسی|آب\s*و\s*هوا|هوای|طلا|ارز|بورس|قیمت\s*سکه/i,
      /تعداد\s*کارمندان|لیست\s*پرسنل|حضور\s*و\s*غیاب/i,
      /ثبت\s*فاکتور|چطور\s*ثبت|آموزش/i
    ]
    for (const pattern of outOfScopePatterns) {
      if (pattern.test(prompt)) {
        return 'out_of_scope'
      }
    }
    // If the prompt looks financial but no metric matched
    return 'no_metric'
  }

  /**
   * S31.1: Normalize prompt to a pattern for clustering (PII-stripped, digit-normalized, keyword-extracted).
   */
  private normalizePromptPattern(prompt: string): string {
    // Normalize Persian digits
    let normalized = normalizePersianDigits(prompt)
    // Remove amounts and numbers
    normalized = normalized.replace(/\d[\d,]*(?:\.\d+)?/g, 'N')
    // Remove person names after honorifics
    normalized = normalized.replace(/(آقای|خانم|سرکار)\s+[\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,})?/gu, '$1 [NAME]')
    // Collapse whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim()
    // Extract key financial keywords for pattern matching
    const keywords = [
      'فروش', 'خرید', 'هزینه', 'درآمد', 'ترازنامه', 'سود', 'زیان', 'دارایی',
      'بدهی', 'سرمایه', 'بانک', 'نقد', 'دریافتنی', 'پرداختنی', 'مالیات',
      'استهلاک', 'بودجه', 'گردش', 'مانده', 'پرسنل', 'حقوق', 'بهای',
      'سال', 'ماهانه', 'فصلی', 'مقایسه', 'روند', 'چارت', 'نمودار',
      'طلا', 'ارز', 'بورس', 'سکه', 'کارمندان', 'پرسنل', 'حضور', 'غیاب',
      'هوا', 'آب', 'قیمت', 'تعداد', 'لیست', 'ثبت', 'فاکتور', 'آموزش',
      'چگونه', 'چطور', 'کمک', 'راهنما'
    ]
    const foundKeywords = keywords.filter(kw => normalized.includes(kw))
    // Build pattern: sorted keywords + year placeholder
    const yearPattern = normalized.match(/\b1[34]\d\d\b/) ? 'YEAR' : ''
    return [...foundKeywords.sort(), yearPattern].filter(Boolean).join('+')
  }

  getLoopBudgetSummary(): { maxRounds: number; maxCallsPerRound: number; maxTotalCalls: number } {
    return {
      maxRounds: MAX_TOOL_CALL_ROUNDS,
      maxCallsPerRound: MAX_TOOL_CALLS_PER_ROUND,
      maxTotalCalls: MAX_TOTAL_TOOL_CALLS
    }
  }

  normalizeTableReference(tableRef: string): string {
    return tableRef.trim().toLowerCase()
  }

  resolveColumnNameAlias(columnName: string, availableColumns: string[]): string {
    const lower = columnName.toLowerCase()
    const aliases: Record<string, string[]> = {
      name: ['title', 'accountname', 'account_title'],
      date: ['documentdate', 'voucherdate', 'fiscalyearref'],
      amount: ['debit', 'credit', 'priceinbasecurrency', 'netamount'],
      code: ['accountcode', 'documentno', 'vouchercode']
    }
    for (const [alias, targets] of Object.entries(aliases)) {
      if (lower === alias) {
        for (const target of targets) {
          const found = availableColumns.find((c) => c.toLowerCase() === target)
          if (found) return found
        }
      }
    }
    return columnName
  }

  buildActionProposal(prompt: string, subject: string, priorityCount: number): string {
    const normalizedPrompt = this.compactText(prompt.replace(/\s+/g, ' ').trim(), 220)
    const safePriorityCount = Math.max(1, Math.trunc(priorityCount || 1))

    return [
      '### Summary',
      `پیشنهاد اقدام برای ${subject}: ${normalizedPrompt}`,
      '',
      '### Findings',
      '- این خروجی فقط یک پیشنهاد مدیریتی و قابل بازبینی است و هیچ تغییر داده‌ای اجرا نمی‌کند.',
      `- برای تصمیم‌گیری، ${safePriorityCount} اولویت اصلی با مقایسه‌ی شواهد، ریسک و scope بررسی می‌شود.`,
      '- این پیشنهاد صرفاً برای سناریوهای کم‌ریسک و قابل audit طراحی شده است؛ اقدام واقعی فقط پس از تایید انسانی مجاز است.',
      '',
      '### Evidence',
      '- پیشنهاد بر پایه متن سوال و شواهد مالی موجود در مسیر read-only ساخته می‌شود.',
      '- هر اقدام بعدی باید با تایید انسانی، dry-run و audit کامل همراه باشد.',
      '- بررسی/چک‌لیست تایید انسانی: scope، ریسک، اثر روی داده، خروجی قابل بازبینی و امکان rollback/compensating action.',
      '',
      '### Assumptions',
      '- فرض می‌شود داده‌ها از مسیر قابل اتکا و بدون write operation استخراج شده‌اند.',
      '- اگر سناریو ریسک‌پذیر باشد، پیشنهاد باید به حالت تعلیق و بازبینی انسانی برگردد.',
      '',
      '### Actions',
      '1. مقایسه‌ی نتایج فعلی با baseline و سناریوهای کم‌ریسک.' +
        '\n2. اولویت‌بندی ' +
        `${safePriorityCount}` +
        ' مورد کلیدی برای تایید مدیر.' +
        '\n3. اجرای dry-run و ثبت audit قبل از هر اقدام بعدی.' +
        '\n4. بررسی/چک‌لیست تایید انسانی قبل از هر اقدام واقعی.' +
        '\n5. آماده‌سازی rollback/compensating action و ثبت گزارش before/after برای هر مورد پیشنهادی.'
    ].join('\n')
  }
}
