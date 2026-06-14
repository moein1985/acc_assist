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
  detectFinancialIntent,
  detectSalesKpiContractCandidates,
  listFinancialIntentDefinitions,
  type FinancialIntentId
} from './financialIntentRegistry'
import { SqlPolicyViolationError } from './sqlConnectionManager'

const FINANCIAL_SCHEMA_GUIDE = [
  'Database schema context (logical map; verify actual tables and columns before final SELECT):',
  '- Accounts / Chart of Accounts: account_id, account_code (کل/معین/تفضیلی), account_name, account_type, parent_account_id, is_active',
  '- Documents / Voucher Headers: document_id, document_no, document_date, fiscal_year, branch_id, status',
  '- Ledger / Journal Lines: line_id, document_id, account_id, debit_amount, credit_amount, line_description, cost_center_id',
  '- Transactions / Cashflow: transaction_id, transaction_date, amount, direction, account_id, counterparty_id, reference_no',
  '- Parties / Counterparties: party_id, party_code, party_name, category, national_id',
  '- Optional dimensions: project_id, cost_center_id, currency_code, exchange_rate, tax_amount',
  'Date and type handling policy:',
  '- Always identify if dates are Gregorian (DATE/DATETIME) or Shamsi/Persian text values before filtering.',
  '- For Shamsi text dates (e.g. 1403/01/15), keep format-consistent comparisons and avoid unsafe casts.',
  '- For Gregorian datetime columns, use precise range predicates and explicit ORDER BY.',
  '- Validate numeric/text code types (especially account codes) before joins or predicates.'
].join('\n')

const RESPONSE_POLICY_GUIDE = [
  'Tool usage and reporting policy:',
  '- Always use tools when data is required. Never invent rows, totals, or schema fields.',
  '- The financial schema map is a logical guide, not a guaranteed physical schema for every customer database.',
  '- Discovery strategy for unknown databases: Step 1) call list_database_tables, Step 2) call get_database_schema, Step 3) write final SELECT with fetch_financial_data.',
  '- Tool-call budget: maximum 4 tool calls per round and maximum 12 tool calls per request.',
  '- For fetch_financial_data, use in-scope financial catalog tables from current database only; cross-database/server references are blocked.',
  '- If unsure about columns or table names, never guess; discover metadata with tools first.',
  '- If the user specifies multiple companies/fiscal years/branches, preserve all scopes in SQL filters and keep scope labels visible in the output.',
  '- Analyze tool responses carefully before writing conclusions or recommendations.',
  '- Sensitive identifiers (national ID, mobile, account/card/IBAN values) may be redacted in tool outputs for privacy.',
  '- Return final answers in clean Markdown with sections: Summary, Findings, Evidence, Actions.',
  '- When trend data exists, include a compact text chart (ASCII) plus a short interpretation.',
  '- Explicitly state assumptions about date format, account-code level, and currency.'
].join('\n')

const SYSTEM_PROMPT = [
  'You are ACC Assist, an enterprise financial analyst assistant specialized in SQL Server financial databases.',
  'You can use these tools: list_database_tables(table_pattern?), get_database_schema(table_name, schema_name?), and fetch_financial_data(sql_query).',
  'Use only read-only SELECT/CTE SELECT queries. Never request UPDATE/DELETE/INSERT/DDL statements.',
  'Treat FINANCIAL_SCHEMA_GUIDE as a logical reference only; real table names may differ across databases.',
  'If the database is unknown, follow this strategy strictly: Step 1 list_database_tables, Step 2 get_database_schema, Step 3 fetch_financial_data.',
  'Before generating SQL, reason about data types, date calendar format (Shamsi vs Gregorian), and account code hierarchy.',
  FINANCIAL_SCHEMA_GUIDE,
  RESPONSE_POLICY_GUIDE
].join('\n\n')

const MAX_TOOL_CALL_ROUNDS = 8
const MAX_TOOL_CALLS_PER_ROUND = 4
const MAX_TOTAL_TOOL_CALLS = 15
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

const PROMPT_INTENT_SYNONYMS: Record<AccountingConceptKey, RegExp[]> = {
  accounts: [/حساب/iu, /سرفصل/iu, /معین/iu, /تفضیلی/iu, /\baccount(s)?\b/i, /\bledger\b/i],
  documents: [/سند/iu, /دفتر\s*روزنامه/iu, /\bdocument(s)?\b/i, /\bvoucher(s)?\b/i, /\bjournal\b/i],
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

type DeterministicFinancialIntent = Extract<
  FinancialIntentId,
  | 'count_fiscal_years'
  | 'list_fiscal_years'
  | 'get_party_balance'
  | 'get_account_balance'
  | 'get_account_turnover'
  | 'get_sales_summary_by_period'
  | 'get_receivables_summary'
  | 'get_payables_summary'
  | 'get_cashflow_summary'
>

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
  private readonly mobileBridge?: AgentOrchestratorDeps['mobileBridge']
  private readonly activeExecutions = new Map<string, ActiveAgentExecution>()
  private readonly conversationMemoryById = new Map<string, ConversationMemoryState>()
  private readonly schemaCacheByTableKey = new Map<string, { schema: SchemaColumnCatalogItem[]; timestamp: number }>()
  private readonly SCHEMA_CACHE_TTL_MS = 60000

  constructor(deps: AgentOrchestratorDeps) {
    this.geminiClient = deps.geminiClient
    this.getSettings = deps.getSettings
    this.executeReadOnlySql = deps.executeReadOnlySql
    this.executeMetadataSql = deps.executeMetadataSql
    this.auditLog = deps.auditLog
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
      const deterministicIntent =
        payload.mode === 'dry-run' ? null : this.detectDeterministicFinancialIntent(prompt)
      const deterministicFiscalIntent =
        deterministicIntent && ['count_fiscal_years', 'list_fiscal_years'].includes(deterministicIntent)
          ? deterministicIntent
          : null
      const deterministicToolIntent =
        deterministicIntent &&
        ['get_account_balance', 'get_party_balance', 'get_cashflow_summary', 'get_receivables_summary', 'get_payables_summary'].includes(
          deterministicIntent
        )
          ? deterministicIntent
          : null
      const deterministicNonFiscalIntent = deterministicIntent && !deterministicFiscalIntent && !deterministicToolIntent
        ? deterministicIntent
        : null

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
          onProgress
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

        const response = await this.geminiClient.chat(
          {
            messages: [{ role: 'system', content: runtimeSystemPrompt }, ...workingHistory],
            temperature: 0.2,
            tools: FINANCIAL_TOOLS
          },
          settings.gemini,
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
            signal: execution.abortController.signal
          }
        )

        this.throwIfRequestCanceled(execution.abortController.signal)

        const toolCalls = this.extractToolCallsFromResponse(response)

        if (toolCalls.length > MAX_TOOL_CALLS_PER_ROUND) {
          throw this.createAgentPolicyError(
            'AGENT_TOOL_CALLS_PER_ROUND_EXCEEDED',
            `Tool-call budget exceeded: this round requested ${toolCalls.length} calls (max ${MAX_TOOL_CALLS_PER_ROUND}).`
          )
        }

        const projectedTotalToolCalls = totalToolCallCount + toolCalls.length

        if (projectedTotalToolCalls > MAX_TOTAL_TOOL_CALLS) {
          throw this.createAgentPolicyError(
            'AGENT_TOTAL_TOOL_CALLS_EXCEEDED',
            `Tool-call budget exceeded: total requested ${projectedTotalToolCalls} calls (max ${MAX_TOTAL_TOOL_CALLS}).`
          )
        }

        if (toolCalls.length === 0) {
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
                round: round + 1
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
          const finalText = this.finalizeFinancialResponse(
            prompt,
            rawFinalText,
            conversationMemory,
            totalToolCallCount,
            totalSuccessfulDataFetches,
            'model-assisted'
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
            round: round + 1
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
          round: round + 1,
          toolCalls,
          settings,
          conversationMemory,
          onProgress,
          abortSignal: execution.abortController.signal
        })

        totalToolCallCount = projectedTotalToolCalls
        totalSuccessfulDataFetches += toolExecution.successfulDataFetches

        workingHistory = this.compactHistory([...workingHistory, ...toolExecution.toolMessages], conversationMemory)
      }

      throw new Error('Tool-call loop exceeded limit. Try a simpler question or narrower date range.')
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
    round: number
    toolCalls: GeminiToolCall[]
    settings: AppSettings
    conversationMemory: ConversationMemoryState
    onProgress?: (event: AgentProgressEvent) => void
    abortSignal: AbortSignal
  }): Promise<{ toolMessages: GeminiMessage[]; successfulDataFetches: number }> {
    const { requestId, round, toolCalls, settings, conversationMemory, onProgress, abortSignal } = params
    const toolMessages: GeminiMessage[] = []
    let successfulDataFetches = 0

    for (const toolCall of toolCalls) {
      this.throwIfRequestCanceled(abortSignal)

      const toolName = toolCall.function.name
      const args = this.parseToolArguments(toolCall.function.arguments)
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
        if (toolName === 'list_database_tables') {
          const tablePattern = this.readOptionalStringArg(args, 'table_pattern', 256)
          const sqlQuery = this.buildListDatabaseTablesQuery(tablePattern)
          const rows = await this.executeMetadataSql(sqlQuery, abortSignal)
          this.throwIfRequestCanceled(abortSignal)
          this.rememberToolTrace(
            conversationMemory,
            `list_database_tables rows=${rows.length} pattern=${tablePattern ?? '*'}`
          )
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
          const sqlQuery = this.readRequiredStringArg(args, 'sql_query', 16000)
          this.ensureFinancialQueryAllowed(sqlQuery, settings, conversationMemory)
          const rows = await this.executeReadOnlySql(sqlQuery, abortSignal)
          successfulDataFetches += 1
          this.throwIfRequestCanceled(abortSignal)
          this.rememberToolTrace(
            conversationMemory,
            `fetch_financial_data rows=${rows.length} sql=${this.compactText(sqlQuery.replace(/\s+/g, ' '), 180)}`
          )
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
            sqlQuery,
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
          const tableName = this.readRequiredStringArg(args, 'table_name', 128)
          const schemaName = this.readOptionalStringArg(args, 'schema_name', 128)
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
          const rows = await this.executeMetadataSql(sqlQuery, abortSignal)
          this.throwIfRequestCanceled(abortSignal)
          
          // Cache the schema columns for this table
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
      successfulDataFetches
    }
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
    return value
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
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
      const preferredMapping = this.resolvePreferredMapping(activeCatalog, conceptKey)

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
    const salesKpiClarification = this.buildSalesKpiClarificationResponseIfNeeded(prompt)

    if (salesKpiClarification) {
      return salesKpiClarification
    }

    const detectedConcepts = this.detectPromptConcepts(prompt)

    if (detectedConcepts.length === 0) {
      return null
    }

    const activeCatalog = this.findActiveSchemaCatalog(settings)

    if (!activeCatalog) {
      return null
    }

    const missingConceptMappings = detectedConcepts.filter(
      (conceptKey) => !this.resolvePreferredMapping(activeCatalog, conceptKey)
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
    conceptKey: AccountingConceptKey
  ): PreferredMapping | null {
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
    const normalizedPrompt = this.normalizePersianDigits(prompt)
      .normalize('NFKC')
      .replace(/[\u064a\u0649]/g, 'ی')
      .replace(/[\u0643]/g, 'ک')
      .replace(/\u200c/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const compactPrompt = normalizedPrompt.replace(/\s+/g, '')

    // Fast path for frequent fiscal-year intents so we do not fall back to generic schema-exploration loops.
    if (/(?:تعداد|چند)\s*سال\s*مالی|سال\s*مالی\s*(?:چند|تعداد)|how\s+many\s+fiscal\s+years?|fiscal\s+year\s+count/iu.test(normalizedPrompt)) {
      return 'count_fiscal_years'
    }

    if (
      /(سال\s*مالی|fiscal\s*year)/iu.test(normalizedPrompt) &&
      /(?:چند|تعداد|وجود|count|how\s+many)/iu.test(normalizedPrompt)
    ) {
      return 'count_fiscal_years'
    }

    if (
      /(سالمالی|fiscalyear)/iu.test(compactPrompt) &&
      /(?:چند|تعداد|وجود|count|howmany)/iu.test(compactPrompt)
    ) {
      return 'count_fiscal_years'
    }

    if (/(?:لیست|فهرست|نمایش)\s*(?:سال(?:\s|\u200c)?های?|سال)\s*مالی|سال(?:\s|\u200c)?های?\s*مالی\s*را\s*(?:لیست|فهرست|نمایش)|list\s+(?:the\s+)?(?:available\s+)?fiscal\s+years?/iu.test(normalizedPrompt)) {
      return 'list_fiscal_years'
    }

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

  private isSalesGrowthPercentPrompt(prompt: string): boolean {
    const normalizedPrompt = this.normalizePersianDigits(prompt)
      .normalize('NFKC')
      .replace(/[\u064a\u0649]/g, 'ی')
      .replace(/[\u0643]/g, 'ک')
      .replace(/\u200c/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const hasSalesSignal = /(?:فروش|sales|revenue)/iu.test(normalizedPrompt)
    const hasPercentSignal = /(?:درصد|percent|percentage|%)/iu.test(normalizedPrompt)
    const hasChangeSignal = /(?:رشد|کاهش|افزایش|افت|change|growth|decline|نسبت\s*به|مقایسه)/iu.test(normalizedPrompt)
    const yearMatches = normalizedPrompt.match(/\b(?:13|14|19|20)\d{2}\b/g) ?? []

    return hasSalesSignal && hasPercentSignal && hasChangeSignal && yearMatches.length >= 2
  }

  private extractYearComparison(prompt: string): { targetYear: number; baseYear: number } | null {
    const normalizedPrompt = this.normalizePersianDigits(prompt)
      .normalize('NFKC')
      .replace(/[\u064a\u0649]/g, 'ی')
      .replace(/[\u0643]/g, 'ک')
      .replace(/\u200c/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

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
    onProgress?: (event: AgentProgressEvent) => void
  ): Promise<DeterministicFinancialToolResult | null> {
    const activeCatalog = this.findActiveSchemaCatalog(settings)

    if (!activeCatalog) {
      return null
    }

    const conceptKey =
      deterministicIntent === 'get_account_balance'
        ? 'accounts'
        : deterministicIntent === 'get_party_balance'
          ? 'counterparties'
          : deterministicIntent === 'get_cashflow_summary'
            ? 'cashTransactions'
            : deterministicIntent === 'get_receivables_summary' || deterministicIntent === 'get_payables_summary'
              ? 'documents'
              : 'documents'
    const mapping = this.resolvePreferredMapping(activeCatalog, conceptKey)

    if (!mapping) {
      return null
    }

    const tableRef = this.parseSqlTableReference(mapping.tableRef)

    if (!tableRef?.schemaName || !tableRef.tableName) {
      return null
    }

    const schemaName = tableRef.schemaName.trim().toLowerCase()
    const tableName = tableRef.tableName.trim().toLowerCase()

    const catalogTable = activeCatalog.tables.find((entry) => {
      return (
        entry.schemaName.trim().toLowerCase() === schemaName &&
        entry.tableName.trim().toLowerCase() === tableName
      )
    })

    const candidateColumns = (catalogTable?.columns ?? []).filter((column) => {
      const columnName = column.name.toLowerCase()
      const dataType = column.dataType.toLowerCase()
      return /(?:amount|balance|debit|credit|total|sum|net|value)/iu.test(columnName) && /(?:int|decimal|numeric|money|float|real)/iu.test(dataType)
    })

    const column = this.selectDeterministicToolColumn(deterministicIntent, candidateColumns) ?? catalogTable?.columns[0]

    if (!column) {
      return null
    }

    const schemaIdentifier = this.quoteSqlIdentifier(schemaName)
    const tableIdentifier = this.quoteSqlIdentifier(tableName)
    const columnIdentifier = this.quoteSqlIdentifier(column.name)
    const query = `SELECT SUM(CAST(${columnIdentifier} AS decimal(18,2))) AS result_value FROM ${schemaIdentifier}.${tableIdentifier}`

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
        toolCallsUsed: 1
      }
    } catch {
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
          : deterministicIntent === 'get_receivables_summary'
            ? 'خلاصه بدهکاران'
            : deterministicIntent === 'get_payables_summary'
              ? 'خلاصه بستانکاران'
              : 'خلاصه جریان نقد'

    return [
      '### Summary',
      `${label} بر اساس داده‌های read-only و mapping schema محاسبه شد: ${result.value ?? 'نامشخص'} (نوع KPI: ${label})`,
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
      '- از mapping انتخاب‌شده schema و ستون عددی قابل‌محاسبه استفاده شد؛ در صورت تفاوت نام ستون، نتیجه ممکن است محدود شود.',
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
    routeMode: 'deterministic' | 'model-assisted' | 'clarification' = 'model-assisted'
  ): string {
    const templatedText = this.ensureFinancialResponseTemplate(rawText, conversationMemory, totalToolCallCount)
    const alignedText = this.enforcePromptIntentAlignment(prompt, templatedText)
    const routedText = this.annotateManagerUx(alignedText, routeMode)
    return this.enforceEvidenceFirstContract(
      prompt,
      routedText,
      totalToolCallCount,
      successfulDataFetchCount
    )
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
    successfulDataFetchCount: number
  ): string {
    const normalizedText = this.normalizePersianDigits(finalText)

    if (/cannot\s+answer\s+reliably/iu.test(normalizedText)) {
      return finalText
    }

    const isClarificationOnlyResponse =
      /برای\s+پاسخ\s+دقیق|برای\s+جلوگیری\s+از\s+حدس\s+زدن|برای\s+جلوگیری\s+از\s+تحلیل\s+اشتباه|لطفا\s+یکی\s+از\s+این\s+گزینه‌ها|سال\s+مالی\s+دقیق|تاریخ\s+شروع\s+و\s+پایان/i.test(
        normalizedText
      )

    if (isClarificationOnlyResponse) {
      return finalText
    }

    const sections = this.parseFinancialTemplateSections(finalText)
    const narrative = `${sections.summary}\n${sections.findings}`.trim()
    const evidence = sections.evidence
    const appearsFinancialClaim = this.appearsToContainFinancialClaim(narrative)
    const hasRequiredContractSections = this.hasRequiredFinancialResponseSections(sections)
    const hasStructuredEvidence = this.hasStructuredEvidence(evidence)
    const requiresStrictQuantResult = this.requiresStrictQuantitativeDataFetch(prompt)
    const hasQuantitativeResult = this.hasQuantitativeResultSignal(narrative)
    const statesNoData = this.appearsToBeNoDataResult(narrative)

    if (appearsFinancialClaim && !hasRequiredContractSections) {
      return this.buildEvidenceContractFailureResponse(
        'پاسخ مالی فاقد بلوک‌های قرارداد استاندارد Summary/Findings/Evidence/Assumptions/Actions بود.',
        prompt
      )
    }

    if (totalToolCallCount === 0 && appearsFinancialClaim) {
      return this.buildEvidenceContractFailureResponse(
        'پاسخ مالی عددی بدون اجرای ابزار read-only تولید شد و قابل اتکا نیست.',
        prompt
      )
    }

    if (totalToolCallCount > 0 && !hasStructuredEvidence) {
      return this.buildEvidenceContractFailureResponse(
        'پاسخ مالی فاقد شواهد ساخت یافته کافی (ابزار/کوئری/جدول/ردیف) بود.',
        prompt
      )
    }

    if (requiresStrictQuantResult && successfulDataFetchCount === 0) {
      return this.buildEvidenceContractFailureResponse(
        'برای سوال درصد رشد/کاهش، پاسخ نهایی بدون اجرای موفق fetch_financial_data مجاز نیست.',
        prompt
      )
    }

    if (requiresStrictQuantResult && !hasQuantitativeResult && !statesNoData) {
      return this.buildEvidenceContractFailureResponse(
        'برای سوال درصد رشد/کاهش، پاسخ نهایی باید عدد درصد معتبر (+x% یا -x%) یا پیام صریح نبود داده داشته باشد.',
        prompt
      )
    }

    return finalText
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

    return /(?:داده(?:\s*ای)?\s*یافت\s*نشد|بدون\s*داده|اطلاعات\s*کافی\s*وجود\s*ندارد|no\s*data|insufficient\s*data)/iu.test(
      normalized
    )
  }

  private appearsToContainFinancialClaim(text: string): boolean {
    const normalized = this.normalizePersianDigits(text)
    const hasFinancialSignal =
      /(?:total|amount|balance|sales|revenue|cash\s*flow|receivable|payable|debit|credit|مانده|مبلغ|فروش|درآمد|دریافت|پرداخت|جمع|گردش|بدهکار|بستانکار)/iu.test(
        normalized
      )

    return hasFinancialSignal
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

    return /(?:query|tool|read-only|table|column|row|runtime\s*scope|fetch_financial_data|count_fiscal_years|list_fiscal_years|کوئری|ابزار|جدول|ستون|ردیف|شواهد|شاهد)/iu.test(
      normalized
    )
  }

  private buildEvidenceContractFailureResponse(reason: string, prompt: string): string {
    return [
      '### Summary',
      'Cannot answer reliably: پاسخ مالی بدون شواهد کافی مجاز نیست.',
      '',
      '### Findings',
      `- دلیل ساده: ${reason}`,
      '',
      '### Evidence',
      '- Evidence-first contract فعال شد و از ارائه پاسخ مالی غیرقابل اتکا جلوگیری کرد.',
      '',
      '### Assumptions',
      '- پاسخ رد شده به دلیل فقدان شواهد ساخت یافته و/یا ابزار read-only قابل اتکا متوقف شد.',
      '',
      '### Actions',
      `- اقدام بعدی: سوال را با scope دقیق‌تر تکرار کنید: ${this.compactText(prompt, 180)}`,
      '- اگر داده‌ای وجود ندارد، بازه زمانی/سال مالی/شرکت/شعبه را مشخص کنید تا ابزارها بتوانند پاسخ قابل اتکا تولید کنند.'
    ].join('\n')
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

  private buildListDatabaseTablesQuery(tablePattern: string | null): string {
    const normalizedPattern = this.normalizeTablePattern(tablePattern)
    const patternFilter = normalizedPattern
      ? `\n  AND TABLE_NAME LIKE N'${this.escapeSqlStringLiteral(normalizedPattern)}'`
      : ''

    return `SELECT TOP (${MAX_TABLE_LIST_ROWS}) TABLE_SCHEMA, TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'${patternFilter}
ORDER BY TABLE_SCHEMA, TABLE_NAME`
  }

  private buildDatabaseSchemaQuery(tableName: string, schemaName: string | null): string {
    const tableValue = this.escapeSqlStringLiteral(tableName)
    const schemaFilter = schemaName
      ? `  AND c.TABLE_SCHEMA = N'${this.escapeSqlStringLiteral(schemaName)}'\n`
      : ''

    return `SELECT TOP (${MAX_SCHEMA_ROWS})
  c.TABLE_SCHEMA AS table_schema,
  c.TABLE_NAME AS table_name,
  c.ORDINAL_POSITION AS ordinal_position,
  c.COLUMN_NAME AS column_name,
  c.DATA_TYPE AS data_type,
  c.CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
  c.NUMERIC_PRECISION AS numeric_precision,
  c.NUMERIC_SCALE AS numeric_scale,
  c.DATETIME_PRECISION AS datetime_precision,
  c.IS_NULLABLE AS is_nullable,
  COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS is_identity
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_NAME = N'${tableValue}'
${schemaFilter}ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`
  }

  private escapeSqlStringLiteral(value: string): string {
    return value.replace(/'/g, "''")
  }

  private normalizeTablePattern(value: string | null): string | null {
    if (!value) {
      return null
    }

    return value.replace(/\*/g, '%')
  }

  private readRequiredStringArg(args: Record<string, unknown>, key: string, maxLength: number): string {
    const value = args[key]

    if (typeof value !== 'string') {
      throw new Error(`Missing required argument: ${key}`)
    }

    const trimmed = value.trim()
    if (!trimmed) {
      throw new Error(`Missing required argument: ${key}`)
    }

    if (trimmed.length > maxLength) {
      throw new Error(`Argument ${key} exceeds max length (${maxLength}).`)
    }

    return trimmed
  }

  private readOptionalStringArg(args: Record<string, unknown>, key: string, maxLength: number): string | null {
    const value = args[key]

    if (value === undefined || value === null) {
      return null
    }

    if (typeof value !== 'string') {
      throw new Error(`Argument ${key} must be a string when provided.`)
    }

    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }

    if (trimmed.length > maxLength) {
      throw new Error(`Argument ${key} exceeds max length (${maxLength}).`)
    }

    return trimmed
  }

  private parseToolArguments(argumentText: string): Record<string, unknown> {
    if (!argumentText.trim()) {
      return {}
    }

    try {
      const parsed = JSON.parse(argumentText) as unknown

      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>
      }

      return {}
    } catch {
      return {}
    }
  }
}
