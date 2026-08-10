import {
  DoResumableDownloadParams,
  DoResumableDownloadWithRetryParams,
} from '../../types/downloads.js'
import axios from 'axios'
import { Transform } from 'node:stream'
import { deleteFileIfExists, ensureDirectoryExists, getFileStatsIfExists } from './fs.js'
import { createWriteStream } from 'node:fs'
import { rename } from 'node:fs/promises'
import path from 'node:path'

// Some upstream mirrors reject requests with a missing or generic User-Agent.
// In particular, download.kiwix.org routes large Wikimedia-family ZIMs to
// dumps.wikimedia.org, which rejects axios's default identifier.
const DOWNLOAD_HEADERS: Record<string, string> = {
  'User-Agent':
    'WatchmanCommand/1.0 (+https://github.com/michaelfprimerica-sketch/watchman-command)',
}

/** A remote source permanently rejected this installation's authorization. */
export class PermanentDownloadAuthError extends Error {
  constructor(status: number) {
    super(`Download authorization was rejected by the server (HTTP ${status}).`)
    this.name = 'PermanentDownloadAuthError'
  }
}

export function classifyPermanentDownloadError(error: any): PermanentDownloadAuthError | null {
  const status = error?.response?.status
  if (status === 401 || status === 403) {
    return new PermanentDownloadAuthError(status)
  }
  return null
}

function rethrowPermanentDownloadError(error: any): never {
  const permanentError = classifyPermanentDownloadError(error)
  if (permanentError) throw permanentError
  throw error
}

interface ParsedContentRange {
  start: number
  end: number
  total: number | null
}

function responseHeader(headers: any, name: string): string | undefined {
  const value =
    typeof headers?.get === 'function'
      ? headers.get(name)
      : (headers?.[name] ?? headers?.[name.toLowerCase()])
  return value === undefined || value === null ? undefined : String(value)
}

function parseContentRange(value: string | undefined): ParsedContentRange | null {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/i)
  if (!match) return null

  const start = Number(match[1])
  const end = Number(match[2])
  const total = match[3] === '*' ? null : Number(match[3])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null
  if (total !== null && (!Number.isSafeInteger(total) || total <= end)) return null
  return { start, end, total }
}

/**
 * Perform a resumable download with progress tracking
 * @param param0 - Download parameters. Leave allowedMimeTypes empty to skip mime type checking.
 * Otherwise, mime types should be in the format "application/pdf", "image/png", etc.
 * @returns Path to the downloaded file
 */
export async function doResumableDownload({
  url,
  filepath,
  timeout = 30000,
  signal,
  onProgress,
  onComplete,
  forceNew = false,
  allowedMimeTypes,
}: DoResumableDownloadParams): Promise<string> {
  const dirname = path.dirname(filepath)
  await ensureDirectoryExists(dirname)

  // Stage download to a .tmp file so consumers (e.g. Kiwix) never see a partial file
  const tempPath = filepath + '.tmp'

  // Check if partial .tmp file exists for resume
  let startByte = 0
  let appendMode = false

  const existingStats = await getFileStatsIfExists(tempPath)
  if (existingStats && !forceNew) {
    startByte = Number(existingStats.size)
    appendMode = true
  }

  // Get file info with HEAD request first
  const headResponse = await axios
    .head(url, {
      signal,
      timeout,
      headers: DOWNLOAD_HEADERS,
    })
    .catch(rethrowPermanentDownloadError)

  // Some upstream hosts (notably download.kiwix.org for .zim files) don't set a
  // Content-Type header at all. Per RFC 7231 §3.1.1.5, "if no Content-Type is
  // provided" the recipient may treat it as application/octet-stream — which is
  // already in every binary-content allowlist we use (ZIM, PMTILES, base assets).
  // Without this default, the validator below throws `MIME type  is not allowed`
  // and breaks all downloads from kiwix's primary host (#848).
  const contentType = headResponse.headers['content-type']?.toString() || 'application/octet-stream'
  const advertisedTotalBytes = Number.parseInt(
    headResponse.headers['content-length']?.toString() || '0',
    10
  )
  let totalBytes = Number.isSafeInteger(advertisedTotalBytes) ? advertisedTotalBytes : 0
  const supportsRangeRequests = headResponse.headers['accept-ranges'] === 'bytes'

  // If allowedMimeTypes is provided, check content type
  if (allowedMimeTypes && allowedMimeTypes.length > 0) {
    const isMimeTypeAllowed = allowedMimeTypes.some((mimeType) => contentType.includes(mimeType))
    if (!isMimeTypeAllowed) {
      throw new Error(`MIME type ${contentType} is not allowed`)
    }
  }

  // If final file already exists at correct size, return early (idempotent)
  const finalFileStats = await getFileStatsIfExists(filepath)
  if (finalFileStats && Number(finalFileStats.size) === totalBytes && totalBytes > 0 && !forceNew) {
    if (onComplete) {
      await onComplete(url, filepath)
    }
    return filepath
  }

  // If .tmp file is already at correct size (complete but never renamed), just rename it
  if (startByte === totalBytes && totalBytes > 0 && !forceNew) {
    await rename(tempPath, filepath)
    if (onComplete) {
      await onComplete(url, filepath)
    }
    return filepath
  }

  // If server doesn't support range requests and we have a partial .tmp file, delete it
  if (!supportsRangeRequests && startByte > 0) {
    await deleteFileIfExists(tempPath)
    startByte = 0
    appendMode = false
  }

  // A publisher may replace a file in place. A larger partial cannot be a
  // prefix of the newly advertised object and would otherwise cause a 416 on
  // every retry, so discard only that stale staging file and restart cleanly.
  if (startByte > totalBytes && totalBytes > 0) {
    await deleteFileIfExists(tempPath)
    startByte = 0
    appendMode = false
  }

  const headers: Record<string, string> = {}
  if (supportsRangeRequests && startByte > 0) {
    headers.Range = `bytes=${startByte}-`
  }

  const fetchStream = (hdrs: Record<string, string>) =>
    axios
      .get(url, {
        responseType: 'stream',
        headers: { ...DOWNLOAD_HEADERS, ...hdrs },
        signal,
        timeout,
      })
      .catch(rethrowPermanentDownloadError)

  let response = await fetchStream(headers)

  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`Failed to download: HTTP ${response.status}`)
  }

  const contentRangeMatches = (expectedStart: number): boolean => {
    const range = parseContentRange(responseHeader(response.headers, 'content-range'))
    if (!range || range.start !== expectedStart) return false
    if (range.total !== null && totalBytes > 0 && range.total !== totalBytes) return false
    if (range.total !== null && totalBytes <= 0) totalBytes = range.total
    return true
  }

  // A resumed response is safe to append only when the server proves it started
  // at the requested byte. If Range is ignored or malformed, discard that response
  // and the stale staging file, then retry once from byte zero.
  if (headers.Range && (response.status !== 206 || !contentRangeMatches(startByte))) {
    response.data.destroy()
    await deleteFileIfExists(tempPath)
    startByte = 0
    appendMode = false
    delete headers.Range
    response = await fetchStream(headers)
    if (response.status !== 200 && response.status !== 206) {
      throw new Error(`Failed to download: HTTP ${response.status}`)
    }
  }

  // A server may return 206 even without a Range request. Accept it only when it
  // starts at byte zero; otherwise the resulting local file could never be whole.
  if (!headers.Range && response.status === 206 && !contentRangeMatches(0)) {
    response.data.destroy()
    throw new Error('Download server returned an invalid Content-Range response')
  }

  if (totalBytes <= 0 && response.status === 200) {
    totalBytes = Number.parseInt(responseHeader(response.headers, 'content-length') || '0', 10)
  }

  return new Promise((resolve, reject) => {
    let downloadedBytes = startByte
    let lastProgressTime = Date.now()
    let lastDownloadedBytes = startByte

    // Stall detection: if no data arrives for 5 minutes, abort the download
    const STALL_TIMEOUT_MS = 5 * 60 * 1000
    let stallTimer: ReturnType<typeof setTimeout> | null = null

    const clearStallTimer = () => {
      if (stallTimer) {
        clearTimeout(stallTimer)
        stallTimer = null
      }
    }

    const resetStallTimer = () => {
      clearStallTimer()
      stallTimer = setTimeout(() => {
        cleanup(new Error('Download stalled - no data received for 5 minutes'))
      }, STALL_TIMEOUT_MS)
    }

    // Progress tracking stream to monitor data flow
    const progressStream = new Transform({
      transform(chunk: Buffer, _: any, callback: Function) {
        downloadedBytes += chunk.length
        resetStallTimer()

        // Update progress tracking
        const now = Date.now()
        if (onProgress && now - lastProgressTime >= 500) {
          lastProgressTime = now
          lastDownloadedBytes = downloadedBytes
          onProgress({
            downloadedBytes,
            totalBytes,
            lastProgressTime,
            lastDownloadedBytes,
            url,
          })
        }

        this.push(chunk)
        callback()
      },
    })

    const writeStream = createWriteStream(tempPath, {
      flags: appendMode ? 'a' : 'w',
    })

    const cleanup = (error?: Error) => {
      clearStallTimer()
      progressStream.destroy()
      response.data.destroy()
      writeStream.destroy()
      if (error) {
        reject(error)
      }
    }

    response.data.on('error', cleanup)
    progressStream.on('error', cleanup)
    writeStream.on('error', cleanup)

    signal?.addEventListener('abort', () => {
      cleanup(new Error('Download aborted'))
    })

    writeStream.on('finish', async () => {
      clearStallTimer()
      try {
        const stagedFileStats = await getFileStatsIfExists(tempPath)
        if (stagedFileStats && totalBytes > 0 && Number(stagedFileStats.size) !== totalBytes) {
          reject(
            new Error(
              `Downloaded size mismatch: expected ${totalBytes} bytes, received ${stagedFileStats.size}`
            )
          )
          return
        }

        // Atomically move the completed .tmp file to the final path
        await rename(tempPath, filepath)
      } catch (renameError) {
        // A parallel job may have completed the same file first — treat as success
        // if the destination already exists at the expected size.
        const existing = await getFileStatsIfExists(filepath)
        if (existing && Number(existing.size) === totalBytes && totalBytes > 0) {
          // fall through to resolve
        } else {
          reject(renameError)
          return
        }
      }
      try {
        if (onProgress) {
          onProgress({
            downloadedBytes,
            totalBytes,
            lastProgressTime: Date.now(),
            lastDownloadedBytes: downloadedBytes,
            url,
          })
        }
        if (onComplete) {
          await onComplete(url, filepath)
        }
        resolve(filepath)
      } catch (completionError) {
        reject(completionError)
      }
    })

    // Start stall timer and pipe: response -> progressStream -> writeStream
    resetStallTimer()
    response.data.pipe(progressStream).pipe(writeStream)
  })
}

export async function doResumableDownloadWithRetry({
  url,
  filepath,
  signal,
  timeout = 30000,
  onProgress,
  max_retries = 3,
  retry_delay = 2000,
  onAttemptError,
  allowedMimeTypes,
}: DoResumableDownloadWithRetryParams): Promise<string> {
  const dirname = path.dirname(filepath)
  await ensureDirectoryExists(dirname)

  let attempt = 0
  let lastError: Error | null = null

  while (attempt < max_retries) {
    try {
      const result = await doResumableDownload({
        url,
        filepath,
        signal,
        timeout,
        allowedMimeTypes,
        onProgress,
      })

      return result // return on success
    } catch (error: any) {
      attempt++
      lastError = error as Error

      const isAborted = error.name === 'AbortError' || error.code === 'ABORT_ERR'
      const isNetworkError =
        error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT'

      onAttemptError?.(error, attempt)
      if (isAborted) {
        throw new Error(`Download aborted for URL: ${url}`)
      }

      if (attempt < max_retries && isNetworkError) {
        await delay(retry_delay)
        continue
      }

      // If max retries reached or non-retriable error, throw
      if (attempt >= max_retries || !isNetworkError) {
        throw error
      }
    }
  }

  // should not reach here, but TypeScript needs a return
  throw lastError || new Error('Unknown error during download')
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
