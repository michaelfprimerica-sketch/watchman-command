import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import semver from 'semver'

import type {
  KnowledgePackArtifactManifestEntry,
  KnowledgePackManifestV1,
} from '../../types/knowledge_packs.js'
import {
  type SignedKnowledgePackManifestV1,
  KNOWLEDGE_PACK_SIGNATURE_ALGORITHM,
  unsignedKnowledgePackManifest,
} from '../../types/knowledge_pack_manifests.js'
import {
  KNOWLEDGE_PACK_MAX_TOTAL_ARTIFACT_BYTES,
  KnowledgePackManifestService,
} from './knowledge_pack_manifest_service.js'
import {
  type KnowledgePackVerificationProvider,
  knowledgePackManifestSigningBytes,
} from './knowledge_pack_signature_service.js'

export type KnowledgePackCompatibility = 'COMPATIBLE' | 'INDETERMINATE'

export type VerifiedKnowledgePackArtifact = KnowledgePackArtifactManifestEntry & {
  absolutePath: string
}

export type VerifiedKnowledgePackManifest = {
  manifest: KnowledgePackManifestV1
  signedManifest: SignedKnowledgePackManifestV1
  canonicalSignedManifest: string
  manifestSha256: string
  signingKeyId: string
  compatibility: KnowledgePackCompatibility
}

export type VerifiedKnowledgePack = VerifiedKnowledgePackManifest & {
  artifacts: VerifiedKnowledgePackArtifact[]
}

export class KnowledgePackVerificationError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'UNTRUSTED_KEY'
      | 'INVALID_SIGNATURE'
      | 'INCOMPATIBLE_WATCHMAN_VERSION'
      | 'UNSAFE_ARTIFACT_ROOT'
      | 'MISSING_ARTIFACT'
      | 'UNEXPECTED_ARTIFACT'
      | 'UNSAFE_ARTIFACT'
      | 'ARTIFACT_SIZE_MISMATCH'
      | 'ARTIFACT_HASH_MISMATCH'
  ) {
    super(message)
    this.name = 'KnowledgePackVerificationError'
  }
}

function verificationError(code: KnowledgePackVerificationError['code'], message: string): never {
  throw new KnowledgePackVerificationError(message, code)
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot)
}

async function assertSafeDirectory(path: string, canonicalRoot?: string): Promise<string> {
  let stats
  try {
    stats = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      verificationError('MISSING_ARTIFACT', `Artifact directory ${path} is missing`)
    }
    throw error
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    verificationError(
      'UNSAFE_ARTIFACT_ROOT',
      `Artifact directory ${path} is not a regular directory`
    )
  }
  const canonical = await realpath(path)
  if (canonicalRoot && !isInside(canonicalRoot, canonical)) {
    verificationError('UNSAFE_ARTIFACT', `Artifact directory ${path} escapes its staging root`)
  }
  return canonical
}

async function listArtifactFiles(root: string): Promise<string[]> {
  const canonicalRoot = await assertSafeDirectory(root)
  const files: string[] = []
  const pending: Array<{ absolute: string; relative: string }> = [
    { absolute: canonicalRoot, relative: '' },
  ]

  while (pending.length) {
    const directory = pending.pop()!
    await assertSafeDirectory(directory.absolute, canonicalRoot)
    const entries = await readdir(directory.absolute, { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = directory.relative ? `${directory.relative}/${entry.name}` : entry.name
      const absolutePath = resolve(directory.absolute, entry.name)
      if (!isInside(canonicalRoot, absolutePath)) {
        verificationError(
          'UNSAFE_ARTIFACT',
          `Artifact path ${relativePath} escapes its staging root`
        )
      }
      if (entry.isSymbolicLink()) {
        verificationError('UNSAFE_ARTIFACT', `Artifact path ${relativePath} is a symbolic link`)
      }
      if (entry.isDirectory()) {
        pending.push({ absolute: absolutePath, relative: relativePath })
      } else if (entry.isFile()) {
        files.push(relativePath)
      } else {
        verificationError('UNSAFE_ARTIFACT', `Artifact path ${relativePath} is not a regular file`)
      }
    }
  }
  return files.sort()
}

async function assertSafeParentDirectories(root: string, relativePath: string): Promise<void> {
  const canonicalRoot = await realpath(root)
  const components = relativePath.split('/').slice(0, -1)
  let current = canonicalRoot
  for (const component of components) {
    current = resolve(current, component)
    await assertSafeDirectory(current, canonicalRoot)
  }
}

async function verifyArtifactFile(
  canonicalRoot: string,
  artifact: KnowledgePackArtifactManifestEntry
): Promise<VerifiedKnowledgePackArtifact> {
  await assertSafeParentDirectories(canonicalRoot, artifact.path)
  const absolutePath = resolve(canonicalRoot, artifact.path)
  if (!isInside(canonicalRoot, absolutePath)) {
    verificationError('UNSAFE_ARTIFACT', `Artifact path ${artifact.path} escapes its staging root`)
  }

  let before
  try {
    before = await lstat(absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      verificationError('MISSING_ARTIFACT', `Artifact ${artifact.path} is missing`)
    }
    throw error
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    verificationError('UNSAFE_ARTIFACT', `Artifact ${artifact.path} is not a regular file`)
  }

  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      verificationError('UNSAFE_ARTIFACT', `Artifact ${artifact.path} changed while it was opened`)
    }
    if (opened.size !== artifact.sizeBytes) {
      verificationError(
        'ARTIFACT_SIZE_MISMATCH',
        `Artifact ${artifact.path} size does not match its manifest`
      )
    }

    const hash = createHash('sha256')
    let bytesRead = 0
    const stream = handle.createReadStream({ autoClose: false })
    for await (const chunk of stream) {
      bytesRead += chunk.length
      if (bytesRead > artifact.sizeBytes || bytesRead > KNOWLEDGE_PACK_MAX_TOTAL_ARTIFACT_BYTES) {
        verificationError(
          'ARTIFACT_SIZE_MISMATCH',
          `Artifact ${artifact.path} exceeded its declared size while hashing`
        )
      }
      hash.update(chunk)
    }
    if (bytesRead !== artifact.sizeBytes) {
      verificationError(
        'ARTIFACT_SIZE_MISMATCH',
        `Artifact ${artifact.path} was truncated while hashing`
      )
    }
    if (hash.digest('hex') !== artifact.sha256) {
      verificationError(
        'ARTIFACT_HASH_MISMATCH',
        `Artifact ${artifact.path} SHA-256 does not match its manifest`
      )
    }
  } finally {
    await handle.close()
  }

  return { ...artifact, absolutePath }
}

function compareExactFileSet(actual: readonly string[], expected: readonly string[]): void {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  for (const path of expected) {
    if (!actualSet.has(path)) verificationError('MISSING_ARTIFACT', `Artifact ${path} is missing`)
  }
  for (const path of actual) {
    if (!expectedSet.has(path)) {
      verificationError('UNEXPECTED_ARTIFACT', `Unexpected artifact ${path} is present`)
    }
  }
}

export class KnowledgePackVerificationService {
  constructor(
    private readonly provider: KnowledgePackVerificationProvider,
    private readonly manifestService = new KnowledgePackManifestService()
  ) {
    if (provider.algorithm !== KNOWLEDGE_PACK_SIGNATURE_ALGORITHM) {
      throw new Error('Only Ed25519 Knowledge Pack verification providers are supported')
    }
  }

  async verifyManifest(input: {
    signedManifest: string | Uint8Array
    currentWatchmanVersion?: string | null
  }): Promise<VerifiedKnowledgePackManifest> {
    const signedManifest = this.manifestService.parseSignedManifest(input.signedManifest)
    const keyId = signedManifest.signed.signatureMetadata.keyId
    if (!this.provider.hasTrustedKey(keyId)) {
      verificationError('UNTRUSTED_KEY', `Knowledge Pack signing key ${keyId} is not trusted`)
    }

    const validSignature = await this.provider.verify(
      keyId,
      knowledgePackManifestSigningBytes(signedManifest.signed, this.manifestService),
      Buffer.from(signedManifest.signature, 'base64url')
    )
    if (!validSignature)
      verificationError('INVALID_SIGNATURE', 'Knowledge Pack signature is invalid')

    if (
      !input.currentWatchmanVersion ||
      semver.valid(input.currentWatchmanVersion) !== input.currentWatchmanVersion
    ) {
      verificationError(
        'INCOMPATIBLE_WATCHMAN_VERSION',
        'Current Watchman version is unknown; Knowledge Pack compatibility cannot be verified'
      )
    }
    if (semver.lt(input.currentWatchmanVersion, signedManifest.signed.minimumWatchmanVersion)) {
      verificationError(
        'INCOMPATIBLE_WATCHMAN_VERSION',
        `Knowledge Pack requires Watchman ${signedManifest.signed.minimumWatchmanVersion} or newer`
      )
    }

    const canonicalBytes = this.manifestService.canonicalSignedManifestBytes(signedManifest)
    return {
      manifest: unsignedKnowledgePackManifest(signedManifest.signed),
      signedManifest,
      canonicalSignedManifest: canonicalBytes.toString('utf8'),
      manifestSha256: createHash('sha256').update(canonicalBytes).digest('hex'),
      signingKeyId: keyId,
      compatibility: 'COMPATIBLE',
    }
  }

  async verify(input: {
    signedManifest: string | Uint8Array
    artifactRoot: string
    currentWatchmanVersion?: string | null
  }): Promise<VerifiedKnowledgePack> {
    const verifiedManifest = await this.verifyManifest(input)
    const canonicalRoot = await assertSafeDirectory(resolve(input.artifactRoot))
    const manifest = verifiedManifest.manifest
    const expectedPaths = manifest.artifacts.map((artifact) => artifact.path).sort()
    compareExactFileSet(await listArtifactFiles(canonicalRoot), expectedPaths)
    const artifacts: VerifiedKnowledgePackArtifact[] = []
    for (const artifact of manifest.artifacts) {
      artifacts.push(await verifyArtifactFile(canonicalRoot, artifact))
    }
    compareExactFileSet(await listArtifactFiles(canonicalRoot), expectedPaths)

    return {
      ...verifiedManifest,
      artifacts,
    }
  }
}
