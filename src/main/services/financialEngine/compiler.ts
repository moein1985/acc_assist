/**
 * Deterministic SQL compiler for the Financial Reasoning Engine (FRE).
 *
 * Phase 1: no-op stub. Phase 2 will implement compileMetricPlan which
 * transforms a MetricPlan + MetricDefinition + Catalog into a safe SQL string.
 *
 * @see FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md
 */

import type { CompiledQuery, MetricDefinition, MetricPlan, Grain, MetricSource, AggregateKind, DimensionBinding, MetricFilter, ConceptSource, ConceptAggregateKind, ConceptDimensionBinding, ConceptFilter } from './types'
import type { SchemaAdapter } from './schemaAdapter'
import { AccountingConcept } from './schemaAdapter'

export interface CompilerDeps {
  quoteSqlTableRef: (ref: string) => string
  quoteSqlIdentifier: (value: string) => string
  normalizePersianText: (input: string) => string
  /** Schema adapter for concept-based resolution (S15.16) */
  adapter?: SchemaAdapter
}

function buildMeasureExpr(
  measure: MetricDefinition['measure'],
  alias: string,
  deps: CompilerDeps
): string {
  switch (measure.kind) {
    case 'sum': {
      const col = deps.quoteSqlIdentifier(measure.column)
      return `SUM(CAST(${alias}.${col} AS decimal(18,4)))`
    }
    case 'count': {
      return `COUNT(*)`
    }
    case 'debit_minus_credit': {
      const debit = deps.quoteSqlIdentifier(measure.debitColumn)
      const credit = deps.quoteSqlIdentifier(measure.creditColumn)
      return `SUM(${alias}.${debit}) - SUM(${alias}.${credit})`
    }
    case 'list': {
      return measure.columns
        .map((c) => {
          if (c.includes('(') || c.includes(' ')) {
            return c
          }
          if (c.includes('.')) {
            return c
              .split('.')
              .map((part) => deps.quoteSqlIdentifier(part))
              .join('.')
          }
          return `${alias}.${deps.quoteSqlIdentifier(c)}`
        })
        .join(', ')
    }
  }
}

function escapeNString(value: string): string {
  return value.replace(/'/g, "''")
}

function formatFilterValue(value: string, labelType: 'nstring' | 'int'): string {
  if (labelType === 'int') {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw new Error(`Invalid integer filter value: ${value}`)
    }
    return String(parsed)
  }
  return `N'${escapeNString(value)}'`
}

function findDimension(
  definition: MetricDefinition,
  grain: Grain
): MetricDefinition['dimensions'][number] | undefined {
  return definition.dimensions.find((d) => d.dimension === grain)
}

function resolveLabelColumn(dim: MetricDefinition['dimensions'][number]): string {
  // S14.15: Use custom expression for computed dimensions (e.g. age buckets)
  if (dim.expression) {
    return dim.expression
  }
  if (dim.join) {
    if (dim.labelColumn.includes('.')) {
      return dim.labelColumn
    }
    return `${dim.join.alias}.${dim.labelColumn}`
  }
  return dim.labelColumn
}

function buildJoinClauses(
  definition: MetricDefinition,
  plan: MetricPlan,
  deps: CompilerDeps
): string[] {
  const joins: string[] = []
  const seen = new Set<string>()

  const addRequiredJoin = (rj: {
    table: string
    alias: string
    on: { sourceColumn: string; targetColumn: string }
    sourceAlias?: string
  }): void => {
    const key = `${rj.table}:${rj.alias}`
    if (seen.has(key)) return
    seen.add(key)
    const table = deps.quoteSqlTableRef(rj.table)
    const sourceAlias = rj.sourceAlias ?? definition.source.alias
    const onLeft = `${sourceAlias}.${deps.quoteSqlIdentifier(rj.on.sourceColumn)}`
    const onRight = `${rj.alias}.${deps.quoteSqlIdentifier(rj.on.targetColumn)}`
    joins.push(`JOIN ${table} ${rj.alias} ON ${onLeft} = ${onRight}`)
  }

  const addDimensionJoin = (dim: MetricDefinition['dimensions'][number]): void => {
    if (!dim.join) return
    const key = `${dim.join.table}:${dim.join.alias}`
    if (seen.has(key)) return
    seen.add(key)
    const table = deps.quoteSqlTableRef(dim.join.table)
    const sourceAlias = dim.join.sourceAlias ?? definition.source.alias
    const onLeft = `${sourceAlias}.${deps.quoteSqlIdentifier(dim.join.on.sourceColumn)}`
    const onRight = `${dim.join.alias}.${deps.quoteSqlIdentifier(dim.join.on.targetColumn)}`
    joins.push(`JOIN ${table} ${dim.join.alias} ON ${onLeft} = ${onRight}`)
  }

  if (definition.source.requiredJoins) {
    for (const rj of definition.source.requiredJoins) {
      addRequiredJoin(rj)
    }
  }

  for (const filter of plan.filters) {
    const dim = findDimension(definition, filter.dimension)
    if (dim) addDimensionJoin(dim)
  }

  if (plan.comparison) {
    const dim = findDimension(definition, plan.comparison.dimension)
    if (dim) addDimensionJoin(dim)
  }

  if (plan.grain !== 'total') {
    const dim = findDimension(definition, plan.grain)
    if (dim) addDimensionJoin(dim)
  }

  if (definition.entityNameMatch && plan.entityName) {
    const dim = findDimension(definition, 'by_account')
    if (dim) addDimensionJoin(dim)
  }

  return joins
}

function buildWhereClauses(
  definition: MetricDefinition,
  plan: MetricPlan,
  deps: CompilerDeps
): string[] {
  const where: string[] = []

  for (const filter of definition.mandatoryFilters) {
    where.push(filter.sql)
  }

  // S14.4: Apply date range filter if present
  if (plan.dateRange && definition.dateColumn) {
    const dateCol = definition.dateColumn
    if (plan.dateRange.start && plan.dateRange.end) {
      where.push(
        `${dateCol} >= '${plan.dateRange.start}' AND ${dateCol} <= '${plan.dateRange.end}'`
      )
    } else if (plan.dateRange.start) {
      where.push(`${dateCol} >= '${plan.dateRange.start}'`)
    } else if (plan.dateRange.end) {
      where.push(`${dateCol} <= '${plan.dateRange.end}'`)
    }
  }

  for (const pf of plan.filters) {
    const dim = findDimension(definition, pf.dimension)
    if (!dim) continue
    const labelCol = resolveLabelColumn(dim)
    if (pf.op === 'eq') {
      where.push(`${labelCol} = ${formatFilterValue(pf.values[0], dim.labelType)}`)
    } else if (pf.op === 'between') {
      const from = formatFilterValue(pf.values[0], dim.labelType)
      const to = formatFilterValue(pf.values[1], dim.labelType)
      where.push(`${labelCol} BETWEEN ${from} AND ${to}`)
    } else {
      const formatted = pf.values.map((v) => formatFilterValue(v, dim.labelType))
      where.push(`${labelCol} IN (${formatted.join(', ')})`)
    }
  }

  if (definition.entityNameMatch && plan.entityName) {
    // S25.9: If resolvedPartyId is set, use exact PartnerId filter
    if (plan.resolvedPartyId != null) {
      where.push(`p.PartyId = ${plan.resolvedPartyId}`)
    } else {
      const col = definition.entityNameMatch.column
      let value: string
      if (definition.entityNameMatch.foldPersian) {
        value = deps.normalizePersianText(plan.entityName)
        const foldedCol = `REPLACE(REPLACE(REPLACE(${col}, NCHAR(1610), NCHAR(1740)), NCHAR(1609), NCHAR(1740)), NCHAR(1603), NCHAR(1705))`
        where.push(`${foldedCol} LIKE N'%${escapeNString(value)}%'`)
      } else {
        value = plan.entityName
        where.push(`${col} LIKE N'%${escapeNString(value)}%'`)
      }
    }
  }

  // S14.6: Voucher number filter for voucher_detail
  if (plan.voucherNumber) {
    where.push(`v.Number = ${Number(plan.voucherNumber)}`)
  }

  // S14.8: Voucher type filter for vouchers_by_type
  if (plan.voucherType) {
    where.push(`v.Type = ${Number(plan.voucherType)}`)
  }

  return where
}

function buildComparisonQuery(
  plan: MetricPlan,
  definition: MetricDefinition,
  deps: CompilerDeps
): string {
  const { source, measure } = definition
  const table = deps.quoteSqlTableRef(source.primaryTable)
  const alias = source.alias
  const measureExpr = buildMeasureExpr(measure, alias, deps)

  const joins = buildJoinClauses(definition, plan, deps)
  const where = buildWhereClauses(definition, plan, deps)

  const comp = plan.comparison!
  const compDim = findDimension(definition, comp.dimension)
  if (!compDim) {
    throw new Error(`Dimension ${comp.dimension} not found for metric ${plan.metricId}`)
  }

  const labelCol = resolveLabelColumn(compDim)
  const baseVal = formatFilterValue(comp.baseValue, compDim.labelType)
  const targetVal = formatFilterValue(comp.targetValue, compDim.labelType)

  const sql = [
    `WITH yearly_data AS (`,
    `  SELECT ${labelCol} AS period, ${measureExpr} AS value`,
    `  FROM ${table} ${alias}`,
    joins.length > 0 ? `  ${joins.join('\n  ')}` : null,
    where.length > 0 ? `  WHERE ${where.join(' AND ')}` : null,
    `  GROUP BY ${labelCol}`,
    `)`,
    `SELECT`,
    `  MAX(CASE WHEN period = ${baseVal} THEN value END) AS base_value,`,
    `  MAX(CASE WHEN period = ${targetVal} THEN value END) AS target_value,`,
    `  CASE`,
    `    WHEN MAX(CASE WHEN period = ${baseVal} THEN value END) IS NULL THEN NULL`,
    `    WHEN MAX(CASE WHEN period = ${baseVal} THEN value END) = 0 THEN NULL`,
    `    ELSE (MAX(CASE WHEN period = ${targetVal} THEN value END) - MAX(CASE WHEN period = ${baseVal} THEN value END)) * 100.0 / MAX(CASE WHEN period = ${baseVal} THEN value END)`,
    `  END AS percent_change`,
    `FROM yearly_data`
  ]
    .filter((line) => line !== null)
    .join('\n')

  return sql
}

function buildStandardQuery(
  plan: MetricPlan,
  definition: MetricDefinition,
  deps: CompilerDeps
): string {
  const { source, measure } = definition
  const table = deps.quoteSqlTableRef(source.primaryTable)
  const alias = source.alias
  const measureExpr = buildMeasureExpr(measure, alias, deps)

  const joins = buildJoinClauses(definition, plan, deps)
  const where = buildWhereClauses(definition, plan, deps)

  const isList = measure.kind === 'list'
  const groupByCols: string[] = []
  const selectCols: string[] = isList ? [measureExpr] : [`${measureExpr} AS result_value`]

  if (plan.grain !== 'total' && plan.grain !== 'by_voucher') {
    const dim = findDimension(definition, plan.grain)
    if (dim) {
      const labelCol = resolveLabelColumn(dim)
      selectCols.unshift(`${labelCol} AS period`)
      groupByCols.push(labelCol)
    }
  }

  // S14.19: by_voucher adds voucher number as period column
  // For list measures, no GROUP BY needed. For aggregate measures, GROUP BY is required.
  if (plan.grain === 'by_voucher') {
    const dim = findDimension(definition, 'by_voucher')
    if (dim) {
      const labelCol = resolveLabelColumn(dim)
      selectCols.unshift(`${labelCol} AS period`)
      if (!isList) {
        groupByCols.push(labelCol)
      }
    }
  }

  // S14.10: Use custom GROUP BY columns from definition if provided
  if (definition.groupByColumns && groupByCols.length === 0) {
    groupByCols.push(...definition.groupByColumns)
  }

  const topN = plan.topN
  const selectClause = topN ? `SELECT TOP(${topN}) ${selectCols.join(', ')}` : `SELECT ${selectCols.join(', ')}`

  const sql = [
    selectClause,
    `FROM ${table} ${alias}`,
    joins.length > 0 ? joins.join('\n') : null,
    where.length > 0 ? `WHERE ${where.join(' AND ')}` : null,
    groupByCols.length > 0 ? `GROUP BY ${groupByCols.join(', ')}` : null,
    definition.havingClause ? `HAVING ${definition.havingClause}` : null,
    definition.orderBy ? `ORDER BY ${definition.orderBy.column} ${definition.orderBy.direction}` : null
  ]
    .filter((line) => line !== null)
    .join('\n')

  return sql
}

// ─── S15.16: Concept-based resolution layer ───

function resolveConceptColumn(adapter: SchemaAdapter, concept: AccountingConcept, field: string): string {
  if (field === 'primary_key') {
    return adapter.getPrimaryKeyColumn(concept)
  }
  return adapter.resolveColumn(concept, field)
}

function findConceptAlias(cs: ConceptSource, concept: AccountingConcept): string | null {
  if (cs.concept === concept) return cs.alias
  for (const rj of cs.requiredJoins ?? []) {
    if (rj.concept === concept) return rj.alias
  }
  for (const fc of cs.fallbackConcepts ?? []) {
    if (fc.concept === concept) return fc.alias
  }
  for (const cc of cs.compositeConcepts ?? []) {
    if (cc.concept === concept) return cc.alias
  }
  return null
}

function resolveConceptMeasure(measure: ConceptAggregateKind, concept: AccountingConcept, adapter: SchemaAdapter): AggregateKind {
  switch (measure.kind) {
    case 'sum':
      return { kind: 'sum', column: adapter.resolveColumn(concept, measure.field) }
    case 'count':
      return { kind: 'count' }
    case 'debit_minus_credit':
      return {
        kind: 'debit_minus_credit',
        debitColumn: adapter.resolveColumn(concept, measure.debitField),
        creditColumn: adapter.resolveColumn(concept, measure.creditField)
      }
    case 'list':
      return { kind: 'list', columns: measure.fields.map(f => adapter.resolveColumn(concept, f)) }
  }
}

function resolveConceptSource(cs: ConceptSource, adapter: SchemaAdapter): MetricSource {
  const source: MetricSource = {
    primaryTable: adapter.resolveTable(cs.concept),
    alias: cs.alias
  }
  if (cs.requiredJoins) {
    source.requiredJoins = cs.requiredJoins.map(rj => ({
      table: adapter.resolveTable(rj.concept),
      alias: rj.alias,
      on: {
        sourceColumn: resolveConceptColumn(adapter, cs.concept, rj.on.sourceColumn),
        targetColumn: resolveConceptColumn(adapter, rj.concept, rj.on.targetColumn)
      }
    }))
  }
  if (cs.fallbackConcepts) {
    source.fallbackTables = cs.fallbackConcepts.map(fc => ({
      table: adapter.resolveTable(fc.concept),
      alias: fc.alias,
      measure: resolveConceptMeasure(fc.measure, fc.concept, adapter),
      filters: fc.filters ? resolveConceptFilters(fc.filters, cs, adapter) : undefined
    }))
  }
  if (cs.compositeConcepts) {
    source.compositeSources = cs.compositeConcepts.map(cc => ({
      table: adapter.resolveTable(cc.concept),
      alias: cc.alias,
      measure: resolveConceptMeasure(cc.measure, cc.concept, adapter),
      filters: cc.filters ? resolveConceptFilters(cc.filters, cs, adapter) : undefined
    }))
  }
  return source
}

function resolveConceptDimensions(
  conceptDims: ConceptDimensionBinding[],
  cs: ConceptSource,
  adapter: SchemaAdapter,
  conceptDateColumn?: { sourceAlias: string; field: string }
): DimensionBinding[] {
  return conceptDims.map(cd => {
    const dim: DimensionBinding = {
      dimension: cd.dimension,
      labelColumn: '',
      labelType: cd.labelType
    }
    if (cd.expression) {
      let expr = cd.expression
      if (conceptDateColumn) {
        const dateCol = adapter.resolveColumn(cs.concept, conceptDateColumn.field)
        expr = expr.replace('{dateColumn}', dateCol)
      }
      dim.expression = expr
      dim.labelColumn = expr
    } else if (cd.conceptLabelField && cd.conceptJoin) {
      const sourceConcept = cd.conceptJoin.sourceAlias
        ? (findConceptByAlias(cs, cd.conceptJoin.sourceAlias) ?? cs.concept)
        : cs.concept
      dim.join = {
        table: adapter.resolveTable(cd.conceptJoin.concept),
        alias: cd.conceptJoin.alias,
        on: {
          sourceColumn: resolveConceptColumn(adapter, sourceConcept, cd.conceptJoin.on.sourceColumn),
          targetColumn: resolveConceptColumn(adapter, cd.conceptJoin.concept, cd.conceptJoin.on.targetColumn)
        },
        sourceAlias: cd.conceptJoin.sourceAlias
      }
      dim.labelColumn = adapter.resolveColumn(cd.conceptJoin.concept, cd.conceptLabelField)
    } else if (cd.conceptLabelField) {
      dim.labelColumn = adapter.resolveColumn(cs.concept, cd.conceptLabelField)
    }
    return dim
  })
}

function resolveEnumValues(adapter: SchemaAdapter, concept: AccountingConcept, field: string, values: string[]): number[] {
  if (concept === AccountingConcept.voucher && field === 'voucher_type') {
    const enumMap = adapter.enums.voucherType as Record<string, number[]>
    const result: number[] = []
    for (const v of values) {
      const mapped = enumMap[v]
      if (mapped) result.push(...mapped)
    }
    return result
  }
  if (concept === AccountingConcept.inventory_receipt && field === 'return_type') {
    const enumMap = adapter.enums.inventoryReturnType as Record<string, number>
    return values.map(v => enumMap[v]).filter((v): v is number => v != null)
  }
  return values.map(v => Number(v)).filter((v): v is number => !isNaN(v))
}

function resolveConceptFilters(
  filters: ConceptFilter[],
  cs: ConceptSource,
  adapter: SchemaAdapter
): MetricFilter[] {
  return filters.map(cf => {
    const alias = findConceptAlias(cs, cf.concept) ?? cs.alias
    const column = adapter.resolveColumn(cf.concept, cf.field)
    const colRef = `${alias}.${column}`
    let sql: string
    if (cf.op === 'like') {
      sql = `${colRef} LIKE N'${String(cf.value).replace(/'/g, "''")}'`
    } else if (cf.op === 'eq' || cf.op === 'ne') {
      const vals = Array.isArray(cf.value) ? cf.value : [cf.value]
      const enumVals = resolveEnumValues(adapter, cf.concept, cf.field, vals)
      if (enumVals.length > 0) {
        sql = `${colRef} ${cf.op === 'eq' ? '=' : '<>'} ${enumVals[0]}`
      } else {
        sql = `${colRef} ${cf.op === 'eq' ? '=' : '<>'} N'${vals[0].replace(/'/g, "''")}'`
      }
    } else if (cf.op === 'in' || cf.op === 'not_in') {
      const vals = Array.isArray(cf.value) ? cf.value : [cf.value]
      const enumVals = resolveEnumValues(adapter, cf.concept, cf.field, vals)
      if (enumVals.length > 0) {
        sql = `${colRef} ${cf.op === 'in' ? 'IN' : 'NOT IN'} (${enumVals.join(', ')})`
      } else {
        sql = `${colRef} ${cf.op === 'in' ? 'IN' : 'NOT IN'} (${vals.map(v => `N'${v.replace(/'/g, "''")}'`).join(', ')})`
      }
    } else {
      sql = `${colRef} = N'${String(cf.value).replace(/'/g, "''")}'`
    }
    return { sql, description: cf.description }
  })
}

function resolveDefinition(definition: MetricDefinition, adapter: SchemaAdapter): MetricDefinition {
  if (!definition.conceptSource) return definition
  const cs = definition.conceptSource
  const resolvedSource = resolveConceptSource(cs, adapter)
  const resolvedMeasure = definition.conceptMeasure
    ? resolveConceptMeasure(definition.conceptMeasure, cs.concept, adapter)
    : definition.measure
  const resolvedDimensions = definition.conceptDimensions
    ? resolveConceptDimensions(definition.conceptDimensions, cs, adapter, definition.conceptDateColumn)
    : definition.dimensions
  const resolvedFilters = definition.conceptFilters
    ? resolveConceptFilters(definition.conceptFilters, cs, adapter)
    : definition.mandatoryFilters
  const resolved: MetricDefinition = {
    ...definition,
    source: resolvedSource,
    measure: resolvedMeasure,
    dimensions: resolvedDimensions,
    mandatoryFilters: resolvedFilters,
    conceptSource: undefined,
    conceptMeasure: undefined,
    conceptDimensions: undefined,
    conceptFilters: undefined
  }
  if (definition.conceptDateColumn) {
    const cdc = definition.conceptDateColumn
    const conceptForAlias = findConceptByAlias(cs, cdc.sourceAlias) ?? cs.concept
    resolved.dateColumn = `${cdc.sourceAlias}.${adapter.resolveColumn(conceptForAlias, cdc.field)}`
  }
  if (definition.conceptEntityNameMatch) {
    const cem = definition.conceptEntityNameMatch
    const alias = findConceptAlias(cs, cem.concept) ?? cs.alias
    resolved.entityNameMatch = {
      column: `${alias}.${adapter.resolveColumn(cem.concept, cem.field)}`,
      foldPersian: cem.foldPersian
    }
  }
  return resolved
}

function findConceptByAlias(cs: ConceptSource, alias: string): AccountingConcept | null {
  if (cs.alias === alias) return cs.concept
  for (const rj of cs.requiredJoins ?? []) {
    if (rj.alias === alias) return rj.concept
  }
  for (const fc of cs.fallbackConcepts ?? []) {
    if (fc.alias === alias) return fc.concept
  }
  for (const cc of cs.compositeConcepts ?? []) {
    if (cc.alias === alias) return cc.concept
  }
  return null
}

export function compileMetricPlan(
  plan: MetricPlan,
  definition: MetricDefinition,
  deps: CompilerDeps
): CompiledQuery {
  const resolvedDef = (deps.adapter && definition.conceptSource)
    ? resolveDefinition(definition, deps.adapter)
    : definition

  let sql: string

  if (plan.comparison) {
    sql = buildComparisonQuery(plan, resolvedDef, deps)
  } else {
    sql = buildStandardQuery(plan, resolvedDef, deps)
  }

  const bindings: string[] = []
  for (const f of plan.filters) {
    bindings.push(`${f.dimension} ${f.op} [${f.values.join(', ')}]`)
  }
  if (plan.comparison) {
    bindings.push(
      `comparison ${plan.comparison.dimension}: ${plan.comparison.baseValue} → ${plan.comparison.targetValue}`
    )
  }
  if (plan.entityName) {
    bindings.push(`entityName: ${plan.entityName}`)
  }
  if (plan.dateRange) {
    bindings.push(`dateRange: ${plan.dateRange.start ?? '*'} → ${plan.dateRange.end ?? '*'}`)
  }
  if (plan.voucherNumber) {
    bindings.push(`voucherNumber: ${plan.voucherNumber}`)
  }
  if (plan.voucherType) {
    bindings.push(`voucherType: ${plan.voucherType}`)
  }

  return {
    sql,
    bindingsDescription: bindings.join('; ') || 'no filters'
  }
}
