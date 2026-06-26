/**
 * First-pass metric router for the Financial Reasoning Engine (FRE).
 *
 * Phase 1: no-op stub. Phase 2 will implement deterministic first-pass
 * metric identification from Persian prompts.
 *
 * @see FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md
 */

import type { MetricId } from './types'

export interface RouterResult {
  metricId: MetricId | null
  confidence: number
}

export function routeMetric(prompt: string): RouterResult {
  void prompt
  // TODO: Phase 2 — deterministic first-pass metric routing
  return { metricId: null, confidence: 0 }
}
