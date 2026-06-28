/**
 * Deterministic SQL compiler for the Financial Reasoning Engine (FRE).
 *
 * Phase 1: no-op stub. Phase 2 will implement compileMetricPlan which
 * transforms a MetricPlan + MetricDefinition + Catalog into a safe SQL string.
 *
 * @see FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md
 */

import type { CompiledQuery, MetricDefinition, MetricPlan, Grain } from './types'

export interface CompilerDeps {
  quoteSqlTableRef: (ref: string) => string
  quoteSqlIdentifier: (value: string) => string
  normalizePersianText: (input: string) => string
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
      return measure.columns.map((c) => `${alias}.${deps.quoteSqlIdentifier(c)}`).join(', ')
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
  if (dim.join) {
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
  }): void => {
    const key = `${rj.table}:${rj.alias}`
    if (seen.has(key)) return
    seen.add(key)
    const table = deps.quoteSqlTableRef(rj.table)
    const onLeft = `${definition.source.alias}.${deps.quoteSqlIdentifier(rj.on.sourceColumn)}`
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

  if (plan.grain !== 'total') {
    const dim = findDimension(definition, plan.grain)
    if (dim) {
      const labelCol = resolveLabelColumn(dim)
      selectCols.unshift(`${labelCol} AS period`)
      groupByCols.push(labelCol)
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

export function compileMetricPlan(
  plan: MetricPlan,
  definition: MetricDefinition,
  deps: CompilerDeps
): CompiledQuery {
  let sql: string

  if (plan.comparison) {
    sql = buildComparisonQuery(plan, definition, deps)
  } else {
    sql = buildStandardQuery(plan, definition, deps)
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
