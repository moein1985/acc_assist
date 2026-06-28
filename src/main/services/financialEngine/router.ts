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
    if (route.metricId && route.confidence >= 0.7) {
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
    if (route.metricId && route.confidence >= 0.7) {
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
  const normalized = normalizePersianText(normalizePersianDigits(prompt))
  if (!normalized) return { metricId: null, confidence: 0 }

  const cacheKey = softwareId ? `${softwareId}:${normalized}` : normalized
  const cached = getCachedRoute(cacheKey)
  if (cached) return cached

  const catalog = getMetricCatalog()
  let bestId: MetricId | null = null
  let bestScore = 0

  for (const metric of catalog) {
    let score = 0
    let excluded = false

    // S15.17: Use adapter-specific anchors when available
    const anchors = (softwareId && metric.adapterAnchors?.[softwareId])
      ? metric.adapterAnchors[softwareId]
      : metric.anchors

    for (const anchor of anchors) {
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
  const result = { metricId: bestId, confidence }
  setCachedRoute(cacheKey, result)
  return result
}
