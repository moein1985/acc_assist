import mssql, { type ConnectionPool } from 'mssql'

import type { SqlConnectionConfig, SqlQueryRequest, SqlQueryResult, SqlQueryRow } from '../../shared/contracts'

const DEFAULT_POOL_MAX = 8
const DEFAULT_POOL_MIN = 0
const DEFAULT_POOL_IDLE_TIMEOUT_MS = 30000
const FORBIDDEN_SQL_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|MERGE|EXEC|EXECUTE|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC|USE)\b/i

export class SqlConnectionManager {
  private pool: ConnectionPool | null = null
  private poolSignature: string | null = null
  private connectPromise: Promise<ConnectionPool> | null = null

  async testConnection(connection: SqlConnectionConfig): Promise<string> {
    const pool = await this.getOrCreatePool(connection)
    const result = await pool.request().query('SELECT 1 AS ok')
    const okValue = result.recordset?.[0]?.ok
    return okValue === 1 ? 'SQL connection is healthy' : 'SQL connection established'
  }

  async query(payload: SqlQueryRequest): Promise<SqlQueryResult> {
    if (!payload.query.trim()) {
      throw new Error('SQL query is empty.')
    }

    const pool = await this.getOrCreatePool(payload.connection)
    const request = pool.request()

    for (const parameter of payload.parameters ?? []) {
      request.input(this.normalizeParameterName(parameter.name), parameter.value)
    }

    const result = await request.query(payload.query)

    return this.toSqlQueryResult(result)
  }

  async executeReadOnlyQuery(connection: SqlConnectionConfig, query: string): Promise<SqlQueryRow[]> {
    const validatedQuery = this.validateReadOnlyQuery(query)
    const pool = await this.getOrCreatePool(connection)
    const result = await pool.request().query(validatedQuery)

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

  private validateReadOnlyQuery(query: string): string {
    const trimmed = query.trim()

    if (!trimmed) {
      throw new Error('SQL query is empty.')
    }

    const normalized = this.stripSqlCommentsAndLiterals(trimmed).replace(/\s+/g, ' ').trim()

    if (!normalized) {
      throw new Error('SQL query is empty after normalization.')
    }

    const upper = normalized.toUpperCase()

    if (!(upper.startsWith('SELECT ') || upper.startsWith('SELECT\n') || upper === 'SELECT' || upper.startsWith('WITH '))) {
      throw new Error('Only read-only SELECT queries are allowed.')
    }

    if (FORBIDDEN_SQL_KEYWORDS.test(upper)) {
      throw new Error('Query contains forbidden SQL keyword. Only read-only SELECT is allowed.')
    }

    if (/\bSELECT\b[\s\S]*\bINTO\b/i.test(upper)) {
      throw new Error('SELECT INTO is not allowed in read-only mode.')
    }

    const semicolonClean = upper.replace(/;+\s*$/, '')
    if (semicolonClean.includes(';')) {
      throw new Error('Multiple SQL statements are not allowed in executeQuery.')
    }

    return trimmed
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
