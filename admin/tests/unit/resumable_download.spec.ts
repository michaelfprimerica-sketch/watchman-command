import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import axios from 'axios'
import { doResumableDownload } from '../../app/utils/downloads.js'

describe('resumable content downloads', () => {
  const payload = Buffer.from('watchman-command-content')
  const originalHead = axios.head
  const originalGet = axios.get
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'watchman-resume-'))
    axios.head = (async () => ({
      headers: {
        'content-length': String(payload.length),
        'content-type': 'application/octet-stream',
        'accept-ranges': 'bytes',
      },
    })) as typeof axios.head
  })

  afterEach(async () => {
    axios.head = originalHead
    axios.get = originalGet
    await rm(directory, { recursive: true, force: true })
  })

  it('continues an interrupted transfer with a safe Range request', async () => {
    const filepath = join(directory, 'content.zim')
    const partial = payload.subarray(0, 8)
    await writeFile(`${filepath}.tmp`, partial)
    let requestedRange: unknown
    axios.get = (async (_url, config) => {
      requestedRange = config?.headers?.Range
      return {
        status: 206,
        headers: {
          'content-range': `bytes ${partial.length}-${payload.length - 1}/${payload.length}`,
        },
        data: Readable.from(payload.subarray(partial.length)),
      }
    }) as typeof axios.get

    await doResumableDownload({
      url: 'https://example.invalid/content.zim',
      filepath,
      timeout: 1_000,
      allowedMimeTypes: [],
    })

    assert.equal(requestedRange, `bytes=${partial.length}-`)
    assert.deepEqual(await readFile(filepath), payload)
  })

  it('restarts without corruption when a server ignores Range', async () => {
    const filepath = join(directory, 'content.zim')
    await writeFile(`${filepath}.tmp`, payload.subarray(0, 8))
    const requestedRanges: unknown[] = []
    axios.get = (async (_url, config) => {
      requestedRanges.push(config?.headers?.Range)
      return { status: 200, headers: {}, data: Readable.from(payload) }
    }) as typeof axios.get

    await doResumableDownload({
      url: 'https://example.invalid/content.zim',
      filepath,
      timeout: 1_000,
      allowedMimeTypes: [],
    })

    assert.deepEqual(requestedRanges, ['bytes=8-', undefined])
    assert.deepEqual(await readFile(filepath), payload)
  })

  it('discards an oversized stale partial before requesting content', async () => {
    const filepath = join(directory, 'content.zim')
    await writeFile(`${filepath}.tmp`, Buffer.concat([payload, Buffer.from('-stale')]))
    let requestedRange: unknown = 'not-called'
    axios.get = (async (_url, config) => {
      requestedRange = config?.headers?.Range
      return { status: 200, headers: {}, data: Readable.from(payload) }
    }) as typeof axios.get

    await doResumableDownload({
      url: 'https://example.invalid/content.zim',
      filepath,
      timeout: 1_000,
      allowedMimeTypes: [],
    })

    assert.equal(requestedRange, undefined)
    assert.deepEqual(await readFile(filepath), payload)
  })

  it('restarts from zero when a resumed response has the wrong Content-Range', async () => {
    const filepath = join(directory, 'content.zim')
    const partial = payload.subarray(0, 8)
    await writeFile(`${filepath}.tmp`, partial)
    const requestedRanges: unknown[] = []
    axios.get = (async (_url, config) => {
      requestedRanges.push(config?.headers?.Range)
      if (requestedRanges.length === 1) {
        return {
          status: 206,
          headers: { 'content-range': `bytes 9-${payload.length - 1}/${payload.length}` },
          data: Readable.from(payload.subarray(9)),
        }
      }
      return { status: 200, headers: {}, data: Readable.from(payload) }
    }) as typeof axios.get

    await doResumableDownload({
      url: 'https://example.invalid/content.zim',
      filepath,
      timeout: 1_000,
      allowedMimeTypes: [],
    })

    assert.deepEqual(requestedRanges, ['bytes=8-', undefined])
    assert.deepEqual(await readFile(filepath), payload)
  })

  it('preserves a truncated response as partial and does not publish it', async () => {
    const filepath = join(directory, 'content.zim')
    const partial = payload.subarray(0, 8)
    axios.get = (async () => ({
      status: 200,
      headers: {},
      data: Readable.from(partial),
    })) as typeof axios.get

    await assert.rejects(
      doResumableDownload({
        url: 'https://example.invalid/content.zim',
        filepath,
        timeout: 1_000,
        allowedMimeTypes: [],
      }),
      /Downloaded size mismatch/
    )

    await assert.rejects(access(filepath))
    assert.deepEqual(await readFile(`${filepath}.tmp`), partial)
  })

  it('uses the Watchman User-Agent for metadata and content requests', async () => {
    const filepath = join(directory, 'content.zim')
    let getUserAgent: unknown
    let headUserAgent: unknown
    axios.head = (async (_url, config) => {
      headUserAgent = config?.headers?.['User-Agent']
      return {
        headers: {
          'content-length': String(payload.length),
          'content-type': 'application/octet-stream',
          'accept-ranges': 'bytes',
        },
      }
    }) as typeof axios.head
    axios.get = (async (_url, config) => {
      getUserAgent = config?.headers?.['User-Agent']
      return { status: 200, headers: {}, data: Readable.from(payload) }
    }) as typeof axios.get

    await doResumableDownload({
      url: 'https://example.invalid/content.zim',
      filepath,
      timeout: 1_000,
      allowedMimeTypes: [],
    })

    assert.match(String(headUserAgent), /^WatchmanCommand\//)
    assert.equal(getUserAgent, headUserAgent)
  })

  it('re-runs completion after a restart without downloading the completed file again', async () => {
    const filepath = join(directory, 'content.zim')
    await writeFile(filepath, payload)
    let completions = 0
    axios.get = (async () => {
      throw new Error('content request should not occur')
    }) as typeof axios.get

    await doResumableDownload({
      url: 'https://example.invalid/content.zim',
      filepath,
      timeout: 1_000,
      allowedMimeTypes: [],
      onComplete: async () => {
        completions += 1
      },
    })

    assert.equal(completions, 1)
  })
})
