export function toSampleValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  let text: string

  if (typeof value === 'string') {
    text = value.trim()
  } else if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    text = String(value)
  } else if (value instanceof Date) {
    text = value.toISOString()
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }

  if (!text) {
    return null
  }

  if (text.length > 90) {
    return `${text.slice(0, 87)}...`
  }

  return text
}

export function buildCatalogCacheKey(
  profileId: string,
  databaseName: string,
  softwareOverrideId: string | null
): string {
  return `${profileId.trim().toLowerCase()}::${databaseName.trim().toLowerCase()}::${softwareOverrideId ?? 'auto'}`
}
