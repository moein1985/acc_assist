export function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export function shouldStartAgentDebugServer(params: {
  isAgentDebugServerOnly: boolean
  env?: NodeJS.ProcessEnv
}): boolean {
  const env = params.env ?? process.env
  return params.isAgentDebugServerOnly || isTruthyEnvValue(env['ACC_ENABLE_AGENT_DEBUG_SERVER'])
}

export function resolveAgentDebugToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env['ACC_AGENT_DEBUG_TOKEN']?.trim()
  return token ? token : null
}
