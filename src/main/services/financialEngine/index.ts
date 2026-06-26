/**
 * FinancialEngine — orchestrates the plan → compile → exec → verify → explain pipeline.
 *
 * Phase 1: no-op stub. None of these methods are called yet.
 * Phase 2+ will wire the actual pipeline.
 *
 * @see FRE_ROADMAP_00_OVERVIEW.fa.md
 */

import type { EngineResult, EngineVerdict, MetricPlan } from './types'

export interface EngineRunResult {
  verdict: EngineVerdict
  result: EngineResult | null
}

export class FinancialEngine {
  async run(plan: MetricPlan): Promise<EngineRunResult> {
    void plan
    // TODO: Phase 2+ — plan → compile → exec → verify → explain
    return {
      verdict: { status: 'not-implemented' },
      result: null
    }
  }
}
