import * as assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'

import type { KnowledgePackManifestV1 } from '../../types/knowledge_packs.js'
import { KnowledgePackManifestService } from '../../app/services/knowledge_pack_manifest_service.js'
import {
  Ed25519KnowledgePackSigningProvider,
  Ed25519KnowledgePackVerificationProvider,
  KnowledgePackSigningService,
} from '../../app/services/knowledge_pack_signature_service.js'
import {
  KnowledgePackVerificationError,
  KnowledgePackVerificationService,
} from '../../app/services/knowledge_pack_verification_service.js'

const roots: string[] = []
const keyPair = generateKeyPairSync('ed25519')
const otherKeyPair = generateKeyPairSync('ed25519')
const keyId = 'watchman-test-key-2026'
const bytes = Buffer.from('synthetic Watchman artifact\n')

function manifest(overrides: Partial<KnowledgePackManifestV1> = {}): KnowledgePackManifestV1 {
  return {
    schemaVersion: 'watchman.knowledge-pack/v1',
    packId: 'pack-field-reference',
    packVersion: '1.0.0',
    title: 'Synthetic Field Reference',
    category: 'preparedness',
    owner: {
      ownerType: 'AUTHORIZED_WATCHMAN_CREATOR',
      creatorId: 'creator-ada-01',
    },
    missionIds: ['mission-water', 'mission-radio'],
    serviceAreas: [
      { type: 'ZIP', countryCode: 'US', stateCode: 'NC', postalCode: '27601' },
      { type: 'ZIP', countryCode: 'US', stateCode: 'NC', postalCode: '27603' },
    ],
    contentFormat: 'DATASET',
    artifacts: [
      {
        id: 'artifact-reference',
        path: 'data/reference.txt',
        contentType: 'text/plain',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
    minimumWatchmanVersion: '1.34.0',
    publishedAt: '2026-08-11T12:00:00Z',
    sources: [],
    ...overrides,
  }
}

async function fixture(
  input: {
    manifest?: KnowledgePackManifestV1
    signingPrivateKey?: typeof keyPair.privateKey
    trustedPublicKey?: typeof keyPair.publicKey
  } = {}
) {
  const root = await mkdtemp(join(tmpdir(), 'watchman-pack-verification-'))
  roots.push(root)
  await mkdir(join(root, 'data'))
  await writeFile(join(root, 'data', 'reference.txt'), bytes)
  const signingService = new KnowledgePackSigningService(
    new Ed25519KnowledgePackSigningProvider(keyId, input.signingPrivateKey ?? keyPair.privateKey)
  )
  const envelope = await signingService.signManifest(input.manifest ?? manifest())
  const manifestService = new KnowledgePackManifestService()
  const verifier = new KnowledgePackVerificationService(
    new Ed25519KnowledgePackVerificationProvider([
      { keyId, publicKey: input.trustedPublicKey ?? keyPair.publicKey },
    ]),
    manifestService
  )
  return {
    root,
    envelope,
    serialized: manifestService.serializeSignedManifest(envelope),
    verifier,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('verifies Ed25519 signature, exact artifacts, compatibility, and canonical manifest hash', async () => {
  const { root, serialized, verifier } = await fixture()
  const result = await verifier.verify({
    signedManifest: serialized,
    artifactRoot: root,
    currentWatchmanVersion: '1.34.1',
  })
  assert.equal(result.manifest.packId, 'pack-field-reference')
  assert.equal(result.signingKeyId, keyId)
  assert.equal(result.compatibility, 'COMPATIBLE')
  assert.equal(result.manifestSha256, createHash('sha256').update(serialized).digest('hex'))
  assert.equal(result.artifacts[0].absolutePath, join(root, 'data', 'reference.txt'))
})

test('exposes manifest-only verification for a single-pass atomic installer', async () => {
  const { root, serialized, verifier } = await fixture()
  await rm(root, { recursive: true, force: true })
  const result = await verifier.verifyManifest({
    signedManifest: serialized,
    currentWatchmanVersion: '1.34.0',
  })
  assert.equal(result.manifest.packVersion, '1.0.0')
  assert.equal(result.signingKeyId, keyId)
  assert.equal(result.compatibility, 'COMPATIBLE')
  assert.equal(result.manifestSha256, createHash('sha256').update(serialized).digest('hex'))
})

test('rejects invalid signature, wrong/untrusted keys, modified metadata, and manifest mutation', async () => {
  const { root, envelope, serialized, verifier } = await fixture()
  const invalidSignature = {
    ...envelope,
    signature: Buffer.alloc(64, 7).toString('base64url'),
  }
  await assert.rejects(
    verifier.verify({
      signedManifest: new KnowledgePackManifestService().serializeSignedManifest(invalidSignature),
      artifactRoot: root,
      currentWatchmanVersion: '1.34.0',
    }),
    (error: KnowledgePackVerificationError) => error.code === 'INVALID_SIGNATURE'
  )

  const wrongKeyFixture = await fixture({ trustedPublicKey: otherKeyPair.publicKey })
  const wrongKeyVerifier = wrongKeyFixture.verifier
  await assert.rejects(
    wrongKeyVerifier.verify({
      signedManifest: serialized,
      artifactRoot: root,
      currentWatchmanVersion: '1.34.0',
    }),
    (error: KnowledgePackVerificationError) => error.code === 'INVALID_SIGNATURE'
  )

  const unknownKeyEnvelope = {
    ...envelope,
    signed: {
      ...envelope.signed,
      signatureMetadata: { ...envelope.signed.signatureMetadata, keyId: 'unknown-key' },
    },
  }
  await assert.rejects(
    verifier.verify({
      signedManifest: new KnowledgePackManifestService().serializeSignedManifest(
        unknownKeyEnvelope
      ),
      artifactRoot: root,
    }),
    (error: KnowledgePackVerificationError) => error.code === 'UNTRUSTED_KEY'
  )

  const modifiedManifest = {
    ...envelope,
    signed: { ...envelope.signed, title: 'Modified title' },
  }
  await assert.rejects(
    verifier.verify({
      signedManifest: new KnowledgePackManifestService().serializeSignedManifest(modifiedManifest),
      artifactRoot: root,
    }),
    (error: KnowledgePackVerificationError) => error.code === 'INVALID_SIGNATURE'
  )
})

test('rejects modified, truncated, missing, unexpected, and symbolic-link artifacts', async () => {
  {
    const { root, serialized, verifier } = await fixture()
    const modified = Buffer.from(bytes)
    modified[0] ^= 0xff
    await writeFile(join(root, 'data', 'reference.txt'), modified)
    await assert.rejects(
      verifier.verify({
        signedManifest: serialized,
        artifactRoot: root,
        currentWatchmanVersion: '1.34.0',
      }),
      (error: KnowledgePackVerificationError) => error.code === 'ARTIFACT_HASH_MISMATCH'
    )
  }
  {
    const incorrectHashManifest = manifest({
      artifacts: [{ ...manifest().artifacts[0], sha256: '0'.repeat(64) }],
    })
    const { root, serialized, verifier } = await fixture({ manifest: incorrectHashManifest })
    await assert.rejects(
      verifier.verify({
        signedManifest: serialized,
        artifactRoot: root,
        currentWatchmanVersion: '1.34.0',
      }),
      (error: KnowledgePackVerificationError) => error.code === 'ARTIFACT_HASH_MISMATCH'
    )
  }
  {
    const { root, serialized, verifier } = await fixture()
    await writeFile(join(root, 'data', 'reference.txt'), bytes.subarray(0, 4))
    await assert.rejects(
      verifier.verify({
        signedManifest: serialized,
        artifactRoot: root,
        currentWatchmanVersion: '1.34.0',
      }),
      (error: KnowledgePackVerificationError) => error.code === 'ARTIFACT_SIZE_MISMATCH'
    )
  }
  {
    const { root, serialized, verifier } = await fixture()
    await rm(join(root, 'data', 'reference.txt'))
    await assert.rejects(
      verifier.verify({
        signedManifest: serialized,
        artifactRoot: root,
        currentWatchmanVersion: '1.34.0',
      }),
      (error: KnowledgePackVerificationError) => error.code === 'MISSING_ARTIFACT'
    )
  }
  {
    const { root, serialized, verifier } = await fixture()
    await writeFile(join(root, 'unexpected.bin'), 'unexpected')
    await assert.rejects(
      verifier.verify({
        signedManifest: serialized,
        artifactRoot: root,
        currentWatchmanVersion: '1.34.0',
      }),
      (error: KnowledgePackVerificationError) => error.code === 'UNEXPECTED_ARTIFACT'
    )
  }
  {
    const { root, serialized, verifier } = await fixture()
    const outside = join(root, 'outside.txt')
    await writeFile(outside, bytes)
    await rm(join(root, 'data', 'reference.txt'))
    await symlink(outside, join(root, 'data', 'reference.txt'))
    await assert.rejects(
      verifier.verify({
        signedManifest: serialized,
        artifactRoot: root,
        currentWatchmanVersion: '1.34.0',
      }),
      (error: KnowledgePackVerificationError) => error.code === 'UNSAFE_ARTIFACT'
    )
  }
})

test('rejects incompatible, unknown, and development Watchman versions', async () => {
  const { root, serialized, verifier } = await fixture()
  await assert.rejects(
    verifier.verify({
      signedManifest: serialized,
      artifactRoot: root,
      currentWatchmanVersion: '1.33.9',
    }),
    (error: KnowledgePackVerificationError) => error.code === 'INCOMPATIBLE_WATCHMAN_VERSION'
  )
  for (const currentWatchmanVersion of ['dev', '0.0', undefined]) {
    await assert.rejects(
      verifier.verify({
        signedManifest: serialized,
        artifactRoot: root,
        currentWatchmanVersion,
      }),
      (error: KnowledgePackVerificationError) => error.code === 'INCOMPATIBLE_WATCHMAN_VERSION'
    )
  }
})
