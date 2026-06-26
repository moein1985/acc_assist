/**
 * Deterministic SQL compiler for the Financial Reasoning Engine (FRE).
 *
 * Phase 1: no-op stub. Phase 2 will implement compileMetricPlan which
 * transforms a MetricPlan + MetricDefinition + Catalog into a safe SQL string.
 *
 * @see FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md
 */

import type { CompiledQuery, MetricDefinition, MetricPlan } from './types'

export function compileMetricPlan(
  plan: MetricPlan,
  definition: MetricDefinition
): CompiledQuery | null {
  void plan
  void definition
  // TODO: Phase 2 — deterministic compilation of MetricPlan to SQL
  return null
}
