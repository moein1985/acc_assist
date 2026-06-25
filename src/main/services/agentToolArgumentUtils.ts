const DEFAULT_SCHEMA_ROW_LIMIT = 240

export function buildDatabaseSchemaQuery(tableName: string, schemaName: string | null, maxSchemaRows = DEFAULT_SCHEMA_ROW_LIMIT): string {
  const tableValue = escapeSqlStringLiteral(tableName)
  const schemaFilter = schemaName
    ? `  AND c.TABLE_SCHEMA = N'${escapeSqlStringLiteral(schemaName)}'\n`
    : ''

  return `SELECT TOP (${maxSchemaRows})
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

export function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

export function normalizeTablePattern(value: string | null): string | null {
  if (!value) {
    return null
  }

  return value.replace(/\*/g, '%')
}

export function readRequiredStringArg(args: Record<string, unknown>, key: string, maxLength: number): string {
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

export function readOptionalStringArg(args: Record<string, unknown>, key: string, maxLength: number): string | null {
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

type OptionalNumberArgOptions = {
  min: number
  max: number
  fallback: number
}

/**
 * Reads an optional numeric tool argument, accepting either a real `number` or a
 * numeric `string` (LLM tool runtimes are inconsistent about JSON number vs string
 * encoding). Values are coerced to an integer and clamped to [min, max]. Absent,
 * null, or non-numeric values resolve to `fallback`.
 */
export function readOptionalNumberArg(
  args: Record<string, unknown>,
  key: string,
  { min, max, fallback }: OptionalNumberArgOptions
): number {
  const value = args[key]

  if (value === undefined || value === null) {
    return fallback
  }

  let parsed: number
  if (typeof value === 'number') {
    parsed = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return fallback
    }
    parsed = Number(trimmed)
  } else {
    return fallback
  }

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

export function parseToolArguments(argumentText: string): Record<string, unknown> {
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
