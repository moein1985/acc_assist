export function encodePromptTransportBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

function looksLikeBase64Transport(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0
}

export function decodePromptTransportValue(value: string): string {
  const normalized = value.trim()

  if (!normalized) {
    return ''
  }

  try {
    const parsed = JSON.parse(normalized) as unknown

    if (typeof parsed === 'string') {
      return decodePromptTransportValue(parsed)
    }

    if (parsed && typeof parsed === 'object') {
      const candidate = parsed as Record<string, unknown>

      if (typeof candidate.promptBase64 === 'string') {
        const base64Candidate = candidate.promptBase64.trim()

        if (looksLikeBase64Transport(base64Candidate)) {
          const decoded = Buffer.from(base64Candidate, 'base64').toString('utf8')

          if (decoded && !/^\s*$/.test(decoded) && decoded.trim() !== base64Candidate) {
            return decoded
          }
        }
      }

      if (typeof candidate.prompt === 'string') {
        return candidate.prompt
      }
    }
  } catch {
    // Fall back to plain-text or raw Base64 transport.
  }

  if (looksLikeBase64Transport(normalized)) {
    const decoded = Buffer.from(normalized, 'base64').toString('utf8')

    if (decoded && !/^\s*$/.test(decoded) && decoded.trim() !== normalized) {
      return decoded
    }
  }

  return normalized
}
