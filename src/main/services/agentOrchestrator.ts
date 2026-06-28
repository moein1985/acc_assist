import { Parser } from 'node-sql-parser'

import type {
  AccountingConceptKey,
  AgentEvidencePreview,
  AgentProgressEvent,
  AgentSendMessageRequest,
  AgentSendMessageResult,
  AppSettings,
  GeminiChatResponse,
  GeminiMessage,
  GeminiToolCall,
  GeminiToolDefinition,
  SchemaCatalogEntry,
  SchemaColumnCatalogItem,
  SqlQueryRow
} from '../../shared/contracts'
import type { AuditLogEntry } from './auditLogService'
import { type ExecutionTrace, type ToolEvidence, type ToolFailureKind } from './evidenceContract'
import { detectFinancialIntent, listFinancialIntentDefinitions } from './financialIntentRegistry'
import { SqlPolicyViolationError } from './sqlConnectionManager'
import { normalizePersianDigits } from './textNormalization'
import type { DeterministicFinancialIntent } from './agentOrchestrator/intentRouting'
import { resolveDeterministicFinancialTool } from './agentOrchestrator/deterministicTools'
import {
  appearsToContainFinancialClaim as appearsToContainFinancialClaimFn,
  isComparativeMultiPeriodPrompt as isComparativeMultiPeriodPromptFn,
  isSalesGrowthPercentPrompt as isSalesGrowthPercentPromptFn
} from './agentOrchestrator/routing'
import {
  composeSalesGrowthFallbackMarkdown as composeSalesGrowthFallbackMarkdownFn,
  tryResolveSalesGrowthPercentFallback as tryResolveSalesGrowthPercentFallbackFn,
  type SalesGrowthDeps,
  type SalesGrowthFallbackResult
} from './agentOrchestrator/salesGrowth'
import {
  type ConversationMemoryDeps,
  type ConversationMemorySnapshot,
  type ConversationMemoryState as ConversationMemoryStateType,
  type ExtractedConversationFacts,
  createConversationMemorySnapshot as createConversationMemorySnapshotFn,
  extractConversationFacts as extractConversationFactsFn,
  getOrCreateConversationMemory as getOrCreateConversationMemoryFn,
  mergeScopeValues as mergeScopeValuesFn,
  pruneConversationMemory as pruneConversationMemoryFn,
  pushConversationMemoryNote as pushConversationMemoryNoteFn,
  rememberToolTrace as rememberToolTraceFn,
  updateConversationMemoryFromAssistant as updateConversationMemoryFromAssistantFn
} from './agentOrchestrator/conversationMemory'
import {
  type ResponseContractDeps,
  type FinancialTemplateSections,
  enforceEvidenceFirstContract as enforceEvidenceFirstContractFn,
  finalizeFinancialResponse as finalizeFinancialResponseFn
} from './agentOrchestrator/responseContract'
import {
  type SqlExecutionDeps,
  type ExtractedTableReference,
  type RuntimeScopeColumnCandidate,
  throwIfRequestCanceled as throwIfRequestCanceledFn,
  isCancellationLikeError as isCancellationLikeErrorFn,
  resolveCancellationError as resolveCancellationErrorFn,
  parseSqlTableReference as parseSqlTableReferenceFn,
  ensureFinancialQueryAllowed as ensureFinancialQueryAllowedFn
} from './agentOrchestrator/sqlExecution'
import {
  type PromptBuilderDeps,
  type PreferredMapping,
  compactHistory as compactHistoryFn,
  buildRuntimeSystemPrompt as buildRuntimeSystemPromptFn,
  isLikelyRefinementPrompt as isLikelyRefinementPromptFn
} from './agentOrchestrator/promptBuilder'
import {
  type ClarificationDeps,
  buildDeterministicIntentClarificationResponse as buildDeterministicIntentClarificationResponseFn,
  buildClarificationResponseIfNeeded as buildClarificationResponseIfNeededFn
} from './agentOrchestrator/clarification'
import {
  type SchemaCatalogDeps,
  resolvePreferredMapping as resolvePreferredMappingFn,
  detectPromptConcepts as detectPromptConceptsFn,
  inferDateHintForTable as inferDateHintForTableFn,
  normalizeTableRef as normalizeTableRefFn,
  buildSchemaCatalogContext as buildSchemaCatalogContextFn,
  findActiveSchemaCatalog as findActiveSchemaCatalogFn,
  collectRuntimeScopeColumnCandidates as collectRuntimeScopeColumnCandidatesFn,
  SCHEMA_CONTEXT_CONCEPT_ORDER,
  SCHEMA_CONTEXT_CONCEPT_LABELS
} from './agentOrchestrator/schemaCatalog'
import {
  type FiscalYearFallbackDeps,
  type FiscalYearFallbackResult,
  tryResolveFiscalYearFallback as tryResolveFiscalYearFallbackFn,
  composeDeterministicFinancialToolMarkdown as composeDeterministicFinancialToolMarkdownFn,
  composeFiscalYearDeterministicMarkdown as composeFiscalYearDeterministicMarkdownFn
} from './agentOrchestrator/fiscalYearFallback'
import {
  type RedactedRowsResult,
  type LimitedRowsForModelResult,
  redactSensitiveIdentifiers as redactSensitiveIdentifiersFn,
  limitRowsForModel as limitRowsForModelFn,
  rowsContainNonNullValue as rowsContainNonNullValueFn,
  createEvidencePreview as createEvidencePreviewFn
} from './agentOrchestrator/rowUtils'
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
  emitEvidenceContractTelemetry as emitEvidenceContractTelemetryFn,
  emitGuardrailTelemetry as emitGuardrailTelemetryFn,
  emitGuardrailCounterTelemetry as emitGuardrailCounterTelemetryFn
} from './agentOrchestrator/telemetry'
import {
  quoteSqlIdentifier as quoteSqlIdentifierFn,
  quoteSqlTableRef as quoteSqlTableRefFn,
  toFiniteInteger as toFiniteIntegerFn,
  toSafeNumber as toSafeNumberFn,
  toOptionalFiniteInteger as toOptionalFiniteIntegerFn,
  buildPendingToolStatusText as buildPendingToolStatusTextFn,
  buildCatalogScanQuery as buildCatalogScanQueryFn,
  buildListDatabaseTablesQuery as buildListDatabaseTablesQueryFn,
  buildDatabaseSchemaQueryWrapper as buildDatabaseSchemaQueryWrapperFn
} from './agentOrchestrator/sqlUtils'
import {
  type ToolExecutionDeps,
  executeFinancialToolCalls as executeFinancialToolCallsFn
} from './agentOrchestrator/toolExecution'
import {
  type SendMessageDeps,
  sendMessage as sendMessageFn,
  type ActiveAgentExecution
} from './agentOrchestrator/sendMessage'

import {
  type GeminiRetryDeps,
  buildExhaustionFallbackAnswer as buildExhaustionFallbackAnswerFn,
  callGeminiWithProviderRetry as callGeminiWithProviderRetryFn,
  shouldReturnDegradedFallback as shouldReturnDegradedFallbackFn,
  buildRuntimeFailureFallbackAnswer as buildRuntimeFailureFallbackAnswerFn,
  validateIntentTableMatch as validateIntentTableMatchFn,
  buildRecoveryHint as buildRecoveryHintFn
} from './agentOrchestrator/geminiRetry'
import {
  type SchemaCacheDeps,
  fetchTableListCached as fetchTableListCachedFn,
  prevalidateFinancialQuery as prevalidateFinancialQueryFn,
  getCachedSchemaSnapshot as getCachedSchemaSnapshotFn,
  normalizeTableReference as normalizeTableReferenceFn,
  resolveColumnNameAlias as resolveColumnNameAliasFn
} from './agentOrchestrator/schemaCache'

export type ConversationMemoryState = ConversationMemoryStateType

// Budget arithmetic for the capped tool loop used by the production MVP path.
// The runtime policy keeps the loop small to avoid runaway token bleed and noisy retries.
const MAX_TOOL_CALL_ROUNDS = 4
const MAX_TOOL_CALLS_PER_ROUND = 7
const MAX_TOTAL_TOOL_CALLS = 14
const MAX_SCHEMA_ROWS = 240
const MAX_TABLE_LIST_ROWS = 500
const MAX_TOOL_PAYLOAD_CHARS = 90000
const MAX_TOOL_VALUE_CHARS = 500

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
  private readonly sqlParser = new Parser()
  private readonly geminiClient: AgentOrchestratorDeps['geminiClient']
  private readonly getSettings: () => AppSettings
  private readonly executeReadOnlySql: (
    query: string,
    signal?: AbortSignal
  ) => Promise<SqlQueryRow[]>
  private readonly executeMetadataSql: (
    query: string,
    signal?: AbortSignal
  ) => Promise<SqlQueryRow[]>
  private readonly auditLog: AgentOrchestratorDeps['auditLog']
  private readonly telemetry?: AgentOrchestratorDeps['telemetry']
  private readonly mobileBridge?: AgentOrchestratorDeps['mobileBridge']
  private readonly activeExecutions = new Map<string, ActiveAgentExecution>()
  private readonly conversationMemoryById = new Map<string, ConversationMemoryState>()
  private readonly schemaCacheByTableKey = new Map<
    string,
    { schema: SchemaColumnCatalogItem[]; timestamp: number }
  >()
  private readonly schemaTableListCache = new Map<
    string,
    { rows: SqlQueryRow[]; timestamp: number }
  >()
  private readonly SCHEMA_CACHE_TTL_MS = 900000

  private get salesGrowthDeps(): SalesGrowthDeps {
    return {
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      resolvePreferredMapping: (catalog, conceptKey, prompt) =>
        this.resolvePreferredMapping(catalog, conceptKey, prompt),
      normalizeTableRef: (tableRef) => this.normalizeTableRef(tableRef),
      quoteSqlTableRef: (ref) => this.quoteSqlTableRef(ref),
      executeReadOnlySql: (query, signal) => this.executeReadOnlySql(query, signal),
      toSafeNumber: (value) => this.toSafeNumber(value),
      rememberToolTrace: (memory, trace) => this.rememberToolTrace(memory, trace),
      throwIfRequestCanceled: (signal) => this.throwIfRequestCanceled(signal),
      safeAuditWrite: (entry) => this.safeAuditWrite(entry),
      compactText: (value, maxLength) => this.compactText(value, maxLength)
    }
  }

  constructor(deps: AgentOrchestratorDeps) {
    this.geminiClient = deps.geminiClient
    this.getSettings = deps.getSettings
    this.executeReadOnlySql = deps.executeReadOnlySql
    this.executeMetadataSql = deps.executeMetadataSql
    this.auditLog = deps.auditLog
    this.telemetry = deps.telemetry
    this.mobileBridge = deps.mobileBridge
  }

  async sendMessage(
    payload: AgentSendMessageRequest,
    onProgress?: (event: AgentProgressEvent) => void
  ): Promise<AgentSendMessageResult> {
    const mode =
      process.env.ACC_FINANCIAL_ENGINE_MODE ?? this.getSettings().financialEngineMode ?? 'legacy'
    void this.safeAuditWrite({
      timestamp: new Date().toISOString(),
      requestId: payload.requestId,
      conversationId: payload.conversationId,
      stage: 'engine-mode',
      prompt: `FINANCIAL_ENGINE_MODE=${mode}`
    })

    if (mode === 'engine') {
      const engineResponse = await this.tryEngineResponse(payload)
      if (engineResponse !== null) {
        return engineResponse
      }
      // Engine failed → degrade to legacy
      void this.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        stage: 'engine-mode',
        prompt: 'engine-degraded-to-legacy'
      })
    }

    const result = await sendMessageFn(this.sendMessageDeps, payload, onProgress)

    if (mode === 'shadow') {
      void this.runShadowComparison(payload, result.finalText)
    }

    return result
  }

  private async tryEngineResponse(
    payload: AgentSendMessageRequest
  ): Promise<AgentSendMessageResult | null> {
    try {
      const { FinancialEngine } = await import('./financialEngine/index')
      const { quoteSqlIdentifier, quoteSqlTableRef } = await import('./agentOrchestrator/sqlUtils')
      const { normalizePersianText } = await import('./textNormalization')
      const { composeEngineResponseMarkdown, composeMultiMetricMarkdown } = await import('./financialEngine/explainer')
      const { checkIntentAlignment } = await import('./financialEngine/verifier')

      const engine = new FinancialEngine({
        quoteSqlTableRef,
        quoteSqlIdentifier,
        normalizePersianText,
        executeReadOnlySql: (query, signal) => this.executeReadOnlySql(query, signal ?? undefined)
      })

      // S14.41: Pass lastMetricPlan from conversation memory for drill-down follow-up
      const memory = this.getOrCreateConversationMemory(payload.conversationId)
      const engineRun = await engine.run(payload.prompt, undefined, memory.lastMetricPlan)

      // Handle multi-metric result (has 'results' array)
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

        const finalText = composeMultiMetricMarkdown(multi, payload.prompt)
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
      const intentCheck = checkIntentAlignment(payload.prompt, engineRun.result.plan)
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

      return {
        history: [],
        finalText,
        rounds: 1,
        toolCallsUsed: 1
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

  private async runShadowComparison(
    payload: AgentSendMessageRequest,
    legacyText: string
  ): Promise<void> {
    try {
      const { FinancialEngine } = await import('./financialEngine/index')
      const { quoteSqlIdentifier, quoteSqlTableRef } = await import('./agentOrchestrator/sqlUtils')
      const { normalizePersianText } = await import('./textNormalization')

      const engine = new FinancialEngine({
        quoteSqlTableRef,
        quoteSqlIdentifier,
        normalizePersianText,
        executeReadOnlySql: (query, signal) => this.executeReadOnlySql(query, signal ?? undefined)
      })

      const engineResult = await engine.run(payload.prompt)

      const legacyNumbers = (legacyText.match(/[\d,]{4,}/g) ?? []).sort(
        (a, b) => b.length - a.length
      )
      const legacyValue = legacyNumbers.length > 0 ? legacyNumbers[0]!.replace(/,/g, '') : null

      let engineValue: string | null = null
      let metricId: string | null = null
      if ('results' in engineResult && 'verdicts' in engineResult) {
        // Multi-metric: skip shadow comparison for multi-metric plans
        return
      }
      if (engineResult.result && engineResult.result.rows.length > 0) {
        const row = engineResult.result.rows[0]
        const raw = row['result_value'] ?? row['base_value']
        if (raw != null) {
          engineValue = String(raw)
          metricId = engineResult.result.plan.metricId
        }
      }

      const match = legacyValue !== null && engineValue !== null && legacyValue === engineValue

      void this.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        stage: 'engine-shadow-compare',
        prompt: `metricId=${metricId ?? 'null'} legacyValue=${legacyValue ?? 'null'} engineValue=${engineValue ?? 'null'} match=${match}`
      })
    } catch (error) {
      void this.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        stage: 'engine-shadow-compare',
        prompt: `error=${error instanceof Error ? error.message : String(error)}`
      })
    }
  }

  private get sendMessageDeps(): SendMessageDeps {
    return {
      activeExecutions: this.activeExecutions,
      getOrCreateConversationMemory: (conversationId) =>
        this.getOrCreateConversationMemory(conversationId),
      createConversationMemorySnapshot: (memory) => this.createConversationMemorySnapshot(memory),
      pruneConversationMemory: () => this.pruneConversationMemory(),
      isLikelyRefinementPrompt: (previousMemory, prompt) =>
        this.isLikelyRefinementPrompt(previousMemory, prompt),
      safeAuditWrite: (entry) => this.safeAuditWrite(entry),
      emitProgress: (onProgress, event) => this.emitProgress(onProgress, event),
      throwIfRequestCanceled: (signal) => this.throwIfRequestCanceled(signal),
      getSettings: () => this.getSettings(),
      refreshConversationMemory: (memory, settings, history, prompt) =>
        this.refreshConversationMemory(memory, settings, history, prompt),
      buildRuntimeSystemPrompt: (settings, prompt, conversationMemory, previousMemorySnapshot) =>
        this.buildRuntimeSystemPrompt(settings, prompt, conversationMemory, previousMemorySnapshot),
      compactHistory: (history, memory) => this.compactHistory(history, memory),
      detectDeterministicFinancialIntent: (prompt) =>
        this.detectDeterministicFinancialIntent(prompt),
      buildClarificationResponseIfNeeded: (settings, prompt, conversationMemory) =>
        this.buildClarificationResponseIfNeeded(settings, prompt, conversationMemory),
      tryResolveDeterministicFinancialTool: (
        deterministicIntent,
        settings,
        conversationMemory,
        signal,
        onProgress,
        prompt
      ) =>
        this.tryResolveDeterministicFinancialTool(
          deterministicIntent,
          settings,
          conversationMemory,
          signal,
          onProgress,
          prompt
        ),
      finalizeFinancialResponse: (
        prompt,
        rawText,
        conversationMemory,
        totalToolCallCount,
        successfulDataFetchCount,
        routeMode,
        executionTrace,
        recoveryContext,
        requestId
      ) =>
        this.finalizeFinancialResponse(
          prompt,
          rawText,
          conversationMemory,
          totalToolCallCount,
          successfulDataFetchCount,
          routeMode,
          executionTrace,
          recoveryContext,
          requestId
        ),
      composeDeterministicFinancialToolMarkdown: (deterministicIntent, result) =>
        this.composeDeterministicFinancialToolMarkdown(deterministicIntent, result),
      updateConversationMemoryFromAssistant: (memory, finalText) =>
        this.updateConversationMemoryFromAssistant(memory, finalText),
      buildDeterministicIntentClarificationResponse: (intentId) =>
        this.buildDeterministicIntentClarificationResponse(intentId),
      tryResolveFiscalYearFallback: (
        deterministicIntent,
        settings,
        conversationMemory,
        signal,
        onProgress
      ) =>
        this.tryResolveFiscalYearFallback(
          deterministicIntent,
          settings,
          conversationMemory,
          signal,
          onProgress
        ),
      composeFiscalYearDeterministicMarkdown: (deterministicIntent, result) =>
        this.composeFiscalYearDeterministicMarkdown(deterministicIntent, result),
      isSalesGrowthPercentPrompt: (prompt) => this.isSalesGrowthPercentPrompt(prompt),
      tryResolveSalesGrowthPercentFallback: (prompt, conversationMemory, signal) =>
        this.tryResolveSalesGrowthPercentFallback(prompt, conversationMemory, signal),
      composeSalesGrowthFallbackMarkdown: (result) =>
        this.composeSalesGrowthFallbackMarkdown(result),
      callGeminiWithProviderRetry: (payload, savedConfig, abortSignal, onProgress) =>
        this.callGeminiWithProviderRetry(payload, savedConfig, abortSignal, onProgress),
      toErrorInfo: (error) => this.toErrorInfo(error),
      shouldReturnDegradedFallback: (error) => this.shouldReturnDegradedFallback(error),
      emitGuardrailTelemetry: (kind, requestId, conversationId, details) =>
        this.emitGuardrailTelemetry(kind, requestId, conversationId, details),
      emitGuardrailCounterTelemetry: (kind, requestId, conversationId, count) =>
        this.emitGuardrailCounterTelemetry(kind, requestId, conversationId, count),
      buildRuntimeFailureFallbackAnswer: (
        prompt,
        detail,
        toolCallsUsed,
        successfulDataFetches,
        kind
      ) =>
        this.buildRuntimeFailureFallbackAnswer(
          prompt,
          detail,
          toolCallsUsed,
          successfulDataFetches,
          kind
        ),
      extractToolCallsFromResponse: (response) => this.extractToolCallsFromResponse(response),
      requiresStrictFinancialDataFetch: (prompt, narrative) =>
        this.requiresStrictFinancialDataFetch(prompt, narrative),
      isComparativeMultiPeriodPrompt: (prompt) => this.isComparativeMultiPeriodPrompt(prompt),
      buildRecoveryHint: (
        failureKind,
        lastErrorCode,
        lastErrorMessage,
        evidence,
        context,
        prompt
      ) =>
        this.buildRecoveryHint(
          failureKind,
          lastErrorCode,
          lastErrorMessage,
          evidence,
          context,
          prompt
        ),
      executeFinancialToolCalls: (params) => this.executeFinancialToolCalls(params),
      buildExhaustionFallbackAnswer: (prompt, history, toolCallsUsed, successfulDataFetches) =>
        this.buildExhaustionFallbackAnswer(prompt, history, toolCallsUsed, successfulDataFetches),
      resolveCancellationError: (error, signal) => this.resolveCancellationError(error, signal),
      telemetryCapture: this.telemetry?.capture.bind(this.telemetry)
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

  private async executeFinancialToolCalls(params: {
    requestId: string
    conversationId: string
    round: number
    toolCalls: GeminiToolCall[]
    settings: AppSettings
    conversationMemory: ConversationMemoryState
    onProgress?: (event: AgentProgressEvent) => void
    abortSignal: AbortSignal
  }): Promise<{
    toolMessages: GeminiMessage[]
    successfulDataFetches: number
    evidence: ToolEvidence[]
  }> {
    return executeFinancialToolCallsFn(this.toolExecutionDeps, params)
  }

  private rowsContainNonNullValue(rows: SqlQueryRow[]): boolean {
    return rowsContainNonNullValueFn(rows)
  }

  private emitProgress(
    onProgress: ((event: AgentProgressEvent) => void) | undefined,
    event: AgentProgressEvent
  ): void {
    if (onProgress) {
      onProgress(event)
    }

    if (this.mobileBridge) {
      this.mobileBridge.broadcast({
        type: 'agent:progress',
        payload: event
      })
    }
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

  private toErrorInfo(error: unknown): {
    message: string
    code?: string
    category?: string
  } {
    if (error instanceof SqlPolicyViolationError) {
      return {
        message: error.message,
        code: error.code,
        category: error.category
      }
    }

    if (error instanceof Error) {
      const errorWithMetadata = error as Error & {
        code?: unknown
        category?: unknown
      }

      return {
        message: error.message,
        code: typeof errorWithMetadata.code === 'string' ? errorWithMetadata.code : undefined,
        category:
          typeof errorWithMetadata.category === 'string' ? errorWithMetadata.category : undefined
      }
    }

    return {
      message: String(error)
    }
  }

  private createAgentPolicyError(
    code: string,
    message: string
  ): Error & {
    code: string
    category: string
  } {
    const error = new Error(message) as Error & {
      code: string
      category: string
    }

    error.code = code
    error.category = 'orchestration-policy'

    return error
  }

  private throwIfRequestCanceled(signal: AbortSignal): void {
    throwIfRequestCanceledFn(signal)
  }

  private resolveCancellationError(error: unknown, signal: AbortSignal): Error {
    return resolveCancellationErrorFn(error, signal)
  }

  private isCancellationLikeError(error: unknown): boolean {
    return isCancellationLikeErrorFn(error)
  }

  private getOrCreateConversationMemory(conversationId: string): ConversationMemoryState {
    return getOrCreateConversationMemoryFn(this.conversationMemoryById, conversationId)
  }

  private createConversationMemorySnapshot(
    memory: ConversationMemoryState
  ): ConversationMemorySnapshot {
    return createConversationMemorySnapshotFn(memory)
  }

  private pruneConversationMemory(): void {
    pruneConversationMemoryFn(this.conversationMemoryById)
  }

  private get conversationMemoryDeps(): ConversationMemoryDeps {
    return {
      compactText: (value, maxLength) => this.compactText(value, maxLength)
    }
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

  private get sqlExecutionDeps(): SqlExecutionDeps {
    return {
      normalizePersianDigits: (value) => this.normalizePersianDigits(value),
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      normalizeTableRef: (tableRef) => this.normalizeTableRef(tableRef),
      createAgentPolicyError: (code, message) => this.createAgentPolicyError(code, message),
      collectRuntimeScopeColumnCandidates: (catalog) =>
        this.collectRuntimeScopeColumnCandidates(catalog),
      sqlParser: this.sqlParser,
      schemaContextConceptOrder: SCHEMA_CONTEXT_CONCEPT_ORDER
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

  private get clarificationDeps(): ClarificationDeps {
    return {
      createConversationMemorySnapshot: (memory) => this.createConversationMemorySnapshot(memory),
      detectPromptConcepts: (prompt) => this.detectPromptConcepts(prompt),
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      detectDeterministicFinancialIntent: (prompt) =>
        this.detectDeterministicFinancialIntent(prompt),
      resolvePreferredMapping: (catalog, conceptKey, prompt) =>
        this.resolvePreferredMapping(catalog, conceptKey, prompt),
      extractConversationFacts: (text) => this.extractConversationFacts(text),
      normalizePersianDigits: (value) => this.normalizePersianDigits(value),
      schemaContextConceptLabels: SCHEMA_CONTEXT_CONCEPT_LABELS
    }
  }

  private get schemaCatalogDeps(): SchemaCatalogDeps {
    return {
      normalizePersianDigits: (value) => this.normalizePersianDigits(value),
      compactText: (value, maxLength) => this.compactText(value, maxLength)
    }
  }

  private get fiscalYearFallbackDeps(): FiscalYearFallbackDeps {
    return {
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      collectRuntimeScopeColumnCandidates: (catalog) =>
        this.collectRuntimeScopeColumnCandidates(catalog),
      executeMetadataSql: (sql, signal) => this.executeMetadataSql(sql, signal),
      executeReadOnlySql: (sql, signal) => this.executeReadOnlySql(sql, signal),
      throwIfRequestCanceled: (signal) => this.throwIfRequestCanceled(signal),
      parseSqlTableReference: (rawRef) => this.parseSqlTableReference(rawRef),
      quoteSqlIdentifier: (value) => this.quoteSqlIdentifier(value),
      toFiniteInteger: (value) => this.toFiniteInteger(value),
      toOptionalFiniteInteger: (value) => this.toOptionalFiniteInteger(value),
      rememberToolTrace: (memory, trace) => this.rememberToolTrace(memory, trace),
      emitProgress: (progressCallback, event) => this.emitProgress(progressCallback, event)
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

  private get toolExecutionDeps(): ToolExecutionDeps {
    return {
      throwIfRequestCanceled: (signal) => this.throwIfRequestCanceled(signal),
      buildPendingToolStatusText: (toolName, args) =>
        this.buildPendingToolStatusText(toolName, args),
      emitProgress: (onProgress, event) => this.emitProgress(onProgress, event),
      safeAuditWrite: (entry) => this.safeAuditWrite(entry),
      buildCatalogScanQuery: (tablePattern, limit) =>
        this.buildCatalogScanQuery(tablePattern, limit),
      executeMetadataSql: (query, signal) => this.executeMetadataSql(query, signal),
      rememberToolTrace: (memory, trace) => this.rememberToolTrace(memory, trace),
      limitRowsForModel: (rows) => this.limitRowsForModel(rows),
      createToolResponseMessage: (toolCall, data) => this.createToolResponseMessage(toolCall, data),
      buildListDatabaseTablesQuery: (tablePattern) =>
        this.buildListDatabaseTablesQuery(tablePattern),
      fetchTableListCached: (tablePattern, sqlQuery, abortSignal) =>
        this.fetchTableListCached(tablePattern, sqlQuery, abortSignal),
      compactText: (value, maxLength) => this.compactText(value, maxLength),
      emitGuardrailTelemetry: (kind, requestId, conversationId, details) =>
        this.emitGuardrailTelemetry(kind, requestId, conversationId, details),
      emitGuardrailCounterTelemetry: (kind, requestId, conversationId, count) =>
        this.emitGuardrailCounterTelemetry(kind, requestId, conversationId, count),
      createAgentPolicyError: (code, message) => this.createAgentPolicyError(code, message),
      prevalidateFinancialQuery: (sqlQuery, settings) =>
        this.prevalidateFinancialQuery(sqlQuery, settings),
      ensureFinancialQueryAllowed: (sqlQuery, settings, conversationMemory) =>
        this.ensureFinancialQueryAllowed(sqlQuery, settings, conversationMemory),
      executeReadOnlySql: (query, signal) => this.executeReadOnlySql(query, signal),
      rowsContainNonNullValue: (rows) => this.rowsContainNonNullValue(rows),
      redactSensitiveIdentifiers: (rows) => this.redactSensitiveIdentifiers(rows),
      createEvidencePreview: (sqlQuery, rows, rowCount, truncated) =>
        this.createEvidencePreview(sqlQuery, rows, rowCount, truncated),
      buildDatabaseSchemaQuery: (tableName, schemaName) =>
        this.buildDatabaseSchemaQuery(tableName, schemaName),
      getCachedSchemaSnapshot: (cacheKey, sqlQuery, abortSignal) =>
        this.getCachedSchemaSnapshot(cacheKey, sqlQuery, abortSignal),
      isCancellationLikeError: (error) => this.isCancellationLikeError(error),
      resolveCancellationError: (error, signal) => this.resolveCancellationError(error, signal),
      toErrorInfo: (error) => this.toErrorInfo(error),
      schemaCacheByTableKey: this.schemaCacheByTableKey,
      SCHEMA_CACHE_TTL_MS: this.SCHEMA_CACHE_TTL_MS
    }
  }

  private refreshConversationMemory(
    memory: ConversationMemoryState,
    settings: AppSettings,
    history: GeminiMessage[],
    prompt: string
  ): void {
    memory.touchedAt = Date.now()

    const activeCatalog = this.findActiveSchemaCatalog(settings)
    if (activeCatalog) {
      for (const conceptKey of SCHEMA_CONTEXT_CONCEPT_ORDER) {
        const selectedMapping = activeCatalog.selectedMappings[conceptKey]?.trim() ?? ''

        if (selectedMapping) {
          memory.facts.confirmedMappings[conceptKey] = selectedMapping
        }
      }
    }

    const textSources = [
      ...history.filter((message) => message.role === 'user').map((message) => message.content),
      prompt
    ]

    for (const sourceText of textSources) {
      const extractedFacts = this.extractConversationFacts(sourceText)

      memory.facts.companyNames = this.mergeScopeValues(
        memory.facts.companyNames,
        extractedFacts.companyNames
      )
      memory.facts.fiscalYears = this.mergeScopeValues(
        memory.facts.fiscalYears,
        extractedFacts.fiscalYears
      )
      memory.facts.branchNames = this.mergeScopeValues(
        memory.facts.branchNames,
        extractedFacts.branchNames
      )

      if (extractedFacts.dateRange) {
        memory.facts.dateRange = extractedFacts.dateRange
      }
    }

    memory.lastUserPrompt = this.compactText(prompt, 240)
    this.pushConversationMemoryNote(memory, `Latest user intent: ${this.compactText(prompt, 220)}`)
  }

  private extractConversationFacts(text: string): ExtractedConversationFacts {
    return extractConversationFactsFn(text)
  }

  private mergeScopeValues(currentValues: string[], incomingValues: string[]): string[] {
    return mergeScopeValuesFn(currentValues, incomingValues)
  }

  private normalizePersianDigits(value: string): string {
    return normalizePersianDigits(value)
  }

  private updateConversationMemoryFromAssistant(
    memory: ConversationMemoryState,
    finalText: string
  ): void {
    updateConversationMemoryFromAssistantFn(this.conversationMemoryDeps, memory, finalText)
  }

  private rememberToolTrace(memory: ConversationMemoryState, trace: string): void {
    rememberToolTraceFn(this.conversationMemoryDeps, memory, trace)
  }

  private pushConversationMemoryNote(memory: ConversationMemoryState, note: string): void {
    pushConversationMemoryNoteFn(memory, note)
  }

  private createToolResponseMessage(
    toolCall: GeminiToolCall,
    payload: Record<string, unknown>
  ): GeminiMessage {
    return {
      role: 'tool',
      name: toolCall.function.name,
      toolCallId: toolCall.id,
      content: JSON.stringify(payload)
    }
  }

  private extractToolCallsFromResponse(response: GeminiChatResponse): GeminiToolCall[] {
    if (Array.isArray(response.toolCalls) && response.toolCalls.length > 0) {
      return response.toolCalls
    }

    const raw = response.raw as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{
            id?: string
            type?: string
            function?: {
              name?: string
              arguments?: string
            }
          }>
        }
      }>
    }

    const rawToolCalls = raw.choices?.[0]?.message?.tool_calls
    if (!Array.isArray(rawToolCalls)) {
      return []
    }

    return rawToolCalls
      .filter(
        (toolCall): toolCall is { id: string; function: { name: string; arguments?: string } } => {
          return Boolean(toolCall?.id && toolCall.function?.name)
        }
      )
      .map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments ?? '{}'
        }
      }))
  }

  private compactHistory(
    history: GeminiMessage[],
    memory?: ConversationMemoryState
  ): GeminiMessage[] {
    return compactHistoryFn(this.promptBuilderDeps, history, memory)
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

  private isLikelyRefinementPrompt(
    previousMemory: ConversationMemorySnapshot,
    prompt: string
  ): boolean {
    return isLikelyRefinementPromptFn(previousMemory, prompt)
  }

  private buildDeterministicIntentClarificationResponse(
    intentId: DeterministicFinancialIntent
  ): string {
    return buildDeterministicIntentClarificationResponseFn(intentId)
  }

  private buildClarificationResponseIfNeeded(
    settings: AppSettings,
    prompt: string,
    conversationMemory: ConversationMemoryState
  ): string | null {
    return buildClarificationResponseIfNeededFn(
      this.clarificationDeps,
      settings,
      prompt,
      conversationMemory
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

  private get schemaCacheDeps(): SchemaCacheDeps {
    return {
      schemaTableListCache: this.schemaTableListCache,
      schemaCacheByTableKey: this.schemaCacheByTableKey,
      SCHEMA_CACHE_TTL_MS: this.SCHEMA_CACHE_TTL_MS,
      executeMetadataSql: (query, signal) => this.executeMetadataSql(query, signal),
      findActiveSchemaCatalog: (settings) => this.findActiveSchemaCatalog(settings),
      normalizeTableRef: (tableRef) => this.normalizeTableRef(tableRef)
    }
  }

  private async fetchTableListCached(
    tablePattern: string | null,
    sqlQuery: string,
    abortSignal: AbortSignal
  ): Promise<SqlQueryRow[]> {
    return fetchTableListCachedFn(this.schemaCacheDeps, tablePattern, sqlQuery, abortSignal)
  }

  private prevalidateFinancialQuery(sqlQuery: string, settings: AppSettings): string {
    return prevalidateFinancialQueryFn(this.schemaCacheDeps, sqlQuery, settings)
  }

  private async getCachedSchemaSnapshot(
    cacheKey: string,
    sqlQuery: string,
    abortSignal: AbortSignal
  ): Promise<{ rows: SqlQueryRow[] }> {
    return getCachedSchemaSnapshotFn(this.schemaCacheDeps, cacheKey, sqlQuery, abortSignal)
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

  private get geminiRetryDeps(): GeminiRetryDeps {
    return {
      geminiClient: this.geminiClient,
      emitProgress: (onProgress, event) => this.emitProgress(onProgress, event),
      toErrorInfo: (error) => this.toErrorInfo(error),
      compactText: (value, maxLength) => this.compactText(value, maxLength)
    }
  }

  private buildExhaustionFallbackAnswer(
    prompt: string,
    history: GeminiMessage[],
    toolCallsUsed: number,
    successfulDataFetches: number
  ): string {
    return buildExhaustionFallbackAnswerFn(
      this.geminiRetryDeps,
      prompt,
      history,
      toolCallsUsed,
      successfulDataFetches
    )
  }

  private async callGeminiWithProviderRetry(
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
    return callGeminiWithProviderRetryFn(
      this.geminiRetryDeps,
      payload,
      savedConfig,
      abortSignal,
      onProgress
    )
  }

  private shouldReturnDegradedFallback(error: unknown): boolean {
    return shouldReturnDegradedFallbackFn(this.geminiRetryDeps, error)
  }

  private buildRuntimeFailureFallbackAnswer(
    prompt: string,
    detail: string,
    toolCallsUsed: number,
    successfulDataFetches: number,
    kind: 'provider' | 'budget' = 'provider'
  ): string {
    return buildRuntimeFailureFallbackAnswerFn(
      this.geminiRetryDeps,
      prompt,
      detail,
      toolCallsUsed,
      successfulDataFetches,
      kind
    )
  }

  private validateIntentTableMatch(
    intentId: string | undefined,
    evidence: ToolEvidence[]
  ): string | null {
    return validateIntentTableMatchFn(intentId, evidence)
  }

  private buildRecoveryHint(
    failureKind: ToolFailureKind,
    lastErrorCode?: string,
    lastErrorMessage?: string,
    evidence: ToolEvidence[] = [],
    context?: { comparativeMultiPeriod?: boolean; successfulFetches?: number },
    prompt?: string
  ): string {
    return buildRecoveryHintFn(
      failureKind,
      lastErrorCode,
      lastErrorMessage,
      evidence,
      context,
      prompt
    )
  }

  private collectRuntimeScopeColumnCandidates(
    activeCatalog: SchemaCatalogEntry
  ): RuntimeScopeColumnCandidate[] {
    return collectRuntimeScopeColumnCandidatesFn(this.schemaCatalogDeps, activeCatalog)
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
  private isComparativeMultiPeriodPrompt(prompt: string): boolean {
    return isComparativeMultiPeriodPromptFn(prompt)
  }

  private isSalesGrowthPercentPrompt(prompt: string): boolean {
    return isSalesGrowthPercentPromptFn(prompt)
  }

  private async tryResolveSalesGrowthPercentFallback(
    prompt: string,
    conversationMemory: ConversationMemoryState,
    signal: AbortSignal
  ): Promise<SalesGrowthFallbackResult | null> {
    return tryResolveSalesGrowthPercentFallbackFn(
      this.salesGrowthDeps,
      prompt,
      this.getSettings(),
      conversationMemory,
      signal
    )
  }

  private composeSalesGrowthFallbackMarkdown(result: SalesGrowthFallbackResult): string {
    return composeSalesGrowthFallbackMarkdownFn(this.salesGrowthDeps, result)
  }

  private async tryResolveFiscalYearFallback(
    deterministicIntent: DeterministicFinancialIntent,
    settings: AppSettings,
    conversationMemory: ConversationMemoryState,
    signal: AbortSignal,
    onProgress?: (event: AgentProgressEvent) => void
  ): Promise<FiscalYearFallbackResult | null> {
    return tryResolveFiscalYearFallbackFn(
      this.fiscalYearFallbackDeps,
      deterministicIntent,
      settings,
      conversationMemory,
      signal,
      onProgress
    )
  }

  private tryResolveDeterministicFinancialTool(
    deterministicIntent: DeterministicFinancialIntent,
    settings: AppSettings,
    conversationMemory: ConversationMemoryState,
    signal: AbortSignal,
    onProgress?: (event: AgentProgressEvent) => void,
    prompt?: string
  ): Promise<DeterministicFinancialToolResult | null> {
    return resolveDeterministicFinancialTool(
      {
        findActiveSchemaCatalog: (catalogSettings) => this.findActiveSchemaCatalog(catalogSettings),
        resolvePreferredMapping: (catalog, conceptKey, mappingPrompt) =>
          this.resolvePreferredMapping(catalog as SchemaCatalogEntry, conceptKey as AccountingConceptKey, mappingPrompt),
        parseSqlTableReference: (rawRef) => this.parseSqlTableReference(rawRef),
        executeReadOnlySql: (sqlQuery, sqlSignal) => this.executeReadOnlySql(sqlQuery, sqlSignal),
        quoteSqlIdentifier: (value) => this.quoteSqlIdentifier(value),
        quoteSqlTableRef: (ref) => this.quoteSqlTableRef(ref),
        toOptionalFiniteInteger: (value) => this.toOptionalFiniteInteger(value),
        rememberToolTrace: (memory, trace) => this.rememberToolTrace(memory, trace),
        emitProgress: (progressCallback, event) => this.emitProgress(progressCallback, event)
      },
      deterministicIntent,
      settings,
      conversationMemory,
      signal,
      onProgress,
      prompt
    )
  }

  private composeDeterministicFinancialToolMarkdown(
    deterministicIntent: DeterministicFinancialIntent,
    result: DeterministicFinancialToolResult
  ): string {
    return composeDeterministicFinancialToolMarkdownFn(deterministicIntent, result)
  }

  private composeFiscalYearDeterministicMarkdown(
    deterministicIntent: DeterministicFinancialIntent,
    result: FiscalYearFallbackResult
  ): string {
    return composeFiscalYearDeterministicMarkdownFn(deterministicIntent, result)
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

  private finalizeFinancialResponse(
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
    return finalizeFinancialResponseFn(
      this.responseContractDeps,
      prompt,
      rawText,
      conversationMemory,
      totalToolCallCount,
      successfulDataFetchCount,
      routeMode,
      executionTrace,
      recoveryContext,
      requestId
    )
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

  private emitGuardrailTelemetry(
    kind: 'unsupported-function' | 'empty-result-recovery' | 'provider-error',
    requestId: string | undefined,
    conversationId: string | undefined,
    details?: Record<string, unknown>
  ): void {
    emitGuardrailTelemetryFn(this.telemetryDeps, kind, requestId, conversationId, details)
  }

  private emitGuardrailCounterTelemetry(
    kind: 'unsupported-function' | 'empty-result-recovery' | 'provider-error',
    requestId: string | undefined,
    conversationId: string | undefined,
    count: number
  ): void {
    emitGuardrailCounterTelemetryFn(this.telemetryDeps, kind, requestId, conversationId, count)
  }

  private enforcePromptIntentAlignment(prompt: string, finalText: string): string {
    return enforcePromptIntentAlignmentFn(this.evidenceValidationDeps, prompt, finalText)
  }

  private quoteSqlIdentifier(value: string): string {
    return quoteSqlIdentifierFn(value)
  }

  private quoteSqlTableRef(ref: string): string {
    return quoteSqlTableRefFn(ref)
  }

  private toFiniteInteger(value: unknown): number {
    return toFiniteIntegerFn(value)
  }

  private toSafeNumber(value: unknown): number {
    return toSafeNumberFn(value)
  }

  private toOptionalFiniteInteger(value: unknown): number | null {
    return toOptionalFiniteIntegerFn(value)
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

  private createEvidencePreview(
    sqlQuery: string,
    rows: SqlQueryRow[],
    rowCount: number,
    truncated: boolean
  ): AgentEvidencePreview {
    return createEvidencePreviewFn(
      { compactText: (value, maxLength) => this.compactText(value, maxLength) },
      sqlQuery,
      rows,
      rowCount,
      truncated
    )
  }

  private buildPendingToolStatusText(toolName: string, args: Record<string, unknown>): string {
    return buildPendingToolStatusTextFn(toolName, args)
  }

  private ensureFinancialQueryAllowed(
    sqlQuery: string,
    settings: AppSettings,
    conversationMemory?: ConversationMemoryState
  ): void {
    ensureFinancialQueryAllowedFn(this.sqlExecutionDeps, sqlQuery, settings, conversationMemory)
  }

  private parseSqlTableReference(rawRef: string): ExtractedTableReference | null {
    return parseSqlTableReferenceFn(rawRef)
  }

  private limitRowsForModel(rows: SqlQueryRow[]): LimitedRowsForModelResult {
    return limitRowsForModelFn(rows, MAX_TOOL_PAYLOAD_CHARS, MAX_TOOL_VALUE_CHARS)
  }

  private redactSensitiveIdentifiers(rows: SqlQueryRow[]): RedactedRowsResult {
    return redactSensitiveIdentifiersFn(rows)
  }

  private buildCatalogScanQuery(tablePattern: string | null, limit: number): string {
    return buildCatalogScanQueryFn(tablePattern, limit)
  }

  private buildListDatabaseTablesQuery(tablePattern: string | null): string {
    return buildListDatabaseTablesQueryFn(tablePattern, MAX_TABLE_LIST_ROWS)
  }

  private buildDatabaseSchemaQuery(tableName: string, schemaName: string | null): string {
    return buildDatabaseSchemaQueryWrapperFn(tableName, schemaName, MAX_SCHEMA_ROWS)
  }
}
