import type {
  AccountingConceptKey,
  AgentProgressEvent,
  AgentSendMessageRequest,
  AgentSendMessageResult,
  AppSettings,
  GeminiChatResponse,
  GeminiMessage,
  GeminiToolDefinition,
  ResponseEvidenceEntry,
  ResponseMetadata,
  SchemaCatalogEntry,
  SqlQueryRow
} from '../../shared/contracts'
import type { AuditLogEntry } from './auditLogService'
import { type ExecutionTrace, type ToolEvidence } from './evidenceContract'
import { detectFinancialIntent, listFinancialIntentDefinitions } from './financialIntentRegistry'
import { normalizePersianDigits } from './textNormalization'
import type { DeterministicFinancialIntent } from './agentOrchestrator/intentRouting'
import { appearsToContainFinancialClaim as appearsToContainFinancialClaimFn, isFinancialNumericQuery as isFinancialNumericQueryFn } from './agentOrchestrator/routing'
import {
  type ConversationMemorySnapshot,
  type ConversationMemoryState as ConversationMemoryStateType,
  type ExtractedConversationFacts,
  extractConversationFacts as extractConversationFactsFn,
  getOrCreateConversationMemory as getOrCreateConversationMemoryFn,
  pushConversationMemoryNote as pushConversationMemoryNoteFn,
  updateContextEntities as updateContextEntitiesFn,
  pushConversationTurn as pushConversationTurnFn
} from './agentOrchestrator/conversationMemory'
import {
  type ResponseContractDeps,
  type FinancialTemplateSections,
  enforceEvidenceFirstContract as enforceEvidenceFirstContractFn
} from './agentOrchestrator/responseContract'
import {
  type PromptBuilderDeps,
  type PreferredMapping,
  buildRuntimeSystemPrompt as buildRuntimeSystemPromptFn
} from './agentOrchestrator/promptBuilder'
import {
  type SchemaCatalogDeps,
  resolvePreferredMapping as resolvePreferredMappingFn,
  detectPromptConcepts as detectPromptConceptsFn,
  inferDateHintForTable as inferDateHintForTableFn,
  normalizeTableRef as normalizeTableRefFn,
  buildSchemaCatalogContext as buildSchemaCatalogContextFn,
  findActiveSchemaCatalog as findActiveSchemaCatalogFn,
  SCHEMA_CONTEXT_CONCEPT_LABELS
} from './agentOrchestrator/schemaCatalog'
import {
  type EvidenceValidationDeps,
  requiresStrictFinancialDataFetch as requiresStrictFinancialDataFetchFn,
  requiresStrictQuantitativeDataFetch as requiresStrictQuantitativeDataFetchFn,
  hasQuantitativeResultSignal as hasQuantitativeResultSignalFn,
  appearsToBeNoDataResult as appearsToBeNoDataResultFn,
  hasRequiredFinancialResponseSections as hasRequiredFinancialResponseSectionsFn,
  hasStructuredEvidence as hasStructuredEvidenceFn,
  containsUnsupportedNumericClaim as containsUnsupportedNumericClaimFn,
  containsFinancialMarkedNumericClaim as containsFinancialMarkedNumericClaimFn,
  extractNumericClaims as extractNumericClaimsFn,
  traceSupportsNumericClaim as traceSupportsNumericClaimFn,
  enforcePromptIntentAlignment as enforcePromptIntentAlignmentFn,
  parseFinancialTemplateSections as parseFinancialTemplateSectionsFn,
  ensureFinancialResponseTemplate as ensureFinancialResponseTemplateFn
} from './agentOrchestrator/evidenceValidation'
import {
  type TelemetryDeps,
  emitEvidenceContractTelemetry as emitEvidenceContractTelemetryFn
} from './agentOrchestrator/telemetry'
import type { ActiveAgentExecution } from './agentOrchestrator/sendMessage'
import {
  validateIntentTableMatch as validateIntentTableMatchFn
} from './agentOrchestrator/geminiRetry'
import {
  normalizeTableReference as normalizeTableReferenceFn,
  resolveColumnNameAlias as resolveColumnNameAliasFn
} from './agentOrchestrator/schemaCache'

export type ConversationMemoryState = ConversationMemoryStateType

// Budget arithmetic for the capped tool loop used by the production MVP path.
// The runtime policy keeps the loop small to avoid runaway token bleed and noisy retries.
const MAX_TOOL_CALL_ROUNDS = 4
const MAX_TOOL_CALLS_PER_ROUND = 7
const MAX_TOTAL_TOOL_CALLS = 14

export type DeterministicFinancialToolResult = {
  intentId: DeterministicFinancialIntent
  value: number | null
  tableRef: string
  columnName: string
  query: string
  toolCallsUsed: number
}

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
  executeMetadataSql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
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
        prompt: 'engine-no-result: explicit refusal (no legacy fallback)'
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
            prompt: `engine-multi-no-result: ${multi.verdicts.map((v) => v.reason ?? 'ok').join(', ')}`
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
        void this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId: payload.requestId,
          conversationId: payload.conversationId,
          stage: 'engine-mode',
          prompt: `engine-no-result: ${engineRun.verdict.reason ?? 'unknown'}`
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
          prompt: `intent-mismatch: ${intentCheck.reason}`
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

  private get responseContractDeps(): ResponseContractDeps {
    return {
      normalizePersianDigits: (value) => this.normalizePersianDigits(value),
      ensureFinancialResponseTemplate: (rawText, memory, count) =>
        this.ensureFinancialResponseTemplate(rawText, memory, count),
      enforcePromptIntentAlignment: (prompt, text) =>
        this.enforcePromptIntentAlignment(prompt, text),
      validateIntentTableMatch: (intentId, evidence) =>
        this.validateIntentTableMatch(intentId, evidence),
      emitEvidenceContractTelemetry: (requestId, conversationId, failureText, attempts) =>
        this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, attempts),
      appearsToContainFinancialClaim: (text) => this.appearsToContainFinancialClaim(text),
      parseFinancialTemplateSections: (text) => this.parseFinancialTemplateSections(text),
      hasRequiredFinancialResponseSections: (sections) =>
        this.hasRequiredFinancialResponseSections(sections),
      hasStructuredEvidence: (evidence) => this.hasStructuredEvidence(evidence),
      requiresStrictFinancialDataFetch: (prompt, narrative) =>
        this.requiresStrictFinancialDataFetch(prompt, narrative),
      requiresStrictQuantitativeDataFetch: (prompt) =>
        this.requiresStrictQuantitativeDataFetch(prompt),
      hasQuantitativeResultSignal: (narrative) => this.hasQuantitativeResultSignal(narrative),
      appearsToBeNoDataResult: (narrative) => this.appearsToBeNoDataResult(narrative),
      extractNumericClaims: (narrative) => this.extractNumericClaims(narrative),
      containsUnsupportedNumericClaim: (narrative, evidence, sections) =>
        this.containsUnsupportedNumericClaim(narrative, evidence, sections),
      containsFinancialMarkedNumericClaim: (narrative) =>
        this.containsFinancialMarkedNumericClaim(narrative),
      traceSupportsNumericClaim: (trace) => this.traceSupportsNumericClaim(trace)
    }
  }

  private get promptBuilderDeps(): PromptBuilderDeps {
    return {
      compactText: (value, maxLength) => this.compactText(value, maxLength),
      pushConversationMemoryNote: (memory, note) => this.pushConversationMemoryNote(memory, note),
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      detectPromptConcepts: (prompt) => this.detectPromptConcepts(prompt),
      resolvePreferredMapping: (catalog, conceptKey, prompt) =>
        this.resolvePreferredMapping(catalog, conceptKey, prompt),
      inferDateHintForTable: (catalog, tableRef) => this.inferDateHintForTable(catalog, tableRef),
      extractConversationFacts: (text) => this.extractConversationFacts(text),
      buildSchemaCatalogContext: (settings) => this.buildSchemaCatalogContext(settings),
      schemaContextConceptLabels: SCHEMA_CONTEXT_CONCEPT_LABELS
    }
  }

  private get schemaCatalogDeps(): SchemaCatalogDeps {
    return {
      normalizePersianDigits: (value) => this.normalizePersianDigits(value),
      compactText: (value, maxLength) => this.compactText(value, maxLength)
    }
  }

  private get evidenceValidationDeps(): EvidenceValidationDeps {
    return {
      normalizePersianDigits: (value) => this.normalizePersianDigits(value),
      compactText: (value, maxLength) => this.compactText(value, maxLength),
      detectDeterministicFinancialIntent: (prompt) =>
        this.detectDeterministicFinancialIntent(prompt)
    }
  }

  private get telemetryDeps(): TelemetryDeps {
    return {
      capture: this.telemetry?.capture.bind(this.telemetry)
    }
  }

  private extractConversationFacts(text: string): ExtractedConversationFacts {
    return extractConversationFactsFn(text)
  }

  private normalizePersianDigits(value: string): string {
    return normalizePersianDigits(value)
  }

  private pushConversationMemoryNote(memory: ConversationMemoryState, note: string): void {
    pushConversationMemoryNoteFn(memory, note)
  }

  buildRuntimeSystemPrompt(
    settings: AppSettings,
    prompt: string,
    conversationMemory: ConversationMemoryState,
    previousMemorySnapshot: ConversationMemorySnapshot
  ): string {
    return buildRuntimeSystemPromptFn(
      this.promptBuilderDeps,
      settings,
      prompt,
      conversationMemory,
      previousMemorySnapshot
    )
  }

  private resolvePreferredMapping(
    activeCatalog: SchemaCatalogEntry,
    conceptKey: AccountingConceptKey,
    prompt?: string
  ): PreferredMapping | null {
    return resolvePreferredMappingFn(this.schemaCatalogDeps, activeCatalog, conceptKey, prompt)
  }

  private detectPromptConcepts(prompt: string): AccountingConceptKey[] {
    return detectPromptConceptsFn(prompt)
  }

  private inferDateHintForTable(
    activeCatalog: SchemaCatalogEntry,
    tableRef: string
  ): string | null {
    return inferDateHintForTableFn(activeCatalog, tableRef)
  }

  private normalizeTableRef(tableRef: string): string {
    return normalizeTableRefFn(tableRef)
  }

  normalizeTableReference(tableRef: string): string {
    return normalizeTableReferenceFn(this.normalizeTableRef.bind(this), tableRef)
  }

  resolveColumnNameAlias(columnName: string, availableColumns: string[]): string {
    return resolveColumnNameAliasFn(columnName, availableColumns)
  }

  getLoopBudgetSummary(): { maxRounds: number; maxCallsPerRound: number; maxTotalCalls: number } {
    return {
      maxRounds: MAX_TOOL_CALL_ROUNDS,
      maxCallsPerRound: MAX_TOOL_CALLS_PER_ROUND,
      maxTotalCalls: MAX_TOTAL_TOOL_CALLS
    }
  }

  private validateIntentTableMatch(
    intentId: string | undefined,
    evidence: ToolEvidence[]
  ): string | null {
    return validateIntentTableMatchFn(intentId, evidence)
  }

  private buildSchemaCatalogContext(settings: AppSettings): string | null {
    return buildSchemaCatalogContextFn(this.schemaCatalogDeps, settings)
  }

  private findActiveSchemaCatalog(settings: AppSettings): SchemaCatalogEntry | null {
    return findActiveSchemaCatalogFn(settings)
  }

  private compactText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim()

    if (normalized.length <= maxLength) {
      return normalized
    }

    return `${normalized.slice(0, maxLength - 1)}…`
  }

  private detectDeterministicFinancialIntent(prompt: string): DeterministicFinancialIntent | null {
    // Thin adapter: routing is fully data-driven through the weighted intent registry.
    // The deterministic gate simply honors intents whose responseMode is 'deterministic'.
    const matchedIntent = detectFinancialIntent(prompt)

    if (!matchedIntent) {
      return null
    }

    const definition = listFinancialIntentDefinitions().find(
      (entry) => entry.id === matchedIntent.intentId
    )

    if (definition?.responseMode === 'deterministic') {
      return matchedIntent.intentId as DeterministicFinancialIntent
    }

    return null
  }

  /**
   * H3: detect a multi-period comparative financial intent — e.g.
   * "فروش 1403 در مقابل 1402" or "مقایسه خرید سال X و Y" — even when no percent
   * is requested. The orchestrator must run at least one `fetch_financial_data`
   * per period; exiting with fewer than 2 successful fetches is a NO_FETCH-grade
   * defect for such prompts.
   */
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

  enforceEvidenceFirstContract(
    prompt: string,
    finalText: string,
    totalToolCallCount: number,
    successfulDataFetchCount: number,
    executionTrace?: ExecutionTrace,
    recoveryContext?: { attempts: number },
    requestId?: string,
    conversationId?: string
  ): string {
    return enforceEvidenceFirstContractFn(
      this.responseContractDeps,
      prompt,
      finalText,
      totalToolCallCount,
      successfulDataFetchCount,
      executionTrace,
      recoveryContext,
      requestId,
      conversationId
    )
  }

  private requiresStrictFinancialDataFetch(prompt: string, narrative: string): boolean {
    return requiresStrictFinancialDataFetchFn(this.evidenceValidationDeps, prompt, narrative)
  }

  private requiresStrictQuantitativeDataFetch(prompt: string): boolean {
    return requiresStrictQuantitativeDataFetchFn(this.evidenceValidationDeps, prompt)
  }

  private hasQuantitativeResultSignal(text: string): boolean {
    return hasQuantitativeResultSignalFn(this.evidenceValidationDeps, text)
  }

  private appearsToBeNoDataResult(text: string): boolean {
    return appearsToBeNoDataResultFn(this.evidenceValidationDeps, text)
  }

  private appearsToContainFinancialClaim(text: string): boolean {
    return appearsToContainFinancialClaimFn(text)
  }

  private hasRequiredFinancialResponseSections(sections: FinancialTemplateSections): boolean {
    return hasRequiredFinancialResponseSectionsFn(sections)
  }

  private hasStructuredEvidence(evidenceSection: string): boolean {
    return hasStructuredEvidenceFn(this.evidenceValidationDeps, evidenceSection)
  }

  private containsUnsupportedNumericClaim(
    narrative: string,
    evidence: string,
    sections: FinancialTemplateSections
  ): boolean {
    return containsUnsupportedNumericClaimFn(
      this.evidenceValidationDeps,
      narrative,
      evidence,
      sections
    )
  }

  /**
   * H1: detect whether the narrative contains a *financial* numeric claim —
   * a number paired with a currency marker (تومان/ریال/$/IRR), a percent sign,
   * or a financial keyword (مبلغ/موجودی/مانده/جمع/...). Bare scope numbers like
   * fiscal years (e.g. "FiscalYearRef = 1403") must not count, so an honest
   * VALID_EMPTY response that merely echoes the queried scope is not rejected.
   */
  private containsFinancialMarkedNumericClaim(narrative: string): boolean {
    return containsFinancialMarkedNumericClaimFn(this.evidenceValidationDeps, narrative)
  }

  private extractNumericClaims(text: string): string[] {
    return extractNumericClaimsFn(this.evidenceValidationDeps, text)
  }

  private traceSupportsNumericClaim(trace: ExecutionTrace | undefined): boolean {
    return traceSupportsNumericClaimFn(trace)
  }

  private emitEvidenceContractTelemetry(
    requestId: string | undefined,
    conversationId: string | undefined,
    finalText: string,
    recoveryAttempts?: number
  ): void {
    emitEvidenceContractTelemetryFn(
      this.telemetryDeps,
      requestId,
      conversationId,
      finalText,
      recoveryAttempts
    )
  }

  private enforcePromptIntentAlignment(prompt: string, finalText: string): string {
    return enforcePromptIntentAlignmentFn(this.evidenceValidationDeps, prompt, finalText)
  }

  private ensureFinancialResponseTemplate(
    rawText: string,
    conversationMemory: ConversationMemoryState,
    totalToolCallCount: number
  ): string {
    return ensureFinancialResponseTemplateFn(
      this.evidenceValidationDeps,
      rawText,
      conversationMemory,
      totalToolCallCount
    )
  }

  private parseFinancialTemplateSections(text: string): FinancialTemplateSections {
    return parseFinancialTemplateSectionsFn(text)
  }
}
