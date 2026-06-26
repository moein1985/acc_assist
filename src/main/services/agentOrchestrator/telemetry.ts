/**
 * Telemetry emission methods extracted from `agentOrchestrator.ts` (FRE Roadmap F2.6).
 */

export interface TelemetryCaptureInput {
  event: string
  category: string
  level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  process?: 'main' | 'renderer'
  message?: string
  details?: Record<string, unknown>
  requestId?: string
  conversationId?: string
  correlationId?: string
}

export interface TelemetryDeps {
  capture?: (input: TelemetryCaptureInput) => void
}

export function emitEvidenceContractTelemetry(
  deps: TelemetryDeps,
  requestId: string | undefined,
  conversationId: string | undefined,
  finalText: string,
  recoveryAttempts?: number
): void {
  const effectiveRecoveryAttempts = recoveryAttempts ?? 0

  deps.capture?.({
    event: 'agent.orchestrator.audit',
    category: 'agent.orchestrator',
    level: 'warn',
    process: 'main',
    message: 'evidence-contract-failure',
    details: {
      failureKind: 'evidence_contract',
      recoveryAttempts: effectiveRecoveryAttempts,
      finalText,
      requestId,
      conversationId
    },
    requestId,
    conversationId
  })
}

export function emitGuardrailTelemetry(
  deps: TelemetryDeps,
  kind: 'unsupported-function' | 'empty-result-recovery' | 'provider-error',
  requestId: string | undefined,
  conversationId: string | undefined,
  details?: Record<string, unknown>
): void {
  deps.capture?.({
    event: 'agent.orchestrator.guardrail',
    category: 'agent.orchestrator',
    level: 'warn',
    process: 'main',
    message: kind,
    details: {
      kind,
      requestId,
      conversationId,
      ...details
    },
    requestId,
    conversationId
  })
}

export function emitGuardrailCounterTelemetry(
  deps: TelemetryDeps,
  kind: 'unsupported-function' | 'empty-result-recovery' | 'provider-error',
  requestId: string | undefined,
  conversationId: string | undefined,
  count: number
): void {
  deps.capture?.({
    event: 'agent.orchestrator.guardrail.count',
    category: 'agent.orchestrator',
    level: 'info',
    process: 'main',
    message: kind,
    details: {
      kind,
      count,
      requestId,
      conversationId
    },
    requestId,
    conversationId
  })
}
