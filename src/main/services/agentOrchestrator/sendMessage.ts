/**
 * sendMessage orchestration logic extracted from `agentOrchestrator.ts` (FRE Roadmap F2.6).
 */
import type {
  AgentProgressEvent,
  AgentSendMessageRequest,
  AgentSendMessageResult,
  AppSettings,
  GeminiChatResponse,
  GeminiMessage,
  GeminiToolCall,
  GeminiToolDefinition
} from '../../../shared/contracts'
import type { AuditLogEntry } from '../auditLogService'
import type { ExecutionTrace, ToolEvidence, ToolFailureKind } from '../evidenceContract'
import type { ConversationMemoryState, ConversationMemorySnapshot } from './conversationMemory'
import type { DeterministicFinancialIntent } from './intentRouting'
import type { SalesGrowthFallbackResult } from './salesGrowth'
import type { FiscalYearFallbackResult } from './fiscalYearFallback'
import type { DeterministicFinancialToolResult } from '../agentOrchestrator'
import { classifyDeterministicIntent, isRelaxedExploratoryIntent } from './intentRouting'
import { classifyToolFailure } from '../evidenceContract'
import { MAX_FINANCIAL_RECOVERY_ATTEMPTS } from './recovery'

export type ActiveAgentExecution = {
  requestId: string
  conversationId: string
  abortController: AbortController
}

export const FINANCIAL_TOOLS: GeminiToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'catalog_scan',
      description:
        'Run a low-cost read-only catalog scan for candidate financial or purchase tables, including estimated row counts and sample columns for discovery.',
      parameters: {
        type: 'object',
        properties: {
          table_pattern: {
            type: 'string',
            description: "Optional LIKE pattern such as '%purchase%' or '%receipt%'."
          },
          limit: {
            type: 'integer',
            description: 'Maximum number of candidate tables to return. Default is 8.'
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_database_tables',
      description:
        'List base tables in the current SQL Server database. Call this first when table names are unknown, then choose relevant financial tables for schema inspection.',
      parameters: {
        type: 'object',
        properties: {
          table_pattern: {
            type: 'string',
            description: "Optional LIKE pattern for table names. Example: '%ledger%' or 'acc_%'"
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_financial_data',
      description:
        'Execute a read-only SQL SELECT query on the configured SQL Server financial database and return serialized rows.',
      parameters: {
        type: 'object',
        properties: {
          sql_query: {
            type: 'string',
            description:
              'Read-only SQL query. Must be SELECT/CTE SELECT only. Example: SELECT TOP 50 date, amount FROM Ledger ORDER BY date DESC'
          }
        },
        required: ['sql_query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_database_schema',
      description:
        'Fetch SQL Server table schema metadata (columns, types, nullability, order) for a target table to help build correct SELECT queries.',
      parameters: {
        type: 'object',
        properties: {
          table_name: {
            type: 'string',
            description: 'Target table name to inspect. Example: Ledger or Acc_DocumentLines'
          },
          schema_name: {
            type: 'string',
            description: 'Optional schema name. Example: dbo'
          }
        },
        required: ['table_name'],
        additionalProperties: false
      }
    }
  }
]

export interface SendMessageDeps {
  activeExecutions: Map<string, ActiveAgentExecution>
  getOrCreateConversationMemory: (conversationId: string) => ConversationMemoryState
  createConversationMemorySnapshot: (memory: ConversationMemoryState) => ConversationMemorySnapshot
  pruneConversationMemory: () => void
  isLikelyRefinementPrompt: (previousMemory: ConversationMemorySnapshot, prompt: string) => boolean
  safeAuditWrite: (entry: AuditLogEntry) => Promise<void>
  emitProgress: (
    onProgress: ((event: AgentProgressEvent) => void) | undefined,
    event: AgentProgressEvent
  ) => void
  throwIfRequestCanceled: (signal: AbortSignal) => void
  getSettings: () => AppSettings
  refreshConversationMemory: (
    memory: ConversationMemoryState,
    settings: AppSettings,
    history: GeminiMessage[],
    prompt: string
  ) => void
  buildRuntimeSystemPrompt: (
    settings: AppSettings,
    prompt: string,
    conversationMemory: ConversationMemoryState,
    previousMemorySnapshot: ConversationMemorySnapshot
  ) => string
  compactHistory: (history: GeminiMessage[], memory?: ConversationMemoryState) => GeminiMessage[]
  detectDeterministicFinancialIntent: (prompt: string) => DeterministicFinancialIntent | null
  buildClarificationResponseIfNeeded: (
    settings: AppSettings,
    prompt: string,
    conversationMemory: ConversationMemoryState
  ) => string | null
  tryResolveDeterministicFinancialTool: (
    deterministicIntent: DeterministicFinancialIntent,
    settings: AppSettings,
    conversationMemory: ConversationMemoryState,
    signal: AbortSignal,
    onProgress?: (event: AgentProgressEvent) => void,
    prompt?: string
  ) => Promise<DeterministicFinancialToolResult | null>
  finalizeFinancialResponse: (
    prompt: string,
    rawText: string,
    conversationMemory: ConversationMemoryState,
    totalToolCallCount: number,
    successfulDataFetchCount: number,
    routeMode?: 'deterministic' | 'model-assisted' | 'clarification',
    executionTrace?: ExecutionTrace,
    recoveryContext?: { attempts: number },
    requestId?: string
  ) => string
  composeDeterministicFinancialToolMarkdown: (
    deterministicIntent: DeterministicFinancialIntent,
    result: DeterministicFinancialToolResult
  ) => string
  updateConversationMemoryFromAssistant: (
    memory: ConversationMemoryState,
    finalText: string
  ) => void
  buildDeterministicIntentClarificationResponse: (intentId: DeterministicFinancialIntent) => string
  tryResolveFiscalYearFallback: (
    deterministicIntent: DeterministicFinancialIntent,
    settings: AppSettings,
    conversationMemory: ConversationMemoryState,
    signal: AbortSignal,
    onProgress?: (event: AgentProgressEvent) => void
  ) => Promise<FiscalYearFallbackResult | null>
  composeFiscalYearDeterministicMarkdown: (
    deterministicIntent: DeterministicFinancialIntent,
    result: FiscalYearFallbackResult
  ) => string
  isSalesGrowthPercentPrompt: (prompt: string) => boolean
  tryResolveSalesGrowthPercentFallback: (
    prompt: string,
    conversationMemory: ConversationMemoryState,
    signal: AbortSignal
  ) => Promise<SalesGrowthFallbackResult | null>
  composeSalesGrowthFallbackMarkdown: (result: SalesGrowthFallbackResult) => string
  callGeminiWithProviderRetry: (
    payload: {
      messages: GeminiMessage[]
      temperature?: number
      maxOutputTokens?: number
      tools?: GeminiToolDefinition[]
    },
    savedConfig: AppSettings['gemini'],
    abortSignal: AbortSignal,
    onProgress?: (event: AgentProgressEvent) => void
  ) => Promise<GeminiChatResponse>
  toErrorInfo: (error: unknown) => { message: string; code?: string; category?: string }
  shouldReturnDegradedFallback: (error: unknown) => boolean
  emitGuardrailTelemetry: (
    kind: 'unsupported-function' | 'empty-result-recovery' | 'provider-error',
    requestId: string | undefined,
    conversationId: string | undefined,
    details?: Record<string, unknown>
  ) => void
  emitGuardrailCounterTelemetry: (
    kind: 'unsupported-function' | 'empty-result-recovery' | 'provider-error',
    requestId: string | undefined,
    conversationId: string | undefined,
    count: number
  ) => void
  buildRuntimeFailureFallbackAnswer: (
    prompt: string,
    detail: string,
    toolCallsUsed: number,
    successfulDataFetches: number,
    kind?: 'provider' | 'budget'
  ) => string
  extractToolCallsFromResponse: (response: GeminiChatResponse) => GeminiToolCall[]
  requiresStrictFinancialDataFetch: (prompt: string, narrative: string) => boolean
  isComparativeMultiPeriodPrompt: (prompt: string) => boolean
  buildRecoveryHint: (
    failureKind: ToolFailureKind,
    lastErrorCode?: string,
    lastErrorMessage?: string,
    evidence?: ToolEvidence[],
    context?: { comparativeMultiPeriod?: boolean; successfulFetches?: number },
    prompt?: string
  ) => string
  executeFinancialToolCalls: (params: {
    requestId: string
    conversationId: string
    round: number
    toolCalls: GeminiToolCall[]
    settings: AppSettings
    conversationMemory: ConversationMemoryState
    onProgress?: (event: AgentProgressEvent) => void
    abortSignal: AbortSignal
  }) => Promise<{
    toolMessages: GeminiMessage[]
    successfulDataFetches: number
    evidence: ToolEvidence[]
  }>
  buildExhaustionFallbackAnswer: (
    prompt: string,
    history: GeminiMessage[],
    toolCallsUsed: number,
    successfulDataFetches: number
  ) => string
  resolveCancellationError: (error: unknown, signal: AbortSignal) => Error
  telemetryCapture?: (input: {
    event: string
    category: string
    level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
    process?: 'main' | 'renderer'
    message: string
    details?: Record<string, unknown>
    requestId?: string
    conversationId?: string
  }) => void
}

export const MAX_TOOL_CALL_ROUNDS = 4
export const MAX_TOOL_CALLS_PER_ROUND = 7
export const MAX_TOTAL_TOOL_CALLS = 14

export async function sendMessage(
  deps: SendMessageDeps,
  payload: AgentSendMessageRequest,
  onProgress?: (event: AgentProgressEvent) => void
): Promise<AgentSendMessageResult> {
  const requestId = payload.requestId.trim()
  const conversationId = payload.conversationId?.trim() || `conversation-${requestId}`
  const prompt = payload.prompt.trim()

  if (!requestId) {
    throw new Error('requestId is required for agent orchestration.')
  }

  if (deps.activeExecutions.has(requestId)) {
    throw new Error(`Request [${requestId}] is already running.`)
  }

  if (!prompt) {
    throw new Error('Prompt is empty.')
  }

  const execution: ActiveAgentExecution = {
    requestId,
    conversationId,
    abortController: new AbortController()
  }

  const requestTelemetrySummary: Record<string, unknown> = {
    intentId: null,
    confidence: null,
    verdictKind: null,
    recoveryAttempts: 0,
    failureKind: null,
    roundsUsed: 0
  }
  deps.activeExecutions.set(requestId, execution)
  const conversationMemory = deps.getOrCreateConversationMemory(conversationId)
  const previousMemorySnapshot = deps.createConversationMemorySnapshot(conversationMemory)
  deps.pruneConversationMemory()

  const startedAt = Date.now()
  const isRefinementPrompt = deps.isLikelyRefinementPrompt(previousMemorySnapshot, prompt)
  const contextMode = isRefinementPrompt ? 'refinement' : 'fresh'
  const contextReason = isRefinementPrompt
    ? 'Refinement cues detected in the current prompt, so prior turn context remains active.'
    : 'No refinement cues detected; the prompt should be treated as a fresh analysis request.'

  await deps.safeAuditWrite({
    timestamp: new Date().toISOString(),
    requestId,
    conversationId,
    stage: 'start',
    prompt,
    contextMode,
    contextReason
  })

  deps.emitProgress(onProgress, {
    type: 'thinking',
    message:
      payload.mode === 'dry-run'
        ? 'Dry-run: در حال بررسی مسیر کامل ابزارها در main process...'
        : 'در حال تحلیل پرسش و برنامه‌ریزی اجرای ابزارها...'
  })

  try {
    deps.throwIfRequestCanceled(execution.abortController.signal)

    const settings = deps.getSettings()
    deps.refreshConversationMemory(conversationMemory, settings, payload.history, prompt)
    const runtimeSystemPrompt = deps.buildRuntimeSystemPrompt(
      settings,
      prompt,
      conversationMemory,
      previousMemorySnapshot
    )
    let workingHistory = deps.compactHistory(
      [...payload.history, { role: 'user', content: prompt }],
      conversationMemory
    )
    let totalToolCallCount = 0
    let totalSuccessfulDataFetches = 0
    let financialRecoveryAttempts = 0
    let discoveryWithoutFetchCount = 0
    let lastToolErrorCode: string | null = null
    let lastToolErrorMessage: string | null = null
    const executionEvidence: ToolEvidence[] = []
    const deterministicIntent =
      payload.mode === 'dry-run' ? null : deps.detectDeterministicFinancialIntent(prompt)
    const {
      fiscalIntent: deterministicFiscalIntent,
      toolIntent: deterministicToolIntent,
      nonFiscalIntent: deterministicNonFiscalIntent
    } = classifyDeterministicIntent(deterministicIntent)

    const clarificationResponse =
      payload.mode === 'manual'
        ? deps.buildClarificationResponseIfNeeded(settings, prompt, conversationMemory)
        : null

    if (deterministicToolIntent) {
      const toolResult = await deps.tryResolveDeterministicFinancialTool(
        deterministicToolIntent,
        settings,
        conversationMemory,
        execution.abortController.signal,
        onProgress,
        prompt
      )

      if (toolResult) {
        const finalText = deps.finalizeFinancialResponse(
          prompt,
          deps.composeDeterministicFinancialToolMarkdown(deterministicToolIntent, toolResult),
          conversationMemory,
          toolResult.toolCallsUsed,
          toolResult.toolCallsUsed > 0 ? 1 : 0,
          'deterministic'
        )
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
        const finalHistory = deps.compactHistory(
          [...workingHistory, { role: 'assistant', content: finalText }],
          conversationMemory
        )

        await deps.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          conversationId,
          stage: 'final',
          durationMs: Date.now() - startedAt,
          round: 0
        })

        deps.emitProgress(onProgress, {
          type: 'final',
          message: finalText
        })

        return {
          history: finalHistory,
          finalText,
          rounds: 0,
          toolCallsUsed: toolResult.toolCallsUsed
        }
      }

      if (!isRelaxedExploratoryIntent(deterministicToolIntent)) {
        const finalText =
          deps.buildDeterministicIntentClarificationResponse(deterministicToolIntent)
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
        const finalHistory = deps.compactHistory(
          [...workingHistory, { role: 'assistant', content: finalText }],
          conversationMemory
        )

        await deps.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          conversationId,
          stage: 'final',
          durationMs: Date.now() - startedAt,
          round: 0
        })

        deps.emitProgress(onProgress, {
          type: 'final',
          message: finalText
        })

        return {
          history: finalHistory,
          finalText,
          rounds: 0,
          toolCallsUsed: 0
        }
      }
    }

    if (deterministicNonFiscalIntent) {
      const finalText = deps.buildDeterministicIntentClarificationResponse(
        deterministicNonFiscalIntent
      )
      deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
      const finalHistory = deps.compactHistory(
        [...workingHistory, { role: 'assistant', content: finalText }],
        conversationMemory
      )

      await deps.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId,
        conversationId,
        stage: 'final',
        durationMs: Date.now() - startedAt,
        round: 0
      })

      deps.emitProgress(onProgress, {
        type: 'final',
        message: finalText
      })

      return {
        history: finalHistory,
        finalText,
        rounds: 0,
        toolCallsUsed: 0
      }
    }

    if (deterministicFiscalIntent) {
      deps.emitProgress(onProgress, {
        type: 'thinking',
        message:
          deterministicFiscalIntent === 'count_fiscal_years'
            ? 'در حال اجرای ابزار قطعی شمارش سال مالی از دیتابیس...'
            : 'در حال اجرای ابزار قطعی فهرست سال های مالی از دیتابیس...'
      })

      const fallbackResult = await deps.tryResolveFiscalYearFallback(
        deterministicFiscalIntent,
        settings,
        conversationMemory,
        execution.abortController.signal,
        onProgress
      )

      if (fallbackResult) {
        totalToolCallCount += fallbackResult.toolCallsUsed
        const finalText = deps.finalizeFinancialResponse(
          prompt,
          deps.composeFiscalYearDeterministicMarkdown(deterministicFiscalIntent, fallbackResult),
          conversationMemory,
          totalToolCallCount,
          1,
          'deterministic'
        )
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
        const finalHistory = deps.compactHistory(
          [...workingHistory, { role: 'assistant', content: finalText }],
          conversationMemory
        )

        await deps.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          conversationId,
          stage: 'final',
          durationMs: Date.now() - startedAt,
          round: 0
        })

        deps.emitProgress(onProgress, {
          type: 'final',
          message: finalText
        })

        return {
          history: finalHistory,
          finalText,
          rounds: 0,
          toolCallsUsed: totalToolCallCount
        }
      }
    }

    if (deps.isSalesGrowthPercentPrompt(prompt)) {
      deps.emitProgress(onProgress, {
        type: 'thinking',
        message: 'در حال محاسبه مستقیم درصد رشد/کاهش فروش از داده واقعی دیتابیس...'
      })

      const growthFallback = await deps.tryResolveSalesGrowthPercentFallback(
        prompt,
        conversationMemory,
        execution.abortController.signal
      )

      if (growthFallback) {
        totalToolCallCount += growthFallback.toolCallsUsed
        totalSuccessfulDataFetches += 1

        const finalText = deps.finalizeFinancialResponse(
          prompt,
          deps.composeSalesGrowthFallbackMarkdown(growthFallback),
          conversationMemory,
          totalToolCallCount,
          totalSuccessfulDataFetches,
          'deterministic'
        )
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
        const finalHistory = deps.compactHistory(
          [...workingHistory, { role: 'assistant', content: finalText }],
          conversationMemory
        )

        await deps.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          conversationId,
          stage: 'final',
          durationMs: Date.now() - startedAt,
          round: 0
        })

        deps.emitProgress(onProgress, {
          type: 'final',
          message: finalText
        })

        return {
          history: finalHistory,
          finalText,
          rounds: 0,
          toolCallsUsed: totalToolCallCount
        }
      }
    }

    if (clarificationResponse) {
      const finalText = deps.finalizeFinancialResponse(
        prompt,
        clarificationResponse,
        conversationMemory,
        totalToolCallCount,
        totalSuccessfulDataFetches,
        'clarification'
      )
      deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
      const finalHistory = deps.compactHistory(
        [...workingHistory, { role: 'assistant', content: finalText }],
        conversationMemory
      )

      await deps.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId,
        conversationId,
        stage: 'final',
        durationMs: Date.now() - startedAt,
        round: 0
      })

      deps.emitProgress(onProgress, {
        type: 'final',
        message: finalText
      })

      return {
        history: finalHistory,
        finalText,
        rounds: 0,
        toolCallsUsed: 0
      }
    }

    for (let round = 0; round < MAX_TOOL_CALL_ROUNDS; round += 1) {
      deps.throwIfRequestCanceled(execution.abortController.signal)

      const isFinalRound = round === MAX_TOOL_CALL_ROUNDS - 1
      const finalRoundPrompt = isFinalRound
        ? `${runtimeSystemPrompt}\n\nThis is the final tool round. If the required data is still missing, answer with the best partial result and explicitly state what is missing.`
        : runtimeSystemPrompt

      let response: GeminiChatResponse

      try {
        response = await deps.callGeminiWithProviderRetry(
          {
            messages: [{ role: 'system', content: finalRoundPrompt }, ...workingHistory],
            temperature: 0.2,
            tools: isFinalRound ? undefined : FINANCIAL_TOOLS
          },
          settings.gemini,
          execution.abortController.signal,
          onProgress
        )
      } catch (error) {
        const errorInfo = deps.toErrorInfo(error)

        if (deps.shouldReturnDegradedFallback(error)) {
          deps.emitGuardrailTelemetry('provider-error', requestId, conversationId, {
            errorCode: errorInfo.code ?? 'AGENT_PROVIDER_FAILURE_DEGRADED',
            errorMessage: errorInfo.message
          })
          deps.emitGuardrailCounterTelemetry('provider-error', requestId, conversationId, 1)

          const finalText = deps.buildRuntimeFailureFallbackAnswer(
            prompt,
            errorInfo.message,
            totalToolCallCount,
            totalSuccessfulDataFetches
          )
          deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
          const finalHistory = deps.compactHistory(
            [...workingHistory, { role: 'assistant', content: finalText }],
            conversationMemory
          )

          deps.emitProgress(onProgress, {
            type: 'tool-error',
            message:
              '⚠️ پاسخ جزئی بازگردانده شد زیرا خطای ارتباط یا زمان‌بندی در مسیر هوش مصنوعی رخ داد.',
            errorCode: 'AGENT_PROVIDER_FAILURE_DEGRADED',
            errorCategory: 'orchestration-runtime'
          })

          await deps.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            conversationId,
            stage: 'error',
            durationMs: Date.now() - startedAt,
            error: errorInfo.message,
            errorCode: 'AGENT_PROVIDER_FAILURE_DEGRADED',
            errorCategory: 'orchestration-runtime'
          })

          deps.emitProgress(onProgress, {
            type: 'final',
            message: finalText
          })

          return {
            history: finalHistory,
            finalText,
            rounds: 0,
            toolCallsUsed: totalToolCallCount
          }
        }

        throw error
      }

      deps.throwIfRequestCanceled(execution.abortController.signal)

      const toolCalls = deps.extractToolCallsFromResponse(response)

      if (toolCalls.length > MAX_TOOL_CALLS_PER_ROUND) {
        const finalText = deps.buildRuntimeFailureFallbackAnswer(
          prompt,
          `محدودیت ابزارها: این دور ${toolCalls.length} ابزار درخواست کرد در حالی که حد مجاز ${MAX_TOOL_CALLS_PER_ROUND} است.`,
          totalToolCallCount,
          totalSuccessfulDataFetches,
          'budget'
        )
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
        const finalHistory = deps.compactHistory(
          [...workingHistory, { role: 'assistant', content: finalText }],
          conversationMemory
        )

        deps.emitProgress(onProgress, {
          type: 'tool-error',
          message: '⚠️ پاسخ جزئی بازگردانده شد زیرا محدودیت ابزارهای هر دور از حد مجاز عبور کرد.',
          errorCode: 'AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED',
          errorCategory: 'orchestration-policy'
        })

        await deps.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          conversationId,
          stage: 'error',
          durationMs: Date.now() - startedAt,
          error: 'AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED',
          errorCode: 'AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED',
          errorCategory: 'orchestration-policy'
        })

        deps.emitProgress(onProgress, {
          type: 'final',
          message: finalText
        })

        return {
          history: finalHistory,
          finalText,
          rounds: round + 1,
          toolCallsUsed: totalToolCallCount
        }
      }

      const projectedTotalToolCalls = totalToolCallCount + toolCalls.length

      if (projectedTotalToolCalls > MAX_TOTAL_TOOL_CALLS) {
        const finalText = deps.buildRuntimeFailureFallbackAnswer(
          prompt,
          `محدودیت ابزارها: در کل ${projectedTotalToolCalls} ابزار درخواست شد در حالی که حد مجاز ${MAX_TOTAL_TOOL_CALLS} است.`,
          totalToolCallCount,
          totalSuccessfulDataFetches,
          'budget'
        )
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
        const finalHistory = deps.compactHistory(
          [...workingHistory, { role: 'assistant', content: finalText }],
          conversationMemory
        )

        deps.emitProgress(onProgress, {
          type: 'tool-error',
          message:
            '⚠️ پاسخ جزئی بازگردانده شد زیرا محدودیت ابزارهای کل درخواست از حد مجاز عبور کرد.',
          errorCode: 'AGENT_TOTAL_TOOL_CALLS_EXCEEDED',
          errorCategory: 'orchestration-policy'
        })

        await deps.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          conversationId,
          stage: 'error',
          durationMs: Date.now() - startedAt,
          error: 'AGENT_TOTAL_TOOL_CALLS_EXCEEDED',
          errorCode: 'AGENT_TOTAL_TOOL_CALLS_EXCEEDED',
          errorCategory: 'orchestration-policy'
        })

        deps.emitProgress(onProgress, {
          type: 'final',
          message: finalText
        })

        return {
          history: finalHistory,
          finalText,
          rounds: round + 1,
          toolCallsUsed: totalToolCallCount
        }
      }

      if (toolCalls.length === 0) {
        const failureKind = classifyToolFailure(
          executionEvidence,
          lastToolErrorCode ?? undefined,
          lastToolErrorMessage ?? undefined
        )
        const numericFinancialQuestion = deps.requiresStrictFinancialDataFetch(
          prompt,
          response.text
        )
        const shouldRecoverEmptyResult = failureKind === 'EMPTY_RESULT' && numericFinancialQuestion
        const shouldForceFetchAfterDiscovery =
          discoveryWithoutFetchCount >= 2 &&
          totalSuccessfulDataFetches === 0 &&
          !isFinalRound &&
          !deps.isLikelyRefinementPrompt(conversationMemory, prompt)
        const isComparativeMultiPeriod = deps.isComparativeMultiPeriodPrompt(prompt)
        const shouldForceComparativeFetch =
          isComparativeMultiPeriod &&
          totalSuccessfulDataFetches < 2 &&
          !isFinalRound &&
          !deps.isLikelyRefinementPrompt(conversationMemory, prompt)

        if (deterministicFiscalIntent && totalToolCallCount === 0) {
          deps.emitProgress(onProgress, {
            type: 'thinking',
            message:
              deterministicFiscalIntent === 'count_fiscal_years'
                ? 'در حال اجرای ابزار پشتیبان شمارش سال مالی از داده واقعی دیتابیس...'
                : 'در حال اجرای ابزار پشتیبان فهرست سال های مالی از داده واقعی دیتابیس...'
          })

          const fallbackResult = await deps.tryResolveFiscalYearFallback(
            deterministicFiscalIntent,
            settings,
            conversationMemory,
            execution.abortController.signal,
            onProgress
          )

          if (fallbackResult) {
            totalToolCallCount += fallbackResult.toolCallsUsed
            const finalText = deps.finalizeFinancialResponse(
              prompt,
              deps.composeFiscalYearDeterministicMarkdown(
                deterministicFiscalIntent,
                fallbackResult
              ),
              conversationMemory,
              totalToolCallCount,
              1
            )
            deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
            const finalHistory = deps.compactHistory(
              [...workingHistory, { role: 'assistant', content: finalText }],
              conversationMemory
            )

            await deps.safeAuditWrite({
              timestamp: new Date().toISOString(),
              requestId,
              conversationId,
              stage: 'final',
              durationMs: Date.now() - startedAt,
              round: round + 1,
              recoveryAttempts: financialRecoveryAttempts,
              failureKind
            })

            deps.emitProgress(onProgress, {
              type: 'final',
              message: finalText
            })

            return {
              history: finalHistory,
              finalText,
              rounds: round + 1,
              toolCallsUsed: totalToolCallCount
            }
          }
        }

        const rawFinalText = response.text.trim() || 'Model returned an empty response.'

        const shouldAttemptRecovery =
          financialRecoveryAttempts < MAX_FINANCIAL_RECOVERY_ATTEMPTS &&
          !isFinalRound &&
          totalToolCallCount < MAX_TOTAL_TOOL_CALLS &&
          (shouldRecoverEmptyResult ||
            (totalSuccessfulDataFetches === 0 &&
              deps.requiresStrictFinancialDataFetch(prompt, rawFinalText) &&
              !deps.isLikelyRefinementPrompt(conversationMemory, prompt)) ||
            shouldForceFetchAfterDiscovery ||
            shouldForceComparativeFetch)

        if (shouldAttemptRecovery) {
          financialRecoveryAttempts += 1
          const recoveryHint = deps.buildRecoveryHint(
            failureKind,
            lastToolErrorCode ?? undefined,
            lastToolErrorMessage ?? undefined,
            executionEvidence,
            {
              comparativeMultiPeriod: isComparativeMultiPeriod,
              successfulFetches: totalSuccessfulDataFetches
            },
            prompt
          )

          if (
            failureKind === 'EMPTY_RESULT' &&
            deps.requiresStrictFinancialDataFetch(prompt, rawFinalText)
          ) {
            deps.emitGuardrailTelemetry('empty-result-recovery', requestId, conversationId, {
              recoveryAttempts: financialRecoveryAttempts,
              failureKind,
              hint: recoveryHint
            })
            deps.emitGuardrailCounterTelemetry(
              'empty-result-recovery',
              requestId,
              conversationId,
              financialRecoveryAttempts
            )
          }

          workingHistory = deps.compactHistory(
            [
              ...workingHistory,
              { role: 'assistant', content: rawFinalText },
              {
                role: 'user',
                content:
                  `برای پاسخ مالی نهایی باید عددِ خواسته‌شده را مستقیماً از دیتابیس استخراج کنی. ` +
                  `این ${financialRecoveryAttempts} از ${MAX_FINANCIAL_RECOVERY_ATTEMPTS} تلاش بازپروری است. ` +
                  `${recoveryHint} ` +
                  'سپس بر اساس نتیجهٔ واقعی پاسخ نهایی بده. بدون اجرای fetch_financial_data پاسخ نده.'
              }
            ],
            conversationMemory
          )

          deps.emitProgress(onProgress, {
            type: 'thinking',
            message: `در حال امتحان روش دیگر برای استخراج داده... (تلاش ${financialRecoveryAttempts} از ${MAX_FINANCIAL_RECOVERY_ATTEMPTS})`
          })

          continue
        }

        const finalText = deps.finalizeFinancialResponse(
          prompt,
          rawFinalText,
          conversationMemory,
          totalToolCallCount,
          totalSuccessfulDataFetches,
          'model-assisted',
          {
            intentId: deterministicIntent ?? null,
            toolCallsUsed: totalToolCallCount,
            rounds: round + 1,
            evidence: executionEvidence
          },
          { attempts: financialRecoveryAttempts }
        )
        requestTelemetrySummary.intentId = deterministicIntent ?? null
        requestTelemetrySummary.confidence = deterministicIntent ? 1 : 0.5
        requestTelemetrySummary.recoveryAttempts = financialRecoveryAttempts
        requestTelemetrySummary.failureKind = failureKind ?? null
        requestTelemetrySummary.roundsUsed = round + 1
        deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
        const finalHistory = deps.compactHistory(
          [...workingHistory, { role: 'assistant', content: finalText }],
          conversationMemory
        )

        await deps.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          conversationId,
          stage: 'final',
          durationMs: Date.now() - startedAt,
          round: round + 1,
          recoveryAttempts: financialRecoveryAttempts,
          failureKind
        })

        deps.emitProgress(onProgress, {
          type: 'final',
          message: finalText
        })

        return {
          history: finalHistory,
          finalText,
          rounds: round + 1,
          toolCallsUsed: totalToolCallCount
        }
      }

      if (isFinalRound) {
        deps.emitProgress(onProgress, {
          type: 'tool-error',
          message: '⚠️ این آخرین دور ابزار است؛ خروجی فعلی به‌عنوان نتیجه جزئی بازگردانده می‌شود.',
          errorCode: 'AGENT_LOOP_BUDGET_EXHAUSTED',
          errorCategory: 'orchestration-control'
        })
        break
      }

      deps.emitProgress(onProgress, {
        type: 'thinking',
        message: 'هوش مصنوعی در حال استخراج داده از دیتابیس است...'
      })

      workingHistory.push({
        role: 'assistant',
        content: response.text ?? '',
        toolCalls
      })

      const toolExecution = await deps.executeFinancialToolCalls({
        requestId,
        conversationId,
        round: round + 1,
        toolCalls,
        settings,
        conversationMemory,
        onProgress,
        abortSignal: execution.abortController.signal
      })

      totalToolCallCount = projectedTotalToolCalls
      totalSuccessfulDataFetches += toolExecution.successfulDataFetches
      executionEvidence.push(...toolExecution.evidence)

      const discoveryToolsUsed = toolExecution.evidence.filter(
        (entry) => entry.tool === 'catalog_scan' || entry.tool === 'list_database_tables'
      )
      if (discoveryToolsUsed.some((entry) => entry.status === 'ok')) {
        const hadFetchInRound = toolExecution.evidence.some(
          (entry) => entry.tool === 'fetch_financial_data' && entry.status === 'ok'
        )
        if (!hadFetchInRound) {
          discoveryWithoutFetchCount += 1
        }
      }

      const lastToolEvidence = toolExecution.evidence
        .filter((entry) => entry.status === 'error')
        .at(-1)
      if (lastToolEvidence) {
        lastToolErrorCode =
          lastToolEvidence.errorCode ?? (lastToolEvidence.query ? 'TOOL_ERROR' : null)
        lastToolErrorMessage = lastToolEvidence.errorMessage ?? null
      }

      workingHistory = deps.compactHistory(
        [...workingHistory, ...toolExecution.toolMessages],
        conversationMemory
      )
    }

    const finalText = deps.buildExhaustionFallbackAnswer(
      prompt,
      workingHistory,
      totalToolCallCount,
      totalSuccessfulDataFetches
    )
    deps.updateConversationMemoryFromAssistant(conversationMemory, finalText)
    const finalHistory = deps.compactHistory(
      [...workingHistory, { role: 'assistant', content: finalText }],
      conversationMemory
    )

    deps.emitProgress(onProgress, {
      type: 'tool-error',
      message: '⚠️ محدودیت دورهای ابزار به پایان رسید؛ پاسخ جزئی با جزئیات موجود بازگردانده شد.',
      errorCode: 'AGENT_LOOP_BUDGET_EXHAUSTED',
      errorCategory: 'orchestration-control'
    })

    await deps.safeAuditWrite({
      timestamp: new Date().toISOString(),
      requestId,
      conversationId,
      stage: 'error',
      durationMs: Date.now() - startedAt,
      error: 'AGENT_LOOP_BUDGET_EXHAUSTED',
      errorCode: 'AGENT_LOOP_BUDGET_EXHAUSTED',
      errorCategory: 'orchestration-control'
    })

    deps.telemetryCapture?.({
      event: 'agent.orchestrator.request-summary',
      category: 'agent.orchestrator',
      level: 'warn',
      process: 'main',
      message: 'request-complete',
      details: {
        ...requestTelemetrySummary,
        requestId,
        conversationId,
        stage: 'error'
      },
      requestId,
      conversationId
    })

    deps.emitProgress(onProgress, {
      type: 'final',
      message: finalText
    })

    return {
      history: finalHistory,
      finalText,
      rounds: MAX_TOOL_CALL_ROUNDS,
      toolCallsUsed: totalToolCallCount
    }
  } catch (error) {
    const resolvedError = deps.resolveCancellationError(error, execution.abortController.signal)
    const errorInfo = deps.toErrorInfo(resolvedError)

    if (errorInfo.code === 'AGENT_REQUEST_CANCELLED') {
      deps.emitProgress(onProgress, {
        type: 'cancelled',
        message: '⏹️ درخواست جاری با موفقیت متوقف شد.'
      })
    }

    await deps.safeAuditWrite({
      timestamp: new Date().toISOString(),
      requestId,
      conversationId,
      stage: 'error',
      durationMs: Date.now() - startedAt,
      error: errorInfo.message,
      errorCode: errorInfo.code,
      errorCategory: errorInfo.category
    })

    deps.telemetryCapture?.({
      event: 'agent.orchestrator.request-summary',
      category: 'agent.orchestrator',
      level: 'warn',
      process: 'main',
      message: 'request-complete',
      details: {
        ...requestTelemetrySummary,
        requestId,
        conversationId,
        stage: 'error'
      },
      requestId,
      conversationId
    })

    throw resolvedError
  } finally {
    deps.activeExecutions.delete(requestId)
  }
}
