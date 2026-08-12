import * as assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  assertKnowledgePackApprovalTransition,
  assertKnowledgePackOwnership,
  assertKnowledgePackServiceArea,
  assertSafeKnowledgePackArtifactPath,
  knowledgePackServiceAreaKey,
  KNOWLEDGE_PACK_ALLOWED_TRANSITIONS,
} from '../../app/utils/knowledge_pack_governance.js'

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
  assert.match(source, /Refusing to roll back populated immutable Knowledge Pack history/)
  assert.doesNotMatch(source, /alterTable|dropColumn|delete\(|truncate/)
})
