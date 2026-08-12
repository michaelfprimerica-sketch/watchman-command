import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type {
  InstallKnowledgePackInput,
  InstallKnowledgePackResult,
  KnowledgePackInstallationRegistry,
  KnowledgePackStagingHandle,
  PromotedKnowledgePackArtifact,
  RecordPromotedKnowledgePackReleaseInput,
} from '../../types/knowledge_pack_installation.js'
import { assertPromotedKnowledgePackRelease } from '../utils/knowledge_pack_installation.js'
import type {
  VerifiedKnowledgePackManifest,
  KnowledgePackVerificationService,
} from './knowledge_pack_verification_service.js'

const DIRECTORY_MODE = 0o700
const FILE_MODE = 0o600
const IMMUTABLE_DIRECTORY_MODE = 0o500
const IMMUTABLE_FILE_MODE = 0o400
const COPY_BUFFER_BYTES = 1024 * 1024

type StagingRecord = {
  id: string
  artifactRoot: string
}

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return (
    fromRoot === '' ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
  )
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stats = await handle.stat()
    if (!stats.isDirectory()) throw new Error(`Expected a private directory at ${path}`)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  buffer: Uint8Array
): Promise<void> {
  let offset = 0
  while (offset < buffer.byteLength) {
    const result = await handle.write(buffer, offset, buffer.byteLength - offset, null)
    if (result.bytesWritten <= 0) throw new Error('Knowledge Pack file write made no progress')
    offset += result.bytesWritten
  }
}

async function writePrivateFile(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    FILE_MODE
  )
  try {
    await writeAll(handle, bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function readPrivateFile(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size > maxBytes) {
      throw new Error(`Knowledge Pack file ${path} is unsafe or oversized`)
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function assertPrivateDirectory(path: string, root?: string): Promise<string> {
  const stats = await lstat(path)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Knowledge Pack path ${path} is not a private directory`)
  }
  const canonical = await realpath(path)
  if (root && !isInside(root, canonical)) {
    throw new Error(`Knowledge Pack directory ${path} escapes its private root`)
  }
  return canonical
}

async function enumerateExactArtifactFiles(
  artifactRoot: string,
  expectedPaths: readonly string[]
): Promise<string[]> {
  const canonicalRoot = await assertPrivateDirectory(artifactRoot)
  const expected = new Set(expectedPaths)
  const allowedDirectories = new Set<string>()
  for (const path of expectedPaths) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      allowedDirectories.add(parts.slice(0, index).join('/'))
    }
  }
  // Permit one extra entry so diagnostics can distinguish a single unexpected file/directory
  // from a deliberately excessive staging tree while remaining strictly bounded.
  const maxDirectoryEntries = expected.size + allowedDirectories.size + 1

  const files: string[] = []
  const pending: Array<{ absolute: string; relative: string }> = [
    { absolute: canonicalRoot, relative: '' },
  ]
  let entriesSeen = 0
  while (pending.length) {
    const directory = pending.pop()!
    const canonicalDirectory = await assertPrivateDirectory(directory.absolute, canonicalRoot)
    const entries = await readdir(canonicalDirectory, { withFileTypes: true })
    for (const entry of entries) {
      entriesSeen += 1
      if (entriesSeen > maxDirectoryEntries) {
        throw new Error('Knowledge Pack staging directory contains too many entries')
      }
      const relativePath = directory.relative ? `${directory.relative}/${entry.name}` : entry.name
      const absolutePath = resolve(canonicalDirectory, entry.name)
      if (!isInside(canonicalRoot, absolutePath) || entry.isSymbolicLink()) {
        throw new Error(`Knowledge Pack staging path ${relativePath} is unsafe`)
      }
      if (entry.isDirectory()) {
        if (!allowedDirectories.has(relativePath)) {
          throw new Error(`Unexpected Knowledge Pack staging directory ${relativePath}`)
        }
        pending.push({ absolute: absolutePath, relative: relativePath })
      } else if (entry.isFile()) {
        files.push(relativePath)
      } else {
        throw new Error(`Knowledge Pack staging path ${relativePath} is not a regular file`)
      }
    }
  }

  const actual = new Set(files)
  for (const path of expected) {
    if (!actual.has(path)) throw new Error(`Knowledge Pack artifact ${path} is missing`)
  }
  for (const path of actual) {
    if (!expected.has(path)) throw new Error(`Unexpected Knowledge Pack artifact ${path}`)
  }
  return files.sort()
}

async function copyAndVerifyArtifact(input: {
  sourceRoot: string
  destinationRoot: string
  artifact: PromotedKnowledgePackArtifact
  directories: Set<string>
}): Promise<void> {
  const sourcePath = resolve(input.sourceRoot, input.artifact.path)
  const destinationPath = resolve(input.destinationRoot, input.artifact.path)
  if (
    !isInside(input.sourceRoot, sourcePath) ||
    !isInside(input.destinationRoot, destinationPath)
  ) {
    throw new Error(`Knowledge Pack artifact ${input.artifact.path} escapes its private root`)
  }

  const destinationParent = dirname(destinationPath)
  await mkdir(destinationParent, { recursive: true, mode: DIRECTORY_MODE })
  await chmod(destinationParent, DIRECTORY_MODE)
  let parent = destinationParent
  while (isInside(input.destinationRoot, parent)) {
    input.directories.add(parent)
    if (parent === input.destinationRoot) break
    parent = dirname(parent)
  }

  const source = await open(
    sourcePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  )
  let destination: Awaited<ReturnType<typeof open>> | undefined
  try {
    const sourceStats = await source.stat()
    if (!sourceStats.isFile()) {
      throw new Error(`Knowledge Pack artifact ${input.artifact.path} is not a regular file`)
    }
    const openedPath = await realpath(`/proc/self/fd/${source.fd}`)
    if (!isInside(input.sourceRoot, openedPath)) {
      throw new Error(`Knowledge Pack artifact ${input.artifact.path} escaped staging while opened`)
    }
    if (sourceStats.size !== input.artifact.sizeBytes) {
      throw new Error(
        `Knowledge Pack artifact ${input.artifact.path} size does not match its manifest`
      )
    }

    destination = await open(
      destinationPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      FILE_MODE
    )
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(
      Math.max(1, Math.min(COPY_BUFFER_BYTES, input.artifact.sizeBytes || 1))
    )
    let sourceOffset = 0
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, buffer.length, sourceOffset)
      if (bytesRead === 0) break
      sourceOffset += bytesRead
      if (sourceOffset > input.artifact.sizeBytes) {
        throw new Error(`Knowledge Pack artifact ${input.artifact.path} exceeded its declared size`)
      }
      const chunk = buffer.subarray(0, bytesRead)
      hash.update(chunk)
      await writeAll(destination, chunk)
    }
    if (sourceOffset !== input.artifact.sizeBytes) {
      throw new Error(`Knowledge Pack artifact ${input.artifact.path} was truncated during copy`)
    }
    if (hash.digest('hex') !== input.artifact.sha256) {
      throw new Error(`Knowledge Pack artifact ${input.artifact.path} SHA-256 does not match`)
    }
    await destination.sync()
  } finally {
    await destination?.close()
    await source.close()
  }
}

async function sealReleaseDirectory(
  releaseDirectory: string,
  artifacts: readonly PromotedKnowledgePackArtifact[]
): Promise<void> {
  const artifactRoot = join(releaseDirectory, 'artifacts')
  const directories = new Set<string>([releaseDirectory, artifactRoot])
  for (const artifact of artifacts) {
    await chmod(join(artifactRoot, ...artifact.path.split('/')), IMMUTABLE_FILE_MODE)
    let parent = dirname(join(artifactRoot, ...artifact.path.split('/')))
    while (isInside(releaseDirectory, parent)) {
      directories.add(parent)
      if (parent === releaseDirectory) break
      parent = dirname(parent)
    }
  }
  await chmod(join(releaseDirectory, 'manifest.json'), IMMUTABLE_FILE_MODE)
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
    await chmod(directory, IMMUTABLE_DIRECTORY_MODE)
    await syncDirectory(directory)
  }
}

export class KnowledgePackInstallerService {
  private readonly staging = new Map<string, StagingRecord>()
  private readonly packLocks = new Map<string, Promise<void>>()
  private readonly options: { installRoot: string; currentWatchmanVersion: string }
  private canonicalRoot?: string

  constructor(
    private readonly verifier: KnowledgePackVerificationService,
    private readonly registry: KnowledgePackInstallationRegistry,
    options: { installRoot: string; currentWatchmanVersion: string }
  ) {
    if (!isAbsolute(options.installRoot)) {
      throw new Error('Knowledge Pack installation root must be absolute')
    }
    const installRoot = resolve(options.installRoot)
    if (dirname(installRoot) === installRoot) {
      throw new Error('Knowledge Pack installation root cannot be a filesystem root')
    }
    this.options = { ...options, installRoot }
  }

  async createStagingArea(): Promise<KnowledgePackStagingHandle> {
    const root = await this.ensureRoot()
    const incoming = join(root, '.incoming')
    const id = randomUUID()
    const artifactRoot = join(incoming, id)
    await mkdir(artifactRoot, { mode: DIRECTORY_MODE })
    await chmod(artifactRoot, DIRECTORY_MODE)
    await syncDirectory(incoming)
    const canonical = await assertPrivateDirectory(artifactRoot, root)
    const record = { id, artifactRoot: canonical }
    this.staging.set(id, record)
    return Object.freeze({ ...record })
  }

  async install(input: InstallKnowledgePackInput): Promise<InstallKnowledgePackResult> {
    const staging = this.takeStagingHandle(input.staging)
    try {
      const verified = await this.verifier.verifyManifest({
        signedManifest: input.signedManifest,
        currentWatchmanVersion: this.options.currentWatchmanVersion,
      })
      return await this.withPackLock(verified.manifest.packId, () =>
        this.installVerified(staging, verified, input.source)
      )
    } finally {
      await rm(staging.artifactRoot, { recursive: true, force: true })
    }
  }

  private takeStagingHandle(handle: KnowledgePackStagingHandle): StagingRecord {
    const record = this.staging.get(handle.id)
    this.staging.delete(handle.id)
    if (!record || record.artifactRoot !== handle.artifactRoot) {
      throw new Error('Knowledge Pack staging handle is invalid or has already been consumed')
    }
    return record
  }

  private async ensureRoot(): Promise<string> {
    if (this.canonicalRoot) return this.canonicalRoot
    let created = false
    try {
      await mkdir(this.options.installRoot, { mode: DIRECTORY_MODE })
      created = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const root = await assertPrivateDirectory(this.options.installRoot)
    const rootStats = await lstat(root)
    if (!created && (rootStats.mode & 0o077) !== 0) {
      throw new Error('Existing Knowledge Pack installation root must already be private')
    }
    if (created) await chmod(root, DIRECTORY_MODE)
    for (const child of ['.incoming', '.installing', '.locks', 'releases']) {
      const path = join(root, child)
      await mkdir(path, { mode: DIRECTORY_MODE }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
      const canonicalChild = await assertPrivateDirectory(path, root)
      await chmod(canonicalChild, DIRECTORY_MODE)
    }
    await syncDirectory(root)
    this.canonicalRoot = root
    return root
  }

  private async withPackLock<T>(packId: string, operation: () => Promise<T>): Promise<T> {
    const predecessor = this.packLocks.get(packId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolvePromise) => {
      release = resolvePromise
    })
    const tail = predecessor.then(() => current)
    this.packLocks.set(packId, tail)
    await predecessor
    try {
      return await operation()
    } finally {
      release()
      if (this.packLocks.get(packId) === tail) this.packLocks.delete(packId)
    }
  }

  private async acquireFilesystemLock(packId: string): Promise<() => Promise<void>> {
    const root = await this.ensureRoot()
    const lockDirectory = join(root, '.locks')
    const lockId = createHash('sha256').update(packId).digest('hex')
    const lockPath = join(lockDirectory, `${lockId}.lock`)
    let handle
    try {
      handle = await open(
        lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        FILE_MODE
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('Another process is installing this Knowledge Pack')
      }
      throw error
    }
    try {
      await writeAll(handle, Buffer.from(`${process.pid}\n`, 'ascii'))
      await handle.sync()
      await syncDirectory(lockDirectory)
    } catch (error) {
      await handle.close().catch(() => undefined)
      await unlink(lockPath).catch(() => undefined)
      throw error
    }
    return async () => {
      await handle.close()
      await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      await syncDirectory(lockDirectory)
    }
  }

  private async installVerified(
    staging: StagingRecord,
    verified: VerifiedKnowledgePackManifest,
    source: RecordPromotedKnowledgePackReleaseInput['source']
  ): Promise<InstallKnowledgePackResult> {
    const root = await this.ensureRoot()
    const canonicalSource = await assertPrivateDirectory(staging.artifactRoot, root)
    const artifacts: PromotedKnowledgePackArtifact[] = verified.manifest.artifacts.map(
      (artifact) => ({
        artifactId: artifact.id,
        path: artifact.path,
        contentType: artifact.contentType,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
      })
    )
    const registryInput: RecordPromotedKnowledgePackReleaseInput = {
      packId: verified.manifest.packId,
      packVersion: verified.manifest.packVersion,
      source,
      manifestSha256: verified.manifestSha256,
      signingKeyId: verified.signingKeyId,
      artifacts,
    }
    assertPromotedKnowledgePackRelease(registryInput)
    const expectedPaths = artifacts.map((artifact) => artifact.path).sort()
    await enumerateExactArtifactFiles(canonicalSource, expectedPaths)

    const releaseLock = await this.acquireFilesystemLock(registryInput.packId)
    try {
      const releaseHistory = await this.registry.listReleaseHistory(registryInput.packId)
      const existingVersion = releaseHistory.find(
        (release) => release.packVersion === registryInput.packVersion
      )
      if (existingVersion && existingVersion.manifestSha256 !== registryInput.manifestSha256) {
        throw new Error('Knowledge Pack version is already installed with a different manifest')
      }

      const finalDirectory = join(root, 'releases', registryInput.manifestSha256)
      const installingDirectory = join(root, '.installing', randomUUID())
      let promoted = false
      try {
        const finalExists = await lstat(finalDirectory)
          .then(() => true)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false
            throw error
          })

        if (finalExists) {
          await this.assertExistingRelease(finalDirectory, verified)
          await sealReleaseDirectory(finalDirectory, artifacts)
        } else {
          await mkdir(installingDirectory, { mode: DIRECTORY_MODE })
          const artifactDestination = join(installingDirectory, 'artifacts')
          await mkdir(artifactDestination, { mode: DIRECTORY_MODE })
          const directories = new Set<string>([installingDirectory, artifactDestination])
          for (const artifact of artifacts) {
            await copyAndVerifyArtifact({
              sourceRoot: canonicalSource,
              destinationRoot: artifactDestination,
              artifact,
              directories,
            })
          }
          await enumerateExactArtifactFiles(canonicalSource, expectedPaths)
          await writePrivateFile(
            join(installingDirectory, 'manifest.json'),
            Buffer.from(verified.canonicalSignedManifest, 'utf8')
          )
          for (const directory of [...directories].sort(
            (left, right) => right.length - left.length
          )) {
            await syncDirectory(directory)
          }
          await syncDirectory(join(root, '.installing'))
          await rename(installingDirectory, finalDirectory)
          promoted = true
          await sealReleaseDirectory(finalDirectory, artifacts)
          await syncDirectory(join(root, '.installing'))
          await syncDirectory(join(root, 'releases'))
        }

        const release = await this.registry.recordPromotedRelease(registryInput)
        return { release, releaseDirectory: finalDirectory }
      } finally {
        if (!promoted) {
          await rm(installingDirectory, { recursive: true, force: true })
        }
      }
    } finally {
      await releaseLock()
    }
  }

  private async assertExistingRelease(
    releaseDirectory: string,
    expected: VerifiedKnowledgePackManifest
  ): Promise<void> {
    const root = await this.ensureRoot()
    const canonicalRelease = await assertPrivateDirectory(releaseDirectory, root)
    const topLevelEntries = await readdir(canonicalRelease, { withFileTypes: true })
    if (
      topLevelEntries.length !== 2 ||
      !topLevelEntries.some((entry) => entry.name === 'manifest.json' && entry.isFile()) ||
      !topLevelEntries.some((entry) => entry.name === 'artifacts' && entry.isDirectory()) ||
      topLevelEntries.some((entry) => entry.isSymbolicLink())
    ) {
      throw new Error('Existing Knowledge Pack release has an unexpected filesystem shape')
    }
    const manifestPath = join(canonicalRelease, 'manifest.json')
    const bytes = await readPrivateFile(manifestPath, 256 * 1024)
    if (bytes.toString('utf8') !== expected.canonicalSignedManifest) {
      throw new Error('Existing Knowledge Pack release has a different signed manifest')
    }
    await this.verifier.verify({
      signedManifest: bytes,
      artifactRoot: join(canonicalRelease, 'artifacts'),
      currentWatchmanVersion: this.options.currentWatchmanVersion,
    })
  }
}
