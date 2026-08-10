export function mergeCollectionOptions(collections: readonly string[], draft?: string): string[] {
  const byFoldedName = new Map<string, string>()
  for (const value of [...collections, draft ?? '']) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.normalize('NFKC').toLowerCase()
    if (!byFoldedName.has(key)) byFoldedName.set(key, trimmed)
  }
  return Array.from(byFoldedName.values()).sort((a, b) => a.localeCompare(b))
}
