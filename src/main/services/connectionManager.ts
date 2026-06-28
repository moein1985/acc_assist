/**
 * Connection Manager — S15.21
 *
 * Manages adapter selection and connection configuration based on the active
 * software mode. Two paths are supported:
 *
 * Path 1 (sepidar): Uses the hardcoded SepidarAdapter and the SQL connection
 *   from AppSettings.sql.
 *
 * Path 2 (auto): Loads a discovered adapter from AppSettings.discoveredAdapters
 *   using the current SQL connection's server+database as the key. If no
 *   confirmed adapter exists yet, falls back to SepidarAdapter so the engine
 *   remains functional.
 */

import type { AppSettings, SqlConnectionConfig } from '../../shared/contracts'
import type { SchemaAdapter } from './financialEngine/schemaAdapter'
import { SepidarAdapter } from './financialEngine/adapters/sepidarAdapter'
import { adapterKey, type AdapterStore } from './adapterStore'

export interface ConnectionManagerResult {
  adapter: SchemaAdapter
  softwareId: string
  connectionString: string
  /** 'sepidar' when using hardcoded adapter, 'auto' when using discovered adapter */
  mode: 'sepidar' | 'auto'
}

export interface ConnectionManagerDeps {
  getSettings: () => AppSettings
  adapterStore: AdapterStore
}

export class ConnectionManager {
  private readonly getSettings: () => AppSettings
  private readonly adapterStore: AdapterStore

  constructor(deps: ConnectionManagerDeps) {
    this.getSettings = deps.getSettings
    this.adapterStore = deps.adapterStore
  }

  /**
   * Resolve the active adapter and connection string based on the current
   * software mode and SQL settings.
   *
   * - If softwareMode is 'auto' and a confirmed adapter exists for the current
   *   connection, use that adapter.
   * - Otherwise, fall back to SepidarAdapter.
   */
  resolve(): ConnectionManagerResult {
    const settings = this.getSettings()
    const sql = settings.sql
    const mode = settings.softwareMode ?? 'sepidar'

    const connectionString = this.buildConnectionString(sql)

    if (mode === 'auto') {
      const key = adapterKey(sql.server, sql.database)
      const entry = this.adapterStore.getConfirmedAdapter(key)
      if (entry && entry.adapter) {
        const adapter = entry.adapter as SchemaAdapter
        return {
          adapter,
          softwareId: adapter.softwareId,
          connectionString,
          mode: 'auto',
        }
      }
    }

    const sepidar = new SepidarAdapter()
    return {
      adapter: sepidar,
      softwareId: 'sepidar',
      connectionString,
      mode: 'sepidar',
    }
  }

  /**
   * Build a connection string from SqlConnectionConfig.
   * Delegates to SepidarAdapter's buildConnectionString for SQL Server format.
   */
  buildConnectionString(sql: SqlConnectionConfig): string {
    const adapter = new SepidarAdapter()
    return adapter.buildConnectionString({
      server: sql.server,
      port: sql.port,
      database: sql.database,
      user: sql.user,
      password: sql.password,
      encrypt: sql.encrypt,
      trustServerCertificate: sql.trustServerCertificate,
    })
  }

  /**
   * Get the active softwareId for the current settings.
   * Useful for passing to router/planner without fully resolving the adapter.
   */
  getActiveSoftwareId(): string {
    const settings = this.getSettings()
    const mode = settings.softwareMode ?? 'sepidar'

    if (mode === 'auto') {
      const key = adapterKey(settings.sql.server, settings.sql.database)
      const entry = this.adapterStore.getConfirmedAdapter(key)
      if (entry && entry.adapter) {
        const adapter = entry.adapter as SchemaAdapter
        return adapter.softwareId
      }
    }

    return 'sepidar'
  }
}
