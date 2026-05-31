import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SqlQueryRow } from '../../src/shared/contracts'

export type SyntheticDbKey = 'sepidar' | 'mahak'

type SyntheticDbSnapshot = {
  serverInfo: SqlQueryRow[]
  tables: SqlQueryRow[]
  columns: SqlQueryRow[]
  primaryKeys: SqlQueryRow[]
  foreignKeys: SqlQueryRow[]
  sampleRows: Record<string, SqlQueryRow[]>
}

type SyntheticDbFixtureRoot = Record<SyntheticDbKey, SyntheticDbSnapshot>

const SYNTHETIC_DB_FIXTURE_PATH = join(process.cwd(), 'scripts', 'fixtures', 'synthetic-accounting-db.json')

export async function loadSyntheticDbSnapshot(key: SyntheticDbKey): Promise<SyntheticDbSnapshot> {
  const raw = await readFile(SYNTHETIC_DB_FIXTURE_PATH, 'utf8')
  const parsed = JSON.parse(raw) as Partial<SyntheticDbFixtureRoot>
  const snapshot = parsed[key]

  if (!snapshot) {
    throw new Error(`Synthetic DB fixture [${key}] was not found in ${SYNTHETIC_DB_FIXTURE_PATH}`)
  }

  return snapshot
}

export function createSyntheticSchemaExecutor(snapshot: SyntheticDbSnapshot): (query: string) => Promise<SqlQueryRow[]> {
  return async (query: string): Promise<SqlQueryRow[]> => {
    const normalizedQuery = query.trim().toLowerCase()

    if (normalizedQuery.includes("serverproperty('productversion')")) {
      return snapshot.serverInfo
    }

    if (normalizedQuery.includes('from sys.key_constraints kc')) {
      return snapshot.primaryKeys
    }

    if (normalizedQuery.includes('from sys.foreign_key_columns fkc')) {
      return snapshot.foreignKeys
    }

    if (normalizedQuery.includes('from sys.tables t') && normalizedQuery.includes('left join sys.partitions p')) {
      return snapshot.tables
    }

    if (normalizedQuery.includes('from sys.tables t') && normalizedQuery.includes('inner join sys.columns c')) {
      return snapshot.columns
    }

    const sampleQueryMatch = query.match(/from\s+\[([^\]]+)\]\.\[([^\]]+)\]/i)
    if (sampleQueryMatch?.[1] && sampleQueryMatch?.[2]) {
      const sampleKey = `${sampleQueryMatch[1]}.${sampleQueryMatch[2]}`
      return snapshot.sampleRows[sampleKey] ?? []
    }

    throw new Error(`Synthetic schema executor does not know how to answer query: ${query}`)
  }
}
