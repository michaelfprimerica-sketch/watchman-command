import * as assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import type { KnowledgePackManifestV1 } from '../../types/knowledge_packs.js'
import { KnowledgePackManifestService } from '../../app/services/knowledge_pack_manifest_service.js'
import {
  Ed25519KnowledgePackSigningProvider,
  Ed25519KnowledgePackVerificationProvider,
  KnowledgePackSigningService,
} from '../../app/services/knowledge_pack_signature_service.js'
import {
  assertKnowledgePackManifestMatchesCatalog,
  normalizeKnowledgePackManifestSnapshot,
} from '../../app/services/knowledge_pack_signed_manifest_service.js'

function manifest(): KnowledgePackManifestV1 {
  return {
    schemaVersion: 'watchman.knowledge-pack/v1',
    packId: 'pack-field-reference',
    packVersion: '1.2.0',
    title: 'Field Reference',
    summary: 'Synthetic Watchman-only fixture',
    category: 'preparedness',
    owner: { ownerType: 'VIGILANT_WATCHMAN', creatorId: null },
    missionIds: ['mission-radio', 'mission-water'],
    serviceAreas: [
      { type: 'NATIONAL', countryCode: 'US' },
      { type: 'ZIP', countryCode: 'US', stateCode: 'NC', postalCode: '27601' },
      { type: 'SERVICE_AREA', countryCode: 'US', serviceAreaId: 'wake-county-north' },
    ],
    contentFormat: 'DOCUMENT_BUNDLE',
    artifacts: [
      {
        id: 'artifact-guide',
        path: 'reference/guide.txt',
        contentType: 'text/plain',
        sizeBytes: 8,
        sha256: 'a'.repeat(64),
      },
    ],
    minimumWatchmanVersion: '1.34.0',
    publishedAt: '2026-08-11T12:00:00Z',
    releaseNotes: 'Initial synthetic release',
    sources: [
      {
        id: 'source-public-record',
        authority: 'Synthetic Public Agency',
        title: 'Synthetic record',
        url: 'https://example.invalid/reference',
        checkedDate: '2026-08-11',
      },
    ],
  }
}

async function signed() {
  const { privateKey } = generateKeyPairSync('ed25519')
  return new KnowledgePackSigningService(
    new Ed25519KnowledgePackSigningProvider('watchman-test-key-2026', privateKey)
  ).signManifest(manifest())
}

test('uses RFC 8785 canonical JSON and round-trips only its exact representation', async () => {
  const service = new KnowledgePackManifestService()
  const envelope = await signed()
  const serialized = service.serializeSignedManifest(envelope)
  assert.deepEqual(service.parseSignedManifest(serialized), envelope)
  assert.match(serialized, /^\{"signature":"[A-Za-z0-9_-]{86}","signed":\{/)
  assert.match(
    serialized,
    /"signatureMetadata":\{"algorithm":"Ed25519","canonicalization":"RFC8785","encoding":"base64url","keyId":"watchman-test-key-2026"\}/
  )

  const reordered = `{"signed":${JSON.stringify(envelope.signed)},"signature":${JSON.stringify(envelope.signature)}}`
  assert.throws(() => service.parseSignedManifest(reordered), /canonical representation/)
  assert.throws(() => service.parseSignedManifest(`${serialized}\n`), /canonical representation/)
})

test('rejects duplicate/escaped duplicate fields, malformed UTF-8, BOM, and oversized input', async () => {
  const service = new KnowledgePackManifestService()
  const envelope = await signed()
  const serialized = service.serializeSignedManifest(envelope)
  const duplicate = serialized.replace('{"signature":', '{"signature":"duplicate","signature":')
  const escapedDuplicate = serialized.replace(
    '{"signature":',
    '{"\\u0073ignature":"duplicate","signature":'
  )
  assert.throws(() => service.parseSignedManifest(duplicate), /canonical representation/)
  assert.throws(() => service.parseSignedManifest(escapedDuplicate), /canonical representation/)
  assert.throws(() => service.parseSignedManifest(Buffer.from([0xc3, 0x28])), /not valid UTF-8/)
  assert.throws(
    () =>
      service.parseSignedManifest(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(serialized)])
      ),
    /must not contain a UTF-8 BOM/
  )
  assert.throws(() => service.parseSignedManifest('x'.repeat(256 * 1024 + 1)), /exceeds/)
})

test('rejects unknown/unsupported fields, unsafe paths, duplicate paths, and lax versions', async () => {
  const service = new KnowledgePackManifestService()
  const valid = await signed()
  const variants: unknown[] = [
    { ...valid, untrusted: true },
    { ...valid, signed: { ...valid.signed, schemaVersion: 'watchman.knowledge-pack/v2' } },
    { ...valid, signed: { ...valid.signed, packVersion: 'v1.2.0' } },
    { ...valid, signed: { ...valid.signed, minimumWatchmanVersion: '1.34' } },
    {
      ...valid,
      signed: {
        ...valid.signed,
        owner: { ownerType: 'UNREVIEWED_PUBLISHER', creatorId: 'creator-ada-01' },
      },
    },
    {
      ...valid,
      signed: {
        ...valid.signed,
        artifacts: [{ ...valid.signed.artifacts[0], path: '../escape.txt' }],
      },
    },
    {
      ...valid,
      signed: {
        ...valid.signed,
        artifacts: [{ ...valid.signed.artifacts[0], path: 'reference/CON.txt' }],
      },
    },
    {
      ...valid,
      signed: {
        ...valid.signed,
        artifacts: [
          valid.signed.artifacts[0],
          { ...valid.signed.artifacts[0], id: 'artifact-two' },
        ],
      },
    },
    {
      ...valid,
      signed: {
        ...valid.signed,
        artifacts: [
          valid.signed.artifacts[0],
          {
            ...valid.signed.artifacts[0],
            id: 'artifact-two',
            path: 'Reference/Guide.txt',
          },
        ],
      },
    },
    {
      ...valid,
      signed: {
        ...valid.signed,
        signatureMetadata: { ...valid.signed.signatureMetadata, algorithm: 'HMAC-SHA256' },
      },
    },
  ]
  for (const variant of variants) {
    assert.throws(() => service.canonicalSignedManifestBytes(variant as never))
  }
})

test('commits no private key and the immutable signed-manifest schema resists rollback', async () => {
  const signatureSource = await readFile(
    new URL('../../app/services/knowledge_pack_signature_service.ts', import.meta.url),
    'utf8'
  )
  const migration = await readFile(
    new URL(
      '../../database/migrations/1777000000003_create_knowledge_pack_signed_manifests_table.ts',
      import.meta.url
    ),
    'utf8'
  )
  assert.doesNotMatch(signatureSource, /BEGIN (?:ED25519 |)PRIVATE KEY|process\.env|readFile/)
  assert.match(signatureSource, /server-side signing infrastructure/)
  assert.match(migration, /pack_version_id.*unique/)
  assert.match(migration, /signature_algorithm = 'Ed25519'/)
  assert.match(migration, /canonicalization = 'RFC8785'/)
  assert.match(migration, /manifest_published_at/)
  assert.match(migration, /Refusing to roll back immutable signed Knowledge Pack manifests/)
})

test('enforces Ed25519 key purpose and keeps private keys out of the client trust store', () => {
  const ed25519 = generateKeyPairSync('ed25519')
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
  assert.throws(
    () => new Ed25519KnowledgePackSigningProvider('watchman-test-key', rsa.privateKey),
    /must be an Ed25519 private key/
  )
  assert.throws(
    () =>
      new Ed25519KnowledgePackVerificationProvider([
        { keyId: 'watchman-test-key', publicKey: rsa.publicKey },
      ]),
    /must be an Ed25519 public key/
  )
  assert.throws(
    () =>
      new Ed25519KnowledgePackVerificationProvider([
        { keyId: 'watchman-test-key', publicKey: ed25519.privateKey },
      ]),
    /must be an Ed25519 public key/
  )
})

test('binds persisted signed manifests to the exact immutable catalog snapshot', () => {
  const value = manifest()
  const catalog = normalizeKnowledgePackManifestSnapshot(value)
  assert.doesNotThrow(() => assertKnowledgePackManifestMatchesCatalog(value, catalog))
  assert.throws(
    () =>
      assertKnowledgePackManifestMatchesCatalog(
        { ...value, title: 'A different signed title' },
        catalog
      ),
    /does not match/
  )
  assert.throws(
    () =>
      assertKnowledgePackManifestMatchesCatalog(
        {
          ...value,
          artifacts: [{ ...value.artifacts[0], sha256: 'b'.repeat(64) }],
        },
        catalog
      ),
    /does not match/
  )
})
