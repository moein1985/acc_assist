/**
 * First-pass metric router for the Financial Reasoning Engine (FRE).
 *
 * Phase 1: no-op stub. Phase 2 will implement deterministic first-pass
 * metric identification from Persian prompts.
 *
 * @see FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md
 */

import type { MetricId } from './types'
import { getMetricCatalog } from './metricCatalog'
import { normalizePersianText, normalizePersianDigits } from '../textNormalization'

export interface RouterResult {
  metricId: MetricId | null
  confidence: number
}

export function routeMetric(prompt: string): RouterResult {
  const normalized = normalizePersianText(normalizePersianDigits(prompt))
  if (!normalized) return { metricId: null, confidence: 0 }

  const catalog = getMetricCatalog()
  let bestId: MetricId | null = null
  let bestScore = 0

  for (const metric of catalog) {
    let score = 0
    let excluded = false

    for (const anchor of metric.anchors) {
      const normalizedAnchor = normalizePersianText(anchor)
      if (normalized.includes(normalizedAnchor)) {
        score += 2
      }
    }

    if (metric.excludeSignals) {
      for (const signal of metric.excludeSignals) {
        const normalizedSignal = normalizePersianText(signal)
        if (normalized.includes(normalizedSignal)) {
          excluded = true
          break
        }
      }
    }

    if (excluded) continue

    if (score > bestScore) {
      bestScore = score
      bestId = metric.id
    }
  }

  const confidence = bestScore >= 4 ? 1.0 : bestScore >= 2 ? 0.7 : 0
  return { metricId: bestId, confidence }
}
