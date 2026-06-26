/**
 * Tool execution logic extracted from `agentOrchestrator.ts` (FRE Roadmap F2.6).
 */
import type {
  AgentEvidencePreview,
  AgentProgressEvent,
  AppSettings,
  GeminiMessage,
  GeminiToolCall,
  SchemaColumnCatalogItem,
  SqlQueryRow
} from '../../../shared/contracts'
import type { AuditLogEntry } from '../auditLogService'
import type { ToolEvidence } from '../evidenceContract'
import type { ConversationMemoryState } from './conversationMemory'
import type { LimitedRowsForModelResult, RedactedRowsResult } from './rowUtils'
import {
  parseToolArguments,
  readOptionalNumberArg,
  readOptionalStringArg,
  readRequiredStringArg
} from '../agentToolArgumentUtils'
import { detectUnsupportedSqlFunctions } from '../sqlPolicyValidator'

export interface ToolExecutionDeps {
  throwIfRequestCanceled: (signal: AbortSignal) => void
  buildPendingToolStatusText: (toolName: string, args: Record<string, unknown>) => string
  emitProgress: (
    onProgress: ((event: AgentProgressEvent) => void) | undefined,
    event: AgentProgressEvent
  ) => void
  safeAuditWrite: (entry: AuditLogEntry) => Promise<void>
  buildCatalogScanQuery: (tablePattern: string | null, limit: number) => string
  executeMetadataSql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  rememberToolTrace: (memory: ConversationMemoryState, trace: string) => void
  limitRowsForModel: (rows: SqlQueryRow[]) => LimitedRowsForModelResult
  createToolResponseMessage: (
    toolCall: GeminiToolCall,
    data: Record<string, unknown>
  ) => GeminiMessage
  buildListDatabaseTablesQuery: (tablePattern: string | null) => string
  fetchTableListCached: (
    tablePattern: string | null,
    sqlQuery: string,
    abortSignal: AbortSignal
  ) => Promise<SqlQueryRow[]>
  compactText: (value: string, maxLength: number) => string
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
  createAgentPolicyError: (
    code: string,
    message: string
  ) => Error & { code: string; category: string }
  prevalidateFinancialQuery: (sqlQuery: string, settings: AppSettings) => string
  ensureFinancialQueryAllowed: (
    sqlQuery: string,
    settings: AppSettings,
    conversationMemory?: ConversationMemoryState
  ) => void
  executeReadOnlySql: (query: string, signal?: AbortSignal) => Promise<SqlQueryRow[]>
  rowsContainNonNullValue: (rows: SqlQueryRow[]) => boolean
  redactSensitiveIdentifiers: (rows: SqlQueryRow[]) => RedactedRowsResult
  createEvidencePreview: (
    sqlQuery: string,
    rows: SqlQueryRow[],
    rowCount: number,
    truncated: boolean
  ) => AgentEvidencePreview
  buildDatabaseSchemaQuery: (tableName: string, schemaName: string | null) => string
  getCachedSchemaSnapshot: (
    cacheKey: string,
    sqlQuery: string,
    abortSignal: AbortSignal
  ) => Promise<{ rows: SqlQueryRow[] }>
  isCancellationLikeError: (error: unknown) => boolean
  resolveCancellationError: (error: unknown, signal: AbortSignal) => Error
  toErrorInfo: (error: unknown) => { message: string; code?: string; category?: string }
  schemaCacheByTableKey: Map<string, { schema: SchemaColumnCatalogItem[]; timestamp: number }>
  SCHEMA_CACHE_TTL_MS: number
}

export interface ToolExecutionParams {
  requestId: string
  conversationId: string
  round: number
  toolCalls: GeminiToolCall[]
  settings: AppSettings
  conversationMemory: ConversationMemoryState
  onProgress?: (event: AgentProgressEvent) => void
  abortSignal: AbortSignal
}

export interface ToolExecutionResult {
  toolMessages: GeminiMessage[]
  successfulDataFetches: number
  evidence: ToolEvidence[]
}

export const MAX_TABLE_LIST_ROWS = 500
export const MAX_TOOL_ROWS = 120
export const MAX_SCHEMA_ROWS = 240

export async function executeFinancialToolCalls(
  deps: ToolExecutionDeps,
  params: ToolExecutionParams
): Promise<ToolExecutionResult> {
  const {
    requestId,
    conversationId,
    round,
    toolCalls,
    settings,
    conversationMemory,
    onProgress,
    abortSignal
  } = params
  const toolMessages: GeminiMessage[] = []
  const evidence: ToolEvidence[] = []
  let successfulDataFetches = 0

  for (const toolCall of toolCalls) {
    deps.throwIfRequestCanceled(abortSignal)

    const toolName = toolCall.function.name
    const args = parseToolArguments(toolCall.function.arguments)
    const pendingMessage = deps.buildPendingToolStatusText(toolName, args)

    deps.emitProgress(onProgress, {
      type: 'tool-start',
      message: pendingMessage,
      toolName,
      toolCallId: toolCall.id,
      args
    })

    await deps.safeAuditWrite({
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
        const sqlQuery = deps.buildCatalogScanQuery(tablePattern, limit)
        const rows = await deps.executeMetadataSql(sqlQuery, abortSignal)
        deps.throwIfRequestCanceled(abortSignal)
        deps.rememberToolTrace(
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
        const limitedRows = deps.limitRowsForModel(boundedRows)

        deps.emitProgress(onProgress, {
          type: 'tool-success',
          message: `✅ فهرست کاندیدهای کشف‌شده با ${rows.length} جدول بازگردانده شد.`,
          toolName,
          toolCallId: toolCall.id,
          args,
          rowCount: rows.length
        })

        await deps.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          stage: 'tool-success',
          toolName,
          sqlQuery,
          rowCount: rows.length,
          round
        })

        toolMessages.push(
          deps.createToolResponseMessage(toolCall, {
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
        const sqlQuery = deps.buildListDatabaseTablesQuery(tablePattern)
        const rows = await deps.fetchTableListCached(tablePattern, sqlQuery, abortSignal)
        deps.throwIfRequestCanceled(abortSignal)
        deps.rememberToolTrace(
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
        const limitedRows = deps.limitRowsForModel(boundedRows)
        const outputTruncated = rows.length > boundedRows.length || limitedRows.payloadTruncated
        const compactedText =
          limitedRows.payloadTruncated || limitedRows.valueTruncatedCells > 0
            ? ' | خروجی برای مدل خلاصه شد.'
            : ''

        deps.emitProgress(onProgress, {
          type: 'tool-success',
          message: `✅ تعداد ${rows.length} جدول یافت شد.${compactedText}`,
          toolName,
          toolCallId: toolCall.id,
          args,
          rowCount: rows.length
        })

        await deps.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          stage: 'tool-success',
          toolName,
          sqlQuery,
          rowCount: rows.length,
          round
        })

        toolMessages.push(
          deps.createToolResponseMessage(toolCall, {
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
          const correctionMessage =
            unsupportedSql.correction ?? 'این کوئری از توابع پشتیبانی‌نشده استفاده می‌کند.'
          deps.emitGuardrailTelemetry('unsupported-function', requestId, conversationId, {
            functionName: unsupportedSql.functionName ?? 'unknown',
            correction: correctionMessage,
            sqlQuery: deps.compactText(sqlQuery.replace(/\s+/g, ' '), 400)
          })
          deps.emitGuardrailCounterTelemetry('unsupported-function', requestId, conversationId, 1)
          const guardedError = deps.createAgentPolicyError(
            'AGENT_UNSUPPORTED_SQL_FUNCTION',
            correctionMessage
          )
          guardedError.message = correctionMessage
          throw guardedError
        }

        const prevalidatedSql = deps.prevalidateFinancialQuery(sqlQuery, settings)
        deps.ensureFinancialQueryAllowed(prevalidatedSql, settings, conversationMemory)

        const unsupportedSqlAfterPrevalidation = detectUnsupportedSqlFunctions(prevalidatedSql)
        if (unsupportedSqlAfterPrevalidation.found) {
          const correctionMessage =
            unsupportedSqlAfterPrevalidation.correction ??
            'این کوئری از توابع پشتیبانی‌نشده استفاده می‌کند.'
          deps.emitGuardrailTelemetry('unsupported-function', requestId, conversationId, {
            functionName: unsupportedSqlAfterPrevalidation.functionName ?? 'unknown',
            correction: correctionMessage,
            sqlQuery: deps.compactText(prevalidatedSql.replace(/\s+/g, ' '), 400)
          })
          const guardedError = deps.createAgentPolicyError(
            'AGENT_UNSUPPORTED_SQL_FUNCTION',
            correctionMessage
          )
          guardedError.message = correctionMessage
          throw guardedError
        }

        const rows = await deps.executeReadOnlySql(prevalidatedSql, abortSignal)
        successfulDataFetches += 1
        deps.throwIfRequestCanceled(abortSignal)
        deps.rememberToolTrace(
          conversationMemory,
          `fetch_financial_data rows=${rows.length} sql=${deps.compactText(sqlQuery.replace(/\s+/g, ' '), 180)}`
        )
        evidence.push({
          tool: 'fetch_financial_data',
          status: 'ok',
          rowsReturned: rows.length,
          nonNullValue: deps.rowsContainNonNullValue(rows),
          scopeApplied: true,
          query: deps.compactText(prevalidatedSql.replace(/\s+/g, ' '), 400)
        })
        const redacted = deps.redactSensitiveIdentifiers(rows)
        const boundedRows = redacted.rows.slice(0, MAX_TOOL_ROWS)
        const limitedRows = deps.limitRowsForModel(boundedRows)
        const outputTruncated = rows.length > boundedRows.length || limitedRows.payloadTruncated
        const redactionText =
          redacted.redactedCells > 0
            ? ` | ${redacted.redactedCells} فیلد حساس پیش از ارسال به مدل پوشانده شد.`
            : ''
        const compactedText =
          limitedRows.payloadTruncated || limitedRows.valueTruncatedCells > 0
            ? ' | خروجی برای مدل خلاصه شد.'
            : ''
        const evidencePreview = deps.createEvidencePreview(
          prevalidatedSql,
          limitedRows.rows,
          rows.length,
          outputTruncated
        )

        deps.emitProgress(onProgress, {
          type: 'tool-success',
          message: `✅ تعداد ${rows.length} ردیف مالی استخراج شد.${redactionText}${compactedText}`,
          toolName,
          toolCallId: toolCall.id,
          args,
          rowCount: rows.length,
          evidencePreview
        })

        await deps.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          stage: 'tool-success',
          toolName,
          sqlQuery,
          rowCount: rows.length,
          round
        })

        toolMessages.push(
          deps.createToolResponseMessage(toolCall, {
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

        const cached = deps.schemaCacheByTableKey.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < deps.SCHEMA_CACHE_TTL_MS) {
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

          deps.rememberToolTrace(
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
            deps.createToolResponseMessage(toolCall, {
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

          deps.emitProgress(onProgress, {
            type: 'tool-success',
            message: `✅ ساختار جدول [${tableName}] با ${rows.length} ستون بازیابی شد (از کش).`,
            toolName,
            toolCallId: toolCall.id,
            args,
            rowCount: rows.length
          })

          continue
        }

        const sqlQuery = deps.buildDatabaseSchemaQuery(tableName, schemaName)
        const cachedSchema = await deps.getCachedSchemaSnapshot(cacheKey, sqlQuery, abortSignal)
        const rows = cachedSchema.rows
        deps.throwIfRequestCanceled(abortSignal)

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
        deps.schemaCacheByTableKey.set(cacheKey, { schema: schemaColumns, timestamp: Date.now() })
        deps.rememberToolTrace(
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
        const limitedRows = deps.limitRowsForModel(boundedRows)
        const outputTruncated = rows.length > boundedRows.length || limitedRows.payloadTruncated
        const compactedText =
          limitedRows.payloadTruncated || limitedRows.valueTruncatedCells > 0
            ? ' | خروجی برای مدل خلاصه شد.'
            : ''

        deps.emitProgress(onProgress, {
          type: 'tool-success',
          message: `✅ ساختار جدول [${tableName}] با ${rows.length} ستون استخراج شد.${compactedText}`,
          toolName,
          toolCallId: toolCall.id,
          args,
          rowCount: rows.length
        })

        await deps.safeAuditWrite({
          timestamp: new Date().toISOString(),
          requestId,
          stage: 'tool-success',
          toolName,
          sqlQuery,
          rowCount: rows.length,
          round
        })

        toolMessages.push(
          deps.createToolResponseMessage(toolCall, {
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

      deps.emitProgress(onProgress, {
        type: 'tool-error',
        message: `❌ ابزار ناشناخته: ${toolName}`,
        toolName,
        toolCallId: toolCall.id,
        args,
        errorCode: unsupportedToolCode,
        errorCategory: 'orchestration-policy'
      })

      await deps.safeAuditWrite({
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
        deps.createToolResponseMessage(toolCall, {
          ok: false,
          error: unsupportedToolError,
          error_code: unsupportedToolCode
        })
      )
    } catch (error) {
      if (abortSignal.aborted || deps.isCancellationLikeError(error)) {
        throw deps.resolveCancellationError(error, abortSignal)
      }

      const errorInfo = deps.toErrorInfo(error)

      evidence.push({
        tool: toolName,
        status: 'error',
        rowsReturned: 0,
        nonNullValue: false,
        scopeApplied: false,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message
      })

      deps.emitProgress(onProgress, {
        type: 'tool-error',
        message: `❌ خطا در اجرای ابزار ${toolName}: ${errorInfo.message}`,
        toolName,
        toolCallId: toolCall.id,
        args,
        errorCode: errorInfo.code,
        errorCategory: errorInfo.category
      })

      await deps.safeAuditWrite({
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
        deps.createToolResponseMessage(toolCall, {
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
