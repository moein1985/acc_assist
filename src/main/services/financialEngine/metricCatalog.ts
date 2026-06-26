/**
 * Metric catalog registry for the Financial Reasoning Engine (FRE).
 *
 * Phase 1: no-op stub. Phase 2 will populate this with declarative
 * MetricDefinition entries for each migrated metric.
 *
 * @see FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md
 */

import type { MetricDefinition } from './types'

export function getMetricCatalog(): MetricDefinition[] {
  // TODO: Phase 2 — return the full declarative metric catalog
  return []
}

export function findMetricById(id: string): MetricDefinition | null {
  void id
  // TODO: Phase 2 — lookup metric by id
  return null
}
