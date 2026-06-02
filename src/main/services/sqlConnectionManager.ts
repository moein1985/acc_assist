import mssql, { type ConnectionPool } from 'mssql'
import { Parser } from 'node-sql-parser'

import type { SqlConnectionConfig, SqlHealthCheck, SqlQueryRequest, SqlQueryResult, SqlQueryRow } from '../../shared/contracts'

const DEFAULT_POOL_MAX = 8
const DEFAULT_POOL_MIN = 0
const DEFAULT_POOL_IDLE_TIMEOUT_MS = 30000
const FORBIDDEN_SQL_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|MERGE|EXEC|EXECUTE|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC|USE|WAITFOR)\b/i
const FORBIDDEN_EXTERNAL_DATA_ACCESS_PATTERN =
  /\b(OPENROWSET|OPENQUERY|OPENDATASOURCE)\s*\(/i
const SENSITIVE_METADATA_ACCESS_PATTERN =
  /\bINFORMATION_SCHEMA\b|\bSYS\.[A-Z_][A-Z0-9_]*\b|\bSYSOBJECTS\b|\bSYSCOLUMNS\b|\bSYSINDEXES\b/i
const FORBIDDEN_SYSTEM_PROC_PATTERN = /\b(XP_|SP_|DS_)\w+/i
const FORBIDDEN_TESSERACT_NESTING = /\b(GO|DECLARE|SET)\b/i
const FORBIDDEN_QUERY_HINT_PATTERN = /\bOPTION\s*\(/i
const FORBIDDEN_EXPORT_CLAUSE_PATTERN = /\bFOR\s+(XML|JSON)\b/i
const AGGREGATION_SQL_PATTERN =
  /\b(COUNT|SUM|AVG|MIN|MAX|STRING_AGG)\s*\(|\bGROUP\s+BY\b|\bHAVING\b/i
const RESULT_LIMIT_SQL_PATTERN =
  /\bTOP\s*\(\s*[^)]+\s*\)|\bTOP\s+[^\s;]+\b|\bFETCH\s+NEXT\s+[^;\n\r]+\s+ROWS?\s+ONLY\b/i
const ORDER_BY_SQL_PATTERN = /\bORDER\s+BY\b/i
const WILDCARD_SELECT_PATTERN = /\bSELECT\s+(?:TOP\s*\(\s*\d+\s*\)\s+|TOP\s+\d+\s+)?\*\s+FROM\b/i
const READONLY_LOGIN_CACHE_TTL_MS = 60000

type ReadOnlyQueryScope = 'generic' | 'agent-data' | 'metadata' | 'discovery'

export interface ReadOnlyExecutionOptions {
  enforceReadOnlyLogin?: boolean
  forbidWildcardSelect?: boolean
  requireOrderByWhenLimited?: boolean
  blockQueryHints?: boolean
}

export type SqlPolicyViolationCategory = 'read-only-policy' | 'security-policy'

export type SqlPolicyViolationCode =
  | 'SQL_POLICY_EMPTY_QUERY'
  | 'SQL_POLICY_NOT_SELECT'
  | 'SQL_POLICY_FORBIDDEN_KEYWORD'
  | 'SQL_POLICY_FORBIDDEN_HINT'
  | 'SQL_POLICY_FORBIDDEN_EXPORT_CLAUSE'
  | 'SQL_POLICY_EXTERNAL_DATA_ACCESS'
  | 'SQL_POLICY_METADATA_SCOPE_BLOCK'
  | 'SQL_POLICY_WILDCARD_SELECT_BLOCKED'
  | 'SQL_POLICY_SELECT_INTO'
  | 'SQL_POLICY_MULTI_STATEMENT'
  | 'SQL_POLICY_REQUIRE_RESULT_LIMIT'
  | 'SQL_POLICY_REQUIRE_ORDER_BY_FOR_LIMITED_QUERY'
  | 'SQL_POLICY_NON_NUMERIC_LIMIT'
  | 'SQL_POLICY_INVALID_LIMIT'
  | 'SQL_POLICY_QUERY_TIMEOUT'
  | 'SQL_POLICY_SCOPE_LIMIT_EXCEEDED'
  | 'SQL_POLICY_REQUIRE_READONLY_LOGIN'
  | 'SQL_POLICY_FORBIDDEN_SYSTEM_PROC'
  | 'SQL_POLICY_FORBIDDEN_BATCH_COMMAND'

export class SqlPolicyViolationError extends Error {
  readonly code: SqlPolicyViolationCode
  readonly category: SqlPolicyViolationCategory

  constructor(code: SqlPolicyViolationCode, category: SqlPolicyViolationCategory, message: string) {
    super(message)
    this.name = 'SqlPolicyViolationError'
    this.code = code
    this.category = category
  }

  getPersianMessage(): string {
    switch (this.code) {
      case 'SQL_POLICY_EMPTY_QUERY':
        return 'کوئری ارسالی خالی است.'
      case 'SQL_POLICY_NOT_SELECT':
        return 'فقط کوئری‌های SELECT مجاز هستند.'
      case 'SQL_POLICY_FORBIDDEN_KEYWORD':
        return 'استفاده از کلمات کلیدی غیرمجاز (مانند INSERT/UPDATE/DELETE) در کوئری شناسایی شد.'
      case 'SQL_POLICY_FORBIDDEN_HINT':
        return 'استفاده از Query Hintها در این سطح دسترسی مجاز نیست.'
      case 'SQL_POLICY_FORBIDDEN_EXPORT_CLAUSE':
        return 'استفاده از خروجی‌های XML یا JSON در کوئری مجاز نیست.'
      case 'SQL_POLICY_EXTERNAL_DATA_ACCESS':
        return 'دسترسی به منابع داده خارجی (OpenRowset/OpenQuery) مسدود شده است.'
      case 'SQL_POLICY_METADATA_SCOPE_BLOCK':
        return 'دسترسی مستقیم به جدول‌های سیستم و متادیتا محدود شده است.'
      case 'SQL_POLICY_WILDCARD_SELECT_BLOCKED':
        return 'استفاده از SELECT * در این بخش مجاز نیست. لطفاً نام ستون‌ها را صریحاً ذکر کنید.'
      case 'SQL_POLICY_SELECT_INTO':
        return 'ساخت جدول جدید (SELECT INTO) مجاز نیست.'
      case 'SQL_POLICY_MULTI_STATEMENT':
        return 'اجرای همزمان چند دستور در یک کوئری مجاز نیست.'
      case 'SQL_POLICY_REQUIRE_RESULT_LIMIT':
        return 'برای جلوگیری از بار اضافی، کوئری باید دارای محدودیت تعداد ردیف (TOP یا FETCH NEXT) باشد.'
      case 'SQL_POLICY_REQUIRE_ORDER_BY_FOR_LIMITED_QUERY':
        return 'استفاده از محدودیت ردیف بدون ORDER BY مجاز نیست.'
      case 'SQL_POLICY_NON_NUMERIC_LIMIT':
        return 'مقدار محدودیت تعداد ردیف باید عدد باشد.'
      case 'SQL_POLICY_INVALID_LIMIT':
        return 'مقدار محدودیت تعداد ردیف نامعتبر است.'
      case 'SQL_POLICY_QUERY_TIMEOUT':
        return 'زمان اجرای کوئری بیش از حد مجاز طول کشید.'
      case 'SQL_POLICY_SCOPE_LIMIT_EXCEEDED':
        return 'تعداد ردیف‌های خروجی بیش از سقف مجاز برای این عملیات است.'
      case 'SQL_POLICY_REQUIRE_READONLY_LOGIN':
        return 'این عملیات مستلزم استفاده از یک دسترسی فقط-خواندنی (Read-Only) واقعی در سطح بانک اطلاعاتی است.'
      case 'SQL_POLICY_FORBIDDEN_SYSTEM_PROC':
        return 'فراخوانی توابع و پروسیجرهای سیستمی (xp_*/sp_*) مجاز نیست.'
      case 'SQL_POLICY_FORBIDDEN_BATCH_COMMAND':
        return 'استفاده از دستورات دسته‌ای (مانند GO، DECLARE، SET) در کوئری‌های مالی مجاز نیست.'
      default:
        return 'خطای سیاست امنیتی SQL رخ داده است.'
    }
  }
}

const MAX_READONLY_ROWS_BY_SCOPE: Record<ReadOnlyQueryScope, number> = {
  generic: 500,
  'agent-data': 500,
  metadata: 5000,
  discovery: 30000
}

const MAX_READONLY_TIMEOUT_MS_BY_SCOPE: Record<ReadOnlyQueryScope, number> = {
  generic: 30000,
  'agent-data': 25000,
  metadata: 20000,
  discovery: 45000
}

export class SqlConnectionManager {
  private pool: ConnectionPool | null = null
  private poolSignature: string | null = null
  private connectPromise: Promise<ConnectionPool> | null = null
  private readonly sqlParser = new Parser()
  private readonlyPermissionCache = new Map<
    string,
    {
      checkedAt: number
      isReadOnly: boolean
      writeCapabilities: string[]
    }
  >()

  async testConnection(connection: SqlConnectionConfig): Promise<string> {
    const pool = await this.getOrCreatePool(connection)
    const result = await pool.request().query('SELECT 1 AS ok')
    const okValue = result.recordset?.[0]?.ok
    return okValue === 1 ? 'SQL connection is healthy' : 'SQL connection established'
  }

  async listDatabases(connection: SqlConnectionConfig): Promise<string[]> {
    const pool = await this.getOrCreatePool(this.withDatabase(connection, 'master'))
    const result = await pool.request().query(`
SELECT name
FROM sys.databases
WHERE state = 0
  AND HAS_DBACCESS(name) = 1
ORDER BY name`)

    const rows = Array.isArray(result.recordset) ? result.recordset : []
    return rows
      .map((row) => {
        const name = row?.['name']
        return typeof name === 'string' ? name.trim() : ''
      })
      .filter((name) => name.length > 0)
  }

  async getHealthCheck(connection: SqlConnectionConfig): Promise<SqlHealthCheck> {
    const pool = await this.getOrCreatePool(connection)
    const healthCheck = await this.getHealthCheckFromPool(pool, connection)
    this.updateReadOnlyCache(connection, healthCheck)
    return healthCheck
  }

  private async getHealthCheckFromPool(
    pool: ConnectionPool,
    connection: SqlConnectionConfig
  ): Promise<SqlHealthCheck> {
    const result = await pool.request().query(`
SELECT
  CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS server_version,
  DB_NAME() AS database_name,
  SUSER_SNAME() AS login_user,
  CAST(COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT'), 0) AS int) AS can_insert,
  CAST(COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE'), 0) AS int) AS can_update,
  CAST(COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE'), 0) AS int) AS can_delete,
  CAST(COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER'), 0) AS int) AS can_alter,
  CAST(COALESCE(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CONTROL'), 0) AS int) AS can_control`)

    const row = (Array.isArray(result.recordset) ? result.recordset[0] : undefined) as
      | Record<string, unknown>
      | undefined

    const writeCapabilities: string[] = []

    if (this.toInt(row?.['can_insert']) === 1) {
      writeCapabilities.push('INSERT')
    }
    if (this.toInt(row?.['can_update']) === 1) {
      writeCapabilities.push('UPDATE')
    }
    if (this.toInt(row?.['can_delete']) === 1) {
      writeCapabilities.push('DELETE')
    }
    if (this.toInt(row?.['can_alter']) === 1) {
      writeCapabilities.push('ALTER')
    }
    if (this.toInt(row?.['can_control']) === 1) {
      writeCapabilities.push('CONTROL')
    }

    return {
      serverVersion: this.toStringValue(row?.['server_version'], 'Unknown'),
      databaseName: this.toStringValue(row?.['database_name'], connection.database || 'Unknown'),
      loginUser: this.toStringValue(row?.['login_user'], 'Unknown'),
      isReadOnly: writeCapabilities.length === 0,
      writeCapabilities
    }
  }

  async query(payload: SqlQueryRequest): Promise<SqlQueryResult> {
    if (!payload.query.trim()) {
      throw new Error('کوئری SQL خالی است.')
    }

    const pool = await this.getOrCreatePool(payload.connection)
    const request = pool.request()

    for (const parameter of payload.parameters ?? []) {
      request.input(this.normalizeParameterName(parameter.name), parameter.value)
    }

    const result = await request.query(payload.query)

    return this.toSqlQueryResult(result)
  }

  async executeReadOnlyQuery(
    connection: SqlConnectionConfig,
    query: string,
    scope: ReadOnlyQueryScope = 'generic',
    signal?: AbortSignal,
    options?: ReadOnlyExecutionOptions
  ): Promise<SqlQueryRow[]> {
    const validatedQuery = this.validateReadOnlyQuery(query, scope, options)
    const pool = await this.getOrCreatePool(connection)

    if (options?.enforceReadOnlyLogin && (scope === 'generic' || scope === 'agent-data')) {
      await this.assertReadOnlyLogin(connection, pool)
    }

    const request = pool.request() as mssql.Request & {
      timeout?: number
      cancel?: () => void
    }
    const effectiveTimeoutMs = Math.min(
      Math.max(1000, connection.requestTimeoutMs),
      MAX_READONLY_TIMEOUT_MS_BY_SCOPE[scope]
    )

    request.timeout = effectiveTimeoutMs

    if (signal?.aborted) {
      throw this.createReadOnlyCancellationError(signal.reason)
    }

    const onAbort = (): void => {
      try {
        request.cancel?.()
      } catch {
        // Ignore cancellation errors from driver-level abort attempts.
      }
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    let result: mssql.IResult<unknown>

    try {
      result = await request.query(validatedQuery)
    } catch (error) {
      if (signal?.aborted) {
        throw this.createReadOnlyCancellationError(signal.reason)
      }

      throw this.mapReadOnlyExecutionError(error, effectiveTimeoutMs)
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }

    if (!Array.isArray(result.recordset)) {
      return []
    }

    return result.recordset.map((row) => {
      const serialized = this.toSerializable(row)
      return (serialized as SqlQueryRow) ?? {}
    })
  }

  async close(): Promise<void> {
    const pool = this.pool
    const pending = this.connectPromise

    this.pool = null
    this.poolSignature = null
    this.connectPromise = null
    this.readonlyPermissionCache.clear()

    const resolvedPool = pending ? await pending.catch(() => null) : null
    const poolToClose = pool ?? resolvedPool

    if (poolToClose) {
      await poolToClose.close().catch(() => {
        // Ignore close errors during shutdown.
      })
    }
  }

  private async getOrCreatePool(connection: SqlConnectionConfig): Promise<ConnectionPool> {
    const signature = this.createSignature(connection)

    if (this.pool && this.poolSignature === signature && this.pool.connected) {
      return this.pool
    }

    if (this.connectPromise && this.poolSignature === signature) {
      return this.connectPromise
    }

    if (this.poolSignature && this.poolSignature !== signature) {
      await this.close()
    }

    const newPool = new mssql.ConnectionPool(this.createMssqlConfig(connection))
    this.poolSignature = signature

    this.connectPromise = newPool
      .connect()
      .then((connectedPool) => {
        this.pool = connectedPool
        this.attachPoolListeners(connectedPool, signature)
        return connectedPool
      })
      .catch(async (error) => {
        this.pool = null
        this.poolSignature = null
        await newPool.close().catch(() => {
          // Ignore close errors after failed connect.
        })
        throw error
      })
      .finally(() => {
        this.connectPromise = null
      })

    return this.connectPromise
  }

  private createMssqlConfig(connection: SqlConnectionConfig): mssql.config {
    return {
      server: connection.server,
      database: connection.database,
      user: connection.user,
      password: connection.password,
      port: connection.port,
      options: {
        encrypt: connection.encrypt,
        trustServerCertificate: connection.trustServerCertificate
      },
      connectionTimeout: connection.connectionTimeoutMs,
      requestTimeout: connection.requestTimeoutMs,
      pool: {
        max: DEFAULT_POOL_MAX,
        min: DEFAULT_POOL_MIN,
        idleTimeoutMillis: DEFAULT_POOL_IDLE_TIMEOUT_MS
      }
    }
  }

  private attachPoolListeners(pool: ConnectionPool, signature: string): void {
    pool.on('error', (error) => {
      console.error('[SqlConnectionManager] Pool error:', error)

      if (this.poolSignature === signature) {
        this.pool = null
        this.poolSignature = null
      }
    })
  }

  private normalizeParameterName(name: string): string {
    return name.replace(/^@+/, '').trim()
  }

  private toSqlQueryResult(result: mssql.IResult<unknown>): SqlQueryResult {
    return {
      recordsetCount: result.recordsets.length,
      rowsAffected: result.rowsAffected,
      recordsets: this.serializeRecordsets(result.recordsets),
      output: this.toSerializable(result.output) as Record<string, unknown>
    }
  }

  private serializeRecordsets(recordsets: unknown[]): Record<string, unknown>[][] {
    return recordsets.map((recordset) => {
      if (!Array.isArray(recordset)) {
        return []
      }

      return recordset.map((row) => {
        const serializable = this.toSerializable(row)
        return (serializable as Record<string, unknown>) ?? {}
      })
    })
  }

  private validateReadOnlyQuery(
    query: string,
    scope: ReadOnlyQueryScope,
    options?: ReadOnlyExecutionOptions
  ): string {
    const trimmed = query.trim()

    if (!trimmed) {
      throw new SqlPolicyViolationError('SQL_POLICY_EMPTY_QUERY', 'read-only-policy', 'SQL query is empty.')
    }

    // 1. AST-based check (Primary)
    try {
      // Use 'transactsql' dialect for T-SQL awareness
      const ast = this.sqlParser.astify(trimmed, { database: 'transactsql' })
      const astList = Array.isArray(ast) ? ast : [ast]

      if (astList.length > 1 && (scope === 'generic' || scope === 'agent-data')) {
        throw new SqlPolicyViolationError(
          'SQL_POLICY_MULTI_STATEMENT',
          'security-policy',
          'Multi-statement queries are not allowed for this operation.'
        )
      }

      for (const statement of astList) {
        if (statement.type !== 'select') {
          throw new SqlPolicyViolationError(
            'SQL_POLICY_NOT_SELECT',
            'security-policy',
            `Invalid statement type: ${statement.type}. Only SELECT is allowed.`
          )
        }
      }
    } catch (error) {
      // If it's already a policy violation, rethrow
      if (error instanceof SqlPolicyViolationError) throw error

      // Fallback: If AST parsing fails (might be complex T-SQL syntax not fully supported by the parser),
      // we proceed to strict Regex validation as a safety net.
      // We don't block just because of parsing failure, but we stay extremely cautious.
      console.warn('[SqlConnectionManager] SQL AST parsing failed, falling back to regex:', error)
    }

    // 2. Regex-based check (Secondary / Defense in depth)
    const normalized = this.stripSqlCommentsAndLiterals(trimmed).replace(/\s+/g, ' ').trim()

    if (!normalized) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_EMPTY_QUERY',
        'read-only-policy',
        'SQL query is empty after normalization.'
      )
    }

    const upper = normalized.toUpperCase()

    if (!(upper.startsWith('SELECT ') || upper.startsWith('SELECT\n') || upper === 'SELECT' || upper.startsWith('WITH '))) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_NOT_SELECT',
        'read-only-policy',
        'Only read-only SELECT queries are allowed.'
      )
    }

    if (FORBIDDEN_SQL_KEYWORDS.test(upper)) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_FORBIDDEN_KEYWORD',
        'security-policy',
        'Query contains forbidden SQL keyword. Only read-only SELECT is allowed.'
      )
    }

    if (FORBIDDEN_SYSTEM_PROC_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_FORBIDDEN_SYSTEM_PROC',
        'security-policy',
        'System procedures (xp_*/sp_*) are not allowed.'
      )
    }

    if (FORBIDDEN_TESSERACT_NESTING.test(upper)) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_FORBIDDEN_BATCH_COMMAND',
        'security-policy',
        'Batch commands (GO/DECLARE/SET) are not allowed.'
      )
    }

    if ((options?.blockQueryHints ?? true) && FORBIDDEN_QUERY_HINT_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_FORBIDDEN_HINT',
        'security-policy',
        'Query hints are not allowed in read-only mode.'
      )
    }

    if (FORBIDDEN_EXPORT_CLAUSE_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_FORBIDDEN_EXPORT_CLAUSE',
        'security-policy',
        'FOR JSON/FOR XML clauses are not allowed in read-only mode.'
      )
    }

    if (FORBIDDEN_EXTERNAL_DATA_ACCESS_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_EXTERNAL_DATA_ACCESS',
        'security-policy',
        'External data source functions (OPENROWSET/OPENQUERY/OPENDATASOURCE) are not allowed.'
      )
    }

    if (scope === 'agent-data' && SENSITIVE_METADATA_ACCESS_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_METADATA_SCOPE_BLOCK',
        'security-policy',
        'Agent data queries cannot access SQL Server metadata schemas or system tables.'
      )
    }

    if (FORBIDDEN_SYSTEM_PROC_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_FORBIDDEN_SYSTEM_PROC',
        'security-policy',
        'System procedures (xp_*/sp_*) are not allowed.'
      )
    }

    if (FORBIDDEN_TESSERACT_NESTING.test(upper)) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_FORBIDDEN_BATCH_COMMAND',
        'security-policy',
        'Batch commands (GO/DECLARE/SET) are not allowed.'
      )
    }

    if ((options?.forbidWildcardSelect ?? true) && scope === 'agent-data' && WILDCARD_SELECT_PATTERN.test(upper)) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_WILDCARD_SELECT_BLOCKED',
        'security-policy',
        'Wildcard SELECT (*) is not allowed for agent data queries.'
      )
    }

    if (/\bSELECT\b[\s\S]*\bINTO\b/i.test(upper)) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_SELECT_INTO',
        'security-policy',
        'SELECT INTO is not allowed in read-only mode.'
      )
    }

    const semicolonClean = upper.replace(/;+\s*$/, '')
    if (semicolonClean.includes(';')) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_MULTI_STATEMENT',
        'security-policy',
        'Multiple SQL statements are not allowed in executeQuery.'
      )
    }

    const isAggregatedQuery = AGGREGATION_SQL_PATTERN.test(upper)
    const hasResultLimit = RESULT_LIMIT_SQL_PATTERN.test(upper)
    const numericResultLimit = this.extractNumericResultLimit(upper)
    const hasOrderBy = ORDER_BY_SQL_PATTERN.test(upper)

    if (!isAggregatedQuery && !hasResultLimit) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_REQUIRE_RESULT_LIMIT',
        'read-only-policy',
        'Non-aggregated SELECT queries must include TOP or pagination (OFFSET/FETCH).'
      )
    }

    if (!isAggregatedQuery && hasResultLimit && numericResultLimit === null) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_NON_NUMERIC_LIMIT',
        'read-only-policy',
        'Result limit must be a numeric literal in TOP(...) or FETCH NEXT ... ROWS ONLY.'
      )
    }

    if (
      (options?.requireOrderByWhenLimited ?? true) &&
      (scope === 'generic' || scope === 'agent-data') &&
      !isAggregatedQuery &&
      hasResultLimit &&
      !hasOrderBy
    ) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_REQUIRE_ORDER_BY_FOR_LIMITED_QUERY',
        'read-only-policy',
        'Limited non-aggregated queries must include ORDER BY for deterministic results.'
      )
    }

    if (numericResultLimit !== null && numericResultLimit < 1) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_INVALID_LIMIT',
        'read-only-policy',
        'Result limit must be greater than zero.'
      )
    }

    const maxRows = MAX_READONLY_ROWS_BY_SCOPE[scope]
    if (numericResultLimit !== null && numericResultLimit > maxRows) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_SCOPE_LIMIT_EXCEEDED',
        'read-only-policy',
        `Result limit exceeds maximum allowed rows for this query scope (${maxRows}).`
      )
    }

    return trimmed
  }

  private extractNumericResultLimit(sql: string): number | null {
    const limits: number[] = []

    const topWithParenthesesPattern = /\bTOP\s*\(\s*(\d+)\s*\)/gi
    const topSimplePattern = /\bTOP\s+(\d+)\b/gi
    const fetchNextPattern = /\bFETCH\s+NEXT\s+(\d+)\s+ROWS?\s+ONLY\b/gi

    for (const pattern of [topWithParenthesesPattern, topSimplePattern, fetchNextPattern]) {
      pattern.lastIndex = 0

      let match: RegExpExecArray | null
      while ((match = pattern.exec(sql)) !== null) {
        const parsed = Number.parseInt(match[1], 10)

        if (Number.isFinite(parsed)) {
          limits.push(parsed)
        }
      }
    }

    if (limits.length === 0) {
      return null
    }

    return Math.min(...limits)
  }

  private async assertReadOnlyLogin(connection: SqlConnectionConfig, pool: ConnectionPool): Promise<void> {
    const signature = this.createSignature(connection)
    const cached = this.readonlyPermissionCache.get(signature)

    if (cached && Date.now() - cached.checkedAt <= READONLY_LOGIN_CACHE_TTL_MS) {
      if (!cached.isReadOnly) {
        throw new SqlPolicyViolationError(
          'SQL_POLICY_REQUIRE_READONLY_LOGIN',
          'security-policy',
          `Configured SQL login has write capabilities (${cached.writeCapabilities.join(', ') || 'UNKNOWN'}). Use a read-only SQL login.`
        )
      }

      return
    }

    const healthCheck = await this.getHealthCheckFromPool(pool, connection)
    this.updateReadOnlyCache(connection, healthCheck)

    if (!healthCheck.isReadOnly) {
      throw new SqlPolicyViolationError(
        'SQL_POLICY_REQUIRE_READONLY_LOGIN',
        'security-policy',
        `Configured SQL login has write capabilities (${healthCheck.writeCapabilities.join(', ') || 'UNKNOWN'}). Use a read-only SQL login.`
      )
    }
  }

  private updateReadOnlyCache(connection: SqlConnectionConfig, healthCheck: SqlHealthCheck): void {
    this.readonlyPermissionCache.set(this.createSignature(connection), {
      checkedAt: Date.now(),
      isReadOnly: healthCheck.isReadOnly,
      writeCapabilities: [...healthCheck.writeCapabilities]
    })
  }

  private mapReadOnlyExecutionError(error: unknown, timeoutMs: number): Error {
    if (!(error instanceof Error)) {
      return new Error(String(error))
    }

    const typedError = error as Error & {
      code?: unknown
    }
    const errorCode = typeof typedError.code === 'string' ? typedError.code.toUpperCase() : ''
    const errorMessage = typedError.message.toLowerCase()

    if (errorCode === 'ETIMEOUT' || errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      return new SqlPolicyViolationError(
        'SQL_POLICY_QUERY_TIMEOUT',
        'read-only-policy',
        `SQL query exceeded the maximum execution time (${timeoutMs} ms).`
      )
    }

    return error
  }

  private createReadOnlyCancellationError(reason: unknown): Error & {
    code: string
    category: string
  } {
    const reasonText =
      typeof reason === 'string' && reason.trim()
        ? reason.trim()
        : reason instanceof Error && reason.message.trim()
          ? reason.message.trim()
          : 'Request canceled by user.'

    const error = new Error(reasonText) as Error & {
      code: string
      category: string
    }

    error.name = 'AbortError'
    error.code = 'AGENT_REQUEST_CANCELLED'
    error.category = 'orchestration-control'

    return error
  }

  private stripSqlCommentsAndLiterals(sql: string): string {
    return sql
      .replace(/--.*$/gm, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/N?'(?:''|[^'])*'/g, "''")
      .replace(/"(?:""|[^"])*"/g, '""')
  }

  private toSerializable(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value
    }

    if (typeof value === 'bigint') {
      return value.toString()
    }

    if (value instanceof Date) {
      return value.toISOString()
    }

    if (Buffer.isBuffer(value)) {
      return value.toString('base64')
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.toSerializable(item))
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value)) {
        result[key] = this.toSerializable(item)
      }
      return result
    }

    return value
  }

  private withDatabase(connection: SqlConnectionConfig, fallbackDatabase: string): SqlConnectionConfig {
    const database = connection.database.trim() || fallbackDatabase
    return {
      ...connection,
      database
    }
  }

  private toInt(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0
    }

    if (typeof value === 'bigint') {
      return Number(value)
    }

    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10)
      return Number.isFinite(parsed) ? parsed : 0
    }

    return 0
  }

  private toStringValue(value: unknown, fallback: string): string {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }

    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value)
    }

    return fallback
  }

  private createSignature(connection: SqlConnectionConfig): string {
    return [
      connection.server,
      connection.database,
      connection.user,
      connection.password,
      connection.port,
      connection.encrypt,
      connection.trustServerCertificate,
      connection.connectionTimeoutMs,
      connection.requestTimeoutMs
    ].join('|')
  }
}
