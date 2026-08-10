/** Pure gfx-to-HSA mapping for the ROCm libraries bundled with Ollama. */
export function mapGfxToHsaOverride(gfx: string): string | null {
  if (['gfx1030', 'gfx1100', 'gfx1101', 'gfx1102', 'gfx1150', 'gfx1151'].includes(gfx)) {
    return null
  }
  if (gfx === 'gfx1103') return '11.0.0'
  if (/^gfx103[1-6]$/.test(gfx)) return '10.3.0'
  return null
}

/** Replace only Ollama's AMD-specific entries; preserve all unrelated env. */
export function withAmdOllamaEnvironment(
  environment: readonly string[],
  hsaOverride: string | null
): string[] {
  const next = environment.filter(
    (entry) =>
      !entry.startsWith('HSA_OVERRIDE_GFX_VERSION=') && !entry.startsWith('OLLAMA_IGPU_ENABLE=')
  )
  if (hsaOverride && /^\d+\.\d+\.\d+$/.test(hsaOverride)) {
    next.push(`HSA_OVERRIDE_GFX_VERSION=${hsaOverride}`)
  }
  next.push('OLLAMA_IGPU_ENABLE=1')
  return next
}
