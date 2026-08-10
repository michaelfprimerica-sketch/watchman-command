import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
      return { status: 206, data: Readable.from(payload.subarray(partial.length)) }
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
      return { status: 200, data: Readable.from(payload) }
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
      return { status: 200, data: Readable.from(payload) }
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
})
