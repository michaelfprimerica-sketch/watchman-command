import { normalize } from 'node:path'

type JobRecord =
  | {
      id?: string | number | null
      data?: unknown
    }
  | null
  | undefined

/** Reject stale BullMQ records that no longer have an id or payload. */
export function hasDownloadJobPayload(job: JobRecord): boolean {
  return (
    job?.id !== null &&
    job?.id !== undefined &&
    job.data !== null &&
    job.data !== undefined &&
    typeof job.data === 'object'
  )
}

/** Render an orphaned/malformed job without throwing on a missing path. */
export function normalizeDownloadPath(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? normalize(value) : ''
}
