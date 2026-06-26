/**
 * Placeholder type definitions for the Financial Reasoning Engine (FRE).
 *
 * These interfaces are intentionally minimal stubs — Phase 2 will fill in
 * the full schema, validation, and field details.
 *
 * @see FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md
 */

export type MetricId = string

export type Grain = 'total' | 'by_year' | 'by_month' | 'by_branch' | 'by_account'

export interface MetricDefinition {
  /** TODO: Phase 2 — full declarative metric definition */
  id: MetricId
  label: string
}

export interface MetricPlan {
  /** TODO: Phase 2 — Planner output IR */
  metricId: MetricId
  grain: Grain
}

export interface CompiledQuery {
  /** TODO: Phase 2 — compiler output */
  sql: string
}

export interface EngineResult {
  /** TODO: Phase 2 — executor output */
  rows: unknown[]
}

export interface EngineVerdict {
  /** TODO: Phase 3 — verifier output */
  status: 'verified' | 'rejected' | 'not-implemented'
}

export type FinancialEngineMode = 'legacy' | 'shadow' | 'engine'
