/**
 * Verifier / Critic for the Financial Reasoning Engine (FRE).
 *
 * Phase 1: no-op stub. Phase 3 will implement verifyResult which checks
 * reconciliation, intent-alignment, and evidence contracts.
 *
 * @see FRE_ROADMAP_03_PLANNER_AND_VERIFIER.fa.md
 */

import type { EngineResult, EngineVerdict, MetricPlan } from './types'

export function verifyResult(plan: MetricPlan, result: EngineResult): EngineVerdict {
  void plan
  void result
  // TODO: Phase 3 — reconciliation + intent-alignment + evidence verification
  return { status: 'not-implemented' }
}
