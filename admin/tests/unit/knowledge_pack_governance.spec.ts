import * as assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  assertKnowledgePackApprovalTransition,
  assertKnowledgePackOwnership,
  assertKnowledgePackServiceArea,
  assertPublicationAllowed,
  assertSafeKnowledgePackArtifactPath,
  knowledgePackServiceAreaKey,
  KNOWLEDGE_PACK_ALLOWED_TRANSITIONS,
} from '../../app/utils/knowledge_pack_governance.js'
import KnowledgePack from '../../app/models/knowledge_pack.js'
import KnowledgePackCreator from '../../app/models/knowledge_pack_creator.js'
import KnowledgePackVersion from '../../app/models/knowledge_pack_version.js'

test('enforces the full governed review path and rejects direct publication', () => {
  assert.deepEqual(KNOWLEDGE_PACK_ALLOWED_TRANSITIONS.DRAFT, ['PROPOSED'])
  assert.equal(assertKnowledgePackApprovalTransition('DRAFT', 'PROPOSED'), 'SUBMIT')
  assert.equal(assertKnowledgePackApprovalTransition('PROPOSED', 'CREDENTIALS_REVIEW'), 'ADVANCE')
  assert.equal(
    assertKnowledgePackApprovalTransition('CREDENTIALS_REVIEW', 'CONTENT_REVIEW'),
    'ADVANCE'
  )
  assert.equal(assertKnowledgePackApprovalTransition('CONTENT_REVIEW', 'SAFETY_REVIEW'), 'ADVANCE')
  assert.equal(assertKnowledgePackApprovalTransition('SAFETY_REVIEW', 'APPROVED'), 'APPROVE')
  assert.equal(assertKnowledgePackApprovalTransition('APPROVED', 'PUBLISHED'), 'PUBLISH')
  assert.doesNotThrow(() => assertPublicationAllowed('APPROVED'))
  assert.throws(() => assertPublicationAllowed('DRAFT'))
  assert.throws(() => assertKnowledgePackApprovalTransition('DRAFT', 'PUBLISHED'))
  assert.throws(() => assertKnowledgePackApprovalTransition('PROPOSED', 'APPROVED'))
})

test('requires the actual creator for creator-owned packs and forbids one for HQ packs', () => {
  assert.doesNotThrow(() =>
    assertKnowledgePackOwnership({ ownerType: 'VIGILANT_WATCHMAN', creatorId: null })
  )
  assert.doesNotThrow(() =>
    assertKnowledgePackOwnership({
      ownerType: 'AUTHORIZED_WATCHMAN_CREATOR',
      creatorId: 'creator-ada-01',
    })
  )
  assert.throws(() =>
    assertKnowledgePackOwnership({
      ownerType: 'VIGILANT_WATCHMAN',
      creatorId: 'another-representative',
    } as never)
  )
  assert.throws(() =>
    assertKnowledgePackOwnership({
      ownerType: 'AUTHORIZED_WATCHMAN_CREATOR',
      creatorId: null,
    } as never)
  )
})

test('normalizes national, state, ZIP, and service-area associations', () => {
  assert.equal(knowledgePackServiceAreaKey({ type: 'NATIONAL', countryCode: 'US' }), 'NATIONAL:US')
  assert.equal(
    knowledgePackServiceAreaKey({ type: 'STATE', countryCode: 'US', stateCode: 'NC' }),
    'STATE:US:NC'
  )
  assert.equal(
    knowledgePackServiceAreaKey({
      type: 'ZIP',
      countryCode: 'US',
      stateCode: 'NC',
      postalCode: '27601',
    }),
    'ZIP:US:NC:27601'
  )
  assert.equal(
    knowledgePackServiceAreaKey({
      type: 'SERVICE_AREA',
      countryCode: 'US',
      serviceAreaId: 'wake-county-north',
    }),
    'SERVICE_AREA:US:wake-county-north'
  )
  assert.throws(() =>
    assertKnowledgePackServiceArea({
      type: 'NATIONAL',
      countryCode: 'US',
      postalCode: '27601',
    })
  )
  assert.throws(() => assertKnowledgePackServiceArea({ type: 'ZIP', countryCode: 'US' }))
})

test('rejects traversal, absolute, Windows, normalized, and ambiguous artifact paths', () => {
  for (const unsafe of [
    '../escape.zim',
    'nested/../escape.zim',
    '/absolute.zim',
    'C:\\pack.zim',
    'nested\\pack.zim',
    './pack.zim',
    'nested//pack.zim',
    '',
  ]) {
    assert.throws(() => assertSafeKnowledgePackArtifactPath(unsafe), unsafe)
  }
  assert.doesNotThrow(() => assertSafeKnowledgePackArtifactPath('reference/guide.zim'))
})

test('registry migration is additive, constrained, and refuses populated-history rollback', async () => {
  const source = await readFile(
    new URL(
      '../../database/migrations/1777000000001_create_knowledge_pack_registry_tables.ts',
      import.meta.url
    ),
    'utf8'
  )
  assert.match(source, /knowledge_packs_owner_creator_check/)
  assert.match(source, /knowledge_pack_versions_owner_creator_check/)
  assert.match(source, /knowledge_pack_service_areas_shape_check/)
  assert.match(source, /unique\(\['pack_version_id', 'area_key'\]\)/)
  assert.match(
    source,
    /createTable\('knowledge_pack_artifacts'[\s\S]*is_active'[\s\S]*defaultTo\(false\)/
  )
  assert.match(source, /Refusing to roll back populated immutable Knowledge Pack history/)
  assert.doesNotMatch(source, /alterTable|dropColumn|delete\(|truncate/)

  const down = source.slice(source.indexOf('async down()'))
  for (const tableName of [
    'knowledge_pack_ownership_corrections',
    'knowledge_pack_approvals',
    'knowledge_pack_artifacts',
    'knowledge_pack_sources',
    'knowledge_pack_service_areas',
    'knowledge_pack_version_missions',
    'knowledge_pack_versions',
    'knowledge_packs',
    'knowledge_pack_creators',
  ]) {
    assert.match(down, new RegExp(`['"]${tableName}['"]`), tableName)
  }
})

test('publication uses a dedicated evidence gate and preserves historical timestamps', async () => {
  const source = await readFile(
    new URL('../../app/services/knowledge_pack_registry_service.ts', import.meta.url),
    'utf8'
  )

  assert.match(source, /if \(input\.to === 'PUBLISHED'\)[\s\S]*return this\.publishVersion/)
  assert.match(source, /async publishVersion/)
  assert.match(source, /assertPublicationAllowed\(from\)/)
  assert.match(source, /from\('knowledge_pack_artifacts'\)[\s\S]*pack_version_id/)
  assert.match(source, /from\('knowledge_pack_signed_manifests'\)[\s\S]*pack_version_id/)
  assert.match(source, /assertKnowledgePackManifestMatchesCatalog/)
  assert.match(source, /persistedManifestHash !== signedManifest\.manifest_sha256/)
  assert.match(source, /signedManifest\.manifest_published_at/)
  assert.match(source, /from\('knowledge_pack_financial_terms'\)[\s\S]*pack_version_id/)
  assert.match(source, /where\('effective_from', '<=', nowSql\(\)\)/)
  assert.match(source, /financial terms do not match the version ownership snapshot/i)
  assert.match(source, /whereNull\('published_at'\)/)
  assert.match(source, /clearingAvailability[\s\S]*is_published: clearingAvailability \? false/)
  assert.match(source, /clearingAvailability[\s\S]*update\(\{ is_active: false \}\)/)
  assert.match(source, /recomputePackAvailability/)
})

test('model guards block direct financial identity reassignment', () => {
  const pack = new KnowledgePack()
  pack.owner_type = 'VIGILANT_WATCHMAN'
  pack.creator_id = null
  pack.$isPersisted = true
  pack.$hydrateOriginals()
  pack.title = 'A safe descriptive edit'
  assert.doesNotThrow(() => KnowledgePack.rejectDirectOwnershipUpdate(pack))
  pack.creator_id = 'creator-ada-01'
  assert.throws(() => KnowledgePack.rejectDirectOwnershipUpdate(pack), /audited/i)

  const version = new KnowledgePackVersion()
  version.pack_id = 'pack-1'
  version.version = '1.0.0'
  version.owner_type_snapshot = 'VIGILANT_WATCHMAN'
  version.creator_id_snapshot = null
  version.$isPersisted = true
  version.$hydrateOriginals()
  version.release_notes = 'Safe clarification'
  assert.doesNotThrow(() => KnowledgePackVersion.rejectIdentityOrOwnershipUpdate(version))
  version.version = '2.0.0'
  assert.throws(() => KnowledgePackVersion.rejectIdentityOrOwnershipUpdate(version), /immutable/i)

  const creator = new KnowledgePackCreator()
  creator.representative_id = 'representative-ada'
  creator.$isPersisted = true
  creator.$hydrateOriginals()
  creator.display_name = 'Ada'
  assert.doesNotThrow(() => KnowledgePackCreator.rejectRepresentativeReassignment(creator))
  creator.representative_id = 'different-representative'
  assert.throws(() => KnowledgePackCreator.rejectRepresentativeReassignment(creator), /immutable/i)
})
