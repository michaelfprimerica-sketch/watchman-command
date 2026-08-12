import * as assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'

import type { KnowledgePackManifestV1 } from '../../types/knowledge_packs.js'
import type {
  InstalledKnowledgePackRelease,
  KnowledgePackInstallationRegistry,
  KnowledgePackStagingHandle,
  RecordPromotedKnowledgePackReleaseInput,
} from '../../types/knowledge_pack_installation.js'
import { KnowledgePackInstallerService } from '../../app/services/knowledge_pack_installer_service.js'
import { KnowledgePackManifestService } from '../../app/services/knowledge_pack_manifest_service.js'
import {
  Ed25519KnowledgePackSigningProvider,
  Ed25519KnowledgePackVerificationProvider,
  KnowledgePackSigningService,
} from '../../app/services/knowledge_pack_signature_service.js'
import { KnowledgePackVerificationService } from '../../app/services/knowledge_pack_verification_service.js'

const keyPair = generateKeyPairSync('ed25519')
const keyId = 'watchman-installer-test-key'
const roots: string[] = []

async function makeTreeRemovable(path: string): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info?.isDirectory()) return
  await chmod(path, 0o700)
  const entries = await readdir(path, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => makeTreeRemovable(join(path, entry.name)))
  )
}

type ArtifactFixture = {
  id: string
  path: string
  contentType: string
  bytes: Buffer
}

const defaultArtifacts = (): ArtifactFixture[] => [
  {
    id: 'artifact-guide',
    path: 'reference/guide.txt',
    contentType: 'text/plain',
    bytes: Buffer.from('synthetic Watchman guide\n'),
  },
  {
    id: 'artifact-archive',
    path: 'archives/opaque.zip',
    contentType: 'application/zip',
    bytes: Buffer.from('PK\u0003\u0004not-an-extracted-test-archive'),
  },
]

function manifest(
  input: {
    version?: string
    artifacts?: ArtifactFixture[]
    minimumWatchmanVersion?: string
    title?: string
  } = {}
): KnowledgePackManifestV1 {
  const artifacts = input.artifacts ?? defaultArtifacts()
  return {
    schemaVersion: 'watchman.knowledge-pack/v1',
    packId: '11111111-1111-4111-8111-111111111111',
    packVersion: input.version ?? '1.0.0',
    title: input.title ?? 'Synthetic Installer Pack',
    category: 'preparedness',
    owner: { ownerType: 'VIGILANT_WATCHMAN', creatorId: null },
    missionIds: ['mission-radio', 'mission-water'],
    serviceAreas: [
      { type: 'ZIP', countryCode: 'US', stateCode: 'NC', postalCode: '27601' },
      { type: 'SERVICE_AREA', countryCode: 'US', serviceAreaId: 'wake-county-north' },
    ],
    contentFormat: 'MIXED',
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      path: artifact.path,
      contentType: artifact.contentType,
      sizeBytes: artifact.bytes.length,
      sha256: createHash('sha256').update(artifact.bytes).digest('hex'),
    })),
    minimumWatchmanVersion: input.minimumWatchmanVersion ?? '1.34.0',
    publishedAt: '2026-08-11T12:00:00Z',
    sources: [],
  }
}

class FakeInstallationRegistry implements KnowledgePackInstallationRegistry {
  readonly releases: InstalledKnowledgePackRelease[] = []
  readonly current = new Map<string, InstalledKnowledgePackRelease>()
  failNext = false
  beforeRecord?: (input: RecordPromotedKnowledgePackReleaseInput) => Promise<void>

  async recordPromotedRelease(
    input: RecordPromotedKnowledgePackReleaseInput
  ): Promise<InstalledKnowledgePackRelease> {
    await this.beforeRecord?.(input)
    if (this.failNext) {
      this.failNext = false
      throw new Error('synthetic registry failure')
    }
    const existing = this.releases.find(
      (release) => release.packId === input.packId && release.packVersion === input.packVersion
    )
    if (existing) {
      if (
        existing.manifestSha256 !== input.manifestSha256 ||
        JSON.stringify(existing.artifacts) !== JSON.stringify(input.artifacts)
      ) {
        throw new Error('synthetic version collision')
      }
      this.current.set(input.packId, existing)
      return existing
    }
    const release: InstalledKnowledgePackRelease = {
      id: `release-${this.releases.length + 1}`,
      ...input,
      installStatus: 'INSTALLED',
      installedAt: '2026-08-11T12:00:00.000Z',
    }
    this.releases.push(release)
    this.current.set(input.packId, release)
    return release
  }

  async getCurrentRelease(packId: string): Promise<InstalledKnowledgePackRelease | null> {
    return this.current.get(packId) ?? null
  }

  async listReleaseHistory(packId: string): Promise<InstalledKnowledgePackRelease[]> {
    return this.releases.filter((release) => release.packId === packId)
  }
}

async function fixture(currentWatchmanVersion = '1.34.0') {
  const root = await mkdtemp(join(tmpdir(), 'watchman-pack-installer-'))
  roots.push(root)
  const manifestService = new KnowledgePackManifestService()
  const signer = new KnowledgePackSigningService(
    new Ed25519KnowledgePackSigningProvider(keyId, keyPair.privateKey),
    manifestService
  )
  const verifier = new KnowledgePackVerificationService(
    new Ed25519KnowledgePackVerificationProvider([{ keyId, publicKey: keyPair.publicKey }]),
    manifestService
  )
  const registry = new FakeInstallationRegistry()
  const installer = new KnowledgePackInstallerService(verifier, registry, {
    installRoot: join(root, 'packs'),
    currentWatchmanVersion,
  })
  return { root, manifestService, signer, registry, installer }
}

async function signed(
  signer: KnowledgePackSigningService,
  manifestService: KnowledgePackManifestService,
  value: KnowledgePackManifestV1
): Promise<string> {
  return manifestService.serializeSignedManifest(await signer.signManifest(value))
}

async function stageArtifacts(
  installer: KnowledgePackInstallerService,
  artifacts: ArtifactFixture[],
  mutate?: (staging: KnowledgePackStagingHandle) => Promise<void>
): Promise<KnowledgePackStagingHandle> {
  const staging = await installer.createStagingArea()
  for (const artifact of artifacts) {
    const path = join(staging.artifactRoot, ...artifact.path.split('/'))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, artifact.bytes)
  }
  await mutate?.(staging)
  return staging
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await makeTreeRemovable(root)
      await rm(root, { recursive: true, force: true })
    })
  )
})

test('atomically installs nested opaque artifacts before advancing the registry', async () => {
  const { root, manifestService, signer, registry, installer } = await fixture()
  const artifacts = defaultArtifacts()
  const serialized = await signed(signer, manifestService, manifest({ artifacts }))
  const manifestHash = createHash('sha256').update(serialized).digest('hex')
  const expectedRelease = join(root, 'packs', 'releases', manifestHash)
  registry.beforeRecord = async () => access(join(expectedRelease, 'manifest.json'))

  const result = await installer.install({
    staging: await stageArtifacts(installer, artifacts),
    signedManifest: serialized,
    source: 'SIDELOAD',
  })

  assert.equal(result.releaseDirectory, expectedRelease)
  assert.equal(registry.current.get(manifest().packId)?.packVersion, '1.0.0')
  assert.deepEqual(
    await readFile(join(expectedRelease, 'artifacts/reference/guide.txt')),
    artifacts[0].bytes
  )
  assert.deepEqual(await readdir(join(expectedRelease, 'artifacts/archives')), ['opaque.zip'])
  const releaseStats = await stat(expectedRelease)
  const manifestStats = await stat(join(expectedRelease, 'manifest.json'))
  const artifactStats = await stat(join(expectedRelease, 'artifacts/reference/guide.txt'))
  assert.equal(releaseStats.mode & 0o777, 0o500)
  assert.equal(manifestStats.mode & 0o777, 0o400)
  assert.equal(artifactStats.mode & 0o777, 0o400)
  assert.deepEqual(await readdir(join(root, 'packs', '.installing')), [])
  assert.deepEqual(await readdir(join(root, 'packs', '.incoming')), [])
})

test('rejects modified, truncated, missing, unexpected, and symlink staging artifacts', async () => {
  const cases: Array<{
    name: string
    mutate: (staging: KnowledgePackStagingHandle, root: string) => Promise<void>
    expected: RegExp
  }> = [
    {
      name: 'modified',
      mutate: async (staging) =>
        writeFile(
          join(staging.artifactRoot, 'reference/guide.txt'),
          Buffer.from('synthetic Watchman guile\n')
        ),
      expected: /SHA-256/,
    },
    {
      name: 'truncated',
      mutate: async (staging) =>
        writeFile(join(staging.artifactRoot, 'reference/guide.txt'), Buffer.from('short')),
      expected: /size does not match/,
    },
    {
      name: 'missing',
      mutate: async (staging) => rm(join(staging.artifactRoot, 'reference/guide.txt')),
      expected: /is missing/,
    },
    {
      name: 'unexpected',
      mutate: async (staging) => writeFile(join(staging.artifactRoot, 'unexpected.bin'), 'x'),
      expected: /Unexpected Knowledge Pack artifact/,
    },
    {
      name: 'symlink',
      mutate: async (staging, root) => {
        const outside = join(root, 'outside.txt')
        await writeFile(outside, defaultArtifacts()[0].bytes)
        await rm(join(staging.artifactRoot, 'reference/guide.txt'))
        await symlink(outside, join(staging.artifactRoot, 'reference/guide.txt'))
      },
      expected: /unsafe/,
    },
  ]

  for (const item of cases) {
    const { root, manifestService, signer, registry, installer } = await fixture()
    const artifacts = defaultArtifacts()
    const serialized = await signed(signer, manifestService, manifest({ artifacts }))
    const staging = await stageArtifacts(installer, artifacts, (handle) =>
      item.mutate(handle, root)
    )
    await assert.rejects(
      installer.install({ staging, signedManifest: serialized, source: 'SIDELOAD' }),
      item.expected,
      item.name
    )
    assert.equal(registry.releases.length, 0)
  }
})

test('rejects invalid signatures and indeterminate or incompatible Watchman versions', async () => {
  {
    const { manifestService, signer, registry, installer } = await fixture()
    const artifacts = defaultArtifacts()
    const envelope = await signer.signManifest(manifest({ artifacts }))
    const invalid = manifestService.serializeSignedManifest({
      ...envelope,
      signature: Buffer.alloc(64, 5).toString('base64url'),
    })
    await assert.rejects(
      installer.install({
        staging: await stageArtifacts(installer, artifacts),
        signedManifest: invalid,
        source: 'SIDELOAD',
      }),
      /signature is invalid/
    )
    assert.equal(registry.releases.length, 0)
  }

  for (const currentVersion of ['dev', '1.33.9']) {
    const { manifestService, signer, registry, installer } = await fixture(currentVersion)
    const artifacts = defaultArtifacts()
    const serialized = await signed(signer, manifestService, manifest({ artifacts }))
    await assert.rejects(
      installer.install({
        staging: await stageArtifacts(installer, artifacts),
        signedManifest: serialized,
        source: 'SIDELOAD',
      }),
      /compatibility cannot be verified|requires Watchman/
    )
    assert.equal(registry.releases.length, 0)
  }
})

test('failed version two preserves the current version one release', async () => {
  const { manifestService, signer, registry, installer } = await fixture()
  const v1Artifacts = defaultArtifacts()
  const v1 = await signed(signer, manifestService, manifest({ artifacts: v1Artifacts }))
  const first = await installer.install({
    staging: await stageArtifacts(installer, v1Artifacts),
    signedManifest: v1,
    source: 'ACQUISITION',
  })

  const v2Artifacts = defaultArtifacts().map((artifact) => ({
    ...artifact,
    bytes: Buffer.concat([artifact.bytes, Buffer.from('v2')]),
  }))
  const v2 = await signed(
    signer,
    manifestService,
    manifest({ version: '2.0.0', title: 'Synthetic Installer Pack v2', artifacts: v2Artifacts })
  )
  const staging = await stageArtifacts(installer, v2Artifacts, async (handle) => {
    await writeFile(join(handle.artifactRoot, 'reference/guide.txt'), 'corrupt')
  })
  await assert.rejects(
    installer.install({ staging, signedManifest: v2, source: 'ACQUISITION' }),
    /size does not match|SHA-256/
  )

  assert.equal(registry.current.get(manifest().packId)?.packVersion, '1.0.0')
  assert.deepEqual(
    await readFile(join(first.releaseDirectory, 'artifacts/reference/guide.txt')),
    v1Artifacts[0].bytes
  )
})

test('retains a complete promoted orphan after registry failure and safely retries it', async () => {
  const { root, manifestService, signer, registry, installer } = await fixture()
  const artifacts = defaultArtifacts()
  const serialized = await signed(signer, manifestService, manifest({ artifacts }))
  const manifestHash = createHash('sha256').update(serialized).digest('hex')
  const expectedRelease = join(root, 'packs', 'releases', manifestHash)
  registry.failNext = true

  await assert.rejects(
    installer.install({
      staging: await stageArtifacts(installer, artifacts),
      signedManifest: serialized,
      source: 'RESTORE',
    }),
    /synthetic registry failure/
  )
  await access(join(expectedRelease, 'manifest.json'))
  assert.equal(registry.releases.length, 0)

  const retried = await installer.install({
    staging: await stageArtifacts(installer, artifacts),
    signedManifest: serialized,
    source: 'RESTORE',
  })
  assert.equal(retried.releaseDirectory, expectedRelease)
  assert.equal(registry.releases.length, 1)
  assert.deepEqual(await readdir(join(root, 'packs', 'releases')), [manifestHash])
})

test('serializes concurrent installs and rejects a conflicting same-version manifest', async () => {
  const { root, manifestService, signer, registry, installer } = await fixture()
  const artifacts = defaultArtifacts()
  const serialized = await signed(signer, manifestService, manifest({ artifacts }))
  const [first, second] = await Promise.all([
    installer.install({
      staging: await stageArtifacts(installer, artifacts),
      signedManifest: serialized,
      source: 'SIDELOAD',
    }),
    installer.install({
      staging: await stageArtifacts(installer, artifacts),
      signedManifest: serialized,
      source: 'SIDELOAD',
    }),
  ])
  assert.equal(first.releaseDirectory, second.releaseDirectory)
  assert.equal(registry.releases.length, 1)

  const conflictingArtifacts = defaultArtifacts().map((artifact, index) =>
    index === 0
      ? { ...artifact, bytes: Buffer.concat([artifact.bytes, Buffer.from('changed')]) }
      : artifact
  )
  const conflicting = await signed(
    signer,
    manifestService,
    manifest({ artifacts: conflictingArtifacts, title: 'Conflicting same version' })
  )
  await assert.rejects(
    installer.install({
      staging: await stageArtifacts(installer, conflictingArtifacts),
      signedManifest: conflicting,
      source: 'SIDELOAD',
    }),
    /already installed with a different manifest/
  )
  assert.equal(registry.releases.length, 1)
  const releaseDirectories = await readdir(join(root, 'packs', 'releases'))
  assert.equal(releaseDirectories.length, 1)
})

test('staging handles are service-created and one-use', async () => {
  const { manifestService, signer, installer } = await fixture()
  const artifacts = defaultArtifacts()
  const serialized = await signed(signer, manifestService, manifest({ artifacts }))
  const staging = await stageArtifacts(installer, artifacts)
  await installer.install({ staging, signedManifest: serialized, source: 'SIDELOAD' })
  await assert.rejects(
    installer.install({ staging, signedManifest: serialized, source: 'SIDELOAD' }),
    /invalid or has already been consumed/
  )
  await assert.rejects(
    installer.install({
      staging: { id: 'forged', artifactRoot: tmpdir() },
      signedManifest: serialized,
      source: 'SIDELOAD',
    }),
    /invalid or has already been consumed/
  )
})

test('refuses unsafe installation roots instead of changing their permissions', async () => {
  const { manifestService, registry } = await fixture()
  const root = await mkdtemp(join(tmpdir(), 'watchman-pack-unsafe-root-'))
  roots.push(root)
  await chmod(root, 0o755)
  const verifier = new KnowledgePackVerificationService(
    new Ed25519KnowledgePackVerificationProvider([{ keyId, publicKey: keyPair.publicKey }]),
    manifestService
  )
  const installer = new KnowledgePackInstallerService(verifier, registry, {
    installRoot: root,
    currentWatchmanVersion: '1.34.0',
  })

  await assert.rejects(installer.createStagingArea(), /must already be private/)
  const rootStats = await stat(root)
  assert.equal(rootStats.mode & 0o777, 0o755)
  assert.throws(
    () =>
      new KnowledgePackInstallerService(verifier, registry, {
        installRoot: '/',
        currentWatchmanVersion: '1.34.0',
      }),
    /cannot be a filesystem root/
  )
})
