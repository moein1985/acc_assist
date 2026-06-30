/**
 * S21.2 — Confidence Score Service
 * Computes a 0-100 confidence score for engine responses based on multiple factors.
 */

export interface ConfidenceFactors {
  sqlRowsReturned: boolean
  evidenceMatch: boolean
  anomalyDetected: boolean
  planConfidence: 'high' | 'medium' | 'low'
  fallbackUsed: boolean
}

export interface ConfidenceScore {
  score: number
  factors: ConfidenceFactors
}

export function computeConfidenceScore(factors: ConfidenceFactors): ConfidenceScore {
  let score = 100

  if (!factors.sqlRowsReturned) {
    score -= 40
  }

  if (!factors.evidenceMatch) {
    score -= 20
  }

  if (factors.anomalyDetected) {
    score -= 10
  }

  if (factors.planConfidence === 'medium') {
    score -= 10
  } else if (factors.planConfidence === 'low') {
    score -= 25
  }

  if (factors.fallbackUsed) {
    score -= 20
  }

  score = Math.max(0, Math.min(100, score))

  return { score, factors }
}

export function getConfidenceBadgeClass(score: number): string {
  if (score >= 80) return 'confidence-high'
  if (score >= 50) return 'confidence-medium'
  return 'confidence-low'
}

export function getConfidenceLabel(score: number): string {
  if (score >= 80) return 'بالا'
  if (score >= 50) return 'متوسط'
  return 'پایین'
}
