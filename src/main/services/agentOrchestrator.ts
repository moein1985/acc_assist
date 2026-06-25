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
  SchemaDateMode,
  SqlQueryRow
} from '../../shared/contracts'
import type { AuditLogEntry } from './auditLogService'
import {
  classifyToolFailure,
  evaluateEvidence,
  type ExecutionTrace,
  type ToolEvidence,
  type ToolFailureKind
} from './evidenceContract'
import {
  detectFinancialIntent,
  detectSalesKpiContractCandidates,
  listFinancialIntentDefinitions,
  type FinancialIntentId
} from './financialIntentRegistry'
import { transition, type RouteState } from './intentFsm'
import { SqlPolicyViolationError } from './sqlConnectionManager'
import {
  buildDatabaseSchemaQuery,
  escapeSqlStringLiteral,
  normalizeTablePattern,
  parseToolArguments,
  readOptionalNumberArg,
  readOptionalStringArg,
  readRequiredStringArg
} from './agentToolArgumentUtils'
import { normalizePersianDigits, normalizePersianText } from './textNormalization'
import { detectUnsupportedSqlFunctions } from './sqlPolicyValidator'
import { renderValidEmptyFinancialAnswer, buildEvidenceContractFailureResponse } from './agentOrchestrator/responseBuilder'
import { classifyDeterministicIntent, isRelaxedExploratoryIntent } from './agentOrchestrator/intentRouting'
import type { DeterministicFinancialIntent } from './agentOrchestrator/intentRouting'
import { MAX_FINANCIAL_RECOVERY_ATTEMPTS, mapRecoveryErrorHint } from './agentOrchestrator/recovery'
import { SYSTEM_PROMPT } from './agentOrchestrator/prompts'

// Budget arithmetic for the capped tool loop used by the production MVP path.
// The runtime policy keeps the loop small to avoid runaway token bleed and noisy retries.
const MAX_TOOL_CALL_ROUNDS = 4
const MAX_TOOL_CALLS_PER_ROUND = 7
const MAX_TOTAL_TOOL_CALLS = 14
const MAX_CHAT_HISTORY = 28
const MAX_HISTORY_SUMMARY_USERS = 6
const MAX_HISTORY_SUMMARY_ASSISTANT = 4
const MAX_CONVERSATION_MEMORY_NOTES = 12
const MAX_CONVERSATION_MEMORY_SESSIONS = 24
const MAX_CONVERSATION_TOOL_TRACES = 10
const MAX_TOOL_ROWS = 120
const MAX_SCHEMA_ROWS = 240
const MAX_TABLE_LIST_ROWS = 500
const MAX_TOOL_PAYLOAD_CHARS = 90000
const MAX_TOOL_VALUE_CHARS = 500

const REFINEMENT_INTENT_PATTERNS: RegExp[] = [
  /^(نه|نخیر|اصلاح|دقیقا|منظورم|همین|همان|فقط|با این تفاوت)/iu,
  /\b(قبلی|مثل قبل|همون قبلی|همان قبلی)\b/iu,
  /\b(instead|same as before|previous|correction|adjust)\b/i
]

const COMPANY_SCOPE_CAPTURE_PATTERNS: RegExp[] = [
  /شرکت(?:\s*های|\s*ها|‌های|‌ها)?\s*[:\-]?\s*([^\n\r؛;:.!?]{2,120})/giu,
  /\bcompan(?:y|ies)\b\s*[:\-]?\s*([^\n\r؛;:.!?]{2,120})/gi
]

const BRANCH_SCOPE_CAPTURE_PATTERNS: RegExp[] = [
  /شعبه(?:\s*های|\s*ها|‌های|‌ها)?\s*[:\-]?\s*([^\n\r؛;:.!?]{1,120})/giu,
  /\bbranch(?:es)?\b\s*[:\-]?\s*([^\n\r؛;:.!?]{1,120})/gi
]

const RUNTIME_SCOPE_STOP_PATTERNS: RegExp[] = [
  /\s+در\s+/iu,
  /\s+برای\s+/iu,
  /\s+از\s+/iu,
  /\s+تا\s+/iu,
  /\s+سال(?:\s*مالی)?\s+/iu,
  /\s+from\s+/i,
  /\s+to\s+/i,
  /\s+for\s+/i,
  /\s+fiscal\s*year\s+/i,
  /\s+where\s+/i,
  /\s+with\s+/i,
  /\s+(?:گزارش|تحلیل|مقایسه|نمایش|بررسی)(?=\s|$|[،؛,.!?])/iu,
  /\s+(?:بده|بدید|کن|کنید|بکن)(?=\s|$|[،؛,.!?])/iu,
  /\s+(?:report|show|compare|analy[sz]e)\b/i
]

const RUNTIME_SCOPE_SPLIT_PATTERN = /(?:\s*(?:,|،|;|؛|\/|\||&)\s*|\s+(?:and|و)(?:\s+|$))/iu

const MAX_SCOPE_VALUES_PER_DIMENSION = 8

const RUNTIME_SCOPE_YEAR_CAPTURE_PATTERN = /\b((?:13|14|19|20)\d{2})\b/g
const RUNTIME_SCOPE_YEAR_CONTEXT_PATTERN =
  /(?:سال(?:\s*مالی)?(?:\s*های|\s*ها|\s*\(ها\))?|fiscal\s*year(?:s)?)\s*[:\-]?\s*([^\n\r؛;:.!?]{1,120})/giu
const RUNTIME_SCOPE_YEAR_RANGE_PATTERN = /((?:13|14|19|20)\d{2})\s*(?:تا|to|-|–|—)\s*((?:13|14|19|20)\d{2})/giu

const COMPANY_SCOPE_COLUMN_NAME_PATTERN = /company|firm|entity|organization|organisation|org|شرکت/iu
const FISCAL_SCOPE_COLUMN_NAME_PATTERN = /fiscal|year|period|دوره|سال|مالی/iu
const BRANCH_SCOPE_COLUMN_NAME_PATTERN = /branch|store|warehouse|شعبه|انبار/iu

const YEAR_SAMPLE_PATTERN = /^(?:13|14|19|20)\d{2}$/
const SHAMSI_DATE_SAMPLE_PATTERN = /^(?:13|14)\d{2}[\/-](?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01])$/

const SCHEMA_CONTEXT_CONCEPT_ORDER: AccountingConceptKey[] = [
  'accounts',
  'documents',
  'documentLines',
  'counterparties',
  'cashTransactions',
  'costCenters',
  'projects',
  'banks',
  'pettyCash'
]

const SCHEMA_CONTEXT_CONCEPT_LABELS: Record<AccountingConceptKey, string> = {
  accounts: 'Accounts',
  documents: 'Documents',
  documentLines: 'Document lines',
  counterparties: 'Counterparties',
  cashTransactions: 'Cash transactions',
  costCenters: 'Cost centers',
  projects: 'Projects',
  banks: 'Banks',
  pettyCash: 'Petty cash'
}

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

const PROMPT_INTENT_SYNONYMS: Record<AccountingConceptKey, RegExp[]> = {
  accounts: [/حساب/iu, /سرفصل/iu, /معین/iu, /تفضیلی/iu, /\baccount(s)?\b/i, /\bledger\b/i],
  documents: [
    /سند/iu,
    /دفتر\s*روزنامه/iu,
    /خرید/iu,
    /فروش/iu,
    /\bdocument(s)?\b/i,
    /\bvoucher(s)?\b/i,
    /\bjournal\b/i,
    /\bpurchase(s)?\b/i,
    /\bsale(s)?\b/i,
    /\binvoice(s)?\b/i,
    /\breceipt(s)?\b/i
  ],
  documentLines: [/آرتیکل/iu, /ردیف/iu, /جزئیات/iu, /\bline(s)?\b/i, /\bdetail(s)?\b/i],
  counterparties: [
    /طرف\s*حساب/iu,
    /مشتری/iu,
    /فروشنده/iu,
    /\bcounterpart(y|ies)\b/i,
    /\bcustomer(s)?\b/i,
    /\bvendor(s)?\b/i,
    /\bpart(y|ies)\b/i
  ],
  cashTransactions: [/دریافت/iu, /پرداخت/iu, /گردش/iu, /نقد/iu, /\bcash\b/i, /\btransaction(s)?\b/i],
  costCenters: [/مرکز\s*هزینه/iu, /\bcost\s*center(s)?\b/i, /\bcost_center(s)?\b/i],
  projects: [/پروژه/iu, /\bproject(s)?\b/i],
  banks: [/بانک/iu, /چک/iu, /\bbank(s)?\b/i],
  pettyCash: [/تنخواه/iu, /صندوق/iu, /\bpetty\s*cash\b/i, /\bimprest\b/i]
}

const DATE_RANGE_AMBIGUITY_SIGNAL_PATTERN =
  /(بازه(?:\s*زمانی)?|دوره(?:\s*زمانی)?|range|period|date\s*range|time\s*range)/iu

const DATE_RANGE_EXPLICIT_SCOPE_PATTERN =
  /((?:13|14|19|20)\d{2}|this|current|today|امسال|سال\s*جاری|ماه\s*جاری|فصل\s*جاری|month\s*to\s*date|quarter\s*to\s*date)/iu

type PreferredMapping = {
  tableRef: string
  source: 'selected' | 'suggested'
}

type ExtractedTableReference = {
  raw: string
  schemaTable: string | null
  schemaName: string | null
  databaseName: string | null
  serverName: string | null
  tableName: string
  partCount: number
}

type RedactedRowsResult = {
  rows: SqlQueryRow[]
  redactedCells: number
}

type LimitedRowsForModelResult = {
  rows: SqlQueryRow[]
  payloadTruncated: boolean
  valueTruncatedCells: number
}

type ConversationMemoryFacts = {
  companyNames: string[]
  fiscalYears: string[]
  branchNames: string[]
  dateRange: string | null
  confirmedMappings: Partial<Record<AccountingConceptKey, string>>
}

type ExtractedConversationFacts = {
  companyNames: string[]
  fiscalYears: string[]
  branchNames: string[]
  dateRange?: string
}

type RuntimeScopeDimension = 'company' | 'fiscalYear' | 'branch'

type RuntimeScopeColumnCandidate = {
  dimension: RuntimeScopeDimension
  tableRef: string
  columnName: string
  score: number
  samplePreview: string | null
}

type RuntimeScopeFilterRequirement = {
  dimension: RuntimeScopeDimension
  values: string[]
  candidateColumnNames: string[]
}

type ConversationMemoryState = {
  conversationId: string
  notes: string[]
  facts: ConversationMemoryFacts
  lastUserPrompt: string | null
  lastAssistantOutcome: string | null
  lastToolTrace: string[]
  touchedAt: number
}

type ConversationMemorySnapshot = {
  notes: string[]
  facts: ConversationMemoryFacts
  lastUserPrompt: string | null
  lastAssistantOutcome: string | null
  lastToolTrace: string[]
}

type ActiveAgentExecution = {
  requestId: string
  conversationId: string
  abortController: AbortController
}

type FiscalYearFallbackResult = {
  count: number
  years: number[]
  tableRef: string
  columnName: string
  minYear: number | null
  maxYear: number | null
  toolCallsUsed: number
}

type DeterministicFinancialToolResult = {
  intentId: DeterministicFinancialIntent
  value: number | null
  tableRef: string
  columnName: string
  query: string
  toolCallsUsed: number
}

type SalesGrowthFallbackResult = {
  baseYear: number
  targetYear: number
  salesBase: number
  salesTarget: number
  percentChange: number | null
  query: string
  toolCallsUsed: number
}

const SENSITIVE_IDENTIFIER_FIELD_TOKENS = [
  'nationalid',
  'nationalcode',
  'melicode',
  'mobile',
  'mobileno',
  'phonenumber',
  'phone',
  'telephone',
  'tel',
  'cellphone',
  'cell',
  'accountnumber',
  'accountno',
  'bankaccountnumber',
  'cardnumber',
  'bankcardnumber',
  'iban',
  'sheba'
]

const SENSITIVE_IDENTIFIER_FIELD_TOKENS_FA = [
  'کدملی',
  'شمارهملی',
  'موبایل',
  'شمارهموبایل',
  'تلفن',
  'شمارهتلفن',
  'شمارهحساب',
  'حساببانکی',
  'شمارهکارت',
  'شبا',
  'شمارهشبا'
]

const FINANCIAL_TOOLS: GeminiToolDefinition[] = [
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
    broadcast: (message: any) => void
  }
}

export class AgentOrchestrator {
  private readonly sqlParser = new Parser()
  private readonly geminiClient: AgentOrchestratorDeps['geminiClient']
  private readonly getSettings: () => AppSettings
  private readonly executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  private readonly executeMetadataSql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  private readonly auditLog: AgentOrchestratorDeps['auditLog']
  private readonly telemetry?: AgentOrchestratorDeps['telemetry']
  private readonly mobileBridge?: AgentOrchestratorDeps['mobileBridge']
  private readonly activeExecutions = new Map<string, ActiveAgentExecution>()
  private readonly conversationMemoryById = new Map<string, ConversationMemoryState>()
  private readonly schemaCacheByTableKey = new Map<string, { schema: SchemaColumnCatalogItem[]; timestamp: number }>()
  private readonly schemaTableListCache = new Map<string, { rows: SqlQueryRow[]; timestamp: number }>()
  private readonly SCHEMA_CACHE_TTL_MS = 900000

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
    const requestId = payload.requestId.trim()
    const conversationId = payload.conversationId?.trim() || `conversation-${requestId}`
    const prompt = payload.prompt.trim()

    if (!requestId) {
      throw new Error('requestId is required for agent orchestration.')
    }

    if (this.activeExecutions.has(requestId)) {
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
    this.activeExecutions.set(requestId, execution)
    const conversationMemory = this.getOrCreateConversationMemory(conversationId)
    const previousMemorySnapshot = this.createConversationMemorySnapshot(conversationMemory)
    this.pruneConversationMemory()

    const startedAt = Date.now()
    const isRefinementPrompt = this.isLikelyRefinementPrompt(previousMemorySnapshot, prompt)
    const contextMode = isRefinementPrompt ? 'refinement' : 'fresh'
    const contextReason = isRefinementPrompt
      ? 'Refinement cues detected in the current prompt, so prior turn context remains active.'
      : 'No refinement cues detected; the prompt should be treated as a fresh analysis request.'

    await this.safeAuditWrite({
      timestamp: new Date().toISOString(),
      requestId,
      conversationId,
      stage: 'start',
      prompt,
      contextMode,
      contextReason
    })

    this.emitProgress(onProgress, {
      type: 'thinking',
      message:
        payload.mode === 'dry-run'
          ? 'Dry-run: در حال بررسی مسیر کامل ابزارها در main process...'
          : 'در حال تحلیل پرسش و برنامه‌ریزی اجرای ابزارها...'
    })

    try {
      this.throwIfRequestCanceled(execution.abortController.signal)

      const settings = this.getSettings()
      this.refreshConversationMemory(conversationMemory, settings, payload.history, prompt)
      const runtimeSystemPrompt = this.buildRuntimeSystemPrompt(
        settings,
        prompt,
        conversationMemory,
        previousMemorySnapshot
      )
      let workingHistory = this.compactHistory(
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
        payload.mode === 'dry-run' ? null : this.detectDeterministicFinancialIntent(prompt)
      const { fiscalIntent: deterministicFiscalIntent, toolIntent: deterministicToolIntent, nonFiscalIntent: deterministicNonFiscalIntent } =
        classifyDeterministicIntent(deterministicIntent)

      const clarificationResponse =
        payload.mode === 'manual'
          ? this.buildClarificationResponseIfNeeded(settings, prompt, conversationMemory)
          : null

      if (deterministicToolIntent) {
        const toolResult = await this.tryResolveDeterministicFinancialTool(
          deterministicToolIntent,
          settings,
          conversationMemory,
          execution.abortController.signal,
          onProgress,
          prompt
        )

        if (toolResult) {
          const finalText = this.finalizeFinancialResponse(
            prompt,
            this.composeDeterministicFinancialToolMarkdown(deterministicToolIntent, toolResult),
            conversationMemory,
            toolResult.toolCallsUsed,
            toolResult.toolCallsUsed > 0 ? 1 : 0,
            'deterministic'
          )
          this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
          const finalHistory = this.compactHistory(
            [...workingHistory, { role: 'assistant', content: finalText }],
            conversationMemory
          )

          await this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            conversationId,
            stage: 'final',
            durationMs: Date.now() - startedAt,
            round: 0
          })

          this.emitProgress(onProgress, {
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

        // Issue 4 (intent over-refusal relaxation): when the deterministic
        // account-balance mapping is incomplete we no longer emit a hard,
        // pre-emptive refusal. Instead we fall through to the model-driven tool
        // loop so the agent can take a safe exploration path (e.g.
        // list_database_tables on the ACC schema) and still attempt real data
        // delivery. Other deterministic tool intents keep the strict refusal.
        if (!isRelaxedExploratoryIntent(deterministicToolIntent)) {
          const finalText = this.buildDeterministicIntentClarificationResponse(deterministicToolIntent)
          this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
          const finalHistory = this.compactHistory(
            [...workingHistory, { role: 'assistant', content: finalText }],
            conversationMemory
          )

          await this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            conversationId,
            stage: 'final',
            durationMs: Date.now() - startedAt,
            round: 0
          })

          this.emitProgress(onProgress, {
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
        const finalText = this.buildDeterministicIntentClarificationResponse(deterministicNonFiscalIntent)
        this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
        const finalHistory = this.compactHistory(
          [...workingHistory, { role: 'assistant', content: finalText }],
          conversationMemory
        )

        await this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          conversationId,
          stage: 'final',
          durationMs: Date.now() - startedAt,
          round: 0
        })

        this.emitProgress(onProgress, {
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
        this.emitProgress(onProgress, {
          type: 'thinking',
          message:
            deterministicFiscalIntent === 'count_fiscal_years'
              ? 'در حال اجرای ابزار قطعی شمارش سال مالی از دیتابیس...'
              : 'در حال اجرای ابزار قطعی فهرست سال های مالی از دیتابیس...'
        })

        const fallbackResult = await this.tryResolveFiscalYearFallback(
          deterministicFiscalIntent,
          settings,
          conversationMemory,
          execution.abortController.signal,
          onProgress
        )

        if (fallbackResult) {
          totalToolCallCount += fallbackResult.toolCallsUsed
          const finalText = this.finalizeFinancialResponse(
            prompt,
            this.composeFiscalYearDeterministicMarkdown(deterministicFiscalIntent, fallbackResult),
            conversationMemory,
            totalToolCallCount,
            1,
            'deterministic'
          )
          this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
          const finalHistory = this.compactHistory(
            [...workingHistory, { role: 'assistant', content: finalText }],
            conversationMemory
          )

          await this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            conversationId,
            stage: 'final',
            durationMs: Date.now() - startedAt,
            round: 0
          })

          this.emitProgress(onProgress, {
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

      if (this.isSalesGrowthPercentPrompt(prompt)) {
        this.emitProgress(onProgress, {
          type: 'thinking',
          message: 'در حال محاسبه مستقیم درصد رشد/کاهش فروش از داده واقعی دیتابیس...'
        })

        const growthFallback = await this.tryResolveSalesGrowthPercentFallback(
          prompt,
          conversationMemory,
          execution.abortController.signal
        )

        if (growthFallback) {
          totalToolCallCount += growthFallback.toolCallsUsed
          totalSuccessfulDataFetches += 1

          const finalText = this.finalizeFinancialResponse(
            prompt,
            this.composeSalesGrowthFallbackMarkdown(growthFallback),
            conversationMemory,
            totalToolCallCount,
            totalSuccessfulDataFetches,
            'deterministic'
          )
          this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
          const finalHistory = this.compactHistory(
            [...workingHistory, { role: 'assistant', content: finalText }],
            conversationMemory
          )

          await this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            conversationId,
            stage: 'final',
            durationMs: Date.now() - startedAt,
            round: 0
          })

          this.emitProgress(onProgress, {
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
        const finalText = this.finalizeFinancialResponse(
          prompt,
          clarificationResponse,
          conversationMemory,
          totalToolCallCount,
          totalSuccessfulDataFetches,
          'clarification'
        )
        this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
        const finalHistory = this.compactHistory(
          [...workingHistory, { role: 'assistant', content: finalText }],
          conversationMemory
        )

        await this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          conversationId,
          stage: 'final',
          durationMs: Date.now() - startedAt,
          round: 0
        })

        this.emitProgress(onProgress, {
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
        this.throwIfRequestCanceled(execution.abortController.signal)

        const isFinalRound = round === MAX_TOOL_CALL_ROUNDS - 1
        const finalRoundPrompt = isFinalRound
          ? `${runtimeSystemPrompt}\n\nThis is the final tool round. If the required data is still missing, answer with the best partial result and explicitly state what is missing.`
          : runtimeSystemPrompt

        let response: GeminiChatResponse

        try {
          response = await this.callGeminiWithProviderRetry(
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
          const errorInfo = this.toErrorInfo(error)

          if (this.shouldReturnDegradedFallback(error)) {
            this.emitGuardrailTelemetry(
              'provider-error',
              requestId,
              conversationId,
              {
                errorCode: errorInfo.code ?? 'AGENT_PROVIDER_FAILURE_DEGRADED',
                errorMessage: errorInfo.message
              }
            )
            this.emitGuardrailCounterTelemetry('provider-error', requestId, conversationId, 1)

            const finalText = this.buildRuntimeFailureFallbackAnswer(
              prompt,
              errorInfo.message,
              totalToolCallCount,
              totalSuccessfulDataFetches
            )
            this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
            const finalHistory = this.compactHistory(
              [...workingHistory, { role: 'assistant', content: finalText }],
              conversationMemory
            )

            this.emitProgress(onProgress, {
              type: 'tool-error',
              message: '⚠️ پاسخ جزئی بازگردانده شد زیرا خطای ارتباط یا زمان‌بندی در مسیر هوش مصنوعی رخ داد.',
              errorCode: 'AGENT_PROVIDER_FAILURE_DEGRADED',
              errorCategory: 'orchestration-runtime'
            })

            await this.safeAuditWrite({
              timestamp: new Date().toISOString(),
              requestId,
              conversationId,
              stage: 'error',
              durationMs: Date.now() - startedAt,
              error: errorInfo.message,
              errorCode: 'AGENT_PROVIDER_FAILURE_DEGRADED',
              errorCategory: 'orchestration-runtime'
            })

            this.emitProgress(onProgress, {
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

        this.throwIfRequestCanceled(execution.abortController.signal)

        const toolCalls = this.extractToolCallsFromResponse(response)

        if (toolCalls.length > MAX_TOOL_CALLS_PER_ROUND) {
          const finalText = this.buildRuntimeFailureFallbackAnswer(
            prompt,
            `محدودیت ابزارها: این دور ${toolCalls.length} ابزار درخواست کرد در حالی که حد مجاز ${MAX_TOOL_CALLS_PER_ROUND} است.`,
            totalToolCallCount,
            totalSuccessfulDataFetches,
            'budget'
          )
          this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
          const finalHistory = this.compactHistory(
            [...workingHistory, { role: 'assistant', content: finalText }],
            conversationMemory
          )

          this.emitProgress(onProgress, {
            type: 'tool-error',
            message: '⚠️ پاسخ جزئی بازگردانده شد زیرا محدودیت ابزارهای هر دور از حد مجاز عبور کرد.',
            errorCode: 'AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED',
            errorCategory: 'orchestration-policy'
          })

          await this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            conversationId,
            stage: 'error',
            durationMs: Date.now() - startedAt,
            error: 'AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED',
            errorCode: 'AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED',
            errorCategory: 'orchestration-policy'
          })

          this.emitProgress(onProgress, {
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
          const finalText = this.buildRuntimeFailureFallbackAnswer(
            prompt,
            `محدودیت ابزارها: در کل ${projectedTotalToolCalls} ابزار درخواست شد در حالی که حد مجاز ${MAX_TOTAL_TOOL_CALLS} است.`,
            totalToolCallCount,
            totalSuccessfulDataFetches,
            'budget'
          )
          this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
          const finalHistory = this.compactHistory(
            [...workingHistory, { role: 'assistant', content: finalText }],
            conversationMemory
          )

          this.emitProgress(onProgress, {
            type: 'tool-error',
            message: '⚠️ پاسخ جزئی بازگردانده شد زیرا محدودیت ابزارهای کل درخواست از حد مجاز عبور کرد.',
            errorCode: 'AGENT_TOTAL_TOOL_CALLS_EXCEEDED',
            errorCategory: 'orchestration-policy'
          })

          await this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            conversationId,
            stage: 'error',
            durationMs: Date.now() - startedAt,
            error: 'AGENT_TOTAL_TOOL_CALLS_EXCEEDED',
            errorCode: 'AGENT_TOTAL_TOOL_CALLS_EXCEEDED',
            errorCategory: 'orchestration-policy'
          })

          this.emitProgress(onProgress, {
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
          const numericFinancialQuestion = this.requiresStrictFinancialDataFetch(prompt, response.text)
          const shouldRecoverEmptyResult = failureKind === 'EMPTY_RESULT' && numericFinancialQuestion
          const shouldForceFetchAfterDiscovery =
            discoveryWithoutFetchCount >= 2 &&
            totalSuccessfulDataFetches === 0 &&
            !isFinalRound &&
            !this.isLikelyRefinementPrompt(conversationMemory, prompt)
          // H3: for multi-period comparative prompts (e.g. "فروش 1403 vs 1402"),
          // demand at least one successful fetch per period — a single fetch is
          // not enough for an honest comparison.
          const isComparativeMultiPeriod = this.isComparativeMultiPeriodPrompt(prompt)
          const shouldForceComparativeFetch =
            isComparativeMultiPeriod &&
            totalSuccessfulDataFetches < 2 &&
            !isFinalRound &&
            !this.isLikelyRefinementPrompt(conversationMemory, prompt)

          if (deterministicFiscalIntent && totalToolCallCount === 0) {
            this.emitProgress(onProgress, {
              type: 'thinking',
              message:
                deterministicFiscalIntent === 'count_fiscal_years'
                  ? 'در حال اجرای ابزار پشتیبان شمارش سال مالی از داده واقعی دیتابیس...'
                  : 'در حال اجرای ابزار پشتیبان فهرست سال های مالی از داده واقعی دیتابیس...'
            })

            const fallbackResult = await this.tryResolveFiscalYearFallback(
              deterministicFiscalIntent,
              settings,
              conversationMemory,
              execution.abortController.signal,
              onProgress
            )

            if (fallbackResult) {
              totalToolCallCount += fallbackResult.toolCallsUsed
              const finalText = this.finalizeFinancialResponse(
                prompt,
                this.composeFiscalYearDeterministicMarkdown(deterministicFiscalIntent, fallbackResult),
                conversationMemory,
                totalToolCallCount,
                1
              )
              this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
              const finalHistory = this.compactHistory(
                [...workingHistory, { role: 'assistant', content: finalText }],
                conversationMemory
              )

              await this.safeAuditWrite({
                timestamp: new Date().toISOString(),
                requestId,
                conversationId,
                stage: 'final',
                durationMs: Date.now() - startedAt,
                round: round + 1,
                recoveryAttempts: financialRecoveryAttempts,
                failureKind
              })

              this.emitProgress(onProgress, {
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

          // Completion-reliability guard: if the user asked a strict financial/quant
          // question but the model is about to finalize WITHOUT ever running
          // fetch_financial_data, nudge it once to execute the query (it has usually
          // already discovered the schema) instead of letting the evidence-first
          // contract refuse with "Cannot answer reliably". This is gated by the same
          // requiresStrictFinancialDataFetch predicate the contract uses, so it only
          // fires for questions that would otherwise be refused for missing data.
          const shouldAttemptRecovery =
            financialRecoveryAttempts < MAX_FINANCIAL_RECOVERY_ATTEMPTS &&
            !isFinalRound &&
            totalToolCallCount < MAX_TOTAL_TOOL_CALLS &&
            (shouldRecoverEmptyResult ||
              (totalSuccessfulDataFetches === 0 &&
                this.requiresStrictFinancialDataFetch(prompt, rawFinalText) &&
                !this.isLikelyRefinementPrompt(conversationMemory, prompt)) ||
              shouldForceFetchAfterDiscovery ||
              shouldForceComparativeFetch)

          if (shouldAttemptRecovery) {
            financialRecoveryAttempts += 1
            const recoveryHint = this.buildRecoveryHint(
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

            if (failureKind === 'EMPTY_RESULT' && this.requiresStrictFinancialDataFetch(prompt, rawFinalText)) {
              this.emitGuardrailTelemetry(
                'empty-result-recovery',
                requestId,
                conversationId,
                {
                  recoveryAttempts: financialRecoveryAttempts,
                  failureKind,
                  hint: recoveryHint
                }
              )
              this.emitGuardrailCounterTelemetry('empty-result-recovery', requestId, conversationId, financialRecoveryAttempts)
            }

            workingHistory = this.compactHistory(
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

            this.emitProgress(onProgress, {
              type: 'thinking',
              message: `در حال امتحان روش دیگر برای استخراج داده... (تلاش ${financialRecoveryAttempts} از ${MAX_FINANCIAL_RECOVERY_ATTEMPTS})`
            })

            continue
          }

          const finalText = this.finalizeFinancialResponse(
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
          this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
          const finalHistory = this.compactHistory(
            [...workingHistory, { role: 'assistant', content: finalText }],
            conversationMemory
          )

          await this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            conversationId,
            stage: 'final',
            durationMs: Date.now() - startedAt,
            round: round + 1,
            recoveryAttempts: financialRecoveryAttempts,
            failureKind
          })

          this.emitProgress(onProgress, {
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
          this.emitProgress(onProgress, {
            type: 'tool-error',
            message: '⚠️ این آخرین دور ابزار است؛ خروجی فعلی به‌عنوان نتیجه جزئی بازگردانده می‌شود.',
            errorCode: 'AGENT_LOOP_BUDGET_EXHAUSTED',
            errorCategory: 'orchestration-control'
          })
          break
        }

        this.emitProgress(onProgress, {
          type: 'thinking',
          message: 'هوش مصنوعی در حال استخراج داده از دیتابیس است...'
        })

        workingHistory.push({
          role: 'assistant',
          content: response.text ?? '',
          toolCalls
        })

        const toolExecution = await this.executeFinancialToolCalls({
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

        const discoveryToolsUsed = toolExecution.evidence.filter((entry) => entry.tool === 'catalog_scan' || entry.tool === 'list_database_tables')
        if (discoveryToolsUsed.some((entry) => entry.status === 'ok')) {
          const hadFetchInRound = toolExecution.evidence.some((entry) => entry.tool === 'fetch_financial_data' && entry.status === 'ok')
          if (!hadFetchInRound) {
            discoveryWithoutFetchCount += 1
          }
        }

        const lastToolEvidence = toolExecution.evidence.filter((entry) => entry.status === 'error').at(-1)
        if (lastToolEvidence) {
          lastToolErrorCode = lastToolEvidence.errorCode ?? (lastToolEvidence.query ? 'TOOL_ERROR' : null)
          lastToolErrorMessage = lastToolEvidence.errorMessage ?? null
        }

        workingHistory = this.compactHistory([...workingHistory, ...toolExecution.toolMessages], conversationMemory)
      }

      const finalText = this.buildExhaustionFallbackAnswer(prompt, workingHistory, totalToolCallCount, totalSuccessfulDataFetches)
      this.updateConversationMemoryFromAssistant(conversationMemory, finalText)
      const finalHistory = this.compactHistory([ ...workingHistory, { role: 'assistant', content: finalText } ], conversationMemory)

      this.emitProgress(onProgress, {
        type: 'tool-error',
        message: '⚠️ محدودیت دورهای ابزار به پایان رسید؛ پاسخ جزئی با جزئیات موجود بازگردانده شد.',
        errorCode: 'AGENT_LOOP_BUDGET_EXHAUSTED',
        errorCategory: 'orchestration-control'
      })

      await this.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId,
        conversationId,
        stage: 'error',
        durationMs: Date.now() - startedAt,
        error: 'AGENT_LOOP_BUDGET_EXHAUSTED',
        errorCode: 'AGENT_LOOP_BUDGET_EXHAUSTED',
        errorCategory: 'orchestration-control'
      })

      this.telemetry?.capture({
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

      this.emitProgress(onProgress, {
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
      const resolvedError = this.resolveCancellationError(error, execution.abortController.signal)
      const errorInfo = this.toErrorInfo(resolvedError)

      if (errorInfo.code === 'AGENT_REQUEST_CANCELLED') {
        this.emitProgress(onProgress, {
          type: 'cancelled',
          message: '⏹️ درخواست جاری با موفقیت متوقف شد.'
        })
      }

      await this.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId,
        conversationId,
        stage: 'error',
        durationMs: Date.now() - startedAt,
        error: errorInfo.message,
        errorCode: errorInfo.code,
        errorCategory: errorInfo.category
      })

      this.telemetry?.capture({
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
      this.activeExecutions.delete(requestId)
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
  }): Promise<{ toolMessages: GeminiMessage[]; successfulDataFetches: number; evidence: ToolEvidence[] }> {
    const { requestId, conversationId, round, toolCalls, settings, conversationMemory, onProgress, abortSignal } = params
    const toolMessages: GeminiMessage[] = []
    const evidence: ToolEvidence[] = []
    let successfulDataFetches = 0

    for (const toolCall of toolCalls) {
      this.throwIfRequestCanceled(abortSignal)

      const toolName = toolCall.function.name
      const args = parseToolArguments(toolCall.function.arguments)
      const pendingMessage = this.buildPendingToolStatusText(toolName, args)

      this.emitProgress(onProgress, {
        type: 'tool-start',
        message: pendingMessage,
        toolName,
        toolCallId: toolCall.id,
        args
      })

      await this.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId,
        stage: 'tool-start',
        toolName,
        round
      })

      try {
        if (toolName === 'catalog_scan') {
          const tablePattern = readOptionalStringArg(args, 'table_pattern', 256)
          const limit = readOptionalNumberArg(args, 'limit', { min: 1, max: 24, fallback: 8 })
          const sqlQuery = this.buildCatalogScanQuery(tablePattern, limit)
          const rows = await this.executeMetadataSql(sqlQuery, abortSignal)
          this.throwIfRequestCanceled(abortSignal)
          this.rememberToolTrace(
            conversationMemory,
            `catalog_scan rows=${rows.length} pattern=${tablePattern ?? '*'} limit=${limit}`
          )

          evidence.push({
            tool: 'catalog_scan',
            status: 'ok',
            rowsReturned: rows.length,
            nonNullValue: rows.length > 0,
            scopeApplied: false
          })

          const boundedRows = rows.slice(0, MAX_TABLE_LIST_ROWS)
          const limitedRows = this.limitRowsForModel(boundedRows)

          this.emitProgress(onProgress, {
            type: 'tool-success',
            message: `✅ فهرست کاندیدهای کشف‌شده با ${rows.length} جدول بازگردانده شد.`,
            toolName,
            toolCallId: toolCall.id,
            args,
            rowCount: rows.length
          })

          await this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            stage: 'tool-success',
            toolName,
            sqlQuery,
            rowCount: rows.length,
            round
          })

          toolMessages.push(
            this.createToolResponseMessage(toolCall, {
              ok: true,
              table_pattern: tablePattern,
              limit,
              row_count: rows.length,
              rows: limitedRows.rows
            })
          )
          continue
        }

        if (toolName === 'list_database_tables') {
          const tablePattern = readOptionalStringArg(args, 'table_pattern', 256)
          const sqlQuery = this.buildListDatabaseTablesQuery(tablePattern)
          const rows = await this.fetchTableListCached(tablePattern, sqlQuery, abortSignal)
          this.throwIfRequestCanceled(abortSignal)
          this.rememberToolTrace(
            conversationMemory,
            `list_database_tables rows=${rows.length} pattern=${tablePattern ?? '*'}`
          )
          evidence.push({
            tool: 'list_database_tables',
            status: 'ok',
            rowsReturned: rows.length,
            nonNullValue: rows.length > 0,
            scopeApplied: false
          })
          const boundedRows = rows.slice(0, MAX_TABLE_LIST_ROWS)
          const limitedRows = this.limitRowsForModel(boundedRows)
          const outputTruncated = rows.length > boundedRows.length || limitedRows.payloadTruncated
          const compactedText =
            limitedRows.payloadTruncated || limitedRows.valueTruncatedCells > 0
              ? ' | خروجی برای مدل خلاصه شد.'
              : ''

          this.emitProgress(onProgress, {
            type: 'tool-success',
            message: `✅ تعداد ${rows.length} جدول یافت شد.${compactedText}`,
            toolName,
            toolCallId: toolCall.id,
            args,
            rowCount: rows.length
          })

          await this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            stage: 'tool-success',
            toolName,
            sqlQuery,
            rowCount: rows.length,
            round
          })

          toolMessages.push(
            this.createToolResponseMessage(toolCall, {
              ok: true,
              table_pattern: tablePattern,
              row_count: rows.length,
              truncated: outputTruncated,
              payload_truncated: limitedRows.payloadTruncated,
              value_truncated_cells: limitedRows.valueTruncatedCells,
              rows: limitedRows.rows
            })
          )
          continue
        }

        if (toolName === 'fetch_financial_data') {
          const sqlQuery = readRequiredStringArg(args, 'sql_query', 16000)
          const unsupportedSql = detectUnsupportedSqlFunctions(sqlQuery)
          if (unsupportedSql.found) {
            const correctionMessage = unsupportedSql.correction ?? 'این کوئری از توابع پشتیبانی‌نشده استفاده می‌کند.'
            this.emitGuardrailTelemetry(
              'unsupported-function',
              requestId,
              conversationId,
              {
                functionName: unsupportedSql.functionName ?? 'unknown',
                correction: correctionMessage,
                sqlQuery: this.compactText(sqlQuery.replace(/\s+/g, ' '), 400)
              }
            )
            this.emitGuardrailCounterTelemetry('unsupported-function', requestId, conversationId, 1)
            const guardedError = this.createAgentPolicyError(
              'AGENT_UNSUPPORTED_SQL_FUNCTION',
              correctionMessage
            )
            guardedError.message = correctionMessage
            throw guardedError
          }

          const prevalidatedSql = this.prevalidateFinancialQuery(sqlQuery, settings)
          this.ensureFinancialQueryAllowed(prevalidatedSql, settings, conversationMemory)

          const unsupportedSqlAfterPrevalidation = detectUnsupportedSqlFunctions(prevalidatedSql)
          if (unsupportedSqlAfterPrevalidation.found) {
            const correctionMessage = unsupportedSqlAfterPrevalidation.correction ?? 'این کوئری از توابع پشتیبانی‌نشده استفاده می‌کند.'
            this.emitGuardrailTelemetry(
              'unsupported-function',
              requestId,
              conversationId,
              {
                functionName: unsupportedSqlAfterPrevalidation.functionName ?? 'unknown',
                correction: correctionMessage,
                sqlQuery: this.compactText(prevalidatedSql.replace(/\s+/g, ' '), 400)
              }
            )
            const guardedError = this.createAgentPolicyError(
              'AGENT_UNSUPPORTED_SQL_FUNCTION',
              correctionMessage
            )
            guardedError.message = correctionMessage
            throw guardedError
          }

          const rows = await this.executeReadOnlySql(prevalidatedSql, abortSignal)
          successfulDataFetches += 1
          this.throwIfRequestCanceled(abortSignal)
          this.rememberToolTrace(
            conversationMemory,
            `fetch_financial_data rows=${rows.length} sql=${this.compactText(sqlQuery.replace(/\s+/g, ' '), 180)}`
          )
          evidence.push({
            tool: 'fetch_financial_data',
            status: 'ok',
            rowsReturned: rows.length,
            nonNullValue: this.rowsContainNonNullValue(rows),
            scopeApplied: true,
            query: this.compactText(prevalidatedSql.replace(/\s+/g, ' '), 400)
          })
          const redacted = this.redactSensitiveIdentifiers(rows)
          const boundedRows = redacted.rows.slice(0, MAX_TOOL_ROWS)
          const limitedRows = this.limitRowsForModel(boundedRows)
          const outputTruncated = rows.length > boundedRows.length || limitedRows.payloadTruncated
          const redactionText =
            redacted.redactedCells > 0
              ? ` | ${redacted.redactedCells} فیلد حساس پیش از ارسال به مدل پوشانده شد.`
              : ''
          const compactedText =
            limitedRows.payloadTruncated || limitedRows.valueTruncatedCells > 0
              ? ' | خروجی برای مدل خلاصه شد.'
              : ''
          const evidencePreview = this.createEvidencePreview(
            prevalidatedSql,
            limitedRows.rows,
            rows.length,
            outputTruncated
          )

          this.emitProgress(onProgress, {
            type: 'tool-success',
            message: `✅ تعداد ${rows.length} ردیف مالی استخراج شد.${redactionText}${compactedText}`,
            toolName,
            toolCallId: toolCall.id,
            args,
            rowCount: rows.length,
            evidencePreview
          })

          await this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            stage: 'tool-success',
            toolName,
            sqlQuery,
            rowCount: rows.length,
            round
          })

          toolMessages.push(
            this.createToolResponseMessage(toolCall, {
              ok: true,
              row_count: rows.length,
              redacted_cells: redacted.redactedCells,
              truncated: outputTruncated,
              payload_truncated: limitedRows.payloadTruncated,
              value_truncated_cells: limitedRows.valueTruncatedCells,
              rows: limitedRows.rows
            })
          )
          continue
        }

        if (toolName === 'get_database_schema') {
          const tableName = readRequiredStringArg(args, 'table_name', 128)
          const schemaName = readOptionalStringArg(args, 'schema_name', 128)
          const cacheKey = `${schemaName || 'dbo'}.${tableName}`
          
          // Try schema cache first (INTENT fix: avoid redundant schema lookups)
          const cached = this.schemaCacheByTableKey.get(cacheKey)
          if (cached && Date.now() - cached.timestamp < this.SCHEMA_CACHE_TTL_MS) {
            const rows = cached.schema.map((col, idx) => ({
              table_schema: schemaName || 'dbo',
              table_name: tableName,
              ordinal_position: (idx + 1).toString(),
              column_name: col.name,
              data_type: col.dataType,
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              datetime_precision: null,
              is_nullable: col.isNullable ? 1 : 0,
              is_identity: col.isIdentity ? 1 : 0
            }))
            
            this.rememberToolTrace(
              conversationMemory,
              `get_database_schema rows=${rows.length} table=${cacheKey} (cached)`
            )

            evidence.push({
              tool: 'get_database_schema',
              status: 'ok',
              rowsReturned: rows.length,
              nonNullValue: rows.length > 0,
              scopeApplied: false
            })
            
            toolMessages.push(
              this.createToolResponseMessage(toolCall, {
                ok: true,
                table_name: tableName,
                schema_name: schemaName ?? null,
                row_count: rows.length,
                truncated: false,
                payload_truncated: false,
                value_truncated_cells: 0,
                rows: rows.slice(0, MAX_SCHEMA_ROWS)
              })
            )
            
            this.emitProgress(onProgress, {
              type: 'tool-success',
              message: `✅ ساختار جدول [${tableName}] با ${rows.length} ستون بازیابی شد (از کش).`,
              toolName,
              toolCallId: toolCall.id,
              args,
              rowCount: rows.length
            })
            
            continue
          }
          
          const sqlQuery = this.buildDatabaseSchemaQuery(tableName, schemaName)
          const cachedSchema = await this.getCachedSchemaSnapshot(cacheKey, sqlQuery, abortSignal)
          const rows = cachedSchema.rows
          this.throwIfRequestCanceled(abortSignal)

          const schemaColumns: SchemaColumnCatalogItem[] = rows.map((row) => {
            const colName = row['column_name']
            const dataType = row['data_type']
            const maxLen = row['character_maximum_length']
            const isNullable = row['is_nullable']
            const isIdentity = row['is_identity']
            return {
              name: typeof colName === 'string' ? colName : String(colName || ''),
              dataType: typeof dataType === 'string' ? dataType : 'unknown',
              isNullable: Boolean(isNullable),
              maxLength: typeof maxLen === 'number' && maxLen > 0 ? maxLen : null,
              isIdentity: Boolean(isIdentity),
              isPrimaryKey: false,
              hasForeignKey: false,
              sampleValues: []
            }
          })
          this.schemaCacheByTableKey.set(cacheKey, { schema: schemaColumns, timestamp: Date.now() })
          this.rememberToolTrace(
            conversationMemory,
            `get_database_schema rows=${rows.length} table=${schemaName ? `${schemaName}.` : ''}${tableName}`
          )
          evidence.push({
            tool: 'get_database_schema',
            status: 'ok',
            rowsReturned: rows.length,
            nonNullValue: rows.length > 0,
            scopeApplied: false
          })
          const boundedRows = rows.slice(0, MAX_SCHEMA_ROWS)
          const limitedRows = this.limitRowsForModel(boundedRows)
          const outputTruncated = rows.length > boundedRows.length || limitedRows.payloadTruncated
          const compactedText =
            limitedRows.payloadTruncated || limitedRows.valueTruncatedCells > 0
              ? ' | خروجی برای مدل خلاصه شد.'
              : ''

          this.emitProgress(onProgress, {
            type: 'tool-success',
            message: `✅ ساختار جدول [${tableName}] با ${rows.length} ستون استخراج شد.${compactedText}`,
            toolName,
            toolCallId: toolCall.id,
            args,
            rowCount: rows.length
          })

          await this.safeAuditWrite({
            timestamp: new Date().toISOString(),
            requestId,
            stage: 'tool-success',
            toolName,
            sqlQuery,
            rowCount: rows.length,
            round
          })

          toolMessages.push(
            this.createToolResponseMessage(toolCall, {
              ok: true,
              table_name: tableName,
              schema_name: schemaName ?? null,
              row_count: rows.length,
              truncated: outputTruncated,
              payload_truncated: limitedRows.payloadTruncated,
              value_truncated_cells: limitedRows.valueTruncatedCells,
              rows: limitedRows.rows
            })
          )
          continue
        }

        const unsupportedToolError = `Unsupported tool requested: ${toolName}`
        const unsupportedToolCode = 'AGENT_UNSUPPORTED_TOOL'

        evidence.push({
          tool: toolName,
          status: 'error',
          rowsReturned: 0,
          nonNullValue: false,
          scopeApplied: false,
          errorCode: unsupportedToolCode,
          errorMessage: unsupportedToolError
        })

        this.emitProgress(onProgress, {
          type: 'tool-error',
          message: `❌ ابزار ناشناخته: ${toolName}`,
          toolName,
          toolCallId: toolCall.id,
          args,
          errorCode: unsupportedToolCode,
          errorCategory: 'orchestration-policy'
        })

        await this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          stage: 'tool-error',
          toolName,
          round,
          error: unsupportedToolError,
          errorCode: unsupportedToolCode,
          errorCategory: 'orchestration-policy'
        })

        toolMessages.push(
          this.createToolResponseMessage(toolCall, {
            ok: false,
            error: unsupportedToolError,
            error_code: unsupportedToolCode
          })
        )
      } catch (error) {
        if (abortSignal.aborted || this.isCancellationLikeError(error)) {
          throw this.resolveCancellationError(error, abortSignal)
        }

        const errorInfo = this.toErrorInfo(error)

        evidence.push({
          tool: toolName,
          status: 'error',
          rowsReturned: 0,
          nonNullValue: false,
          scopeApplied: false,
          errorCode: errorInfo.code,
          errorMessage: errorInfo.message
        })

        this.emitProgress(onProgress, {
          type: 'tool-error',
          message: `❌ خطا در اجرای ابزار ${toolName}: ${errorInfo.message}`,
          toolName,
          toolCallId: toolCall.id,
          args,
          errorCode: errorInfo.code,
          errorCategory: errorInfo.category
        })

        await this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          stage: 'tool-error',
          toolName,
          round,
          error: errorInfo.message,
          errorCode: errorInfo.code,
          errorCategory: errorInfo.category
        })

        toolMessages.push(
          this.createToolResponseMessage(toolCall, {
            ok: false,
            error: errorInfo.message,
            error_code: errorInfo.code ?? null
          })
        )
      }
    }

    return {
      toolMessages,
      successfulDataFetches,
      evidence
    }
  }

  private rowsContainNonNullValue(rows: SqlQueryRow[]): boolean {
    return rows.some((row) =>
      Object.values(row).some((value) => value !== null && value !== undefined && value !== '')
    )
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
        category: typeof errorWithMetadata.category === 'string' ? errorWithMetadata.category : undefined
      }
    }

    return {
      message: String(error)
    }
  }

  private createAgentPolicyError(code: string, message: string): Error & {
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

  private createCancellationError(reason: string): Error & {
    code: string
    category: string
  } {
    const normalizedReason = reason.trim() || 'Request canceled by user.'
    const error = new Error(normalizedReason) as Error & {
      code: string
      category: string
    }

    error.name = 'AbortError'
    error.code = 'AGENT_REQUEST_CANCELLED'
    error.category = 'orchestration-control'

    return error
  }

  private throwIfRequestCanceled(signal: AbortSignal): void {
    if (!signal.aborted) {
      return
    }

    throw this.createCancellationError(this.toCancellationReason(signal.reason))
  }

  private resolveCancellationError(error: unknown, signal: AbortSignal): Error {
    if (signal.aborted) {
      return this.createCancellationError(this.toCancellationReason(signal.reason))
    }

    if (this.isCancellationLikeError(error)) {
      if (error instanceof Error) {
        return this.createCancellationError(error.message)
      }

      return this.createCancellationError('Request canceled by user.')
    }

    if (error instanceof Error) {
      return error
    }

    return new Error(String(error))
  }

  private isCancellationLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false
    }

    const typedError = error as Error & {
      code?: unknown
    }

    if (typedError.name === 'AbortError') {
      return true
    }

    if (typeof typedError.code === 'string' && typedError.code.toUpperCase() === 'AGENT_REQUEST_CANCELLED') {
      return true
    }

    const message = error.message.toLowerCase()
    return message.includes('request canceled by user') || message.includes('request cancelled by user')
  }

  private toCancellationReason(reason: unknown): string {
    if (typeof reason === 'string' && reason.trim()) {
      return reason.trim()
    }

    if (reason instanceof Error && reason.message.trim()) {
      return reason.message.trim()
    }

    return 'Request canceled by user.'
  }

  private getOrCreateConversationMemory(conversationId: string): ConversationMemoryState {
    const existing = this.conversationMemoryById.get(conversationId)

    if (existing) {
      existing.touchedAt = Date.now()
      return existing
    }

    const created: ConversationMemoryState = {
      conversationId,
      notes: [],
      facts: {
        companyNames: [],
        fiscalYears: [],
        branchNames: [],
        dateRange: null,
        confirmedMappings: {}
      },
      lastUserPrompt: null,
      lastAssistantOutcome: null,
      lastToolTrace: [],
      touchedAt: Date.now()
    }

    this.conversationMemoryById.set(conversationId, created)

    return created
  }

  private createConversationMemorySnapshot(memory: ConversationMemoryState): ConversationMemorySnapshot {
    return {
      notes: [...memory.notes],
      facts: {
        companyNames: [...memory.facts.companyNames],
        fiscalYears: [...memory.facts.fiscalYears],
        branchNames: [...memory.facts.branchNames],
        dateRange: memory.facts.dateRange,
        confirmedMappings: {
          ...memory.facts.confirmedMappings
        }
      },
      lastUserPrompt: memory.lastUserPrompt,
      lastAssistantOutcome: memory.lastAssistantOutcome,
      lastToolTrace: [...memory.lastToolTrace]
    }
  }

  private pruneConversationMemory(): void {
    if (this.conversationMemoryById.size <= MAX_CONVERSATION_MEMORY_SESSIONS) {
      return
    }

    const overflowCount = this.conversationMemoryById.size - MAX_CONVERSATION_MEMORY_SESSIONS
    const staleConversationIds = [...this.conversationMemoryById.values()]
      .sort((left, right) => left.touchedAt - right.touchedAt)
      .slice(0, overflowCount)
      .map((memory) => memory.conversationId)

    for (const conversationId of staleConversationIds) {
      this.conversationMemoryById.delete(conversationId)
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
      ...history
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
      prompt
    ]

    for (const sourceText of textSources) {
      const extractedFacts = this.extractConversationFacts(sourceText)

      memory.facts.companyNames = this.mergeScopeValues(memory.facts.companyNames, extractedFacts.companyNames)
      memory.facts.fiscalYears = this.mergeScopeValues(memory.facts.fiscalYears, extractedFacts.fiscalYears)
      memory.facts.branchNames = this.mergeScopeValues(memory.facts.branchNames, extractedFacts.branchNames)

      if (extractedFacts.dateRange) {
        memory.facts.dateRange = extractedFacts.dateRange
      }
    }

    memory.lastUserPrompt = this.compactText(prompt, 240)
    this.pushConversationMemoryNote(memory, `Latest user intent: ${this.compactText(prompt, 220)}`)
  }

  private extractConversationFacts(text: string): ExtractedConversationFacts {
    const normalizedText = text.replace(/\s+/g, ' ').trim()

    if (!normalizedText) {
      return {
        companyNames: [],
        fiscalYears: [],
        branchNames: []
      }
    }

    const normalizedDigitsText = this.normalizePersianDigits(normalizedText)
    const facts: ExtractedConversationFacts = {
      companyNames: this.extractNamedScopeValues(normalizedText, COMPANY_SCOPE_CAPTURE_PATTERNS),
      fiscalYears: this.extractFiscalYears(normalizedDigitsText),
      branchNames: this.extractNamedScopeValues(normalizedText, BRANCH_SCOPE_CAPTURE_PATTERNS)
    }

    const dateRangeFaMatch = normalizedText.match(/از\s+([^\n\r]{1,24})\s+تا\s+([^\n\r]{1,24})/u)
    if (dateRangeFaMatch?.[1] && dateRangeFaMatch?.[2]) {
      facts.dateRange = `از ${dateRangeFaMatch[1].trim()} تا ${dateRangeFaMatch[2].trim()}`
    } else {
      const dateRangeEnMatch = normalizedDigitsText.match(/\bfrom\s+([a-z0-9\/-]{2,20})\s+to\s+([a-z0-9\/-]{2,20})/i)
      if (dateRangeEnMatch?.[1] && dateRangeEnMatch?.[2]) {
        facts.dateRange = `from ${dateRangeEnMatch[1]} to ${dateRangeEnMatch[2]}`
      }
    }

    return facts
  }

  private extractNamedScopeValues(text: string, patterns: RegExp[]): string[] {
    const values: string[] = []

    for (const pattern of patterns) {
      pattern.lastIndex = 0

      for (const match of text.matchAll(pattern)) {
        const captured = match[1]

        if (typeof captured !== 'string' || !captured.trim()) {
          continue
        }

        const normalizedChunk = this.trimScopeChunk(captured)
        if (!normalizedChunk) {
          continue
        }

        const parts = normalizedChunk
          .split(RUNTIME_SCOPE_SPLIT_PATTERN)
          .map((part) => this.normalizeScopeToken(part))
          .filter((part) => this.isValidScopeToken(part))

        values.push(...parts)
      }
    }

    return this.uniqueScopeValues(values)
  }

  private trimScopeChunk(value: string): string {
    const compact = value.replace(/\s+/g, ' ').trim()

    if (!compact) {
      return ''
    }

    let minStopIndex = compact.length

    for (const pattern of RUNTIME_SCOPE_STOP_PATTERNS) {
      const match = pattern.exec(compact)

      if (!match || match.index < 0) {
        continue
      }

      minStopIndex = Math.min(minStopIndex, match.index)
    }

    return compact.slice(0, minStopIndex).trim()
  }

  private normalizeScopeToken(value: string): string {
    return value
      .replace(/^['"“”‘’()\[\]{}]+|['"“”‘’()\[\]{}]+$/g, '')
      .replace(/^(?:شرکت|company|companies|شعبه|branch|branches)\s+/iu, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private isValidScopeToken(value: string): boolean {
    if (!value) {
      return false
    }

    if (value.length > 48) {
      return false
    }

    if (/^(?:and|و|or|یا)$/iu.test(value)) {
      return false
    }

    if (/^\d+$/u.test(value)) {
      return false
    }

    return true
  }

  private extractFiscalYears(text: string): string[] {
    const years: string[] = []

    RUNTIME_SCOPE_YEAR_RANGE_PATTERN.lastIndex = 0
    for (const rangeMatch of text.matchAll(RUNTIME_SCOPE_YEAR_RANGE_PATTERN)) {
      const startYear = Number.parseInt(rangeMatch[1] ?? '', 10)
      const endYear = Number.parseInt(rangeMatch[2] ?? '', 10)

      if (Number.isNaN(startYear) || Number.isNaN(endYear)) {
        continue
      }

      const delta = endYear - startYear
      if (delta >= 0 && delta <= 5) {
        for (let year = startYear; year <= endYear; year += 1) {
          years.push(String(year))
        }
      } else {
        years.push(String(startYear), String(endYear))
      }
    }

    RUNTIME_SCOPE_YEAR_CONTEXT_PATTERN.lastIndex = 0
    for (const contextMatch of text.matchAll(RUNTIME_SCOPE_YEAR_CONTEXT_PATTERN)) {
      const segment = contextMatch[1] ?? ''
      const segmentYears = segment.match(RUNTIME_SCOPE_YEAR_CAPTURE_PATTERN) ?? []
      years.push(...segmentYears)
    }

    return this.uniqueScopeValues(years)
  }

  private mergeScopeValues(currentValues: string[], incomingValues: string[]): string[] {
    return this.uniqueScopeValues([...currentValues, ...incomingValues]).slice(0, MAX_SCOPE_VALUES_PER_DIMENSION)
  }

  private uniqueScopeValues(values: string[]): string[] {
    const deduped: string[] = []
    const seen = new Set<string>()

    for (const value of values) {
      const normalized = value.replace(/\s+/g, ' ').trim()

      if (!normalized) {
        continue
      }

      const key = normalized.toLowerCase()
      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      deduped.push(normalized)
    }

    return deduped
  }

  private normalizePersianDigits(value: string): string {
    return normalizePersianDigits(value)
  }

  private updateConversationMemoryFromAssistant(memory: ConversationMemoryState, finalText: string): void {
    memory.touchedAt = Date.now()

    if (!finalText.trim()) {
      return
    }

    memory.lastAssistantOutcome = this.compactText(finalText, 280)
    this.pushConversationMemoryNote(memory, `Latest assistant outcome: ${this.compactText(finalText, 220)}`)
  }

  private rememberToolTrace(memory: ConversationMemoryState, trace: string): void {
    const normalizedTrace = this.compactText(trace.replace(/\s+/g, ' ').trim(), 220)

    if (!normalizedTrace) {
      return
    }

    const existingIndex = memory.lastToolTrace.findIndex((entry) => entry === normalizedTrace)
    if (existingIndex >= 0) {
      memory.lastToolTrace.splice(existingIndex, 1)
    }

    memory.lastToolTrace.push(normalizedTrace)

    if (memory.lastToolTrace.length > MAX_CONVERSATION_TOOL_TRACES) {
      memory.lastToolTrace.splice(0, memory.lastToolTrace.length - MAX_CONVERSATION_TOOL_TRACES)
    }

    this.pushConversationMemoryNote(memory, `Tool trace: ${normalizedTrace}`)
  }

  private pushConversationMemoryNote(memory: ConversationMemoryState, note: string): void {
    const normalizedNote = note.trim()

    if (!normalizedNote) {
      return
    }

    const existingIndex = memory.notes.findIndex((entry) => entry === normalizedNote)
    if (existingIndex >= 0) {
      memory.notes.splice(existingIndex, 1)
    }

    memory.notes.push(normalizedNote)

    if (memory.notes.length > MAX_CONVERSATION_MEMORY_NOTES) {
      memory.notes.splice(0, memory.notes.length - MAX_CONVERSATION_MEMORY_NOTES)
    }
  }

  private createToolResponseMessage(toolCall: GeminiToolCall, payload: Record<string, unknown>): GeminiMessage {
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
      .filter((toolCall): toolCall is { id: string; function: { name: string; arguments?: string } } => {
        return Boolean(toolCall?.id && toolCall.function?.name)
      })
      .map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments ?? '{}'
        }
      }))
  }

  private compactHistory(history: GeminiMessage[], memory?: ConversationMemoryState): GeminiMessage[] {
    const clean = history.filter((message) => message.role !== 'system')

    if (clean.length <= MAX_CHAT_HISTORY) {
      return clean
    }

    const tailCount = MAX_CHAT_HISTORY - 1
    const tail = clean.slice(-tailCount)
    const head = clean.slice(0, clean.length - tailCount)
    const summary = this.buildHistorySummary(head)

    if (memory) {
      this.pushConversationMemoryNote(
        memory,
        `Trimmed history summary: ${this.compactText(summary.replace(/\s+/g, ' '), 220)}`
      )
    }

    return [
      {
        role: 'assistant',
        content: summary
      },
      ...tail
    ]
  }

  private buildHistorySummary(messages: GeminiMessage[]): string {
    if (messages.length === 0) {
      return 'Conversation summary: earlier context was trimmed.'
    }

    const userMessages = messages
      .filter((message) => message.role === 'user')
      .slice(-MAX_HISTORY_SUMMARY_USERS)
      .map((message) => this.compactText(message.content, 160))

    const assistantMessages = messages
      .filter((message) => message.role === 'assistant' && !message.toolCalls)
      .slice(-MAX_HISTORY_SUMMARY_ASSISTANT)
      .map((message) => this.compactText(message.content, 160))

    const lines = ['Conversation summary from earlier turns:']

    for (const userMessage of userMessages) {
      lines.push(`- User request: ${userMessage}`)
    }

    for (const assistantMessage of assistantMessages) {
      lines.push(`- Assistant insight: ${assistantMessage}`)
    }

    lines.push('Use this summary with the recent messages to continue accurately.')

    return lines.join('\n')
  }

  private buildRuntimeSystemPrompt(
    settings: AppSettings,
    prompt: string,
    conversationMemory: ConversationMemoryState,
    previousMemorySnapshot: ConversationMemorySnapshot
  ): string {
    const schemaContext = this.buildSchemaCatalogContext(settings)
    const isRefinementPrompt = this.isLikelyRefinementPrompt(previousMemorySnapshot, prompt)
    const historyWindowContext = this.buildHistoryWindowContext(isRefinementPrompt)
    const memoryContext = this.buildConversationMemoryContext(conversationMemory, isRefinementPrompt)
    const refinementContext = isRefinementPrompt ? this.buildRefinementContext(previousMemorySnapshot, prompt) : null
    const freshContext = this.buildFreshConversationContext(previousMemorySnapshot, prompt)
    const intentContext = this.buildPromptIntentContext(settings, prompt)

    const segments = [SYSTEM_PROMPT]

    if (schemaContext) {
      segments.push(schemaContext)
    }

    if (historyWindowContext) {
      segments.push(historyWindowContext)
    }

    if (memoryContext) {
      segments.push(memoryContext)
    }

    if (refinementContext) {
      segments.push(refinementContext)
    } else if (freshContext) {
      segments.push(freshContext)
    }

    if (intentContext) {
      segments.push(intentContext)
    }

    return segments.join('\n\n')
  }

  private buildHistoryWindowContext(isRefinementPrompt: boolean): string {
    const modeLabel = isRefinementPrompt ? 'refinement' : 'fresh'

    return [
      'Effective history window:',
      `- Current mode: ${modeLabel}.`,
      '- Keep the latest 6 user turns and 4 assistant turns in the active working context.',
      '- Summarize earlier turns into compact context, and do not let stale prior-memory assumptions override a fresh prompt unless the user explicitly asks to continue.'
    ].join('\n')
  }

  private buildConversationMemoryContext(memory: ConversationMemoryState, usePersistentHeader = true): string | null {
    const mappingEntries = Object.entries(memory.facts.confirmedMappings)
      .filter(([, tableRef]) => typeof tableRef === 'string' && tableRef.trim())
      .slice(0, 6)
      .map(([conceptKey, tableRef]) => `${conceptKey}=${tableRef}`)

    const lines: string[] = []

    if (memory.facts.companyNames.length > 0) {
      lines.push(`- Company scope: ${memory.facts.companyNames.join(' | ')}`)
    }

    if (memory.facts.fiscalYears.length > 0) {
      lines.push(`- Fiscal year scope: ${memory.facts.fiscalYears.join(' | ')}`)
    }

    if (memory.facts.branchNames.length > 0) {
      lines.push(`- Branch scope: ${memory.facts.branchNames.join(' | ')}`)
    }

    if (
      memory.facts.companyNames.length > 1 ||
      memory.facts.fiscalYears.length > 1 ||
      memory.facts.branchNames.length > 1
    ) {
      lines.push(
        '- Multi-scope runtime policy: keep all scope values in SQL filters (prefer IN clauses) and label output rows by company/fiscal year/branch when available.'
      )
    }

    if (memory.facts.dateRange) {
      lines.push(`- Date range focus: ${memory.facts.dateRange}`)
    }

    if (mappingEntries.length > 0) {
      lines.push(`- Confirmed mappings: ${mappingEntries.join(' | ')}`)
    }

    if (memory.lastUserPrompt) {
      lines.push(`- Last user prompt: ${memory.lastUserPrompt}`)
    }

    if (memory.lastAssistantOutcome) {
      lines.push(`- Last assistant outcome: ${memory.lastAssistantOutcome}`)
    }

    if (memory.lastToolTrace.length > 0) {
      lines.push(`- Recent tool traces: ${memory.lastToolTrace.slice(-3).join(' || ')}`)
    }

    const memoryNotes = memory.notes.slice(-4)
    for (const note of memoryNotes) {
      lines.push(`- ${note}`)
    }

    if (lines.length === 0) {
      return null
    }

    if (!usePersistentHeader) {
      return lines.join('\n')
    }

    return ['Persistent conversation memory (survives trimmed history):', ...lines].join('\n')
  }

  private buildFreshConversationContext(previousMemory: ConversationMemorySnapshot, prompt: string): string | null {
    if (this.isLikelyRefinementPrompt(previousMemory, prompt)) {
      return null
    }

    const hasPriorContext = Boolean(previousMemory.lastUserPrompt || previousMemory.lastAssistantOutcome)

    if (!hasPriorContext) {
      return [
        'Fresh conversation mode is active:',
        '- Treat this prompt as a new analysis request unless the user explicitly says to reuse the previous answer.',
        '- Use only the current question, current schema catalog, and current tool outputs for planning.',
        '- Do not assume prior turn facts or KPI choices are still valid.'
      ].join('\n')
    }

    return [
      'Fresh conversation mode is active:',
      '- The current prompt is not a refinement request, so reset the working assumption set before planning.',
      '- Re-derive KPI intent and scope from the current question only.',
      '- Keep prior memory as fallback context only when the user explicitly references it.'
    ].join('\n')
  }

  private buildRefinementContext(previousMemory: ConversationMemorySnapshot, prompt: string): string | null {
    if (!this.isLikelyRefinementPrompt(previousMemory, prompt)) {
      return null
    }

    const extractedFacts = this.extractConversationFacts(prompt)
    const lines = [
      'Multi-turn refinement mode is active:',
      '- Treat this prompt as an incremental correction to the previous answer, not a brand-new analysis.',
      '- Preserve prior assumptions/tables unless user explicitly changes them.'
    ]

    if (previousMemory.lastUserPrompt) {
      lines.push(`- Previous user prompt: ${previousMemory.lastUserPrompt}`)
    }

    if (previousMemory.lastAssistantOutcome) {
      lines.push(`- Previous assistant outcome: ${previousMemory.lastAssistantOutcome}`)
    }

    if (previousMemory.lastToolTrace.length > 0) {
      lines.push(`- Previous tool traces: ${previousMemory.lastToolTrace.slice(-3).join(' || ')}`)
    }

    const overrides: string[] = []

    if (extractedFacts.companyNames.length > 0) {
      overrides.push(`companies=${extractedFacts.companyNames.join(',')}`)
    }

    if (extractedFacts.fiscalYears.length > 0) {
      overrides.push(`fiscal_years=${extractedFacts.fiscalYears.join(',')}`)
    }

    if (extractedFacts.branchNames.length > 0) {
      overrides.push(`branches=${extractedFacts.branchNames.join(',')}`)
    }

    if (extractedFacts.dateRange) {
      overrides.push(`date_range=${extractedFacts.dateRange}`)
    }

    if (overrides.length > 0) {
      lines.push(`- Explicit user overrides in this turn: ${overrides.join(' | ')}`)
    }

    return lines.join('\n')
  }

  private isLikelyRefinementPrompt(previousMemory: ConversationMemorySnapshot, prompt: string): boolean {
    const normalizedPrompt = prompt.replace(/\s+/g, ' ').trim()

    if (!normalizedPrompt) {
      return false
    }

    const hasPriorContext = Boolean(previousMemory.lastUserPrompt || previousMemory.lastAssistantOutcome)
    if (!hasPriorContext) {
      return false
    }

    if (REFINEMENT_INTENT_PATTERNS.some((pattern) => pattern.test(normalizedPrompt))) {
      return true
    }

    if (
      normalizedPrompt.length <= 90 &&
      /^(برای|فقط|با|بدون|روی|نه|این|آن|همین|همان|and|only|for)\b/iu.test(normalizedPrompt)
    ) {
      return true
    }

    return false
  }

  private buildPromptIntentContext(settings: AppSettings, prompt: string): string | null {
    const activeCatalog = this.findActiveSchemaCatalog(settings)
    if (!activeCatalog) {
      return null
    }

    const detectedConcepts = this.detectPromptConcepts(prompt)
    if (detectedConcepts.length === 0) {
      return null
    }

    const lines = [
      'Prompt intent context derived from Persian/English finance synonyms:',
      `- Detected concepts: ${detectedConcepts.map((concept) => SCHEMA_CONTEXT_CONCEPT_LABELS[concept]).join(', ')}`,
      '- Tool planning policy for this request:',
      '  - Prefer mapped tables for detected concepts.',
      '  - Call get_database_schema on mapped tables first before writing final SELECT when possible.',
      '  - Use list_database_tables only if mapped tables are missing or do not contain required fields.',
      '- Concept-to-table runtime hints:'
    ]

    let hasPreferredMapping = false

    for (const conceptKey of detectedConcepts) {
      const preferredMapping = this.resolvePreferredMapping(activeCatalog, conceptKey, prompt)

      if (!preferredMapping) {
        lines.push(`  - ${SCHEMA_CONTEXT_CONCEPT_LABELS[conceptKey]}: no mapped table available.`)
        continue
      }

      hasPreferredMapping = true
      const dateHint = this.inferDateHintForTable(activeCatalog, preferredMapping.tableRef)
      const dateText = dateHint ? `; date_hint=${dateHint}` : ''

      lines.push(
        `  - ${SCHEMA_CONTEXT_CONCEPT_LABELS[conceptKey]}: ${preferredMapping.tableRef} (source=${preferredMapping.source}${dateText})`
      )
    }

    if (!hasPreferredMapping) {
      lines.push('  - No preferred mappings for detected concepts; proceed with standard discovery flow.')
    }

    return lines.join('\n')
  }

  private buildDeterministicIntentClarificationResponse(intentId: DeterministicFinancialIntent): string {
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

  private buildClarificationResponseIfNeeded(
    settings: AppSettings,
    prompt: string,
    conversationMemory: ConversationMemoryState
  ): string | null {
    // Drive clarification off the explicit slot/clarification FSM. The orchestrator now
    // consumes the terminal RouteState instead of re-deriving the same checks inline.
    const memorySnapshot = this.createConversationMemorySnapshot(conversationMemory)
    const routeState = transition(prompt, memorySnapshot)

    const intentClarification = this.buildRouteStateClarification(prompt, routeState)

    if (intentClarification) {
      return intentClarification
    }

    // Schema-readiness clarifications depend on runtime catalog state (mappings / ambiguous
    // date range), not pure intent slots, so they remain a distinct fallback layer.
    return this.buildSchemaReadinessClarificationIfNeeded(settings, prompt, conversationMemory)
  }

  /**
   * Map a terminal FSM state to a clarification message (or null to proceed). This folds the
   * previously scattered intent-level clarification checks into one explicit switch.
   */
  private buildRouteStateClarification(prompt: string, routeState: RouteState): string | null {
    switch (routeState.kind) {
      case 'ambiguous':
        return this.buildAmbiguousIntentClarificationResponse(routeState.candidates)
      case 'classified':
        // Finer-grained disambiguation for annual sales (gross / net / booked KPI variants),
        // which live below the FinancialIntentId granularity.
        if (routeState.intentId === 'get_sales_summary_by_period') {
          return this.buildSalesKpiClarificationResponseIfNeeded(prompt)
        }
        return null
      case 'need-slot':
      case 'unroutable':
      default:
        return null
    }
  }

  private buildSchemaReadinessClarificationIfNeeded(
    settings: AppSettings,
    prompt: string,
    conversationMemory: ConversationMemoryState
  ): string | null {
    const detectedConcepts = this.detectPromptConcepts(prompt)

    if (detectedConcepts.length === 0) {
      return null
    }

    const activeCatalog = this.findActiveSchemaCatalog(settings)

    if (!activeCatalog) {
      return null
    }

    // Relaxed exploratory intents (e.g. get_account_balance) must not be halted
    // at Round 0 by a missing-mappings clarification: even when the discovered
    // catalog lacks an explicit accounts/schema mapping, we let the request fall
    // through to the model exploration tool-loop so the agent can self-discover
    // the relevant tables (list_database_tables on the ACC schema) and still
    // deliver data instead of pre-emptively asking for a mapping.
    const detectedExploratoryIntent = this.detectDeterministicFinancialIntent(prompt)
    if (detectedExploratoryIntent && isRelaxedExploratoryIntent(detectedExploratoryIntent)) {
      return null
    }

    const missingConceptMappings = detectedConcepts.filter(
      (conceptKey) => !this.resolvePreferredMapping(activeCatalog, conceptKey, prompt)
    )

    if (missingConceptMappings.length > 0) {
      return this.buildMissingMappingsClarificationResponse(activeCatalog, missingConceptMappings)
    }

    const extractedFacts = this.extractConversationFacts(prompt)
    const hasPromptDateScope = extractedFacts.fiscalYears.length > 0 || Boolean(extractedFacts.dateRange)
    const hasMemoryDateScope =
      conversationMemory.facts.fiscalYears.length > 0 || Boolean(conversationMemory.facts.dateRange)
    const normalizedPromptDigits = this.normalizePersianDigits(prompt)
    const hasAmbiguousDateSignal = DATE_RANGE_AMBIGUITY_SIGNAL_PATTERN.test(normalizedPromptDigits)
    const hasExplicitDateScope = DATE_RANGE_EXPLICIT_SCOPE_PATTERN.test(normalizedPromptDigits)

    if (hasAmbiguousDateSignal && !hasPromptDateScope && !hasMemoryDateScope && !hasExplicitDateScope) {
      return this.buildDateRangeClarificationResponse(activeCatalog)
    }

    return null
  }

  private buildAmbiguousIntentClarificationResponse(candidates: FinancialIntentId[]): string {
    const optionLabels = candidates.map((intentId) => FINANCIAL_INTENT_FA_LABELS[intentId] ?? intentId)

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

  private buildSalesKpiClarificationResponseIfNeeded(prompt: string): string | null {
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

  private buildMissingMappingsClarificationResponse(
    activeCatalog: SchemaCatalogEntry,
    missingConceptMappings: AccountingConceptKey[]
  ): string {
    const missingLabels = missingConceptMappings
      .slice(0, 4)
      .map((conceptKey) => SCHEMA_CONTEXT_CONCEPT_LABELS[conceptKey])
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

  private buildDateRangeClarificationResponse(activeCatalog: SchemaCatalogEntry): string {
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

  private resolvePreferredMapping(
    activeCatalog: SchemaCatalogEntry,
    conceptKey: AccountingConceptKey,
    prompt?: string
  ): PreferredMapping | null {
    const semanticOverride = this.resolvePromptSemanticMappingOverride(activeCatalog, conceptKey, prompt)

    if (semanticOverride) {
      return semanticOverride
    }

    const selectedTable = activeCatalog.selectedMappings[conceptKey]?.trim() ?? ''

    if (selectedTable) {
      return {
        tableRef: selectedTable,
        source: 'selected'
      }
    }

    const suggestedTable = activeCatalog.suggestedMappings[conceptKey]?.[0]?.trim() ?? ''

    if (suggestedTable) {
      return {
        tableRef: suggestedTable,
        source: 'suggested'
      }
    }

    return null
  }

  private resolvePromptSemanticMappingOverride(
    activeCatalog: SchemaCatalogEntry,
    conceptKey: AccountingConceptKey,
    prompt?: string
  ): PreferredMapping | null {
    if (conceptKey !== 'documents' || !prompt) {
      return null
    }

    const normalizedPrompt = this.normalizePersianDigits(prompt).trim().toLowerCase()
    const purchaseSignals = /(خرید|purchase|purchases|buy|procure|procurement|supplier|vendors?|receipts?|رسید|انبار|inventory|voucher|purchaseinvoice)/iu
    const salesSignals = /(فروش|sale|sales|revenue|customer|salefacts)/iu

    const candidates = (activeCatalog.suggestedMappings[conceptKey] ?? [])
      .map((tableRef) => tableRef?.trim() ?? '')
      .filter(Boolean)

    if (purchaseSignals.test(normalizedPrompt)) {
      const purchaseCandidate = candidates.find((tableRef) =>
        /(voucher|receipt|inventory|purchase|buy|procure|supplier|vendor|item)/iu.test(tableRef)
      )

      if (purchaseCandidate) {
        return {
          tableRef: purchaseCandidate,
          source: 'suggested'
        }
      }
    }

    if (salesSignals.test(normalizedPrompt)) {
      const salesCandidate = candidates.find((tableRef) => /(sale|sales|revenue|mrp)/iu.test(tableRef))

      if (salesCandidate) {
        return {
          tableRef: salesCandidate,
          source: 'suggested'
        }
      }
    }

    return null
  }

  private detectPromptConcepts(prompt: string): AccountingConceptKey[] {
    const normalizedPrompt = prompt.trim()

    if (!normalizedPrompt) {
      return []
    }

    return SCHEMA_CONTEXT_CONCEPT_ORDER.filter((conceptKey) => {
      const patterns = PROMPT_INTENT_SYNONYMS[conceptKey]
      return patterns.some((pattern) => pattern.test(normalizedPrompt))
    })
  }

  private inferDateHintForTable(activeCatalog: SchemaCatalogEntry, tableRef: string): string | null {
    const selectedDateMode = this.normalizeSchemaDateMode(activeCatalog.selectedDateMode)

    if (selectedDateMode && selectedDateMode !== 'unknown') {
      return `${this.toDateModeHintText(selectedDateMode)} (catalog selected mode)`
    }

    const normalizedTableRef = this.normalizeTableRef(tableRef)

    const targetTable = activeCatalog.tables.find((table) => {
      return this.normalizeTableRef(`${table.schemaName}.${table.tableName}`) === normalizedTableRef
    })

    if (!targetTable) {
      return null
    }

    const shamsiTextPattern = /^(13|14)\d{2}[\/-](0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])$/
    const shamsiNumericPattern = /^(13|14)\d{6}$/

    let hasGregorianDateType = false
    let hasShamsiText = false
    let hasShamsiNumeric = false
    let hasFiscalPeriod = false
    const relatedDateColumns: string[] = []

    for (const column of targetTable.columns) {
      const dataType = column.dataType.toLowerCase()
      const columnName = column.name.toLowerCase()
      const samples = column.sampleValues.map((value) => value.trim())

      if (dataType.includes('date') || dataType.includes('time')) {
        hasGregorianDateType = true
        relatedDateColumns.push(column.name)
      }

      if (
        columnName.includes('fiscal') ||
        columnName.includes('period') ||
        columnName.includes('دوره') ||
        columnName.includes('سال')
      ) {
        hasFiscalPeriod = true
        relatedDateColumns.push(column.name)
      }

      if (samples.some((sample) => shamsiTextPattern.test(sample))) {
        hasShamsiText = true
        relatedDateColumns.push(column.name)
      }

      if (samples.some((sample) => shamsiNumericPattern.test(sample))) {
        hasShamsiNumeric = true
        relatedDateColumns.push(column.name)
      }
    }

    const uniqueDateColumns = [...new Set(relatedDateColumns)].slice(0, 3)
    const columnHint = uniqueDateColumns.length > 0 ? ` (columns: ${uniqueDateColumns.join(', ')})` : ''

    if (hasFiscalPeriod) {
      return `fiscal period${columnHint}`
    }

    if (hasShamsiText) {
      return `shamsi text date${columnHint}`
    }

    if (hasShamsiNumeric) {
      return `shamsi numeric date${columnHint}`
    }

    if (hasGregorianDateType) {
      return `gregorian date/datetime${columnHint}`
    }

    const detectedDateMode = this.normalizeSchemaDateMode(activeCatalog.detectedDateMode)
    if (detectedDateMode && detectedDateMode !== 'unknown') {
      return `${this.toDateModeHintText(detectedDateMode)} (catalog detected mode)`
    }

    return null
  }

  private normalizeSchemaDateMode(value: unknown): SchemaDateMode | null {
    if (typeof value !== 'string') {
      return null
    }

    const normalized = value.trim()

    switch (normalized) {
      case 'unknown':
      case 'gregorian':
      case 'shamsiText':
      case 'shamsiNumeric':
      case 'fiscalPeriod':
      case 'mixed':
        return normalized
      default:
        return null
    }
  }

  private toDateModeHintText(mode: SchemaDateMode): string {
    switch (mode) {
      case 'gregorian':
        return 'gregorian date/datetime'
      case 'shamsiText':
        return 'shamsi text date'
      case 'shamsiNumeric':
        return 'shamsi numeric date'
      case 'fiscalPeriod':
        return 'fiscal period'
      case 'mixed':
        return 'mixed date formats'
      case 'unknown':
      default:
        return 'unknown date mode'
    }
  }

  private normalizeTableRef(tableRef: string): string {
    return tableRef.trim().toLowerCase()
  }

  /**
   * Fetches the table list for a given pattern, caching the result under a
   * PATTERN-SPECIFIC key.
   *
   * The earlier implementation cached every pattern's result under one global
   * 'all' key, so the first call with a narrow/Persian/typo pattern (e.g. %فروش%
   * → 0 rows) poisoned the cache and every later pattern (%invoice%, %sales%)
   * returned 0 — making the sales/invoice tables undiscoverable and forcing a
   * false "insufficient evidence" refusal.
   *
   * The actual SQL LIKE query is executed per distinct pattern, which (a) avoids
   * poisoning, (b) honors `%` wildcards correctly (a JS substring filter cannot),
   * and (c) never truncates a specific pattern's matches the way a single
   * TOP-capped full-table list would on a database with > MAX_TABLE_LIST_ROWS
   * tables.
   */
  private async fetchTableListCached(
    tablePattern: string | null,
    sqlQuery: string,
    abortSignal: AbortSignal
  ): Promise<SqlQueryRow[]> {
    const normalized = (tablePattern ?? '').trim().toLowerCase()
    const cacheKey = normalized ? `pattern:${normalized}` : 'all'

    const cached = this.schemaTableListCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp <= this.SCHEMA_CACHE_TTL_MS) {
      return [...cached.rows]
    }

    const rows = await this.executeMetadataSql(sqlQuery, abortSignal)
    this.schemaTableListCache.set(cacheKey, { rows, timestamp: Date.now() })
    return rows
  }

  private prevalidateFinancialQuery(sqlQuery: string, settings: AppSettings): string {
    const activeCatalog = this.findActiveSchemaCatalog(settings)

    if (!activeCatalog) {
      return sqlQuery
    }

    let rewritten = sqlQuery

    const identifierPattern = /\b(?:\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\b/g

    for (const table of activeCatalog.tables) {
      const tableName = table.tableName.trim()
      const schemaName = table.schemaName.trim()
      const cacheKey = `${schemaName || 'dbo'}.${tableName}`
      const cachedColumnList = this.schemaCacheByTableKey.get(cacheKey)
      const availableColumns = cachedColumnList?.schema.length
        ? cachedColumnList.schema.map((column) => column.name.trim()).filter(Boolean)
        : table.columns.map((column) => column.name.trim()).filter(Boolean)

      if (availableColumns.length === 0) {
        continue
      }

      const normalizedTableRef = this.normalizeTableReference(`${schemaName}.${tableName}`)
      const tableRefPattern = new RegExp(`\\b(?:\\[${schemaName}\\]\\.|${schemaName}\\.)?\\[?${tableName}\\]?\\b`, 'gi')

      rewritten = rewritten.replace(tableRefPattern, (match) => match)
      rewritten = rewritten.replace(identifierPattern, (match) => {
        const rawName = match.replace(/\[|\]|`/g, '')
        const canonical = this.resolveColumnNameAlias(rawName, availableColumns)

        if (!canonical || canonical.trim().toLowerCase() === rawName.trim().toLowerCase()) {
          return match
        }

        const candidate = canonical.trim().toLowerCase()
        const normalizedMatch = rawName.trim().toLowerCase()

        if (normalizedMatch === candidate) {
          return canonical
        }

        if (availableColumns.some((column) => column.trim().toLowerCase() === normalizedMatch)) {
          return canonical
        }

        return match
      })

      const canonicalTableToken = availableColumns.some((column) => column.toLowerCase() === normalizedTableRef)
      if (canonicalTableToken) {
        rewritten = rewritten.replace(new RegExp(`\\b${tableName}\\b`, 'gi'), tableName)
      }
    }

    return rewritten
  }

  private async getCachedSchemaSnapshot(cacheKey: string, sqlQuery: string, abortSignal: AbortSignal): Promise<{ rows: SqlQueryRow[] }> {
    const cached = this.schemaCacheByTableKey.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < this.SCHEMA_CACHE_TTL_MS) {
      return {
        rows: cached.schema.map((col, idx) => ({
          table_schema: cacheKey.split('.').slice(0, -1).join('.') || 'dbo',
          table_name: cacheKey.split('.').pop() || '',
          ordinal_position: String(idx + 1),
          column_name: col.name,
          data_type: col.dataType,
          character_maximum_length: null,
          numeric_precision: null,
          numeric_scale: null,
          datetime_precision: null,
          is_nullable: col.isNullable ? 1 : 0,
          is_identity: col.isIdentity ? 1 : 0
        }))
      }
    }

    const rows = await this.executeMetadataSql(sqlQuery, abortSignal)
    const schemaColumns: SchemaColumnCatalogItem[] = rows.map((row) => {
      const colName = row['column_name']
      const dataType = row['data_type']
      const maxLen = row['character_maximum_length']
      const isNullable = row['is_nullable']
      const isIdentity = row['is_identity']
      return {
        name: typeof colName === 'string' ? colName : String(colName || ''),
        dataType: typeof dataType === 'string' ? dataType : 'unknown',
        isNullable: Boolean(isNullable),
        maxLength: typeof maxLen === 'number' && maxLen > 0 ? maxLen : null,
        isIdentity: Boolean(isIdentity),
        isPrimaryKey: false,
        hasForeignKey: false,
        sampleValues: []
      }
    })

    this.schemaCacheByTableKey.set(cacheKey, { schema: schemaColumns, timestamp: Date.now() })

    return { rows }
  }

  normalizeTableReference(tableRef: string): string {
    return this.normalizeTableRef(tableRef)
      .replace(/\[|\]|`|"/g, '')
      .replace(/\s+/g, '')
  }

  resolveColumnNameAlias(columnName: string, availableColumns: string[]): string {
    const normalizedTarget = columnName.trim().toLowerCase()
    const normalizedAvailable = availableColumns.map((entry) => entry.trim().toLowerCase())

    if (normalizedAvailable.includes(normalizedTarget)) {
      return availableColumns[normalizedAvailable.indexOf(normalizedTarget)]
    }

    const aliasMap: Record<string, string> = {
      name: 'Title',
      title: 'Title',
      date: 'DocDate',
      docdate: 'DocDate',
      doc_date: 'DocDate',
      documentdate: 'DocDate',
      document_date: 'DocDate'
    }

    const alias = aliasMap[normalizedTarget]
    if (alias && normalizedAvailable.includes(alias.toLowerCase())) {
      return alias
    }

    const fuzzy = availableColumns.find((entry) => entry.trim().toLowerCase() === normalizedTarget)
    if (fuzzy) {
      return fuzzy
    }

    return columnName
  }

  getLoopBudgetSummary(): { maxRounds: number; maxCallsPerRound: number; maxTotalCalls: number } {
    return {
      maxRounds: MAX_TOOL_CALL_ROUNDS,
      maxCallsPerRound: MAX_TOOL_CALLS_PER_ROUND,
      maxTotalCalls: MAX_TOTAL_TOOL_CALLS
    }
  }

  private buildExhaustionFallbackAnswer(
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
      `پرسش کاربر: ${this.compactText(prompt, 220)}`,
      '',
      '### Assumptions',
      'برای ادامه، لازم است پرسش را محدودتر یا با جدول/ستون دقیق‌تر بازفرموله کنید.',
      '',
      '### Actions',
      'پرسش را با نام جدول/ستون دقیق‌تر یا دامنه زمانی محدودتر ارسال کنید.'
    ].join('\n')
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
    const maxAttempts = 5

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.geminiClient.chat(
          payload,
          savedConfig,
          {
            onTextChunk: (chunkText) => {
              if (!chunkText) {
                return
              }

              this.emitProgress(onProgress, {
                type: 'response-chunk',
                message: chunkText
              })
            },
            signal: abortSignal
          }
        )
      } catch (error) {
        const errorInfo = this.toErrorInfo(error)
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

  private shouldReturnDegradedFallback(error: unknown): boolean {
    const errorInfo = this.toErrorInfo(error)
    const message = (errorInfo.message || '').toLowerCase()

    if (errorInfo.code === 'AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED' || errorInfo.code === 'AGENT_TOTAL_TOOL_CALLS_EXCEEDED') {
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

  private buildRuntimeFailureFallbackAnswer(
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
      `جزئیات خطا: ${this.compactText(detail, 240)}`,
      `پرسش کاربر: ${this.compactText(prompt, 220)}`,
      '',
      '### Assumptions',
      'برای ادامه، لازم است پرسش را محدودتر یا با جدول/ستون دقیق‌تر بازفرموله کنید.',
      '',
      '### Actions',
      'پرسش را دوباره با دامنه زمانی محدودتر یا شرح دقیق‌تر ارسال کنید.'
    ].join('\n')
  }

  /**
   * S5: Validates that the detected intent matches the tables used in fetch queries.
   * This is a deterministic guard to prevent intent-table mismatches (e.g., purchase intent using sales tables).
   * Returns null if validation passes, or an error message if there's a mismatch.
   */
  private validateIntentTableMatch(intentId: string | undefined, evidence: ToolEvidence[]): string | null {
    if (!intentId) return null

    // Define intent-to-table mapping for deterministic validation
    const intentTableMap: Record<string, string[]> = {
      get_purchase_summary: ['INV.InventoryReceipt', 'INV.InventoryReceiptItem', 'POM.PurchaseInvoice', 'Inv.Voucher'],
      get_sales_summary_by_period: ['SLS.Invoice', 'MRP.SaleFacts'],
      get_account_balance: ['ACC.Voucher', 'ACC.VoucherItem', 'FMK.FiscalYear', 'ACC.Account'],
      get_cash_bank_balance: ['RPA.CashBalance', 'RPA.BankAccountBalance'],
      get_trial_balance: ['ACC.Voucher', 'ACC.VoucherItem', 'FMK.FiscalYear', 'ACC.Account'],
      get_party_balance: ['ACC.Voucher', 'ACC.VoucherItem', 'FMK.FiscalYear'],
      get_receivables_summary: ['accounts', 'documents'],
      get_payables_summary: ['accounts', 'documents']
    }

    const allowedTables = intentTableMap[intentId]
    if (!allowedTables) return null // Intent not in mapping, skip validation

    // Check all fetch_financial_data queries
    for (const entry of evidence) {
      if (entry.tool === 'fetch_financial_data' && entry.query) {
        const query = entry.query
        // Check if any allowed table appears in the query
        const usesAllowedTable = allowedTables.some((table) => query.includes(table))
        if (!usesAllowedTable) {
          // Found a query that doesn't use any allowed table for this intent
          return `Intent mismatch: detected intent "${intentId}" but query uses tables not in the allowed set [${allowedTables.join(', ')}]. Query: ${query}`
        }
      }
    }

    return null
  }

  private buildRecoveryHint(
    failureKind: ToolFailureKind,
    lastErrorCode?: string,
    lastErrorMessage?: string,
    evidence: ToolEvidence[] = [],
    context?: { comparativeMultiPeriod?: boolean; successfulFetches?: number },
    prompt?: string
  ): string {
    void lastErrorMessage
    const discoveryOnly = evidence.length > 0 && evidence.every((entry) => entry.tool !== 'fetch_financial_data')

    // H3: comparative multi-period override — must run one fetch per period.
    if (context?.comparativeMultiPeriod && (context.successfulFetches ?? 0) < 2) {
      const remaining = Math.max(0, 2 - (context.successfulFetches ?? 0))
      return (
        'این یک سوال مقایسه‌ای چنددوره‌ای است: برای هر دوره/سال یک fetch_financial_data جداگانه با ' +
        'یک SELECT SUM/COUNT/AVG و فیلتر FiscalYearRef متفاوت اجرا کن (مثلاً WHERE FiscalYearRef = <Title1> ' +
        `و یک کوئری دوم WHERE FiscalYearRef = <Title2>). حداقل ${remaining} fetch موفق دیگر لازم است.`
      )
    }

    // S1: purchase data-source fallback — if POM.PurchaseInvoice is empty, try INV.InventoryReceipt
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

  private buildRuntimeScopeHintLines(activeCatalog: SchemaCatalogEntry): string[] {
    const candidates = this.collectRuntimeScopeColumnCandidates(activeCatalog)

    const companyHints = this.formatRuntimeScopeDimensionHints(
      candidates.filter((candidate) => candidate.dimension === 'company')
    )
    const fiscalHints = this.formatRuntimeScopeDimensionHints(
      candidates.filter((candidate) => candidate.dimension === 'fiscalYear')
    )
    const branchHints = this.formatRuntimeScopeDimensionHints(
      candidates.filter((candidate) => candidate.dimension === 'branch')
    )

    const lines: string[] = []

    if (companyHints) {
      lines.push(`  - Company columns: ${companyHints}`)
    }

    if (fiscalHints) {
      lines.push(`  - Fiscal-year columns: ${fiscalHints}`)
    }

    if (branchHints) {
      lines.push(`  - Branch columns: ${branchHints}`)
    }

    if (lines.length === 0) {
      lines.push(
        '  - Scope columns were not detected confidently; inspect mapped tables with get_database_schema before applying company/year/branch filters.'
      )
    }

    return lines
  }

  private collectRuntimeScopeColumnCandidates(activeCatalog: SchemaCatalogEntry): RuntimeScopeColumnCandidate[] {
    const candidates: RuntimeScopeColumnCandidate[] = []

    for (const table of activeCatalog.tables) {
      const tableRef = `${table.schemaName}.${table.tableName}`

      for (const column of table.columns) {
        const sampleValues = column.sampleValues
          .map((sample) => sample.trim())
          .filter((sample) => Boolean(sample))
        const score = this.scoreRuntimeScopeColumn(column.name, sampleValues)
        const samplePreview = sampleValues.slice(0, 2).join(', ') || null

        if (score.company > 0) {
          candidates.push({
            dimension: 'company',
            tableRef,
            columnName: column.name,
            score: score.company,
            samplePreview
          })
        }

        if (score.fiscalYear > 0) {
          candidates.push({
            dimension: 'fiscalYear',
            tableRef,
            columnName: column.name,
            score: score.fiscalYear,
            samplePreview
          })
        }

        if (score.branch > 0) {
          candidates.push({
            dimension: 'branch',
            tableRef,
            columnName: column.name,
            score: score.branch,
            samplePreview
          })
        }
      }
    }

    const dedupedByDimensionAndColumn = new Map<string, RuntimeScopeColumnCandidate>()

    for (const candidate of candidates) {
      const key = `${candidate.dimension}:${this.normalizeTableRef(candidate.tableRef)}.${candidate.columnName.toLowerCase()}`
      const existing = dedupedByDimensionAndColumn.get(key)

      if (!existing || candidate.score > existing.score) {
        dedupedByDimensionAndColumn.set(key, candidate)
      }
    }

    return [...dedupedByDimensionAndColumn.values()].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      const leftRef = `${left.tableRef}.${left.columnName}`.toLowerCase()
      const rightRef = `${right.tableRef}.${right.columnName}`.toLowerCase()
      return leftRef.localeCompare(rightRef)
    })
  }

  private scoreRuntimeScopeColumn(
    columnName: string,
    sampleValues: string[]
  ): {
    company: number
    fiscalYear: number
    branch: number
  } {
    const normalizedName = this.normalizeColumnNameForScopeDetection(columnName)
    const normalizedSamples = sampleValues.map((value) => this.normalizePersianDigits(value))
    const hasTextualSample = normalizedSamples.some((value) => /[a-z\u0600-\u06ff]{2,}/iu.test(value))
    const hasYearLikeSample = normalizedSamples.some(
      (value) => YEAR_SAMPLE_PATTERN.test(value) || SHAMSI_DATE_SAMPLE_PATTERN.test(value)
    )

    let company = 0
    let fiscalYear = 0
    let branch = 0

    if (COMPANY_SCOPE_COLUMN_NAME_PATTERN.test(normalizedName)) {
      company += 4
      if (/(?:name|title|code|نام|کد)/iu.test(normalizedName)) {
        company += 1
      }
    }

    if (FISCAL_SCOPE_COLUMN_NAME_PATTERN.test(normalizedName)) {
      fiscalYear += 4
    }

    if (BRANCH_SCOPE_COLUMN_NAME_PATTERN.test(normalizedName)) {
      branch += 4
      if (/(?:name|title|code|نام|کد)/iu.test(normalizedName)) {
        branch += 1
      }
    }

    if (hasTextualSample) {
      if (company > 0) {
        company += 1
      }

      if (branch > 0) {
        branch += 1
      }
    }

    if (hasYearLikeSample && fiscalYear > 0) {
      fiscalYear += 2
    }

    return {
      company,
      fiscalYear,
      branch
    }
  }

  private formatRuntimeScopeDimensionHints(candidates: RuntimeScopeColumnCandidate[]): string {
    if (candidates.length === 0) {
      return ''
    }

    return candidates
      .slice(0, 4)
      .map((candidate) => {
        const columnRef = `${candidate.tableRef}.${candidate.columnName}`
        const sampleText = candidate.samplePreview
          ? ` (samples=${this.compactText(candidate.samplePreview, 44)})`
          : ''
        return `${columnRef}${sampleText}`
      })
      .join(' | ')
  }

  private normalizeColumnNameForScopeDetection(value: string): string {
    return this.normalizePersianDigits(value)
      .replace(/[_\-.\[\]{}()]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  }

  private buildSchemaCatalogContext(settings: AppSettings): string | null {
    const activeCatalog = this.findActiveSchemaCatalog(settings)

    if (!activeCatalog) {
      return null
    }

    const contextLines = [
      'Runtime schema catalog context (active connection profile):',
      `- Profile ID: ${activeCatalog.profileId}`,
      `- Database: ${activeCatalog.databaseName}`,
      `- Catalog discovered at: ${activeCatalog.discoveredAt}`,
      '- Mapping policy: user-selected mappings are higher priority than suggestions.',
      '- When selected mapping exists, prefer that table and verify columns with get_database_schema before final SELECT.'
    ]

    const detectedSoftware = activeCatalog.detectedSoftware
    const selectedSoftwareId = activeCatalog.selectedSoftwareId ?? null
    const selectedSoftwareName = selectedSoftwareId
      ? this.toAccountingSoftwareDisplayName(selectedSoftwareId)
      : null
    const effectiveSoftwareId = selectedSoftwareId ?? detectedSoftware?.id ?? null
    const effectiveSoftwareName = selectedSoftwareName ?? detectedSoftware?.name ?? null
    const effectiveSoftwareSource = selectedSoftwareId
      ? 'manual override'
      : detectedSoftware
        ? 'auto-detected'
        : 'not-detected'
    const candidateText = (activeCatalog.softwareCandidates ?? [])
      .slice(0, 3)
      .map((candidate) => `${candidate.name}:${candidate.confidence.toFixed(2)}`)
      .join(' | ')
    const effectiveCandidate = effectiveSoftwareId
      ? (activeCatalog.softwareCandidates ?? []).find((candidate) => candidate.id === effectiveSoftwareId)
      : undefined

    if (effectiveSoftwareId && effectiveSoftwareName) {
      const confidenceText = effectiveCandidate
        ? `, confidence=${effectiveCandidate.confidence.toFixed(2)}`
        : ''

      contextLines.splice(
        4,
        0,
        `- Effective accounting software: ${effectiveSoftwareName} (id=${effectiveSoftwareId}, source=${effectiveSoftwareSource}${confidenceText}${candidateText ? `; candidates=${candidateText}` : ''}).`
      )
    } else {
      contextLines.splice(4, 0, '- Accounting software detection: no reliable software profile detected yet.')
    }

    if (effectiveSoftwareId === 'sepidar') {
      contextLines.splice(5, 0, ...this.buildSepidarSchemaHintLines())
    }

    const detectedDateMode = this.normalizeSchemaDateMode(activeCatalog.detectedDateMode) ?? 'unknown'
    const selectedDateMode = this.normalizeSchemaDateMode(activeCatalog.selectedDateMode)
    const effectiveDateMode = selectedDateMode ?? detectedDateMode
    const dateModeSource = selectedDateMode ? 'selected override' : 'detected mode'

    contextLines.splice(
      6,
      0,
      `- Date mode policy: effective=${effectiveDateMode}; source=${dateModeSource}; detected=${detectedDateMode}; selected=${selectedDateMode ?? '(auto)'}.`
    )

    if (activeCatalog.dateEvidence && activeCatalog.dateEvidence.length > 0) {
      contextLines.splice(7, 0, `- Date mode evidence: ${activeCatalog.dateEvidence.slice(0, 3).join(' | ')}`)
    }

    contextLines.push('- Runtime scope hints (multi-company / multi-fiscal / multi-branch):')
    contextLines.push(...this.buildRuntimeScopeHintLines(activeCatalog))
    contextLines.push('- Concept mapping hints:')

    let hasMappingLine = false

    for (const conceptKey of SCHEMA_CONTEXT_CONCEPT_ORDER) {
      const selectedTable = activeCatalog.selectedMappings[conceptKey]?.trim() ?? ''
      const suggestedPrimary = activeCatalog.suggestedMappings[conceptKey]?.[0]?.trim() ?? ''

      if (!selectedTable && !suggestedPrimary) {
        continue
      }

      const selectedText = selectedTable || '(none)'
      const suggestedText = suggestedPrimary || '(none)'

      contextLines.push(
        `  - ${SCHEMA_CONTEXT_CONCEPT_LABELS[conceptKey]}: selected=${selectedText}; suggested=${suggestedText}`
      )

      hasMappingLine = true
    }

    if (!hasMappingLine) {
      contextLines.push('  - No selected/suggested mappings available for this database yet.')
    }

    return contextLines.join('\n')
  }

  private buildSepidarSchemaHintLines(): string[] {
    return [
      '- Sepidar schema-prefix map (discovery tools filter TABLE_NAME only \u2014 search lowercase table-name tokens, never the schema name; the schema is returned in the TABLE_SCHEMA column):',
      "  - Sales (فروش / فاکتور فروش / فاکتورهای فروش): table-name tokens '%invoice%' (Invoice, InvoiceItem); schema = SLS. Then get_database_schema(table_name 'Invoice', schema_name 'SLS').",
      "  - Purchases (خرید / فاکتور خرید / هزینه خرید): table-name tokens '%purchase%' (PurchaseInvoice, PurchaseCost, PurchaseCostItem); schema = POM.",
      "  - Accounts / Chart of accounts (حساب / سرفصل / دفتر کل): table-name token '%account%' (Account); schema = ACC.",
      "  - Accounting vouchers / ledger lines (مانده حساب / گردش حساب / بدهکار / بستانکار / سند حسابداری): table-name tokens '%voucher%' / '%voucheritem%' (Voucher, VoucherItem); schema = ACC. For balance use SUM(Debit) - SUM(Credit) on ACC.VoucherItem grouped by AccountRef, JOIN ACC.Voucher header for fiscal-year scope. Always read the actual debit/credit column names with get_database_schema before writing the SELECT — do not guess between Debit/DebitAmount/DebitBaseCurrency.",
      "  - Cash and bank (نقد / بانک / موجودی): table-name tokens '%cash%' / '%bank%' (CashBalance, BankAccountBalance); schema = RPA.",
      "  - Inventory receipts / vouchers (انبار / رسید کالا): table-name token '%voucher%' (Voucher); schema = Inv. (Note: distinct from ACC vouchers.)",
      '  - Fiscal-year columns (e.g. FiscalYearRef) may be surrogate keys, not the literal Shamsi year; if a year filter returns 0 rows, inspect the fiscal-year lookup table to resolve the correct ref id before concluding no data exists.',
      '  - Prefer the schema-qualified domain table (e.g. SLS.Invoice) over generic dbo tables for sales/purchase summaries.'
    ]
  }

  private toAccountingSoftwareDisplayName(softwareId: string): string {
    switch (softwareId) {
      case 'sepidar':
        return 'Sepidar'
      case 'mahak':
        return 'Mahak'
      default:
        return softwareId
    }
  }

  private findActiveSchemaCatalog(settings: AppSettings): SchemaCatalogEntry | null {
    const activeProfileId = settings.activeConnectionProfileId?.trim()
    const activeDatabaseName = settings.sql.database?.trim().toLowerCase()

    if (!activeProfileId || !activeDatabaseName) {
      return null
    }

    const activeCatalog = settings.schemaCatalogs.find((entry) => {
      return (
        entry.profileId === activeProfileId &&
        entry.databaseName.trim().toLowerCase() === activeDatabaseName
      )
    })

    return activeCatalog ?? null
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

    const definition = listFinancialIntentDefinitions().find((entry) => entry.id === matchedIntent.intentId)

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
    const normalizedPrompt = normalizePersianText(prompt)
    const years = normalizedPrompt.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? []
    const uniqueYears = new Set(years)
    if (uniqueYears.size < 2) {
      return false
    }
    const hasComparativeKeyword =
      /(?:نسبت\s*به|در\s*مقابل|مقایسه|قیاس|رشد|کاهش|افزایش|افت|change|growth|decline|versus|\bvs\.?\b|year\s*over\s*year|yoy)/iu.test(
        normalizedPrompt
      )
    const hasFinancialContext =
      this.appearsToContainFinancialClaim(normalizedPrompt) || /(?:خرید|purchase|sales|درآمد|revenue)/iu.test(normalizedPrompt)
    return hasComparativeKeyword && hasFinancialContext
  }

  private isSalesGrowthPercentPrompt(prompt: string): boolean {
    const normalizedPrompt = normalizePersianText(prompt)

    const hasSalesSignal = /(?:فروش|sales|revenue)/iu.test(normalizedPrompt)
    const hasPercentSignal = /(?:درصد|percent|percentage|%)/iu.test(normalizedPrompt)
    const hasChangeSignal = /(?:رشد|کاهش|افزایش|افت|change|growth|decline|نسبت\s*به|مقایسه)/iu.test(normalizedPrompt)
    const yearMatches = normalizedPrompt.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? []

    // Also trigger for comparative multi-period prompts (e.g., "فروش 1403 در مقابل 1402")
    // even without explicit '%' keyword, as comparison implies percentage change
    const isComparativeMultiPeriod = this.isComparativeMultiPeriodPrompt(prompt)

    return (hasSalesSignal && hasPercentSignal && hasChangeSignal && yearMatches.length >= 2) ||
           (isComparativeMultiPeriod && hasSalesSignal && yearMatches.length >= 2)
  }

  private extractYearComparison(prompt: string): { targetYear: number; baseYear: number } | null {
    const normalizedPrompt = normalizePersianText(prompt)

    const explicitMatch = normalizedPrompt.match(/\b((?:13|14|19|20)\d{2})\b.{0,40}?نسبت\s*به.{0,40}?\b((?:13|14|19|20)\d{2})\b/iu)
    if (explicitMatch) {
      return {
        targetYear: Number(explicitMatch[1]),
        baseYear: Number(explicitMatch[2])
      }
    }

    const years = (normalizedPrompt.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? []).map((item) => Number(item))
    const uniqueYears = Array.from(new Set(years))

    if (uniqueYears.length < 2) {
      return null
    }

    // If prompt does not explicitly say "X نسبت به Y", use latest year as target and previous as base.
    uniqueYears.sort((a, b) => a - b)
    return {
      targetYear: uniqueYears[uniqueYears.length - 1],
      baseYear: uniqueYears[uniqueYears.length - 2]
    }
  }

  private async tryResolveSalesGrowthPercentFallback(
    prompt: string,
    conversationMemory: ConversationMemoryState,
    signal: AbortSignal
  ): Promise<SalesGrowthFallbackResult | null> {
    const yearComparison = this.extractYearComparison(prompt)

    if (!yearComparison) {
      return null
    }

    const baseYear = yearComparison.baseYear
    const targetYear = yearComparison.targetYear

    if (!Number.isFinite(baseYear) || !Number.isFinite(targetYear)) {
      return null
    }

    const activeCatalog = this.findActiveSchemaCatalog(this.getSettings())

    if (!activeCatalog) {
      return null
    }

    const salesSource = this.selectSalesGrowthSourceTable(activeCatalog)

    if (!salesSource) {
      return null
    }

    const sqlQuery = `WITH yearly_sales AS (\n  SELECT\n    CAST(${salesSource.yearColumn} AS int) AS FiscalYearTitle,\n    SUM(CAST(${salesSource.amountColumn} AS decimal(18, 4))) AS TotalSales\n  FROM ${salesSource.tableRef}\n  WHERE CAST(${salesSource.yearColumn} AS int) IN (${baseYear}, ${targetYear})\n  GROUP BY CAST(${salesSource.yearColumn} AS int)\n),\npivoted AS (\n  SELECT\n    MAX(CASE WHEN FiscalYearTitle = ${baseYear} THEN TotalSales END) AS SalesBase,\n    MAX(CASE WHEN FiscalYearTitle = ${targetYear} THEN TotalSales END) AS SalesTarget\n  FROM yearly_sales\n)\nSELECT\n  ISNULL(SalesBase, 0) AS SalesBase,\n  ISNULL(SalesTarget, 0) AS SalesTarget,\n  CASE\n    WHEN SalesBase IS NULL OR SalesBase = 0 THEN NULL\n    ELSE CAST(((SalesTarget - SalesBase) * 100.0 / SalesBase) AS decimal(18, 4))\n  END AS PercentChange\nFROM pivoted`

    this.ensureFinancialQueryAllowed(sqlQuery, this.getSettings(), conversationMemory)
    const rows = await this.executeReadOnlySql(sqlQuery, signal)
    this.throwIfRequestCanceled(signal)

    const firstRow = rows[0] ?? {}
    const salesBase = this.toSafeNumber(firstRow['SalesBase'])
    const salesTarget = this.toSafeNumber(firstRow['SalesTarget'])
    const percentRaw = this.toSafeNumber(firstRow['PercentChange'])
    const percentChange = Number.isFinite(percentRaw) ? percentRaw : null

    this.rememberToolTrace(
      conversationMemory,
      `sales_growth_fallback base=${baseYear} target=${targetYear} pct=${percentChange ?? 'null'}`
    )

    return {
      baseYear,
      targetYear,
      salesBase,
      salesTarget,
      percentChange,
      query: sqlQuery,
      toolCallsUsed: 1
    }
  }

  private selectSalesGrowthSourceTable(activeCatalog: SchemaCatalogEntry): {
    tableRef: string
    yearColumn: string
    amountColumn: string
  } | null {
    const preferredConcepts = ['documentLines', 'documents', 'accounts'] as AccountingConceptKey[]
    const preferredMappings = preferredConcepts
      .map((conceptKey) => this.resolvePreferredMapping(activeCatalog, conceptKey))
      .filter((mapping): mapping is PreferredMapping => Boolean(mapping))

    const catalogMappings = activeCatalog.tables
      .filter((table) => table.tags.length > 0)
      .map((table) => ({
        tableRef: this.normalizeTableRef(`${table.schemaName}.${table.tableName}`),
        source: 'suggested' as const
      }))
      .filter((mapping) => Boolean(mapping.tableRef)) as PreferredMapping[]

    const tableCandidates: PreferredMapping[] = [...preferredMappings, ...catalogMappings]

    const seen = new Set<string>()

    for (const candidate of tableCandidates) {
      const normalizedRef = this.normalizeTableRef(candidate.tableRef)

      if (!normalizedRef || seen.has(normalizedRef)) {
        continue
      }

      seen.add(normalizedRef)

      const table = activeCatalog.tables.find((entry) => {
        return this.normalizeTableRef(`${entry.schemaName}.${entry.tableName}`) === normalizedRef
      })

      if (!table) {
        continue
      }

      const yearColumn = table.columns.find((column) => /(?:fiscal|year|period|سال|مالی|دوره)/iu.test(column.name))?.name
      const amountColumn = table.columns.find((column) => /(?:amount|price|netprice|gross|revenue|total|sale|sum)/iu.test(column.name))?.name

      if (yearColumn && amountColumn) {
        return {
          tableRef: normalizedRef,
          yearColumn,
          amountColumn
        }
      }
    }

    return null
  }

  private composeSalesGrowthFallbackMarkdown(result: SalesGrowthFallbackResult): string {
    const direction =
      result.percentChange == null
        ? 'نامشخص'
        : result.percentChange > 0
          ? 'رشد'
          : result.percentChange < 0
            ? 'کاهش'
            : 'بدون تغییر'

    const signedPercent =
      result.percentChange == null
        ? 'N/A'
        : `${result.percentChange >= 0 ? '+' : ''}${result.percentChange.toFixed(2)}%`

    const assumptionsLine =
      result.percentChange == null
        ? '- فروش سال مبنا صفر یا ناموجود بوده است؛ درصد تغییر قابل محاسبه نیست.'
        : '- درصد تغییر طبق فرمول ((فروش سال هدف - فروش سال مبنا) / فروش سال مبنا) * 100 محاسبه شد.'

    return [
      '### Summary',
      `فروش سال ${result.targetYear} نسبت به ${result.baseYear}: ${signedPercent} (${direction}) (نوع KPI: فروش سالانه)`,
      '',
      '### Findings',
      '- مسیر پاسخ: deterministic',
      `- فروش سال ${result.baseYear}: ${result.salesBase.toLocaleString('en-US')}`,
      `- فروش سال ${result.targetYear}: ${result.salesTarget.toLocaleString('en-US')}`,
      `- درصد تغییر: ${signedPercent}`,
      '',
      '### Evidence',
      '- منبع داده: ابزار fetch_financial_data با تجمیع جدول مالی انتخاب‌شده از catalog و ستون‌های سال/مبلغ',
      `- سال های مقایسه: ${result.baseYear} و ${result.targetYear}`,
      `- SQL: ${this.compactText(result.query.replace(/\s+/g, ' '), 220)}`,
      '',
      '### Assumptions',
      assumptionsLine,
      '',
      '### Actions',
      '- در صورت نیاز، همین مقایسه را به تفکیک ماه/شعبه/شرکت هم می‌توانم ارائه کنم.',
      '- اگر تعریف فروش (مثلا NetPrice vs GrossPrice) باید تغییر کند، اعلام کنید تا کوئری اصلاح شود.'
    ].join('\n')
  }

  private async tryResolveFiscalYearFallback(
    deterministicIntent: DeterministicFinancialIntent,
    settings: AppSettings,
    conversationMemory: ConversationMemoryState,
    signal: AbortSignal,
    onProgress?: (event: AgentProgressEvent) => void
  ): Promise<FiscalYearFallbackResult | null> {
    const activeCatalog = this.findActiveSchemaCatalog(settings)
    let toolCallsUsed = 0
    let metadataRows: SqlQueryRow[] = []

    let fiscalCandidates: RuntimeScopeColumnCandidate[] = []

    if (activeCatalog) {
      fiscalCandidates = this.collectRuntimeScopeColumnCandidates(activeCatalog)
        .filter((candidate) => candidate.dimension === 'fiscalYear')
        .slice(0, 8)
    }

    if (fiscalCandidates.length === 0) {
      metadataRows = await this.executeMetadataSql(
        `SELECT TOP (48)
  c.TABLE_SCHEMA AS table_schema,
  c.TABLE_NAME AS table_name,
  c.COLUMN_NAME AS column_name
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
  AND (
    c.COLUMN_NAME LIKE N'%fiscal%'
    OR c.COLUMN_NAME LIKE N'%year%'
    OR c.COLUMN_NAME LIKE N'%period%'
    OR c.COLUMN_NAME LIKE N'%سال%'
    OR c.COLUMN_NAME LIKE N'%مالی%'
    OR c.COLUMN_NAME LIKE N'%دوره%'
    OR c.TABLE_NAME LIKE N'%FiscalYear%'
    OR c.TABLE_NAME LIKE N'%Fiscal_Year%'
    OR c.TABLE_NAME LIKE N'%سال%مالی%'
    OR c.TABLE_NAME LIKE N'%دوره%مالی%'
  )
ORDER BY
  CASE WHEN c.TABLE_SCHEMA IN ('ACC', 'RPA') THEN 0 ELSE 1 END,
  c.TABLE_SCHEMA,
  c.TABLE_NAME,
  c.ORDINAL_POSITION`,
        signal
      )

      toolCallsUsed += 1

      const metadataCandidates: RuntimeScopeColumnCandidate[] = []

      for (const row of metadataRows) {
        const schemaName = String(row['table_schema'] ?? '').trim()
        const tableName = String(row['table_name'] ?? '').trim()
        const columnName = String(row['column_name'] ?? '').trim()

        if (!schemaName || !tableName || !columnName) {
          continue
        }

        metadataCandidates.push({
          dimension: 'fiscalYear',
          tableRef: `${schemaName}.${tableName}`,
          columnName,
          score: schemaName === 'ACC' || schemaName === 'RPA' ? 8 : 5,
          samplePreview: null
        })
      }

      fiscalCandidates = metadataCandidates.slice(0, 10)
    }

    if (fiscalCandidates.length === 0) {
      return null
    }

    type FiscalStats = {
      candidate: RuntimeScopeColumnCandidate
      count: number
      minYear: number | null
      maxYear: number | null
    }

    const successfulStats: FiscalStats[] = []

    for (const candidate of fiscalCandidates) {
      this.throwIfRequestCanceled(signal)
      const tableRef = this.parseSqlTableReference(candidate.tableRef)

      if (!tableRef?.schemaName || !tableRef.tableName) {
        continue
      }

      const schemaIdentifier = this.quoteSqlIdentifier(tableRef.schemaName)
      const tableIdentifier = this.quoteSqlIdentifier(tableRef.tableName)
      const columnIdentifier = this.quoteSqlIdentifier(candidate.columnName)
      const fromClause = `${schemaIdentifier}.${tableIdentifier}`

      const statsQuery = `WITH fiscal_values AS (
  SELECT TRY_CONVERT(NVARCHAR(32), ${columnIdentifier}) AS fiscal_text
  FROM ${fromClause}
)
SELECT
  COUNT(DISTINCT TRY_CONVERT(INT, fiscal_text)) AS fiscal_year_count,
  MIN(TRY_CONVERT(INT, fiscal_text)) AS min_fiscal_year,
  MAX(TRY_CONVERT(INT, fiscal_text)) AS max_fiscal_year
FROM fiscal_values
WHERE fiscal_text LIKE '[12][0-9][0-9][0-9]'
  AND TRY_CONVERT(INT, fiscal_text) BETWEEN 1300 AND 2099`

      try {
        const rows = await this.executeReadOnlySql(statsQuery, signal)
        toolCallsUsed += 1

        const row = rows[0] as SqlQueryRow | undefined
        const count = this.toFiniteInteger(row?.['fiscal_year_count'])

        if (count <= 0) {
          continue
        }

        successfulStats.push({
          candidate,
          count,
          minYear: this.toOptionalFiniteInteger(row?.['min_fiscal_year']),
          maxYear: this.toOptionalFiniteInteger(row?.['max_fiscal_year'])
        })
      } catch {
        // Keep trying other fiscal-year candidates.
      }
    }

    if (successfulStats.length === 0) {
      const fiscalTableRows = await this.executeMetadataSql(
        `SELECT TOP (240)
  t.TABLE_SCHEMA AS table_schema,
  t.TABLE_NAME AS table_name
FROM INFORMATION_SCHEMA.TABLES t
WHERE t.TABLE_TYPE = 'BASE TABLE'
  AND t.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
  AND (
    t.TABLE_NAME LIKE N'%FiscalYear%'
    OR t.TABLE_NAME LIKE N'%Fiscal_Year%'
    OR t.TABLE_NAME LIKE N'%Year%'
    OR t.TABLE_NAME LIKE N'%Period%'
    OR t.TABLE_NAME LIKE N'%سال%'
    OR t.TABLE_NAME LIKE N'%مالی%'
    OR t.TABLE_NAME LIKE N'%دوره%'
  )
ORDER BY
  CASE WHEN t.TABLE_SCHEMA IN ('FMK', 'ACC', 'RPA') THEN 0 ELSE 1 END,
  t.TABLE_SCHEMA,
  t.TABLE_NAME`,
        signal
      )

      toolCallsUsed += 1

      if (metadataRows.length === 0) {
        metadataRows = await this.executeMetadataSql(
          `SELECT TOP (240)
  c.TABLE_SCHEMA AS table_schema,
  c.TABLE_NAME AS table_name,
  c.COLUMN_NAME AS column_name
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
          signal
        )

        toolCallsUsed += 1
      }

      for (const tableRow of fiscalTableRows) {
        const schemaName = String(tableRow['table_schema'] ?? '').trim()
        const tableName = String(tableRow['table_name'] ?? '').trim()

        if (!schemaName || !tableName) {
          continue
        }

        metadataRows.push({
          table_schema: schemaName,
          table_name: tableName,
          column_name: ''
        })
      }

      const tableCandidates = new Map<string, { schemaName: string; tableName: string; score: number }>()

      for (const row of metadataRows) {
        const schemaName = String(row['table_schema'] ?? '').trim()
        const tableName = String(row['table_name'] ?? '').trim()

        if (!schemaName || !tableName) {
          continue
        }

        const normalizedTable = tableName.toLowerCase()
        const normalizedSchema = schemaName.toLowerCase()
        let score = 0

        if (/fiscal\s*_?\s*year|سال\s*مالی|دوره\s*مالی/iu.test(tableName)) {
          score += 10
        }

        if (/year|period|سال|دوره/iu.test(tableName)) {
          score += 4
        }

        if (['fmk', 'acc', 'rpa'].includes(normalizedSchema)) {
          score += 3
        }

        if (score <= 0) {
          continue
        }

        const key = `${normalizedSchema}.${normalizedTable}`
        const existing = tableCandidates.get(key)

        if (!existing || score > existing.score) {
          tableCandidates.set(key, {
            schemaName,
            tableName,
            score
          })
        }
      }

      const rankedTables = [...tableCandidates.values()].sort((left, right) => right.score - left.score)

      for (const candidate of rankedTables.slice(0, 6)) {
        this.throwIfRequestCanceled(signal)

        const fromClause = `${this.quoteSqlIdentifier(candidate.schemaName)}.${this.quoteSqlIdentifier(candidate.tableName)}`
        const countQuery = `SELECT COUNT(1) AS fiscal_year_count FROM ${fromClause}`

        try {
          const rows = await this.executeReadOnlySql(countQuery, signal)
          toolCallsUsed += 1

          const count = this.toFiniteInteger((rows[0] as SqlQueryRow | undefined)?.['fiscal_year_count'])

          if (count <= 0 || count > 300) {
            continue
          }

          const tableRef = `${candidate.schemaName}.${candidate.tableName}`

          this.rememberToolTrace(
            conversationMemory,
            `fallback:${deterministicIntent} table=${tableRef} row_count=${count}`
          )

          this.emitProgress(onProgress, {
            type: 'tool-success',
            message: `✅ ابزار ${deterministicIntent} اجرا شد: ${count} سال مالی (row-count fallback) در ${tableRef}`,
            toolName: deterministicIntent,
            rowCount: count
          })

          return {
            count,
            years: [],
            tableRef,
            columnName: '(row-count)',
            minYear: null,
            maxYear: null,
            toolCallsUsed
          }
        } catch {
          // Continue with the next candidate table.
        }
      }

      return null
    }

    successfulStats.sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count
      }

      if (right.candidate.score !== left.candidate.score) {
        return right.candidate.score - left.candidate.score
      }

      return left.candidate.tableRef.localeCompare(right.candidate.tableRef)
    })

    const best = successfulStats[0]
    const bestRef = this.parseSqlTableReference(best.candidate.tableRef)

    if (!bestRef?.schemaName || !bestRef.tableName) {
      return null
    }

    const previewQuery = `WITH fiscal_values AS (
  SELECT DISTINCT TRY_CONVERT(INT, TRY_CONVERT(NVARCHAR(32), ${this.quoteSqlIdentifier(best.candidate.columnName)})) AS fiscal_year
  FROM ${this.quoteSqlIdentifier(bestRef.schemaName)}.${this.quoteSqlIdentifier(bestRef.tableName)}
  WHERE TRY_CONVERT(NVARCHAR(32), ${this.quoteSqlIdentifier(best.candidate.columnName)}) LIKE '[12][0-9][0-9][0-9]'
)
SELECT TOP (48) fiscal_year
FROM fiscal_values
WHERE fiscal_year BETWEEN 1300 AND 2099
ORDER BY fiscal_year DESC`

    let previewYears: number[] = []

    try {
      const previewRows = await this.executeReadOnlySql(previewQuery, signal)
      toolCallsUsed += 1
      previewYears = previewRows
        .map((row) => this.toOptionalFiniteInteger(row['fiscal_year']))
        .filter((value): value is number => value !== null)
    } catch {
      previewYears = []
    }

    this.rememberToolTrace(
      conversationMemory,
      `fallback:${deterministicIntent} table=${best.candidate.tableRef} column=${best.candidate.columnName} count=${best.count}`
    )

    this.emitProgress(onProgress, {
      type: 'tool-success',
      message: `✅ ابزار ${deterministicIntent} اجرا شد: ${best.count} سال مالی در ${best.candidate.tableRef}.${best.candidate.columnName}`,
      toolName: deterministicIntent,
      rowCount: best.count
    })

    return {
      count: best.count,
      years: previewYears,
      tableRef: best.candidate.tableRef,
      columnName: best.candidate.columnName,
      minYear: best.minYear,
      maxYear: best.maxYear,
      toolCallsUsed
    }
  }

  private async tryResolveDeterministicFinancialTool(
    deterministicIntent: DeterministicFinancialIntent,
    settings: AppSettings,
    conversationMemory: ConversationMemoryState,
    signal: AbortSignal,
    onProgress?: (event: AgentProgressEvent) => void,
    prompt?: string
  ): Promise<DeterministicFinancialToolResult | null> {
    const activeCatalog = this.findActiveSchemaCatalog(settings)

    // Hardcoded fallback mappings when no schema catalog is available
    const hardcodedMappings: Partial<Record<DeterministicFinancialIntent, { tableRef: string; columnName: string }>> = {
      get_purchase_summary: { tableRef: 'INV.InventoryReceipt', columnName: 'TotalPrice' },
      get_account_balance: { tableRef: 'ACC.VoucherItem', columnName: 'Debit,Credit' },
      get_party_balance: { tableRef: 'ACC.VoucherItem', columnName: 'Debit,Credit' },
      get_cashflow_summary: { tableRef: 'RPA.CashBalance', columnName: 'Balance' },
      get_receivables_summary: { tableRef: 'ACC.VoucherItem', columnName: 'Debit' },
      get_payables_summary: { tableRef: 'ACC.VoucherItem', columnName: 'Credit' },
      get_cash_bank_balance: { tableRef: 'RPA.CashBalance', columnName: 'Balance' },
      get_trial_balance: { tableRef: 'ACC.VoucherItem', columnName: 'Debit' }
    }

    let mapping: { tableRef: string; source: string } | null = null

    if (activeCatalog) {
      const conceptKey =
        deterministicIntent === 'get_account_balance'
          ? 'accounts'
          : deterministicIntent === 'get_party_balance'
            ? 'counterparties'
            : deterministicIntent === 'get_cashflow_summary'
              ? 'cashTransactions'
              : deterministicIntent === 'get_purchase_summary'
                ? 'documents'
                : deterministicIntent === 'get_receivables_summary' || deterministicIntent === 'get_payables_summary'
                  ? 'documents'
                  : 'documents'
      mapping = this.resolvePreferredMapping(activeCatalog, conceptKey)
    } else {
      // Use hardcoded fallback when no catalog
      const hardcoded = hardcodedMappings[deterministicIntent]
      if (hardcoded) {
        mapping = { tableRef: hardcoded.tableRef, source: 'hardcoded' }
      }
    }

    if (!mapping) {
      return null
    }

    const tableRef = this.parseSqlTableReference(mapping.tableRef)

    if (!tableRef?.schemaName || !tableRef.tableName) {
      return null
    }

    const schemaName = tableRef.schemaName.trim().toLowerCase()
    const tableName = tableRef.tableName.trim().toLowerCase()

    let column: { name: string; dataType: string } | null = null

    if (activeCatalog) {
      const catalogTable = activeCatalog.tables.find((entry) => {
        return (
          entry.schemaName.trim().toLowerCase() === schemaName &&
          entry.tableName.trim().toLowerCase() === tableName
        )
      })

      const candidateColumns = (catalogTable?.columns ?? []).filter((col) => {
        const columnName = col.name.toLowerCase()
        const dataType = col.dataType.toLowerCase()
        return /(?:amount|balance|debit|credit|total|sum|net|value)/iu.test(columnName) && /(?:int|decimal|numeric|money|float|real)/iu.test(dataType)
      })

      column = this.selectDeterministicToolColumn(deterministicIntent, candidateColumns) ?? catalogTable?.columns[0] ?? null
    } else {
      // Use hardcoded column name when no catalog
      const hardcoded = hardcodedMappings[deterministicIntent]
      if (hardcoded) {
        const columnNames = hardcoded.columnName.split(',')
        column = { name: columnNames[0].trim(), dataType: 'decimal' }
      }
    }

    if (!column) {
      return null
    }

    const schemaIdentifier = this.quoteSqlIdentifier(schemaName)
    const tableIdentifier = this.quoteSqlIdentifier(tableName)
    const columnIdentifier = this.quoteSqlIdentifier(column.name)
    
    // Purchase intent fallback: try POM.PurchaseInvoice first, then INV.InventoryReceipt
    let query: string
    let actualTableRef = mapping.tableRef
    let actualColumnName = column.name
    let toolCallsUsed = 1

    if (deterministicIntent === 'get_purchase_summary') {
      // First check COUNT on POM.PurchaseInvoice
      const pomSchema = this.quoteSqlIdentifier('POM')
      const pomTable = this.quoteSqlIdentifier('PurchaseInvoice')
      const countQuery = `SELECT COUNT(*) AS row_count FROM ${pomSchema}.${pomTable}`
      
      try {
        const countRows = await this.executeReadOnlySql(countQuery, signal)
        const rowCount = Number(countRows[0]?.['row_count']) || 0
        
        // If POM.PurchaseInvoice has rows, try SUM
        if (rowCount > 0) {
          const primaryQuery = `SELECT SUM(CAST(${columnIdentifier} AS decimal(18,2))) AS result_value FROM ${schemaIdentifier}.${tableIdentifier}`
          const primaryRows = await this.executeReadOnlySql(primaryQuery, signal)
          const primaryValue = this.toOptionalFiniteInteger(primaryRows[0]?.['result_value'])
          
          if (primaryValue !== null && primaryValue > 0) {
            query = primaryQuery
            const value = primaryValue
            toolCallsUsed = 2
            
            this.rememberToolTrace(
              conversationMemory,
              `tool:${deterministicIntent} table=${actualTableRef} column=${actualColumnName} value=${value} source=pom_purchase_invoice`
            )
            
            this.emitProgress(onProgress, {
              type: 'tool-success',
              message: `✅ ابزار ${deterministicIntent} اجرا شد: ${value} در ${actualTableRef}.${actualColumnName}`,
              toolName: deterministicIntent,
              rowCount: 1
            })
            
            return {
              intentId: deterministicIntent,
              value,
              tableRef: actualTableRef,
              columnName: actualColumnName,
              query,
              toolCallsUsed
            }
          }
        }
        
        // Fallback to INV.InventoryReceipt (POM empty or SUM null)
        const invSchema = this.quoteSqlIdentifier('INV')
        const invTable = this.quoteSqlIdentifier('InventoryReceipt')
        const invColumn = this.quoteSqlIdentifier('TotalPrice')
        const fallbackQuery = `SELECT SUM(CAST(${invColumn} AS decimal(18,2))) AS result_value FROM ${invSchema}.${invTable} WHERE IsReturn = 0`
        
        const fallbackRows = await this.executeReadOnlySql(fallbackQuery, signal)
        const fallbackValue = this.toOptionalFiniteInteger(fallbackRows[0]?.['result_value'])
        
        if (fallbackValue !== null && fallbackValue > 0) {
          query = fallbackQuery
          actualTableRef = 'INV.InventoryReceipt'
          actualColumnName = 'TotalPrice'
          toolCallsUsed = rowCount > 0 ? 3 : 2
          
          this.rememberToolTrace(
            conversationMemory,
            `tool:${deterministicIntent} table=${actualTableRef} column=${actualColumnName} value=${fallbackValue} source=inventory_receipt_fallback`
          )
          
          this.emitProgress(onProgress, {
            type: 'tool-success',
            message: `✅ ابزار ${deterministicIntent} اجرا شد: ${fallbackValue} در ${actualTableRef}.${actualColumnName} (fallback)`,
            toolName: deterministicIntent,
            rowCount: 1
          })
          
          return {
            intentId: deterministicIntent,
            value: fallbackValue,
            tableRef: actualTableRef,
            columnName: actualColumnName,
            query,
            toolCallsUsed
          }
        }
        
        // Both sources empty
        return null
      } catch (error) {
        await this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId: conversationMemory.conversationId,
          stage: 'tool-error',
          toolName: deterministicIntent,
          error: error instanceof Error ? error.message : String(error),
          errorCategory: 'deterministic-tool-failure'
        })
        return null
      }
    }
    
    // Account balance specific logic: SUM(Debit) - SUM(Credit) with fiscal year filtering
    if (deterministicIntent === 'get_account_balance') {
      // Use Debit and Credit columns from ACC.VoucherItem
      const debitColumn = this.quoteSqlIdentifier('Debit')
      const creditColumn = this.quoteSqlIdentifier('Credit')
      const voucherTable = this.quoteSqlTableRef('ACC.Voucher')
      const voucherItemTable = this.quoteSqlTableRef('ACC.VoucherItem')
      const fiscalYearTable = this.quoteSqlTableRef('FMK.FiscalYear')
      const accountTable = this.quoteSqlTableRef('ACC.Account')

      // Extract account name from prompt if present
      const accountNameMatch = prompt?.match(/(?:حساب|سرفصل)\s*([^\s]+)/iu)
      const accountName = accountNameMatch ? accountNameMatch[1] : null

      // Extract fiscal year from prompt (normalize Persian digits first)
      const normalizedPrompt = this.normalizePersianDigits(prompt || '')
      const fiscalYearMatch = normalizedPrompt.match(/(?:سال|سال\s+)?(\d{4})/iu)
      const fiscalYear = fiscalYearMatch ? fiscalYearMatch[1] : null

      // Build query with fiscal year join and optional account filter
      let whereClause = ''
      if (fiscalYear) {
        whereClause = ` AND fy.Title = N'${fiscalYear}'`
      }
      if (accountName) {
        whereClause += ` AND a.Title LIKE N'%${accountName}%'`
        query = `SELECT SUM(CAST(vi.${debitColumn} AS decimal(18,2))) - SUM(CAST(vi.${creditColumn} AS decimal(18,2))) AS result_value
                 FROM ${voucherItemTable} vi
                 JOIN ${voucherTable} v ON vi.VoucherRef = v.VoucherId
                 JOIN ${accountTable} a ON vi.AccountSLRef = a.AccountId
                 JOIN ${fiscalYearTable} fy ON v.FiscalYearRef = fy.FiscalYearId
                 WHERE 1=1${whereClause}`
      } else {
        query = `SELECT SUM(CAST(vi.${debitColumn} AS decimal(18,2))) - SUM(CAST(vi.${creditColumn} AS decimal(18,2))) AS result_value
                 FROM ${voucherItemTable} vi
                 JOIN ${voucherTable} v ON vi.VoucherRef = v.VoucherId
                 JOIN ${fiscalYearTable} fy ON v.FiscalYearRef = fy.FiscalYearId
                 WHERE 1=1${whereClause}`
      }

      try {
        const rows = await this.executeReadOnlySql(query, signal)
        const row = rows[0] as SqlQueryRow | undefined
        const value = this.toOptionalFiniteInteger(row?.['result_value'])

        if (value === null) {
          return null
        }

        this.rememberToolTrace(
          conversationMemory,
          `tool:${deterministicIntent} table=ACC.VoucherItem column=Debit,Credit value=${value}${accountName ? ` account=${accountName}` : ''}`
        )

        this.emitProgress(onProgress, {
          type: 'tool-success',
          message: `✅ ابزار ${deterministicIntent} اجرا شد: ${value} در ACC.VoucherItem (Debit-Credit)${accountName ? ` برای حساب ${accountName}` : ''}`,
          toolName: deterministicIntent,
          rowCount: 1
        })

        return {
          intentId: deterministicIntent,
          value,
          tableRef: 'ACC.VoucherItem',
          columnName: 'Debit,Credit',
          query,
          toolCallsUsed
        }
      } catch (error) {
        await this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId: conversationMemory.conversationId,
          stage: 'tool-error',
          toolName: deterministicIntent,
          error: error instanceof Error ? error.message : String(error),
          errorCategory: 'deterministic-tool-failure'
        })
        return null
      }
    }
    
    // Trial balance specific logic: SUM(Debit), SUM(Credit) by account
    if (deterministicIntent === 'get_trial_balance') {
      const debitColumn = this.quoteSqlIdentifier('Debit')
      const creditColumn = this.quoteSqlIdentifier('Credit')
      const accountTable = this.quoteSqlTableRef('ACC.Account')
      const voucherTable = this.quoteSqlTableRef('ACC.Voucher')
      const voucherItemTable = this.quoteSqlTableRef('ACC.VoucherItem')
      const fiscalYearTable = this.quoteSqlTableRef('FMK.FiscalYear')

      // Extract fiscal year from prompt
      const fiscalYearMatch = prompt?.match(/(?:سال|سال\s+)?(\d{4})/iu)
      const fiscalYear = fiscalYearMatch ? fiscalYearMatch[1] : null

      let whereClause = ''
      if (fiscalYear) {
        whereClause = ` AND fy.Title = N'${fiscalYear}'`
      }

      query = `SELECT TOP (200) a.Title AS AccountTitle,
               SUM(CAST(vi.${debitColumn} AS decimal(18,2))) AS TotalDebit,
               SUM(CAST(vi.${creditColumn} AS decimal(18,2))) AS TotalCredit
               FROM ${voucherItemTable} vi
               JOIN ${voucherTable} v ON vi.VoucherRef = v.VoucherId
               JOIN ${accountTable} a ON vi.AccountSLRef = a.AccountId
               JOIN ${fiscalYearTable} fy ON v.FiscalYearRef = fy.FiscalYearId
               WHERE 1=1${whereClause}
               GROUP BY a.Title`
      
      try {
        const rows = await this.executeReadOnlySql(query, signal)
        
        if (rows.length === 0) {
          return null
        }
        
        const totalDebit = rows.reduce((sum, row) => sum + (Number(row['TotalDebit']) || 0), 0)
        const totalCredit = rows.reduce((sum, row) => sum + (Number(row['TotalCredit']) || 0), 0)
        const value = totalDebit // Return total debit as representative value

        this.rememberToolTrace(
          conversationMemory,
          `tool:${deterministicIntent} table=ACC.VoucherItem column=Debit,Credit rows=${rows.length} totalDebit=${totalDebit} totalCredit=${totalCredit}`
        )

        this.emitProgress(onProgress, {
          type: 'tool-success',
          message: `✅ ابزار ${deterministicIntent} اجرا شد: ${rows.length} حساب، بدهکار=${totalDebit}، بستانکار=${totalCredit}`,
          toolName: deterministicIntent,
          rowCount: rows.length
        })

        return {
          intentId: deterministicIntent,
          value,
          tableRef: 'ACC.VoucherItem',
          columnName: 'Debit,Credit',
          query,
          toolCallsUsed
        }
      } catch (error) {
        await this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId: conversationMemory.conversationId,
          stage: 'tool-error',
          toolName: deterministicIntent,
          error: error instanceof Error ? error.message : String(error),
          errorCategory: 'deterministic-tool-failure'
        })
        return null
      }
    }
    
    // Cash and bank balance specific logic
    if (deterministicIntent === 'get_cash_bank_balance') {
      const cashTable = this.quoteSqlTableRef('RPA.CashBalance')
      const bankTable = this.quoteSqlTableRef('RPA.BankAccountBalance')
      const balanceColumn = this.quoteSqlIdentifier('Balance')
      
      const cashQuery = `SELECT SUM(CAST(${balanceColumn} AS decimal(18,2))) AS result_value FROM ${cashTable}`
      const bankQuery = `SELECT SUM(CAST(${balanceColumn} AS decimal(18,2))) AS result_value FROM ${bankTable}`
      
      try {
        const cashRows = await this.executeReadOnlySql(cashQuery, signal)
        const bankRows = await this.executeReadOnlySql(bankQuery, signal)
        
        const cashValue = this.toOptionalFiniteInteger(cashRows[0]?.['result_value']) || 0
        const bankValue = this.toOptionalFiniteInteger(bankRows[0]?.['result_value']) || 0
        const totalValue = cashValue + bankValue
        
        if (totalValue === 0) {
          return null
        }
        
        query = `${cashQuery}; ${bankQuery}`
        toolCallsUsed = 2

        this.rememberToolTrace(
          conversationMemory,
          `tool:${deterministicIntent} cash=${cashValue} bank=${bankValue} total=${totalValue}`
        )

        this.emitProgress(onProgress, {
          type: 'tool-success',
          message: `✅ ابزار ${deterministicIntent} اجرا شد: نقد=${cashValue}، بانک=${bankValue}، مجموع=${totalValue}`,
          toolName: deterministicIntent,
          rowCount: 2
        })

        return {
          intentId: deterministicIntent,
          value: totalValue,
          tableRef: 'RPA.CashBalance,RPA.BankAccountBalance',
          columnName: 'Balance',
          query,
          toolCallsUsed
        }
      } catch (error) {
        await this.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId: conversationMemory.conversationId,
          stage: 'tool-error',
          toolName: deterministicIntent,
          error: error instanceof Error ? error.message : String(error),
          errorCategory: 'deterministic-tool-failure'
        })
        return null
      }
    }
    
    // Default query for other intents
    query = `SELECT SUM(CAST(${columnIdentifier} AS decimal(18,2))) AS result_value FROM ${schemaIdentifier}.${tableIdentifier}`

    try {
      const rows = await this.executeReadOnlySql(query, signal)
      const row = rows[0] as SqlQueryRow | undefined
      const value = this.toOptionalFiniteInteger(row?.['result_value'])

      if (value === null) {
        return null
      }

      this.rememberToolTrace(
        conversationMemory,
        `tool:${deterministicIntent} table=${mapping.tableRef} column=${column.name} value=${value}`
      )

      this.emitProgress(onProgress, {
        type: 'tool-success',
        message: `✅ ابزار ${deterministicIntent} اجرا شد: ${value} در ${mapping.tableRef}.${column.name}`,
        toolName: deterministicIntent,
        rowCount: 1
      })

      return {
        intentId: deterministicIntent,
        value,
        tableRef: mapping.tableRef,
        columnName: column.name,
        query,
        toolCallsUsed
      }
    } catch (error) {
      await this.safeAuditWrite({
        timestamp: new Date().toISOString(),
        requestId: conversationMemory.conversationId,
        stage: 'tool-error',
        toolName: deterministicIntent,
        error: error instanceof Error ? error.message : String(error),
        errorCategory: 'deterministic-tool-failure'
      })
      return null
    }
  }

  private selectDeterministicToolColumn(
    deterministicIntent: DeterministicFinancialIntent,
    candidateColumns: SchemaColumnCatalogItem[]
  ): SchemaColumnCatalogItem | null {
    if (candidateColumns.length === 0) {
      return null
    }

    const intentSpecificOrder = this.buildDeterministicToolColumnPreference(deterministicIntent)

    if (intentSpecificOrder.length === 0) {
      return candidateColumns[0] ?? null
    }

    const normalizedCandidates = candidateColumns.map((column) => ({
      column,
      name: column.name.toLowerCase()
    }))

    for (const preferredPattern of intentSpecificOrder) {
      const match = normalizedCandidates.find((entry) => preferredPattern.test(entry.name))
      if (match) {
        return match.column
      }
    }

    return candidateColumns[0] ?? null
  }

  private buildDeterministicToolColumnPreference(
    deterministicIntent: DeterministicFinancialIntent
  ): Array<RegExp> {
    switch (deterministicIntent) {
      case 'get_receivables_summary':
        return [/credit_amount|receivable|debt|bedehkar|debtor/i, /amount|balance|total/i]
      case 'get_payables_summary':
        return [/debit_amount|payable|bedehkar|creditor|bastankar/i, /amount|balance|total/i]
      case 'get_cashflow_summary':
        return [/cash_amount|cash|flow|jaryan/i, /amount|balance|total/i]
      case 'get_account_balance':
      case 'get_party_balance':
      default:
        return [/balance|amount|total|sum|net|value/i]
    }
  }

  private composeDeterministicFinancialToolMarkdown(
    deterministicIntent: DeterministicFinancialIntent,
    result: DeterministicFinancialToolResult
  ): string {
    const label =
      deterministicIntent === 'get_account_balance'
        ? 'مانده حساب'
        : deterministicIntent === 'get_party_balance'
          ? 'مانده طرف حساب'
          : deterministicIntent === 'get_purchase_summary'
            ? 'خلاصه خرید'
            : deterministicIntent === 'get_receivables_summary'
              ? 'خلاصه بدهکاران'
              : deterministicIntent === 'get_payables_summary'
                ? 'خلاصه بستانکاران'
                : 'خلاصه جریان نقد'

    const isPurchaseFromInventory = deterministicIntent === 'get_purchase_summary' && result.tableRef === 'INV.InventoryReceipt'
    const hasNoData = result.value === null || result.value === 0

    const summaryText = hasNoData
      ? `این گزارش با داده‌های موجود قابل تولید نیست. ${label} در جدول ${result.tableRef} خالی است.`
      : isPurchaseFromInventory
        ? `فاکتور خرید رسمی ثبت نشده؛ بر اساس رسید انبار (غیرمرجوعی)، ${label} محاسبه شد: ${result.value}`
        : `${label} بر اساس داده‌های read-only و mapping schema محاسبه شد: ${result.value} (نوع KPI: ${label})`

    const assumptionsText = isPurchaseFromInventory
      ? '- مبلغ از رسید انبار `TotalPrice` با `IsReturn=0` است، نه فاکتور خرید رسمی.'
      : '- از mapping انتخاب‌شده schema و ستون عددی قابل‌محاسبه استفاده شد؛ در صورت تفاوت نام ستون، نتیجه ممکن است محدود شود.'

    return [
      '### Summary',
      summaryText,
      '',
      '### Findings',
      `- مسیر پاسخ: deterministic`,
      `- intent قطعی: ${deterministicIntent}`,
      `- جدول/ستون مبنا: ${result.tableRef}.${result.columnName}`,
      '',
      '### Evidence',
      `- ابزار قطعی ${deterministicIntent} با ${result.toolCallsUsed} کوئری read-only اجرا شد.`,
      `- query: ${result.query}`,
      '',
      '### Assumptions',
      assumptionsText,
      '',
      '### Actions',
      '- اگر منظورتان حساب یا بازه زمانی خاصی است، scope دقیق‌تر را مشخص کنید.'
    ].join('\n')
  }

  private composeFiscalYearDeterministicMarkdown(
    deterministicIntent: DeterministicFinancialIntent,
    result: FiscalYearFallbackResult
  ): string {
    const yearSpanText =
      result.minYear !== null && result.maxYear !== null
        ? `${result.minYear} تا ${result.maxYear}`
        : 'نامشخص'
    const previewText = result.years.length > 0 ? result.years.join('، ') : 'نمونه معتبر بازیابی نشد.'

    if (deterministicIntent === 'list_fiscal_years') {
      const listedYears = result.years.length > 0 ? result.years.join('، ') : 'سال مالی قابل اتکا یافت نشد.'

      return [
        '### Summary',
        `فهرست سال های مالی شناسایی شده (fiscal years): ${listedYears} (نوع KPI: سال مالی)`,
        '',
        '### Findings',
        '- مسیر پاسخ: deterministic',
        `- تعداد کل سال های مالی متمایز: ${result.count}`,
        `- بازه سال ها: ${yearSpanText}`,
        `- جدول/ستون مبنا: ${result.tableRef}.${result.columnName}`,
        '',
        '### Evidence',
        `- ابزار قطعی list_fiscal_years با ${result.toolCallsUsed} کوئری read-only اجرا شد.`,
        '- Listed distinct fiscal_year values from the detected fiscal-year column using the read-only path.',
        '- فقط مقادیر 4 رقمی در بازه 1300 تا 2099 در خروجی لحاظ شدند.',
        '',
        '### Assumptions',
        '- فرض اصلی: از جدول/ستون شناسایی‌شده برای سال مالی و مسیر read-only استفاده شده است؛ اگر schema متفاوت باشد، نتیجه ممکن است محدود شود.',
        '',
        '### Actions',
        '- اگر منظور شما شرکت یا شعبه خاصی است، scope را مشخص کنید تا لیست محدودشده ارائه شود.'
      ].join('\n')
    }

    return [
      '### Summary',
      `در دیتابیس فعلی ${result.count} سال مالی متمایز شناسایی شد (${result.count} fiscal years).`,
      '',
      '### Findings',
      '- مسیر پاسخ: deterministic',
      `- جدول/ستون مبنا: ${result.tableRef}.${result.columnName}`,
      `- بازه سال ها: ${yearSpanText}`,
      `- نمونه سال های بازیابی شده (نزولی): ${previewText}`,
      '',
      '### Evidence',
      `- ابزار قطعی count_fiscal_years با ${result.toolCallsUsed} کوئری read-only اجرا شد.`,
      '- Counted distinct fiscal_year values from the detected fiscal-year column using the read-only path.',
      '- فقط مقادیر 4 رقمی در بازه 1300 تا 2099 در شمارش لحاظ شدند.',
      '',
      '### Assumptions',
      '- فرض اصلی: از جدول/ستون شناسایی‌شده برای سال مالی و مسیر read-only استفاده شده است؛ اگر schema متفاوت باشد، نتیجه ممکن است محدود شود.',
      '',
      '### Actions',
      '- اگر منظورتان سال مالی یک شرکت یا شعبه خاص است، نام شرکت/شعبه را اعلام کنید تا شمارش scope-based انجام شود.'
    ].join('\n')
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
        '\n2. اولویت‌بندی ' + `${safePriorityCount}` + ' مورد کلیدی برای تایید مدیر.' +
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
    const templatedText = this.ensureFinancialResponseTemplate(rawText, conversationMemory, totalToolCallCount)
    const alignedText = this.enforcePromptIntentAlignment(prompt, templatedText)
    const routedText = this.annotateManagerUx(alignedText, routeMode)
    const finalizedText = this.enforceEvidenceFirstContract(
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

  private annotateManagerUx(rawText: string, routeMode: 'deterministic' | 'model-assisted' | 'clarification'): string {
    const normalizedText = this.normalizePersianDigits(rawText)

    if (/^### Summary\n/i.test(normalizedText)) {
      const routeLine = `- مسیر پاسخ: ${routeMode}`
      if (normalizedText.includes('نوع KPI:')) {
        return rawText.replace('### Findings', `${routeLine}\n- نوع KPI: ${rawText.match(/نوع KPI: ([^\n]+)/)?.[1] ?? 'نامشخص'}\n\n### Findings`)
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

  private enforceEvidenceFirstContract(
    prompt: string,
    finalText: string,
    totalToolCallCount: number,
    successfulDataFetchCount: number,
    executionTrace?: ExecutionTrace,
    recoveryContext?: { attempts: number },
    requestId?: string,
    conversationId?: string
  ): string {
    const normalizedText = this.normalizePersianDigits(finalText)

    if (/cannot\s+answer\s+reliably/iu.test(normalizedText)) {
      return finalText
    }

    // S5: Validate intent-table match before proceeding
    if (executionTrace && executionTrace.intentId) {
      const intentMismatch = this.validateIntentTableMatch(executionTrace.intentId, executionTrace.evidence)
      if (intentMismatch) {
        const failureText = this.buildEvidenceContractFailureResponse(
          `تطابق intent و جدول برقرار نیست: ${intentMismatch}`,
          prompt,
          recoveryContext?.attempts
        )
        this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, recoveryContext?.attempts)
        return failureText
      }
    }

    const hasFinancialNumericClaimInResponse = /(?:[+-]?\d+(?:[.,]\d+)?(?:\s*%|\s*درصد)|\b(?:تومان|ریال|مبلغ|موجودی|مانده|جمع|مجموع|تعداد|سهم|نسبت|amount|balance|total|count)\b)/iu.test(normalizedText)
    const isClarificationOnlyResponse =
      /برای\s+پاسخ\s+دقیق|برای\s+جلوگیری\s+از\s+حدس\s+زدن|برای\s+جلوگیری\s+از\s+تحلیل\s+اشتباه|لطفا\s+یکی\s+از\s+این\s+گزینه‌ها|سال\s+مالی\s+دقیق|تاریخ\s+شروع\s+و\s+پایان|درخواست\s+صرفاً\s+استعلامی/i.test(
        normalizedText
      ) && !hasFinancialNumericClaimInResponse

    if (isClarificationOnlyResponse) {
      return finalText
    }

    const sections = this.parseFinancialTemplateSections(finalText)
    const narrative = `${sections.summary}\n${sections.findings}`.trim()
    const evidence = sections.evidence
    const appearsFinancialClaim = this.appearsToContainFinancialClaim(prompt) || this.appearsToContainFinancialClaim(narrative)
    const hasRequiredContractSections = this.hasRequiredFinancialResponseSections(sections)
    const hasStructuredEvidence = this.hasStructuredEvidence(evidence)
    const requiresStrictFinancialFetch = this.requiresStrictFinancialDataFetch(prompt, narrative)
    const requiresStrictQuantResult = this.requiresStrictQuantitativeDataFetch(prompt)
    const hasQuantitativeResult = this.hasQuantitativeResultSignal(narrative)
    const statesNoData = this.appearsToBeNoDataResult(narrative)
    const numericClaims = this.extractNumericClaims(narrative)
    const needsStrictData = requiresStrictFinancialFetch || requiresStrictQuantResult

    // Structural guards apply regardless of structured-trace availability.
    if (appearsFinancialClaim && !hasRequiredContractSections) {
      const failureText = this.buildEvidenceContractFailureResponse(
        'پاسخ مالی فاقد بلوک‌های قرارداد استاندارد Summary/Findings/Evidence/Assumptions/Actions بود.',
        prompt,
        recoveryContext?.attempts
      )
      this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, recoveryContext?.attempts)
      return failureText
    }

    if (totalToolCallCount === 0 && appearsFinancialClaim && !statesNoData) {
      const failureText = this.buildEvidenceContractFailureResponse(
        'پاسخ مالی عددی بدون اجرای ابزار read-only تولید شد و قابل اتکا نیست.',
        prompt,
        recoveryContext?.attempts
      )
      this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, recoveryContext?.attempts)
      return failureText
    }

    if (this.containsUnsupportedNumericClaim(narrative, evidence, sections)) {
      const failureText = this.buildEvidenceContractFailureResponse(
        'پاسخ شامل ادعای عددی/درصدی بدون شواهد ساخت‌یافته و بدون داده‌ی اجرا شده بود.',
        prompt,
        recoveryContext?.attempts
      )
      this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, recoveryContext?.attempts)
      return failureText
    }

    // H1: only reject when the response contains a currency/percent-marked
    // financial claim — bare scope numbers (e.g. fiscal years like "1403" in
    // Findings) are diagnostic, not claims, and must not trip the guard on an
    // honest VALID_EMPTY response.
    const hasFinancialMarkedClaim = this.containsFinancialMarkedNumericClaim(narrative)
    if (executionTrace && numericClaims.length > 0 && hasFinancialMarkedClaim && !statesNoData && (appearsFinancialClaim || needsStrictData)) {
      if (!this.traceSupportsNumericClaim(executionTrace)) {
        const failureText = this.buildEvidenceContractFailureResponse(
          'پاسخ شامل عدد/درصدی است که در trace اجرای واقعی وجود ندارد و بنابراین به‌عنوان ادعای بی‌شاهد رد می‌شود. برای پذیرش، عدد باید از اجرای واقعی و شواهد trace پشتیبانی شود.',
          prompt,
          recoveryContext?.attempts
        )
        this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, recoveryContext?.attempts)
        return failureText
      }
    }

    if (totalToolCallCount > 0 && !hasStructuredEvidence && (appearsFinancialClaim || needsStrictData || hasQuantitativeResult)) {
      const failureText = this.buildEvidenceContractFailureResponse(
        'پاسخ مالی فاقد شواهد ساخت یافته کافی (ابزار/کوئری/جدول/ردیف) بود.',
        prompt,
        recoveryContext?.attempts
      )
      this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, recoveryContext?.attempts)
      return failureText
    }

    // When a structured execution trace is available, the tri-state verdict — not
    // rendered prose — is the authority for data sufficiency. This is the core
    // defect fix: a query that ran within scope but returned 0 rows / NULL
    // (VALID_EMPTY) is a legitimate, answerable fact and must NOT be conflated
    // with a never-run/errored query (INSUFFICIENT).
    if (executionTrace && needsStrictData) {
      const verdict = evaluateEvidence(executionTrace)

      if (verdict.kind === 'INSUFFICIENT') {
        const failureText = this.buildEvidenceContractFailureResponse(
          'برای پاسخ عددی/مقایسه ای مالی، اجرای موفق و scope دار fetch_financial_data الزامی است و مسیرهای بدون آن معتبر نیستند.',
          prompt,
          recoveryContext?.attempts
        )
        this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, recoveryContext?.attempts)
        return failureText
      }

      if (verdict.kind === 'VALID_EMPTY') {
        return this.renderValidEmptyFinancialAnswer(finalText, sections, statesNoData)
      }

      // POSITIVE_DATA: a percent-style question must still surface a numeric result.
      if (requiresStrictQuantResult && !hasQuantitativeResult && !statesNoData) {
        const failureText = this.buildEvidenceContractFailureResponse(
          'برای سوال درصد رشد/کاهش، پاسخ نهایی باید عدد درصد معتبر (+x% یا -x%) یا پیام صریح نبود داده داشته باشد.',
          prompt
        )
        this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, recoveryContext?.attempts)
        return failureText
      }

      return finalText
    }

    // Legacy heuristic path (no structured trace available).
    if (requiresStrictFinancialFetch && successfulDataFetchCount === 0 && !statesNoData) {
      const failureText = this.buildEvidenceContractFailureResponse(
        'برای پاسخ عددی/مقایسه ای مالی، اجرای موفق fetch_financial_data الزامی است و مسیرهای بدون آن معتبر نیستند.',
        prompt,
        recoveryContext?.attempts
      )
      this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, recoveryContext?.attempts)
      return failureText
    }

    if (requiresStrictQuantResult && successfulDataFetchCount === 0 && !statesNoData) {
      const failureText = this.buildEvidenceContractFailureResponse(
        'برای سوال درصد رشد/کاهش، پاسخ نهایی بدون اجرای موفق fetch_financial_data مجاز نیست.',
        prompt,
        recoveryContext?.attempts
      )
      this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, recoveryContext?.attempts)
      return failureText
    }

    if (requiresStrictQuantResult && !hasQuantitativeResult && !statesNoData) {
      const failureText = this.buildEvidenceContractFailureResponse(
        'برای سوال درصد رشد/کاهش، پاسخ نهایی باید عدد درصد معتبر (+x% یا -x%) یا پیام صریح نبود داده داشته باشد.',
        prompt,
        recoveryContext?.attempts
      )
      this.emitEvidenceContractTelemetry(requestId, conversationId, failureText, recoveryContext?.attempts)
      return failureText
    }

    return finalText
  }

  /**
   * Renders a first-class affirmative "no records" answer for a VALID_EMPTY
   * verdict. A scoped query executed cleanly but returned 0 rows / NULL, which is
   * a real fact — not an evidence shortfall — so the response is preserved and,
   * if it does not already say so, an explicit no-records statement is injected.
   */
  private renderValidEmptyFinancialAnswer(
    finalText: string,
    sections: ReturnType<AgentOrchestrator['parseFinancialTemplateSections']>,
    statesNoData: boolean
  ): string {
    return renderValidEmptyFinancialAnswer(finalText, sections, statesNoData)
  }

  private requiresStrictFinancialDataFetch(prompt: string, narrative: string): boolean {
    const normalizedPrompt = this.normalizePersianDigits(prompt)
    const normalizedNarrative = this.normalizePersianDigits(narrative)
    const hasFinancialContext =
      this.appearsToContainFinancialClaim(normalizedPrompt) || this.appearsToContainFinancialClaim(normalizedNarrative)

    if (!hasFinancialContext) {
      return false
    }

    const hasQuantOrComparativeSignal =
      /(?:درصد|percent|percentage|رشد|کاهش|افزایش|افت|change|growth|decline|نسبت\s*به|مقایسه|year\s*over\s*year|yoy|total|sum|avg|average|min|max|top|rank|count|تعداد|جمع|مجموع|میانگین|حداقل|حداکثر|بیشترین|کمترین|چه\s*قدر|چقدر|how\s*much)/iu.test(
        normalizedPrompt
      ) || /(?:\b\d[\d,.]*\b|[+-]?\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*درصد)/iu.test(normalizedNarrative)

    return hasQuantOrComparativeSignal
  }

  private requiresStrictQuantitativeDataFetch(prompt: string): boolean {
    const normalized = this.normalizePersianDigits(prompt)

    return /(?:درصد|percent|percentage|رشد|کاهش|افزایش|افت|change|growth|decline|نسبت\s*به|مقایسه|year\s*over\s*year|yoy)/iu.test(
      normalized
    )
  }

  private hasQuantitativeResultSignal(text: string): boolean {
    const normalized = this.normalizePersianDigits(text)

    return /(?:[+-]?\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*درصد|درصد\s*[+-]?\d+(?:\.\d+)?)/iu.test(normalized)
  }

  private appearsToBeNoDataResult(text: string): boolean {
    const normalized = this.normalizePersianDigits(text)

    return /(?:یافت\s*نشد|داده(?:\s*ای)?\s*وجود\s*ندارد|اطلاعات\s*کافی\s*وجود\s*ندارد|نتیجه\s*خالی|رکوردی\s*ثبت\s*نشده|هیچ\s*داده(?:\s*ای)?|no\s*data|insufficient\s*data|no\s+records)/iu.test(
      normalized
    )
  }

  private appearsToContainFinancialClaim(text: string): boolean {
    const normalized = this.normalizePersianDigits(text)
    const strongFinancialSignal =
      /(?:total|amount|balance|sales|revenue|cash\s*flow|receivable|payable|debit|credit|موجودی|مانده|مبلغ|فروش|درآمد|دریافت|پرداخت|جمع|گردش|بدهکار|بستانکار|account|جریان\s*نقد|حساب|ledger|voucher|invoice)/iu.test(
        normalized
      )
    const fiscalYearSignal =
      /(?:سال\s*مالی|fiscal\s*year|financial\s*year)/iu.test(normalized) &&
      /(?:چند|تعداد|لیست|فهرست|کدام|وجود|قرار|دارد|count|list|year)/iu.test(normalized)

    return strongFinancialSignal || fiscalYearSignal
  }

  private hasRequiredFinancialResponseSections(sections: ReturnType<AgentOrchestrator['parseFinancialTemplateSections']>): boolean {
    return Boolean(
      sections.summary.trim() &&
        sections.findings.trim() &&
        sections.evidence.trim() &&
        sections.assumptions.trim() &&
        sections.actions.trim()
    )
  }

  private hasStructuredEvidence(evidenceSection: string): boolean {
    const normalized = this.normalizePersianDigits(evidenceSection)

    return /(?:query|tool|read-only|table|column|row|runtime\s*scope|catalog_scan|list_database_tables|get_database_schema|fetch_financial_data|count_fiscal_years|list_fiscal_years|کوئری|ابزار|جدول|ستون|ردیف|شواهد|شاهد)/iu.test(
      normalized
    )
  }

  private containsUnsupportedNumericClaim(
    narrative: string,
    evidence: string,
    sections: ReturnType<AgentOrchestrator['parseFinancialTemplateSections']>
  ): boolean {
    const normalizedNarrative = this.normalizePersianDigits(narrative)
    const normalizedEvidence = this.normalizePersianDigits(evidence)
    const hasNumericSignal = /(?:[+-]?\d+(?:[.,]\d+)?(?:\s*%|\s*درصد)|\b\d+(?:[.,]\d+)?\b)/u.test(normalizedNarrative)
    const hasPositiveEvidenceSignal = /(?:tool:|read-only\s+query|query\s+executed|query\s+used|scope\s+applied|table\s+name|column\s+name|row\s+count|schema\s+check|via\s+read-only|via\s+query|ابزار\s+اجرایی|کوئری\s+اجرا|کوئری\s+read-only|executed|used)/iu.test(
      normalizedEvidence
    )
    const hasExplicitNoEvidenceSignal = /(?:بدون\s+(?:اجرای|استفاده\s+از|شواهد|کوئری|ابزار|داده|تأیید)|without\s+(?:evidence|tool|query|data)|no\s+(?:evidence|tool|query|data|financial\s+data\s+fetch)|هیچ\s+(?:fetch_financial_data|کوئری|ابزار|داده|شواهد)|not\s+executed|didn['’]?t\s+run|not\s+run|حدس|برآورد|model\s+assumption|assumption)/iu.test(
      normalizedEvidence
    )
    const hasExplicitNoData = this.appearsToBeNoDataResult(normalizedNarrative)
    const hasRequiredSections = this.hasRequiredFinancialResponseSections(sections)

    return Boolean(
      hasNumericSignal && !hasPositiveEvidenceSignal && (hasExplicitNoEvidenceSignal || !normalizedEvidence.trim()) && !hasExplicitNoData && hasRequiredSections
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
    const normalized = this.normalizePersianDigits(narrative)

    if (/[+-]?\d+(?:[.,]\d+)?\s*(?:%|درصد)/iu.test(normalized)) {
      return true
    }

    if (/\d[\d,]*\s*(?:تومان|ریال|IRR|USD|EUR|\$)/iu.test(normalized)) {
      return true
    }

    // Number adjacent to a financial noun (within ~3 words on either side).
    const financialNoun = '(?:مبلغ|موجودی|مانده|جمع|مجموع|سهم|نسبت|amount|balance|total)'
    const adjacencyPattern = new RegExp(
      `(?:${financialNoun}[^\\n]{0,40}?\\d[\\d,]*(?:[.,]\\d+)?|\\d[\\d,]*(?:[.,]\\d+)?[^\\n]{0,40}?${financialNoun})`,
      'iu'
    )
    return adjacencyPattern.test(normalized)
  }

  private extractNumericClaims(text: string): string[] {
    const normalized = this.normalizePersianDigits(text)
    const matches = normalized.match(/(?:[+-]?\d+(?:[.,]\d+)?(?:\s*%|\s*درصد)|\b\d+(?:[.,]\d+)?\b)/gu) ?? []

    return matches.map((value) => value.trim())
  }

  private traceSupportsNumericClaim(trace: ExecutionTrace | undefined): boolean {
    if (!trace) {
      return false
    }

    // VALID_EMPTY (scoped query returned 0 rows / NULL aggregate) is a legitimate
    // basis only for an honest "no records" answer — never for a fabricated
    // numeric claim. Per H1, the safety guard must NOT accept numbers backed by
    // an empty trace.
    const verdict = evaluateEvidence(trace)
    return verdict.kind === 'POSITIVE_DATA'
  }

  private emitEvidenceContractTelemetry(
    requestId: string | undefined,
    conversationId: string | undefined,
    finalText: string,
    recoveryAttempts?: number
  ): void {
    const effectiveRecoveryAttempts = recoveryAttempts ?? 0

    this.telemetry?.capture({
      event: 'agent.orchestrator.audit',
      category: 'agent.orchestrator',
      level: 'warn',
      process: 'main',
      message: 'evidence-contract-failure',
      details: {
        failureKind: 'evidence_contract',
        recoveryAttempts: effectiveRecoveryAttempts,
        finalText,
        requestId,
        conversationId
      },
      requestId,
      conversationId
    })
  }

  private emitGuardrailTelemetry(
    kind: 'unsupported-function' | 'empty-result-recovery' | 'provider-error',
    requestId: string | undefined,
    conversationId: string | undefined,
    details?: Record<string, unknown>
  ): void {
    this.telemetry?.capture({
      event: 'agent.orchestrator.guardrail',
      category: 'agent.orchestrator',
      level: 'warn',
      process: 'main',
      message: kind,
      details: {
        kind,
        requestId,
        conversationId,
        ...details
      },
      requestId,
      conversationId
    })
  }

  private emitGuardrailCounterTelemetry(
    kind: 'unsupported-function' | 'empty-result-recovery' | 'provider-error',
    requestId: string | undefined,
    conversationId: string | undefined,
    count: number
  ): void {
    this.telemetry?.capture({
      event: 'agent.orchestrator.guardrail.count',
      category: 'agent.orchestrator',
      level: 'info',
      process: 'main',
      message: kind,
      details: {
        kind,
        count,
        requestId,
        conversationId
      },
      requestId,
      conversationId
    })
  }

  private buildEvidenceContractFailureResponse(reason: string, prompt: string, recoveryAttempts?: number): string {
    return buildEvidenceContractFailureResponse(reason, this.compactText(prompt, 180), recoveryAttempts)
  }

  private enforcePromptIntentAlignment(prompt: string, finalText: string): string {
    const expectedIntent = this.detectDeterministicFinancialIntent(prompt)

    if (!expectedIntent || !['count_fiscal_years', 'list_fiscal_years'].includes(expectedIntent)) {
      return finalText
    }

    const sections = this.parseFinancialTemplateSections(finalText)
    const intentSourceText = `${sections.summary}\n${sections.findings}\n${sections.evidence}`
    const normalizedText = this.normalizePersianDigits(intentSourceText)
    const hasFiscalYearPhrase = /(?:سال(?:\s*های?)?\s*مالی|fiscal\s+years?)/iu.test(normalizedText)
    const hasCountSignal = /(?:تعداد|count|شمارش|متمایز)/iu.test(normalizedText)
    const hasListSignal = /(?:لیست|فهرست|list)/iu.test(normalizedText)
    const yearTokenMatches = normalizedText.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? []
    const hasYearToken = yearTokenMatches.length > 0
    const hasMultipleYearTokens = yearTokenMatches.length >= 2
    const hasNumericCount = /\b\d+\b/.test(normalizedText)

    const countLike = hasFiscalYearPhrase && (hasCountSignal || hasNumericCount)
    const listLike = hasFiscalYearPhrase && (hasListSignal || hasMultipleYearTokens)

    const matchedIntent =
      countLike && listLike
        ? expectedIntent
        : countLike
          ? 'count_fiscal_years'
          : listLike || (hasFiscalYearPhrase && hasYearToken)
            ? 'list_fiscal_years'
            : null

    if (matchedIntent === expectedIntent) {
      return finalText
    }

    return [
      '### Summary',
      'Cannot answer reliably: پاسخ مدل با intent سوال کاربر هم راستا نیست.',
      '',
      '### Findings',
      `- intent مورد انتظار: ${expectedIntent}`,
      `- intent تشخیص داده شده در پاسخ: ${matchedIntent ?? 'unknown'}`,
      '',
      '### Evidence',
      '- قاعده کنترل کیفیت intent پاسخ فعال شد و از ارائه پاسخ مالی نامعتبر جلوگیری کرد.',
      '',
      '### Actions',
      '- لطفا سوال را دقیق تر بیان کنید (مثال: تعداد سال های مالی یا لیست سال های مالی).'
    ].join('\n')
  }

  private quoteSqlIdentifier(value: string): string {
    return `[${value.replace(/\]/g, ']]')}]`
  }

  private quoteSqlTableRef(ref: string): string {
    const dotIndex = ref.indexOf('.')
    if (dotIndex === -1) {
      return this.quoteSqlIdentifier(ref)
    }
    const schema = ref.slice(0, dotIndex)
    const table = ref.slice(dotIndex + 1)
    return `${this.quoteSqlIdentifier(schema)}.${this.quoteSqlIdentifier(table)}`
  }

  private toFiniteInteger(value: unknown): number {
    const parsed = this.toOptionalFiniteInteger(value)
    return parsed ?? 0
  }

  private toSafeNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }

    if (typeof value === 'string') {
      const normalized = value.replace(/,/g, '').trim()
      const parsed = Number.parseFloat(normalized)
      return Number.isFinite(parsed) ? parsed : 0
    }

    return 0
  }

  private toOptionalFiniteInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value)
    }

    if (typeof value === 'string') {
      const parsed = Number.parseInt(value.trim(), 10)
      return Number.isFinite(parsed) ? parsed : null
    }

    return null
  }

  private ensureFinancialResponseTemplate(
    rawText: string,
    conversationMemory: ConversationMemoryState,
    totalToolCallCount: number
  ): string {
    const normalizedText = rawText.replace(/\r\n?/g, '\n').trim()
    const sections = this.parseFinancialTemplateSections(normalizedText)
    const hasAllSections =
      sections.summary.length > 0 &&
      sections.findings.length > 0 &&
      sections.evidence.length > 0 &&
      sections.assumptions.length > 0 &&
      sections.actions.length > 0

    if (hasAllSections) {
      return normalizedText
    }

    const summarySource = sections.summary || sections.freeform || normalizedText
    const summaryText = summarySource.trim()
      ? this.compactText(
          summarySource
            .replace(/[`*_>#]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
          420
        )
      : 'پاسخ مدل خالی بود.'

    const findingsText =
      sections.findings ||
      (totalToolCallCount > 0
        ? '- تحلیل بر پایه داده واقعی ابزارها انجام شد.'
        : '- این پاسخ بدون اجرای ابزار مالی تولید شده است و باید با احتیاط بازبینی شود.')

    const evidenceText =
      sections.evidence || this.buildFinancialEvidenceFallback(conversationMemory, totalToolCallCount)
    const assumptionsText =
      sections.assumptions ||
      '- فرض اصلی: پاسخ بر پایه داده و شواهد ابزارهای read-only است و در صورت نبود mapping دقیق، نتیجه قابل اتکا نیست.'

    const actionsText =
      sections.actions ||
      '- در صورت نیاز، بازه زمانی یا scope شرکت/سال مالی/شعبه را دقیق‌تر مشخص کنید تا تحلیل بهینه‌تر شود.'

    return [
      '### Summary',
      summaryText,
      '',
      '### Findings',
      findingsText,
      '',
      '### Evidence',
      evidenceText,
      '',
      '### Assumptions',
      assumptionsText,
      '',
      '### Actions',
      actionsText
    ]
      .join('\n')
      .trim()
  }

  private parseFinancialTemplateSections(text: string): {
    summary: string
    findings: string
    evidence: string
    assumptions: string
    actions: string
    freeform: string
  } {
    const sections = {
      summary: '',
      findings: '',
      evidence: '',
      assumptions: '',
      actions: '',
      freeform: ''
    }

    if (!text) {
      return sections
    }

    let activeSection: keyof typeof sections = 'freeform'

    for (const rawLine of text.split('\n')) {
      const headingMatch = rawLine.trim().match(/^#{1,4}\s*(.+?)\s*$/u)

      if (headingMatch) {
        const mappedSection = this.mapFinancialSectionHeading(headingMatch[1] ?? '')

        if (mappedSection) {
          activeSection = mappedSection
          continue
        }

        activeSection = 'freeform'
      }

      const previous = sections[activeSection]
      sections[activeSection] = previous ? `${previous}\n${rawLine}` : rawLine
    }

    return {
      summary: sections.summary.trim(),
      findings: sections.findings.trim(),
      evidence: sections.evidence.trim(),
      assumptions: sections.assumptions.trim(),
      actions: sections.actions.trim(),
      freeform: sections.freeform.trim()
    }
  }

  private mapFinancialSectionHeading(
    heading: string
  ): 'summary' | 'findings' | 'evidence' | 'assumptions' | 'actions' | null {
    const normalized = heading.toLowerCase().replace(/[:：]/g, '').trim()

    if (/^(summary|خلاصه|جمع\s*بندی)$/iu.test(normalized)) {
      return 'summary'
    }

    if (/^(findings?|یافته\s*ها|یافته‌ها|نتایج)$/iu.test(normalized)) {
      return 'findings'
    }

    if (/^(evidence|evidences|شواهد|مدارک)$/iu.test(normalized)) {
      return 'evidence'
    }

    if (/^(assumptions?|فرض\s*ها|فرضیات)$/iu.test(normalized)) {
      return 'assumptions'
    }

    if (/^(actions?|اقدامات|پیشنهادها|گام\s*های\s*بعدی|گامهای\s*بعدی)$/iu.test(normalized)) {
      return 'actions'
    }

    return null
  }

  private buildFinancialEvidenceFallback(
    conversationMemory: ConversationMemoryState,
    totalToolCallCount: number
  ): string {
    const lines: string[] = []

    if (conversationMemory.lastToolTrace.length > 0) {
      for (const trace of conversationMemory.lastToolTrace.slice(-3)) {
        lines.push(`- ${trace}`)
      }
    }

    const scopeParts: string[] = []
    if (conversationMemory.facts.companyNames.length > 0) {
      scopeParts.push(`company=${conversationMemory.facts.companyNames.join('|')}`)
    }
    if (conversationMemory.facts.fiscalYears.length > 0) {
      scopeParts.push(`fiscal_year=${conversationMemory.facts.fiscalYears.join('|')}`)
    }
    if (conversationMemory.facts.branchNames.length > 0) {
      scopeParts.push(`branch=${conversationMemory.facts.branchNames.join('|')}`)
    }

    if (scopeParts.length > 0) {
      lines.push(`- Runtime scope: ${scopeParts.join(' ; ')}`)
    }

    if (totalToolCallCount === 0) {
      lines.push('- ابزار مالی اجرا نشد؛ پاسخ باید با احتیاط بازبینی شود.')
    }

    if (lines.length === 0) {
      lines.push('- شواهد ابزاری در این مرحله ثبت نشده است.')
    }

    return lines.join('\n')
  }

  private createEvidencePreview(
    sqlQuery: string,
    rows: SqlQueryRow[],
    rowCount: number,
    truncated: boolean
  ): AgentEvidencePreview {
    const columnNames = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 10)
    const previewRows = rows.slice(0, 10).map((row) => {
      const previewRow: SqlQueryRow = {}

      for (const columnName of columnNames) {
        const value = row[columnName]
        previewRow[columnName] = this.normalizeEvidenceCellValue(value)
      }

      return previewRow
    })

    return {
      queryPreview: this.compactText(sqlQuery.replace(/\s+/g, ' '), 260),
      columns: columnNames,
      rows: previewRows,
      rowCount,
      truncated
    }
  }

  private normalizeEvidenceCellValue(value: unknown): unknown {
    if (typeof value === 'string' && value.length > 180) {
      return `${value.slice(0, 179)}…`
    }

    return value
  }

  private buildPendingToolStatusText(toolName: string, args: Record<string, unknown>): string {
    if (toolName === 'list_database_tables') {
      return '🔍 در حال جستجو و استخراج لیست جداول دیتابیس...'
    }

    if (toolName === 'get_database_schema') {
      const tableNameArg = args['table_name']
      const tableName = typeof tableNameArg === 'string' && tableNameArg.trim() ? tableNameArg.trim() : 'نامشخص'
      return `📋 در حال تحلیل ساختار و ستون‌های جدول [${tableName}]...`
    }

    if (toolName === 'fetch_financial_data') {
      return '📊 در حال اجرای کوئری مالی روی دیتابیس و استخراج ردیف‌ها...'
    }

    return `🧩 در حال اجرای ابزار ${toolName}...`
  }

  private ensureFinancialQueryAllowed(
    sqlQuery: string,
    settings: AppSettings,
    conversationMemory?: ConversationMemoryState
  ): void {
    const activeCatalog = this.findActiveSchemaCatalog(settings)

    if (!activeCatalog || activeCatalog.tables.length === 0) {
      return
    }

    const referencedTables = this.extractReferencedTableRefs(sqlQuery)

    if (referencedTables.length === 0) {
      throw new Error(
        'Financial query must reference at least one base table in FROM/JOIN/APPLY clauses.'
      )
    }

    const allowedRefs = this.buildAllowedFinancialTableRefs(activeCatalog)
    const catalogTableNameIndex = this.buildCatalogTableNameIndex(activeCatalog)
    const cteNames = this.extractCteNames(sqlQuery)

    this.validateCatalogColumnReferences(sqlQuery, activeCatalog, allowedRefs, cteNames)
    const activeDatabaseName = this.normalizeSqlIdentifier(activeCatalog.databaseName)
    let validatedRefCount = 0

    for (const tableRef of referencedTables) {
      if (tableRef.partCount > 4) {
        throw new Error(`Table reference [${tableRef.raw}] is invalid. Maximum identifier depth is 4 parts.`)
      }

      if (tableRef.serverName) {
        throw new Error(
          `Linked-server reference [${tableRef.raw}] is not allowed in financial data queries.`
        )
      }

      if (tableRef.databaseName && activeDatabaseName && tableRef.databaseName !== activeDatabaseName) {
        throw new Error(
          `Cross-database reference [${tableRef.raw}] is not allowed. Active database is [${activeCatalog.databaseName}].`
        )
      }

      if (tableRef.schemaTable) {
        if (!allowedRefs.has(tableRef.schemaTable)) {
          throw new Error(`Table reference [${tableRef.raw}] is outside the allowed financial catalog scope.`)
        }

        validatedRefCount += 1
        continue
      }

      if (cteNames.has(tableRef.tableName)) {
        continue
      }

      const catalogMatches = catalogTableNameIndex.get(tableRef.tableName)

      if (!catalogMatches || catalogMatches.size === 0) {
        // Likely a CTE alias or derived table name.
        continue
      }

      const hasAllowedMatch = [...catalogMatches].some((candidate) => allowedRefs.has(candidate))

      if (!hasAllowedMatch) {
        throw new Error(`Table reference [${tableRef.raw}] is outside the allowed financial catalog scope.`)
      }

      validatedRefCount += 1
    }

    if (validatedRefCount === 0) {
      throw new Error(
        'Financial query must reference at least one allowed base table (schema.table) from discovered catalog.'
      )
    }

    if (conversationMemory) {
      const scopeRequirements = this.buildRuntimeScopeFilterRequirements(settings, conversationMemory)

      if (scopeRequirements.length > 0) {
        this.ensureRuntimeScopeFilters(sqlQuery, scopeRequirements)
      }
    }

    this.ensurePersonNameSearchPolicy(sqlQuery)
  }

  private ensurePersonNameSearchPolicy(sqlQuery: string): void {
    const normalizedQuery = this.normalizePersianDigits(sqlQuery)
    const personNameColumnSignal =
      /(?:\bLastName\b|\bFirstName\b|\bFullName\b|\bPartyName\b|\bPersonName\b|\bCustomerName\b|\bSurname\b|\bFamilyName\b|\bName\b|نام(?:\s*خانوادگی)?|طرف\s*حساب)/iu.test(
        normalizedQuery
      )

    if (!personNameColumnSignal) {
      return
    }

    const exactNameEqualityPattern =
      /(?:\b(?:LastName|FirstName|FullName|PartyName|PersonName|CustomerName|Surname|FamilyName|Name)\b\s*=\s*N?'[^']+'|N?'[^']+'\s*=\s*\b(?:LastName|FirstName|FullName|PartyName|PersonName|CustomerName|Surname|FamilyName|Name)\b)/iu

    if (exactNameEqualityPattern.test(normalizedQuery)) {
      throw new Error(
        'Exact equality on person name/surname is not allowed. Use robust token-based matching with LIKE and proper Unicode prefixes (N\'...\') for compound names.'
      )
    }
  }

  private buildRuntimeScopeFilterRequirements(
    settings: AppSettings,
    conversationMemory: ConversationMemoryState
  ): RuntimeScopeFilterRequirement[] {
    const activeCatalog = this.findActiveSchemaCatalog(settings)

    if (!activeCatalog) {
      return []
    }

    const scopeColumnCandidates = this.collectRuntimeScopeColumnCandidates(activeCatalog)
    const requirements: RuntimeScopeFilterRequirement[] = []

    const dimensionEntries: Array<{
      dimension: RuntimeScopeDimension
      values: string[]
    }> = [
      {
        dimension: 'company',
        values: conversationMemory.facts.companyNames
      },
      {
        dimension: 'fiscalYear',
        values: conversationMemory.facts.fiscalYears
      },
      {
        dimension: 'branch',
        values: conversationMemory.facts.branchNames
      }
    ]

    for (const entry of dimensionEntries) {
      if (entry.values.length === 0) {
        continue
      }

      const candidateColumnNames: string[] = []
      const seenColumnNames = new Set<string>()

      for (const candidate of scopeColumnCandidates) {
        if (candidate.dimension !== entry.dimension) {
          continue
        }

        const normalizedColumnName = candidate.columnName.trim().toLowerCase()

        if (!normalizedColumnName || seenColumnNames.has(normalizedColumnName)) {
          continue
        }

        seenColumnNames.add(normalizedColumnName)
        candidateColumnNames.push(normalizedColumnName)

        if (candidateColumnNames.length >= 6) {
          break
        }
      }

      if (candidateColumnNames.length === 0) {
        continue
      }

      requirements.push({
        dimension: entry.dimension,
        values: [...entry.values],
        candidateColumnNames
      })
    }

    return requirements
  }

  private ensureRuntimeScopeFilters(
    sqlQuery: string,
    requirements: RuntimeScopeFilterRequirement[]
  ): void {
    const normalizedSql = this.stripSqlCommentsAndLiterals(sqlQuery)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    const normalizedSqlWithValues = this.stripSqlComments(sqlQuery)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()

    for (const requirement of requirements) {
      const hasPredicate = requirement.candidateColumnNames.some((columnName) => {
        return this.hasColumnPredicateInWhereClause(normalizedSql, columnName)
      })

      if (!hasPredicate) {
        const scopeLabel = this.toRuntimeScopeDimensionLabel(requirement.dimension)
        const valuesText = requirement.values.join(' | ')
        const columnsText = requirement.candidateColumnNames.slice(0, 4).join(', ')

        throw this.createAgentPolicyError(
          'AGENT_SCOPE_FILTER_REQUIRED',
          `Query is missing required ${scopeLabel} filter. Scope values: ${valuesText}. Add WHERE predicate using one of: ${columnsText}.`
        )
      }

      const hasScopeValueConstraint = this.hasScopeValueConstraintInWhereClause(
        normalizedSqlWithValues,
        requirement
      )

      if (!hasScopeValueConstraint) {
        const scopeLabel = this.toRuntimeScopeDimensionLabel(requirement.dimension)
        const valuesText = requirement.values.join(' | ')

        throw this.createAgentPolicyError(
          'AGENT_SCOPE_VALUE_FILTER_REQUIRED',
          `Query has ${scopeLabel} predicate but does not constrain requested scope values. Scope values: ${valuesText}.`
        )
      }

      const hasWeakDisjunction = this.hasWeakScopeDisjunctionInWhereClause(
        normalizedSqlWithValues,
        requirement
      )

      if (hasWeakDisjunction) {
        const scopeLabel = this.toRuntimeScopeDimensionLabel(requirement.dimension)
        const valuesText = requirement.values.join(' | ')

        throw this.createAgentPolicyError(
          'AGENT_SCOPE_FILTER_WEAK_CONSTRAINT',
          `Query contains weak OR branches that can bypass ${scopeLabel} scope constraints. Scope values: ${valuesText}.`
        )
      }
    }
  }

  private hasScopeValueConstraintInWhereClause(
    normalizedSqlWithValues: string,
    requirement: RuntimeScopeFilterRequirement
  ): boolean {
    if (!normalizedSqlWithValues || requirement.values.length === 0 || requirement.candidateColumnNames.length === 0) {
      return false
    }

    const whereSections = normalizedSqlWithValues.split(/\bwhere\b/gi).slice(1)

    if (whereSections.length === 0) {
      return false
    }

    for (const section of whereSections) {
      const boundedSection = section.split(
        /\border\s+by\b|\bgroup\s+by\b|\bhaving\b|\boffset\b|\bfetch\b|\bunion\b|\bexcept\b|\bintersect\b/i
      )[0]

      if (!boundedSection) {
        continue
      }

      if (this.hasScopeValueConstraintInExpression(boundedSection, requirement)) {
        return true
      }
    }

    return false
  }

  private hasScopeValueConstraintInExpression(
    normalizedExpression: string,
    requirement: RuntimeScopeFilterRequirement
  ): boolean {
    if (!normalizedExpression || requirement.values.length === 0 || requirement.candidateColumnNames.length === 0) {
      return false
    }

    for (const columnName of requirement.candidateColumnNames) {
      const escapedColumnName = this.escapeRegexPattern(columnName)
      const columnMentionPattern = new RegExp(`(?:\\.|\\b)${escapedColumnName}\\b`, 'i')

      if (!columnMentionPattern.test(normalizedExpression)) {
        continue
      }

      for (const value of requirement.values) {
        const normalizedValue = this.normalizePersianDigits(value).trim().toLowerCase()

        if (!normalizedValue) {
          continue
        }

        const escapedValue = this.escapeRegexPattern(normalizedValue)
        const valueNearColumnPattern = new RegExp(
          `(?:\\.|\\b)${escapedColumnName}\\b[^;]{0,220}?${escapedValue}`,
          'i'
        )

        if (valueNearColumnPattern.test(normalizedExpression)) {
          return true
        }
      }
    }

    return false
  }

  private hasWeakScopeDisjunctionInWhereClause(
    normalizedSqlWithValues: string,
    requirement: RuntimeScopeFilterRequirement
  ): boolean {
    if (!normalizedSqlWithValues || requirement.values.length === 0 || requirement.candidateColumnNames.length === 0) {
      return false
    }

    const whereSections = normalizedSqlWithValues.split(/\bwhere\b/gi).slice(1)

    if (whereSections.length === 0) {
      return false
    }

    for (const section of whereSections) {
      const boundedSection = section.split(
        /\border\s+by\b|\bgroup\s+by\b|\bhaving\b|\boffset\b|\bfetch\b|\bunion\b|\bexcept\b|\bintersect\b/i
      )[0]

      if (!boundedSection) {
        continue
      }

      const disjunctionBranches = this.splitTopLevelDisjunction(boundedSection)

      if (disjunctionBranches.length <= 1) {
        continue
      }

      for (const branch of disjunctionBranches) {
        if (!this.hasScopeValueConstraintInExpression(branch, requirement)) {
          return true
        }
      }
    }

    return false
  }

  private splitTopLevelDisjunction(expression: string): string[] {
    const branches: string[] = []
    let buffer = ''
    let parenDepth = 0
    let bracketDepth = 0
    let inSingleQuote = false
    let inDoubleQuote = false

    for (let index = 0; index < expression.length; index += 1) {
      const char = expression[index]

      if (inSingleQuote) {
        buffer += char

        if (char === "'") {
          if (index + 1 < expression.length && expression[index + 1] === "'") {
            buffer += expression[index + 1]
            index += 1
          } else {
            inSingleQuote = false
          }
        }

        continue
      }

      if (inDoubleQuote) {
        buffer += char

        if (char === '"') {
          if (index + 1 < expression.length && expression[index + 1] === '"') {
            buffer += expression[index + 1]
            index += 1
          } else {
            inDoubleQuote = false
          }
        }

        continue
      }

      if (char === "'") {
        inSingleQuote = true
        buffer += char
        continue
      }

      if (char === '"') {
        inDoubleQuote = true
        buffer += char
        continue
      }

      if (char === '[') {
        bracketDepth += 1
        buffer += char
        continue
      }

      if (char === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1)
        buffer += char
        continue
      }

      if (bracketDepth === 0) {
        if (char === '(') {
          parenDepth += 1
          buffer += char
          continue
        }

        if (char === ')') {
          parenDepth = Math.max(0, parenDepth - 1)
          buffer += char
          continue
        }
      }

      if (parenDepth === 0 && bracketDepth === 0 && this.startsWithLogicalOperator(expression, index, 'or')) {
        const trimmedBranch = buffer.trim()
        if (trimmedBranch) {
          branches.push(trimmedBranch)
        }

        buffer = ''
        index += 1
        continue
      }

      buffer += char
    }

    const trailingBranch = buffer.trim()
    if (trailingBranch) {
      branches.push(trailingBranch)
    }

    return branches
  }

  private startsWithLogicalOperator(expression: string, index: number, operator: 'or' | 'and'): boolean {
    const token = expression.slice(index, index + operator.length).toLowerCase()

    if (token !== operator) {
      return false
    }

    const previousChar = index > 0 ? expression[index - 1] : ' '
    const nextChar = index + operator.length < expression.length ? expression[index + operator.length] : ' '

    const previousIsBoundary = !/[a-z0-9_]/i.test(previousChar)
    const nextIsBoundary = !/[a-z0-9_]/i.test(nextChar)

    return previousIsBoundary && nextIsBoundary
  }

  private hasColumnPredicateInWhereClause(normalizedSql: string, columnName: string): boolean {
    if (!normalizedSql || !columnName) {
      return false
    }

    const whereSections = normalizedSql.split(/\bwhere\b/gi).slice(1)

    if (whereSections.length === 0) {
      return false
    }

    const escapedColumnName = this.escapeRegexPattern(columnName)
    const predicatePattern = new RegExp(
      `(?:\\.|\\b)${escapedColumnName}\\b[^;]{0,120}?(?:=|in\\s*\\(|like\\b|between\\b|>=|<=|<>|>|<)`,
      'i'
    )

    for (const section of whereSections) {
      const boundedSection = section.split(
        /\border\s+by\b|\bgroup\s+by\b|\bhaving\b|\boffset\b|\bfetch\b|\bunion\b|\bexcept\b|\bintersect\b/i
      )[0]

      if (!boundedSection) {
        continue
      }

      if (predicatePattern.test(boundedSection)) {
        return true
      }
    }

    return false
  }

  private toRuntimeScopeDimensionLabel(dimension: RuntimeScopeDimension): string {
    switch (dimension) {
      case 'company':
        return 'company'
      case 'fiscalYear':
        return 'fiscal-year'
      case 'branch':
        return 'branch'
      default:
        return 'runtime scope'
    }
  }

  private escapeRegexPattern(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  private validateCatalogColumnReferences(
    sqlQuery: string,
    activeCatalog: SchemaCatalogEntry,
    allowedRefs: Set<string>,
    cteNames: Set<string>
  ): void {
    let ast: unknown

    try {
      ast = this.sqlParser.astify(sqlQuery)
    } catch {
      return
    }

    const tableMap = this.buildCatalogTableAliasMap(activeCatalog, allowedRefs, cteNames)

    this.visitSqlAstColumns(ast, tableMap, activeCatalog)
  }

  private buildCatalogTableAliasMap(
    activeCatalog: SchemaCatalogEntry,
    allowedRefs: Set<string>,
    cteNames: Set<string>
  ): Map<string, { schemaName: string; tableName: string }> {
    const aliasMap = new Map<string, { schemaName: string; tableName: string }>()

    for (const table of activeCatalog.tables) {
      const normalizedRef = this.normalizeTableRef(`${table.schemaName}.${table.tableName}`)

      if (!allowedRefs.has(normalizedRef)) {
        continue
      }

      aliasMap.set(table.tableName.trim().toLowerCase(), { schemaName: table.schemaName, tableName: table.tableName })
      aliasMap.set(`${table.schemaName}.${table.tableName}`.trim().toLowerCase(), {
        schemaName: table.schemaName,
        tableName: table.tableName
      })
    }

    for (const table of activeCatalog.tables) {
      const normalizedRef = this.normalizeTableRef(`${table.schemaName}.${table.tableName}`)

      if (!allowedRefs.has(normalizedRef) || cteNames.has(table.tableName.trim().toLowerCase())) {
        continue
      }
    }

    return aliasMap
  }

  private visitSqlAstColumns(
    node: unknown,
    aliasMap: Map<string, { schemaName: string; tableName: string }>,
    activeCatalog: SchemaCatalogEntry
  ): void {
    if (!node || typeof node !== 'object') {
      return
    }

    const record = node as Record<string, unknown>

    if (record.type === 'column_ref' && typeof record.column === 'string') {
      const tableName = typeof record.table === 'string' ? record.table.trim().toLowerCase() : null
      const columnName = record.column.trim().toLowerCase()
      const resolvedTable = this.resolveCatalogTableForColumnRef(tableName, aliasMap, activeCatalog)

      if (!resolvedTable) {
        return
      }

      const catalogTable = activeCatalog.tables.find((entry) => {
        return (
          entry.schemaName.trim().toLowerCase() === resolvedTable.schemaName.trim().toLowerCase() &&
          entry.tableName.trim().toLowerCase() === resolvedTable.tableName.trim().toLowerCase()
        )
      })

      if (!catalogTable) {
        return
      }

      const columnExists = catalogTable.columns.some((column) => column.name.trim().toLowerCase() === columnName)

      if (!columnExists) {
        throw new Error(
          `Column [${columnName}] is not available in table [${catalogTable.schemaName}.${catalogTable.tableName}].`
        )
      }
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          this.visitSqlAstColumns(item, aliasMap, activeCatalog)
        }
        continue
      }

      if (value && typeof value === 'object') {
        this.visitSqlAstColumns(value, aliasMap, activeCatalog)
      }
    }
  }

  private resolveCatalogTableForColumnRef(
    tableAlias: string | null,
    aliasMap: Map<string, { schemaName: string; tableName: string }>,
    activeCatalog: SchemaCatalogEntry
  ): { schemaName: string; tableName: string } | null {
    if (tableAlias) {
      return aliasMap.get(tableAlias) ?? null
    }

    const candidates = [...aliasMap.values()]

    if (candidates.length === 1) {
      return candidates[0]
    }

    const inScopeTables = activeCatalog.tables.filter((entry) => aliasMap.has(entry.tableName.trim().toLowerCase()))

    if (inScopeTables.length === 1) {
      return {
        schemaName: inScopeTables[0].schemaName,
        tableName: inScopeTables[0].tableName
      }
    }

    return null
  }

  private buildAllowedFinancialTableRefs(activeCatalog: SchemaCatalogEntry): Set<string> {
    const catalogRefs = new Set(
      activeCatalog.tables.map((table) => this.normalizeTableRef(`${table.schemaName}.${table.tableName}`))
    )

    if (catalogRefs.size === 0) {
      return catalogRefs
    }

    const seedRefs = new Set<string>()

    for (const conceptKey of SCHEMA_CONTEXT_CONCEPT_ORDER) {
      const selectedRef = activeCatalog.selectedMappings[conceptKey]?.trim() ?? ''
      const selectedNormalized = this.normalizeTableRef(selectedRef)

      if (selectedRef && catalogRefs.has(selectedNormalized)) {
        seedRefs.add(selectedNormalized)
      }

      const suggestions = activeCatalog.suggestedMappings[conceptKey] ?? []
      for (const suggestionRef of suggestions) {
        const normalizedSuggestion = this.normalizeTableRef(suggestionRef)

        if (normalizedSuggestion && catalogRefs.has(normalizedSuggestion)) {
          seedRefs.add(normalizedSuggestion)
        }
      }
    }

    for (const table of activeCatalog.tables) {
      if (table.tags.length > 0) {
        seedRefs.add(this.normalizeTableRef(`${table.schemaName}.${table.tableName}`))
      }
    }

    if (seedRefs.size === 0) {
      return catalogRefs
    }

    const expandedRefs = new Set(seedRefs)

    for (const table of activeCatalog.tables) {
      const currentRef = this.normalizeTableRef(`${table.schemaName}.${table.tableName}`)
      const referencedRefs = table.foreignKeys
        .map((fk) => this.normalizeTableRef(`${fk.referencedSchema}.${fk.referencedTable}`))
        .filter((ref) => catalogRefs.has(ref))

      const touchesSeed = seedRefs.has(currentRef) || referencedRefs.some((ref) => seedRefs.has(ref))

      if (!touchesSeed) {
        continue
      }

      expandedRefs.add(currentRef)

      for (const referencedRef of referencedRefs) {
        expandedRefs.add(referencedRef)
      }
    }

    return expandedRefs
  }

  private extractCteNames(sqlQuery: string): Set<string> {
    const sanitizedSql = this.stripSqlCommentsAndLiterals(sqlQuery)
    const cteNames = new Set<string>()
    const ctePattern = /(?:\bWITH\b|,)\s*([A-Z0-9_\[\]"`]+)\s+AS\s*\(/gi

    let match: RegExpExecArray | null
    while ((match = ctePattern.exec(sanitizedSql)) !== null) {
      const normalizedName = this.normalizeSqlIdentifier(match[1])

      if (normalizedName) {
        cteNames.add(normalizedName)
      }
    }

    return cteNames
  }

  private buildCatalogTableNameIndex(activeCatalog: SchemaCatalogEntry): Map<string, Set<string>> {
    const index = new Map<string, Set<string>>()

    for (const table of activeCatalog.tables) {
      const tableName = table.tableName.trim().toLowerCase()
      const schemaTableRef = this.normalizeTableRef(`${table.schemaName}.${table.tableName}`)

      if (!tableName || !schemaTableRef) {
        continue
      }

      const bucket = index.get(tableName)

      if (bucket) {
        bucket.add(schemaTableRef)
      } else {
        index.set(tableName, new Set([schemaTableRef]))
      }
    }

    return index
  }

  private extractReferencedTableRefs(sqlQuery: string): ExtractedTableReference[] {
    const sanitizedSql = this.stripSqlCommentsAndLiterals(sqlQuery)
    const pattern =
      /\b(?:FROM|JOIN|APPLY)\s+((?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[A-Z0-9_#@]+)(?:\s*\.\s*(?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[A-Z0-9_#@]+)){0,3})/gi
    const tableRefs: ExtractedTableReference[] = []

    let match: RegExpExecArray | null
    while ((match = pattern.exec(sanitizedSql)) !== null) {
      const parsed = this.parseSqlTableReference(match[1])

      if (parsed) {
        tableRefs.push(parsed)
      }
    }

    return tableRefs
  }

  private parseSqlTableReference(rawRef: string): ExtractedTableReference | null {
    const segments = this.splitSqlIdentifierParts(rawRef)
      .map((segment) => this.normalizeSqlIdentifier(segment))
      .filter(Boolean)

    if (segments.length === 0) {
      return null
    }

    const tableName = segments[segments.length - 1]
    const schemaName = segments.length >= 2 ? segments[segments.length - 2] : null
    const databaseName = segments.length >= 3 ? segments[segments.length - 3] : null
    const serverName = segments.length >= 4 ? segments[segments.length - 4] : null
    const schemaTable =
      schemaName ? `${schemaName}.${segments[segments.length - 1]}` : null

    return {
      raw: rawRef.trim(),
      schemaTable,
      schemaName,
      databaseName,
      serverName,
      tableName,
      partCount: segments.length
    }
  }

  private splitSqlIdentifierParts(rawRef: string): string[] {
    const parts: string[] = []
    let current = ''
    let mode: 'normal' | 'bracket' | 'doubleQuote' | 'backtick' = 'normal'

    for (let index = 0; index < rawRef.length; index += 1) {
      const char = rawRef[index]

      if (mode === 'normal') {
        if (char === '.') {
          if (current.trim()) {
            parts.push(current.trim())
          }

          current = ''
          continue
        }

        if (char === '[') {
          mode = 'bracket'
          current += char
          continue
        }

        if (char === '"') {
          mode = 'doubleQuote'
          current += char
          continue
        }

        if (char === '`') {
          mode = 'backtick'
          current += char
          continue
        }

        current += char
        continue
      }

      current += char

      if (mode === 'bracket' && char === ']') {
        if (index + 1 < rawRef.length && rawRef[index + 1] === ']') {
          current += rawRef[index + 1]
          index += 1
        } else {
          mode = 'normal'
        }

        continue
      }

      if (mode === 'doubleQuote' && char === '"') {
        if (index + 1 < rawRef.length && rawRef[index + 1] === '"') {
          current += rawRef[index + 1]
          index += 1
        } else {
          mode = 'normal'
        }

        continue
      }

      if (mode === 'backtick' && char === '`') {
        mode = 'normal'
      }
    }

    if (current.trim()) {
      parts.push(current.trim())
    }

    return parts
  }

  private normalizeSqlIdentifier(value: string): string {
    const trimmed = value.trim()

    if (!trimmed) {
      return ''
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      return trimmed.slice(1, -1).replace(/]]/g, ']').trim().toLowerCase()
    }

    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1).replace(/""/g, '"').trim().toLowerCase()
    }

    if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
      return trimmed.slice(1, -1).trim().toLowerCase()
    }

    return trimmed.toLowerCase()
  }

  private stripSqlCommentsAndLiterals(sql: string): string {
    return this.stripSqlComments(sql)
      .replace(/N?'(?:''|[^'])*'/g, "''")
      .replace(/"(?:""|[^"])*"/g, '""')
  }

  private stripSqlComments(sql: string): string {
    return sql
      .replace(/--.*$/gm, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
  }

  private limitRowsForModel(rows: SqlQueryRow[]): LimitedRowsForModelResult {
    const limitedRows: SqlQueryRow[] = []
    let payloadSize = 2
    let payloadTruncated = false
    let valueTruncatedCells = 0

    for (const row of rows) {
      const normalizedRow: SqlQueryRow = {}

      for (const [columnName, value] of Object.entries(row)) {
        if (typeof value === 'string' && value.length > MAX_TOOL_VALUE_CHARS) {
          normalizedRow[columnName] = `${value.slice(0, MAX_TOOL_VALUE_CHARS - 1)}…`
          valueTruncatedCells += 1
          continue
        }

        normalizedRow[columnName] = value
      }

      const serializedRow = JSON.stringify(normalizedRow)
      const projectedPayloadSize = payloadSize + (limitedRows.length > 0 ? 1 : 0) + serializedRow.length

      if (projectedPayloadSize > MAX_TOOL_PAYLOAD_CHARS) {
        payloadTruncated = true
        break
      }

      limitedRows.push(normalizedRow)
      payloadSize = projectedPayloadSize
    }

    return {
      rows: limitedRows,
      payloadTruncated,
      valueTruncatedCells
    }
  }

  private redactSensitiveIdentifiers(rows: SqlQueryRow[]): RedactedRowsResult {
    let redactedCells = 0

    const sanitizedRows = rows.map((row) => {
      const sanitizedRow: SqlQueryRow = {}

      for (const [columnName, value] of Object.entries(row)) {
        if (this.isSensitiveIdentifierField(columnName) && value !== null && value !== undefined && `${value}`.trim()) {
          sanitizedRow[columnName] = '[REDACTED]'
          redactedCells += 1
          continue
        }

        sanitizedRow[columnName] = value
      }

      return sanitizedRow
    })

    return {
      rows: sanitizedRows,
      redactedCells
    }
  }

  private isSensitiveIdentifierField(columnName: string): boolean {
    const normalized = columnName.toLowerCase().replace(/[\s_.-]/g, '')

    if (SENSITIVE_IDENTIFIER_FIELD_TOKENS.some((token) => normalized.includes(token))) {
      return true
    }

    const normalizedFa = columnName.replace(/[\s_.-]/g, '')
    return SENSITIVE_IDENTIFIER_FIELD_TOKENS_FA.some((token) => normalizedFa.includes(token))
  }

  private buildCatalogScanQuery(tablePattern: string | null, limit: number): string {
    const normalizedPattern = normalizeTablePattern(tablePattern)
    const patternFilter = normalizedPattern
      ? `AND LOWER(t.TABLE_NAME) LIKE LOWER(N'${escapeSqlStringLiteral(normalizedPattern)}')`
      : ''

    // NOTE: column previews are intentionally omitted. The classic STUFF(... FOR XML PATH ...)
    // concatenation is rejected by the read-only SQL policy (SQL_POLICY_FORBIDDEN_EXPORT_CLAUSE),
    // and STRING_AGG is unavailable on legacy Sepidar SQL Server (2008 R2). Column details are
    // available on demand via get_database_schema, so catalog_scan only returns table identity + size.
    return `SELECT TOP (${Math.max(1, Math.min(limit, 24))})
  t.TABLE_SCHEMA,
  t.TABLE_NAME,
  CAST(COALESCE(SUM(p.rows), 0) AS bigint) AS estimated_row_count
FROM INFORMATION_SCHEMA.TABLES t
LEFT JOIN sys.partitions p
  ON p.object_id = OBJECT_ID(QUOTENAME(t.TABLE_SCHEMA) + '.' + QUOTENAME(t.TABLE_NAME))
 AND p.index_id IN (0, 1)
WHERE t.TABLE_TYPE = 'BASE TABLE'
  ${patternFilter}
  AND t.TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA', 'sys')
GROUP BY t.TABLE_SCHEMA, t.TABLE_NAME
ORDER BY estimated_row_count DESC, t.TABLE_SCHEMA, t.TABLE_NAME`
  }

  private buildListDatabaseTablesQuery(tablePattern: string | null): string {
    const normalizedPattern = normalizeTablePattern(tablePattern)
    const patternFilter = normalizedPattern
      ? `\n  AND LOWER(TABLE_NAME) LIKE LOWER(N'${escapeSqlStringLiteral(normalizedPattern)}')`
      : ''

    return `SELECT TOP (${MAX_TABLE_LIST_ROWS}) TABLE_SCHEMA, TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'${patternFilter}
ORDER BY TABLE_SCHEMA, TABLE_NAME`
  }

  private buildDatabaseSchemaQuery(tableName: string, schemaName: string | null): string {
    return buildDatabaseSchemaQuery(tableName, schemaName, MAX_SCHEMA_ROWS)
  }
}
