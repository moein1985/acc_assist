/**
 * First-pass metric router for the Financial Reasoning Engine (FRE).
 *
 * Phase 1: no-op stub. Phase 2 will implement deterministic first-pass
 * metric identification from Persian prompts.
 *
 * @see FRE_ROADMAP_02_SEMANTIC_LAYER_AND_COMPILER.fa.md
 */

import type { MetricId, JoinMode } from './types'
import type { DerivedMetric } from './types'
import { getMetricCatalog } from './metricCatalog'
import { derivedCatalog } from './derivedCatalog'
import { normalizePersianText, normalizePersianDigits } from '../textNormalization'

export interface RouterResult {
  metricId: MetricId | null
  confidence: number
}

export interface MultiMetricRouterResult {
  metricIds: MetricId[]
  joinMode: JoinMode
  confidence: number
}

const COMPARISON_SIGNALS = ['مقایسه', 'در برابر', 'نسبت']
const TREND_SIGNALS = ['روند']

// --- LRU cache for routeMetric (S9.14) ---
const ROUTE_CACHE_MAX = 100
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000
const routeCache = new Map<string, { result: RouterResult; expires: number }>()

function getCachedRoute(key: string): RouterResult | null {
  const entry = routeCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expires) {
    routeCache.delete(key)
    return null
  }
  return entry.result
}

function setCachedRoute(key: string, result: RouterResult): void {
  if (routeCache.size >= ROUTE_CACHE_MAX) {
    const firstKey = routeCache.keys().next().value
    if (firstKey) routeCache.delete(firstKey)
  }
  routeCache.set(key, { result, expires: Date.now() + ROUTE_CACHE_TTL_MS })
}

export function routeMultiMetric(prompt: string, softwareId?: string): MultiMetricRouterResult {
  const normalized = normalizePersianText(normalizePersianDigits(prompt))
  if (!normalized) return { metricIds: [], joinMode: 'side_by_side', confidence: 0 }

  let joinMode: JoinMode = 'side_by_side'
  for (const sig of COMPARISON_SIGNALS) {
    if (normalized.includes(sig)) {
      joinMode = 'comparison'
      break
    }
  }
  if (joinMode !== 'comparison') {
    for (const sig of TREND_SIGNALS) {
      if (normalized.includes(sig)) {
        joinMode = 'trend'
        break
      }
    }
  }

  if (joinMode === 'trend') {
    const route = routeMetric(prompt, softwareId)
    if (route.metricId && route.confidence >= 0.5) {
      return { metricIds: [route.metricId], joinMode, confidence: route.confidence }
    }
    return { metricIds: [], joinMode, confidence: 0 }
  }

  const separators = [' و ', ' همراه ', ' و همچنین ']
  let segments: string[] = [normalized]
  for (const sep of separators) {
    const parts = normalized.split(sep)
    if (parts.length >= 2) {
      segments = parts
      break
    }
  }

  const metricIds: MetricId[] = []
  for (const seg of segments) {
    const route = routeMetric(seg.trim(), softwareId)
    if (route.metricId && route.confidence >= 0.5) {
      metricIds.push(route.metricId)
    }
  }

  if (metricIds.length < 2) {
    return { metricIds: [], joinMode: 'side_by_side', confidence: 0 }
  }

  const uniqueIds = [...new Set(metricIds)]
  return { metricIds: uniqueIds, joinMode, confidence: 1.0 }
}

export function routeDerivedMetric(prompt: string): DerivedMetric | null {
  const normalized = normalizePersianText(normalizePersianDigits(prompt))
  if (!normalized) return null

  for (const derived of derivedCatalog) {
    const normalizedTitle = normalizePersianText(derived.titleFa)
    if (normalized.includes(normalizedTitle)) {
      return derived
    }
    const normalizedDesc = normalizePersianText(derived.description)
    const descWords = normalizedDesc.split(/\s+/)
    if (descWords.length >= 2) {
      const matched = descWords.every((w) => w.length > 2 && normalized.includes(w))
      if (matched) return derived
    }
  }

  return null
}

export function routeMetric(prompt: string, softwareId?: string): RouterResult {
  const normalized = normalizePersianText(normalizePersianDigits(prompt)).toLowerCase()
  if (!normalized) return { metricId: null, confidence: 0 }

  // S40.6: Cache key bumped to v3 for weighted excludeSignals
  const cacheKey = `v3:${softwareId ? softwareId + ':' : ''}${normalized}`
  const cached = getCachedRoute(cacheKey)
  if (cached) return cached

  // S22.2: Generic anchors (short, common words) get penalized
  const GENERIC_ANCHORS = new Set([
    'فروش', 'خرید', 'تراز', 'حساب', 'مالیات', 'سود', 'مانده',
    'هزینه', 'درآمد', 'پرداختنی', 'دریافتنی', 'پروژه',
    'sales', 'buy', 'balance', 'profit', 'expenses', 'revenue'
  ])

  const catalog = getMetricCatalog()
  let bestId: MetricId | null = null
  let bestScore = 0

  for (const metric of catalog) {
    let score = 0

    // S15.17: Use adapter-specific anchors when available
    const anchors = (softwareId && metric.adapterAnchors?.[softwareId])
      ? metric.adapterAnchors[softwareId]
      : metric.anchors

    for (const anchor of anchors) {
      const normalizedAnchor = normalizePersianText(anchor).toLowerCase()
      if (normalized.includes(normalizedAnchor)) {
        // S22.1: Weight by anchor length (longer = more specific = more weight)
        // S22.2: Penalize generic short anchors
        if (GENERIC_ANCHORS.has(normalizedAnchor) && normalizedAnchor.length <= 5) {
          score += 0.5
        } else {
          score += 1 + Math.floor(normalizedAnchor.length / 6)
        }
      }
    }

    // S40.6: excludeSignals are now weighted penalties, not hard blocks.
    // Each excludeSignal subtracts a penalty from the score. The metric is
    // only fully excluded if the penalty exceeds the anchor score.
    if (metric.excludeSignals) {
      for (const signal of metric.excludeSignals) {
        const normalizedSignal = normalizePersianText(signal).toLowerCase()
        if (normalized.includes(normalizedSignal)) {
          // Penalty proportional to signal length (longer = stronger exclusion)
          const penalty = 1 + Math.floor(normalizedSignal.length / 6)
          score -= penalty
        }
      }
    }

    // S40.6: Only skip if score dropped to zero or below (net negative = strong exclusion)
    if (score <= 0) continue

    if (score > bestScore) {
      bestScore = score
      bestId = metric.id
    }
  }

  // S22.1: Adjusted thresholds for new weighting system
  // score >= 3 → 1.0 (one specific long anchor, e.g. "بدهکار و بستانکار حساب" = 4+1=5, "گردش حساب" = 2)
  // score >= 1.5 → 0.7 (one medium anchor or multiple generic)
  // score >= 0.5 → 0.5 (at least one generic anchor match — low confidence, let planner decide)
  const confidence = bestScore >= 3 ? 1.0 : bestScore >= 1.5 ? 0.7 : bestScore >= 0.5 ? 0.5 : 0
  const result = { metricId: bestId, confidence }
  setCachedRoute(cacheKey, result)
  return result
}
