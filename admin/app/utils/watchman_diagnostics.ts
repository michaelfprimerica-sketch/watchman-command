export type DiagnosticStatus =
  | 'AVAILABLE'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'NOT INSTALLED'
  | 'UNKNOWN'

export type DiagnosticSnapshot = {
  version: string
  environment: string
  architecture: string
  runtime: string
  wslDistribution?: string | null
  docker: { status: DiagnosticStatus; version?: string | null }
  compose: { status: DiagnosticStatus }
  storage: { status: DiagnosticStatus; freeBytes?: number | null }
  kiwix: { status: DiagnosticStatus; bookCount?: number | null }
  qdrant: { status: DiagnosticStatus }
  ollama: { status: DiagnosticStatus }
  gpu: { status: DiagnosticStatus; vendor?: 'AMD' | 'NVIDIA' | null }
  activeManagedContainers: number | null
  internet: DiagnosticStatus
}

export const DIAGNOSTIC_FIELD_POLICY = {
  safeToDisplay: [
    'Watchman Command version',
    'runtime class',
    'architecture',
    'coarse WSL distribution',
    'Docker and Compose availability/version',
    'storage health and free capacity',
    'Kiwix book count',
    'Qdrant and Ollama health',
    'GPU vendor/passthrough health',
    'managed container count',
  ],
  adminOnlyFuture: ['detailed container inventory', 'service endpoints', 'host filesystem layout'],
  neverDisplay: [
    'environment values',
    'credentials or database URLs',
    'private keys',
    'usernames and home paths',
    'hostname',
    'IP or MAC addresses',
    'device serials',
    'raw Docker inspection data',
    'exception messages or stacks',
  ],
} as const

const safeToken = (value: string, fallback = 'unknown') => {
  const trimmed = value.trim().slice(0, 80)
  return /^[A-Za-z0-9 ._+()/-]+$/.test(trimmed) ? trimmed : fallback
}

export function redactDiagnosticText(input: string): string {
  return input
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, '[REDACTED PRIVATE KEY]')
    .replace(/^\s*(?:hostname|host)\s*[:=]\s*[^\r\n]+$/gim, 'Hostname: [REDACTED]')
    .replace(/\bauthorization\b\s*[:=]\s*[^\r\n]+/gi, 'authorization: [REDACTED]')
    .replace(/\bbearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(password|passwd|token|api[_-]?key|app[_-]?key|secret|private[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi,
      '$1: [REDACTED]'
    )
    .replace(/\b(?:mysql|postgres(?:ql)?|redis):\/\/[^\s@]+@[^\s]+/gi, '[REDACTED DATABASE URL]')
    .replace(/\b[A-Z]:\\Users\\[^\s\\]+(?:\\[^\s]*)?/gi, '[PRIVATE PATH]')
    .replace(/\/(?:home|Users)\/[^\s/]+(?:\/[^\s]*)?/g, '[PRIVATE PATH]')
    .replace(/\/root\/(?:\.ollama|\.ssh|\.config)(?:\/[^\s]*)?/g, '[PRIVATE PATH]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED IP]')
    .replace(/\b(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\b/gi, '[REDACTED IP]')
    .replace(/\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi, '[REDACTED MAC]')
}

export async function bestEffort<T>(probe: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await probe()
  } catch {
    return fallback
  }
}

const formatCapacity = (bytes: number | null | undefined): string | null => {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null
  const gib = bytes / 1024 ** 3
  return gib >= 1024 ? `${(gib / 1024).toFixed(1)} TiB free` : `${Math.round(gib)} GiB free`
}

const statusLine = (label: string, status: DiagnosticStatus, detail?: string | null) =>
  `  ${label}: ${status}${detail ? ` (${detail})` : ''}`

export function buildWatchmanDiagnosticReport(snapshot: DiagnosticSnapshot): string {
  const lines = [
    'Watchman Command Diagnostics',
    '============================',
    `Version: ${safeToken(snapshot.version, 'unknown')}`,
    `Environment: ${safeToken(snapshot.environment, 'unknown')}`,
    `Architecture: ${safeToken(snapshot.architecture, 'unknown')}`,
    `Runtime: ${safeToken(snapshot.runtime, 'unknown')}`,
  ]

  if (snapshot.wslDistribution) {
    lines.push(`WSL Distribution: ${safeToken(snapshot.wslDistribution)}`)
  }

  lines.push('')
  lines.push('Runtime Health:')
  lines.push(
    statusLine(
      'Docker Engine',
      snapshot.docker.status,
      snapshot.docker.version ? safeToken(snapshot.docker.version) : null
    )
  )
  lines.push(statusLine('Docker Compose', snapshot.compose.status))
  lines.push(
    statusLine('Storage', snapshot.storage.status, formatCapacity(snapshot.storage.freeBytes))
  )
  lines.push(
    statusLine(
      'Kiwix Library',
      snapshot.kiwix.status,
      snapshot.kiwix.bookCount === null || snapshot.kiwix.bookCount === undefined
        ? null
        : `${Math.max(0, Math.trunc(snapshot.kiwix.bookCount))} book(s)`
    )
  )
  lines.push(statusLine('Knowledge index (Qdrant)', snapshot.qdrant.status))
  lines.push(statusLine('AI runtime (Ollama)', snapshot.ollama.status))
  lines.push(statusLine('GPU passthrough', snapshot.gpu.status, snapshot.gpu.vendor ?? null))
  lines.push(
    statusLine(
      'Active Watchman-managed containers',
      snapshot.activeManagedContainers === null ? 'UNKNOWN' : 'AVAILABLE',
      snapshot.activeManagedContainers === null ? null : String(snapshot.activeManagedContainers)
    )
  )
  lines.push(statusLine('Internet', snapshot.internet))

  lines.push('')
  lines.push('Optional Components:')
  lines.push(statusLine('Updater', 'NOT INSTALLED'))
  lines.push(statusLine('Disk collector', 'NOT INSTALLED'))
  lines.push(statusLine('Dozzle', 'NOT INSTALLED'))

  return redactDiagnosticText(lines.join('\n'))
}

export function serviceDiagnosticStatus(
  installed: boolean | undefined,
  runtimeStatus: string | undefined
): DiagnosticStatus {
  if (!installed) return 'NOT INSTALLED'
  switch (runtimeStatus?.toLowerCase()) {
    case 'running':
      return 'AVAILABLE'
    case 'restarting':
    case 'created':
    case 'paused':
      return 'DEGRADED'
    case 'exited':
    case 'dead':
      return 'UNAVAILABLE'
    default:
      return 'UNKNOWN'
  }
}
