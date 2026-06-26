/**
 * SQL execution and cancellation helpers extracted from `agentOrchestrator.ts`
 * (FRE Roadmap F2.5). Behaviour-preserving — the orchestrator delegates
 * to these free functions via a {@link SqlExecutionDeps} context.
 */
import type { Parser } from 'node-sql-parser'
import type {
  AccountingConceptKey,
  AppSettings,
  SchemaCatalogEntry
} from '../../../shared/contracts'
import type { ConversationMemoryState } from './conversationMemory'

export type ExtractedTableReference = {
  raw: string
  schemaTable: string | null
  schemaName: string | null
  databaseName: string | null
  serverName: string | null
  tableName: string
  partCount: number
}

export type RuntimeScopeDimension = 'company' | 'fiscalYear' | 'branch'

export type RuntimeScopeColumnCandidate = {
  dimension: RuntimeScopeDimension
  tableRef: string
  columnName: string
  score: number
  samplePreview: string | null
}

export type RuntimeScopeFilterRequirement = {
  dimension: RuntimeScopeDimension
  values: string[]
  candidateColumnNames: string[]
}

export interface SqlExecutionDeps {
  normalizePersianDigits: (value: string) => string
  findActiveSchemaCatalog: (settings: AppSettings) => SchemaCatalogEntry | null
  normalizeTableRef: (tableRef: string) => string
  createAgentPolicyError: (code: string, message: string) => Error
  collectRuntimeScopeColumnCandidates: (
    catalog: SchemaCatalogEntry
  ) => RuntimeScopeColumnCandidate[]
  sqlParser: Parser
  schemaContextConceptOrder: AccountingConceptKey[]
}

export function createCancellationError(reason: string): Error & {
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

export function toCancellationReason(reason: unknown): string {
  if (typeof reason === 'string' && reason.trim()) {
    return reason.trim()
  }

  if (reason instanceof Error && reason.message.trim()) {
    return reason.message.trim()
  }

  return 'Request canceled by user.'
}

export function throwIfRequestCanceled(signal: AbortSignal): void {
  if (!signal.aborted) {
    return
  }

  throw createCancellationError(toCancellationReason(signal.reason))
}

export function isCancellationLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const typedError = error as Error & {
    code?: unknown
  }

  if (typedError.name === 'AbortError') {
    return true
  }

  if (
    typeof typedError.code === 'string' &&
    typedError.code.toUpperCase() === 'AGENT_REQUEST_CANCELLED'
  ) {
    return true
  }

  const message = error.message.toLowerCase()
  return (
    message.includes('request canceled by user') || message.includes('request cancelled by user')
  )
}

export function resolveCancellationError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) {
    return createCancellationError(toCancellationReason(signal.reason))
  }

  if (isCancellationLikeError(error)) {
    if (error instanceof Error) {
      return createCancellationError(error.message)
    }

    return createCancellationError('Request canceled by user.')
  }

  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

export function normalizeSqlIdentifier(value: string): string {
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

export function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')
}

export function stripSqlCommentsAndLiterals(sql: string): string {
  return stripSqlComments(sql)
    .replace(/N?'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
}

export function escapeRegexPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function splitSqlIdentifierParts(rawRef: string): string[] {
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

export function parseSqlTableReference(rawRef: string): ExtractedTableReference | null {
  const segments = splitSqlIdentifierParts(rawRef)
    .map((segment) => normalizeSqlIdentifier(segment))
    .filter(Boolean)

  if (segments.length === 0) {
    return null
  }

  const tableName = segments[segments.length - 1]
  const schemaName = segments.length >= 2 ? segments[segments.length - 2] : null
  const databaseName = segments.length >= 3 ? segments[segments.length - 3] : null
  const serverName = segments.length >= 4 ? segments[segments.length - 4] : null
  const schemaTable = schemaName ? `${schemaName}.${segments[segments.length - 1]}` : null

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

export function extractReferencedTableRefs(sqlQuery: string): ExtractedTableReference[] {
  const sanitizedSql = stripSqlCommentsAndLiterals(sqlQuery)
  const pattern =
    /\b(?:FROM|JOIN|APPLY)\s+((?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[A-Z0-9_#@]+)(?:\s*\.\s*(?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[A-Z0-9_#@]+)){0,3})/gi
  const tableRefs: ExtractedTableReference[] = []

  let match: RegExpExecArray | null
  while ((match = pattern.exec(sanitizedSql)) !== null) {
    const parsed = parseSqlTableReference(match[1])

    if (parsed) {
      tableRefs.push(parsed)
    }
  }

  return tableRefs
}

export function extractCteNames(sqlQuery: string): Set<string> {
  const sanitizedSql = stripSqlCommentsAndLiterals(sqlQuery)
  const cteNames = new Set<string>()
  const ctePattern = /(?:\bWITH\b|,)\s*([A-Z0-9_["`]+)\s+AS\s*\(/gi

  let match: RegExpExecArray | null
  while ((match = ctePattern.exec(sanitizedSql)) !== null) {
    const normalizedName = normalizeSqlIdentifier(match[1])

    if (normalizedName) {
      cteNames.add(normalizedName)
    }
  }

  return cteNames
}

export function buildCatalogTableNameIndex(
  deps: SqlExecutionDeps,
  activeCatalog: SchemaCatalogEntry
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()

  for (const table of activeCatalog.tables) {
    const tableName = table.tableName.trim().toLowerCase()
    const schemaTableRef = deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`)

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

export function buildAllowedFinancialTableRefs(
  deps: SqlExecutionDeps,
  activeCatalog: SchemaCatalogEntry
): Set<string> {
  const catalogRefs = new Set(
    activeCatalog.tables.map((table) =>
      deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`)
    )
  )

  if (catalogRefs.size === 0) {
    return catalogRefs
  }

  const seedRefs = new Set<string>()

  for (const conceptKey of deps.schemaContextConceptOrder) {
    const selectedRef = activeCatalog.selectedMappings[conceptKey]?.trim() ?? ''
    const selectedNormalized = deps.normalizeTableRef(selectedRef)

    if (selectedRef && catalogRefs.has(selectedNormalized)) {
      seedRefs.add(selectedNormalized)
    }

    const suggestions = activeCatalog.suggestedMappings[conceptKey] ?? []
    for (const suggestionRef of suggestions) {
      const normalizedSuggestion = deps.normalizeTableRef(suggestionRef)

      if (normalizedSuggestion && catalogRefs.has(normalizedSuggestion)) {
        seedRefs.add(normalizedSuggestion)
      }
    }
  }

  for (const table of activeCatalog.tables) {
    if (table.tags.length > 0) {
      seedRefs.add(deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`))
    }
  }

  if (seedRefs.size === 0) {
    return catalogRefs
  }

  const expandedRefs = new Set(seedRefs)

  for (const table of activeCatalog.tables) {
    const currentRef = deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`)
    const referencedRefs = table.foreignKeys
      .map((fk) => deps.normalizeTableRef(`${fk.referencedSchema}.${fk.referencedTable}`))
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

export function validateCatalogColumnReferences(
  deps: SqlExecutionDeps,
  sqlQuery: string,
  activeCatalog: SchemaCatalogEntry,
  allowedRefs: Set<string>,
  cteNames: Set<string>
): void {
  let ast: unknown

  try {
    ast = deps.sqlParser.astify(sqlQuery)
  } catch {
    return
  }

  const tableMap = buildCatalogTableAliasMap(deps, activeCatalog, allowedRefs, cteNames)

  visitSqlAstColumns(ast, tableMap, activeCatalog)
}

function buildCatalogTableAliasMap(
  deps: SqlExecutionDeps,
  activeCatalog: SchemaCatalogEntry,
  allowedRefs: Set<string>,
  _cteNames: Set<string>
): Map<string, { schemaName: string; tableName: string }> {
  const aliasMap = new Map<string, { schemaName: string; tableName: string }>()

  for (const table of activeCatalog.tables) {
    const normalizedRef = deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`)

    if (!allowedRefs.has(normalizedRef)) {
      continue
    }

    aliasMap.set(table.tableName.trim().toLowerCase(), {
      schemaName: table.schemaName,
      tableName: table.tableName
    })
    aliasMap.set(`${table.schemaName}.${table.tableName}`.trim().toLowerCase(), {
      schemaName: table.schemaName,
      tableName: table.tableName
    })
  }

  for (const table of activeCatalog.tables) {
    const normalizedRef = deps.normalizeTableRef(`${table.schemaName}.${table.tableName}`)

    if (!allowedRefs.has(normalizedRef) || _cteNames.has(table.tableName.trim().toLowerCase())) {
      continue
    }
  }

  return aliasMap
}

function visitSqlAstColumns(
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
    const resolvedTable = resolveCatalogTableForColumnRef(tableName, aliasMap, activeCatalog)

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

    const columnExists = catalogTable.columns.some(
      (column) => column.name.trim().toLowerCase() === columnName
    )

    if (!columnExists) {
      throw new Error(
        `Column [${columnName}] is not available in table [${catalogTable.schemaName}.${catalogTable.tableName}].`
      )
    }
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        visitSqlAstColumns(item, aliasMap, activeCatalog)
      }
      continue
    }

    if (value && typeof value === 'object') {
      visitSqlAstColumns(value, aliasMap, activeCatalog)
    }
  }
}

function resolveCatalogTableForColumnRef(
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

  const inScopeTables = activeCatalog.tables.filter((entry) =>
    aliasMap.has(entry.tableName.trim().toLowerCase())
  )

  if (inScopeTables.length === 1) {
    return {
      schemaName: inScopeTables[0].schemaName,
      tableName: inScopeTables[0].tableName
    }
  }

  return null
}

export function ensurePersonNameSearchPolicy(deps: SqlExecutionDeps, sqlQuery: string): void {
  const normalizedQuery = deps.normalizePersianDigits(sqlQuery)
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
      "Exact equality on person name/surname is not allowed. Use robust token-based matching with LIKE and proper Unicode prefixes (N'...') for compound names."
    )
  }
}

export function buildRuntimeScopeFilterRequirements(
  deps: SqlExecutionDeps,
  settings: AppSettings,
  conversationMemory: ConversationMemoryState
): RuntimeScopeFilterRequirement[] {
  const activeCatalog = deps.findActiveSchemaCatalog(settings)

  if (!activeCatalog) {
    return []
  }

  const scopeColumnCandidates = deps.collectRuntimeScopeColumnCandidates(activeCatalog)
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

function toRuntimeScopeDimensionLabel(dimension: RuntimeScopeDimension): string {
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

function hasColumnPredicateInWhereClause(normalizedSql: string, columnName: string): boolean {
  if (!normalizedSql || !columnName) {
    return false
  }

  const whereSections = normalizedSql.split(/\bwhere\b/gi).slice(1)

  if (whereSections.length === 0) {
    return false
  }

  const escapedColumnName = escapeRegexPattern(columnName)
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

function hasScopeValueConstraintInExpression(
  deps: SqlExecutionDeps,
  normalizedExpression: string,
  requirement: RuntimeScopeFilterRequirement
): boolean {
  if (
    !normalizedExpression ||
    requirement.values.length === 0 ||
    requirement.candidateColumnNames.length === 0
  ) {
    return false
  }

  for (const columnName of requirement.candidateColumnNames) {
    const escapedColumnName = escapeRegexPattern(columnName)
    const columnMentionPattern = new RegExp(`(?:\\.|\\b)${escapedColumnName}\\b`, 'i')

    if (!columnMentionPattern.test(normalizedExpression)) {
      continue
    }

    for (const value of requirement.values) {
      const normalizedValue = deps.normalizePersianDigits(value).trim().toLowerCase()

      if (!normalizedValue) {
        continue
      }

      const escapedValue = escapeRegexPattern(normalizedValue)
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

function hasScopeValueConstraintInWhereClause(
  deps: SqlExecutionDeps,
  normalizedSqlWithValues: string,
  requirement: RuntimeScopeFilterRequirement
): boolean {
  if (
    !normalizedSqlWithValues ||
    requirement.values.length === 0 ||
    requirement.candidateColumnNames.length === 0
  ) {
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

    if (hasScopeValueConstraintInExpression(deps, boundedSection, requirement)) {
      return true
    }
  }

  return false
}

function startsWithLogicalOperator(
  expression: string,
  index: number,
  operator: 'or' | 'and'
): boolean {
  const token = expression.slice(index, index + operator.length).toLowerCase()

  if (token !== operator) {
    return false
  }

  const previousChar = index > 0 ? expression[index - 1] : ' '
  const nextChar =
    index + operator.length < expression.length ? expression[index + operator.length] : ' '

  const previousIsBoundary = !/[a-z0-9_]/i.test(previousChar)
  const nextIsBoundary = !/[a-z0-9_]/i.test(nextChar)

  return previousIsBoundary && nextIsBoundary
}

function splitTopLevelDisjunction(expression: string): string[] {
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

    if (
      parenDepth === 0 &&
      bracketDepth === 0 &&
      startsWithLogicalOperator(expression, index, 'or')
    ) {
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

function hasWeakScopeDisjunctionInWhereClause(
  deps: SqlExecutionDeps,
  normalizedSqlWithValues: string,
  requirement: RuntimeScopeFilterRequirement
): boolean {
  if (
    !normalizedSqlWithValues ||
    requirement.values.length === 0 ||
    requirement.candidateColumnNames.length === 0
  ) {
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

    const disjunctionBranches = splitTopLevelDisjunction(boundedSection)

    if (disjunctionBranches.length <= 1) {
      continue
    }

    for (const branch of disjunctionBranches) {
      if (!hasScopeValueConstraintInExpression(deps, branch, requirement)) {
        return true
      }
    }
  }

  return false
}

export function ensureRuntimeScopeFilters(
  deps: SqlExecutionDeps,
  sqlQuery: string,
  requirements: RuntimeScopeFilterRequirement[]
): void {
  const normalizedSql = stripSqlCommentsAndLiterals(sqlQuery)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  const normalizedSqlWithValues = stripSqlComments(sqlQuery)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  for (const requirement of requirements) {
    const hasPredicate = requirement.candidateColumnNames.some((columnName) => {
      return hasColumnPredicateInWhereClause(normalizedSql, columnName)
    })

    if (!hasPredicate) {
      const scopeLabel = toRuntimeScopeDimensionLabel(requirement.dimension)
      const valuesText = requirement.values.join(' | ')
      const columnsText = requirement.candidateColumnNames.slice(0, 4).join(', ')

      throw deps.createAgentPolicyError(
        'AGENT_SCOPE_FILTER_REQUIRED',
        `Query is missing required ${scopeLabel} filter. Scope values: ${valuesText}. Add WHERE predicate using one of: ${columnsText}.`
      )
    }

    const hasScopeValueConstraint = hasScopeValueConstraintInWhereClause(
      deps,
      normalizedSqlWithValues,
      requirement
    )

    if (!hasScopeValueConstraint) {
      const scopeLabel = toRuntimeScopeDimensionLabel(requirement.dimension)
      const valuesText = requirement.values.join(' | ')

      throw deps.createAgentPolicyError(
        'AGENT_SCOPE_VALUE_FILTER_REQUIRED',
        `Query has ${scopeLabel} predicate but does not constrain requested scope values. Scope values: ${valuesText}.`
      )
    }

    const hasWeakDisjunction = hasWeakScopeDisjunctionInWhereClause(
      deps,
      normalizedSqlWithValues,
      requirement
    )

    if (hasWeakDisjunction) {
      const scopeLabel = toRuntimeScopeDimensionLabel(requirement.dimension)
      const valuesText = requirement.values.join(' | ')

      throw deps.createAgentPolicyError(
        'AGENT_SCOPE_FILTER_WEAK_CONSTRAINT',
        `Query contains weak OR branches that can bypass ${scopeLabel} scope constraints. Scope values: ${valuesText}.`
      )
    }
  }
}

export function ensureFinancialQueryAllowed(
  deps: SqlExecutionDeps,
  sqlQuery: string,
  settings: AppSettings,
  conversationMemory?: ConversationMemoryState
): void {
  const activeCatalog = deps.findActiveSchemaCatalog(settings)

  if (!activeCatalog || activeCatalog.tables.length === 0) {
    return
  }

  const referencedTables = extractReferencedTableRefs(sqlQuery)

  if (referencedTables.length === 0) {
    throw new Error(
      'Financial query must reference at least one base table in FROM/JOIN/APPLY clauses.'
    )
  }

  const allowedRefs = buildAllowedFinancialTableRefs(deps, activeCatalog)
  const catalogTableNameIndex = buildCatalogTableNameIndex(deps, activeCatalog)
  const cteNames = extractCteNames(sqlQuery)

  validateCatalogColumnReferences(deps, sqlQuery, activeCatalog, allowedRefs, cteNames)
  const activeDatabaseName = normalizeSqlIdentifier(activeCatalog.databaseName)
  let validatedRefCount = 0

  for (const tableRef of referencedTables) {
    if (tableRef.partCount > 4) {
      throw new Error(
        `Table reference [${tableRef.raw}] is invalid. Maximum identifier depth is 4 parts.`
      )
    }

    if (tableRef.serverName) {
      throw new Error(
        `Linked-server reference [${tableRef.raw}] is not allowed in financial data queries.`
      )
    }

    if (
      tableRef.databaseName &&
      activeDatabaseName &&
      tableRef.databaseName !== activeDatabaseName
    ) {
      throw new Error(
        `Cross-database reference [${tableRef.raw}] is not allowed. Active database is [${activeCatalog.databaseName}].`
      )
    }

    if (tableRef.schemaTable) {
      if (!allowedRefs.has(tableRef.schemaTable)) {
        throw new Error(
          `Table reference [${tableRef.raw}] is outside the allowed financial catalog scope.`
        )
      }

      validatedRefCount += 1
      continue
    }

    if (cteNames.has(tableRef.tableName)) {
      continue
    }

    const catalogMatches = catalogTableNameIndex.get(tableRef.tableName)

    if (!catalogMatches || catalogMatches.size === 0) {
      continue
    }

    const hasAllowedMatch = [...catalogMatches].some((candidate) => allowedRefs.has(candidate))

    if (!hasAllowedMatch) {
      throw new Error(
        `Table reference [${tableRef.raw}] is outside the allowed financial catalog scope.`
      )
    }

    validatedRefCount += 1
  }

  if (validatedRefCount === 0) {
    throw new Error(
      'Financial query must reference at least one allowed base table (schema.table) from discovered catalog.'
    )
  }

  if (conversationMemory) {
    const scopeRequirements = buildRuntimeScopeFilterRequirements(
      deps,
      settings,
      conversationMemory
    )

    if (scopeRequirements.length > 0) {
      ensureRuntimeScopeFilters(deps, sqlQuery, scopeRequirements)
    }
  }

  ensurePersonNameSearchPolicy(deps, sqlQuery)
}
