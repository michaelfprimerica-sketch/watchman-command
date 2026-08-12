import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'

import type {
  KnowledgePackApprovalStatus,
  KnowledgePackArtifactManifestEntry,
  KnowledgePackContentFormat,
  KnowledgePackOwnership,
  KnowledgePackServiceArea,
  KnowledgePackSourceReference,
} from '../../types/knowledge_packs.js'
import {
  assertKnowledgePackApprovalTransition,
  assertKnowledgePackCategory,
  assertKnowledgePackIdentifier,
  assertKnowledgePackOwnership,
  assertKnowledgePackSlug,
  assertKnowledgePackVersion,
  assertSafeKnowledgePackArtifactPath,
  knowledgePackServiceAreaKey,
} from '../utils/knowledge_pack_governance.js'

const MAX_ASSOCIATIONS = 256
const SHA256_PATTERN = /^[a-f0-9]{64}$/

type CreateCreatorInput = {
  representativeId: string
  displayName: string
}

type CreatePackInput = {
  slug: string
  title: string
  summary?: string | null
  category: string
  ownership: KnowledgePackOwnership
  supportOwnerType?: KnowledgePackOwnership['ownerType']
  supportOwnerRef?: string | null
}

type CreateVersionInput = {
  packId: string
  version: string
  contentFormat: KnowledgePackContentFormat
  minimumWatchmanVersion: string
  releaseNotes?: string | null
  missionIds?: string[]
  serviceAreas?: KnowledgePackServiceArea[]
  sources?: KnowledgePackSourceReference[]
  artifacts?: Array<KnowledgePackArtifactManifestEntry & { storageReference: string }>
}

type TransitionInput = {
  packId: string
  packVersionId: string
  to: KnowledgePackApprovalStatus
  reviewerRef: string
  notes?: string | null
}

const nowSql = () => DateTime.utc().toSQL({ includeOffset: false }) as string

const assertText = (value: string, label: string, maxLength: number) => {
  if (!value.trim() || value.length > maxLength) throw new Error(`${label} is invalid`)
}

const assertUnique = (values: string[], label: string) => {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`)
}

const assertSource = (source: KnowledgePackSourceReference) => {
  assertKnowledgePackIdentifier(source.id, 'Source ID')
  assertText(source.authority, 'Source authority', 255)
  assertText(source.title, 'Source title', 512)
  if (source.url) {
    if (source.url.length > 2048) throw new Error('Source URL is too long')
    const parsed = new URL(source.url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('Source URL must be an HTTPS URL without credentials')
    }
  }
}

const assertArtifact = (
  artifact: KnowledgePackArtifactManifestEntry & { storageReference: string }
) => {
  assertKnowledgePackIdentifier(artifact.id, 'Artifact ID')
  assertSafeKnowledgePackArtifactPath(artifact.path)
  assertText(artifact.contentType, 'Artifact content type', 255)
  if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0) {
    throw new Error('Artifact size is invalid')
  }
  if (!SHA256_PATTERN.test(artifact.sha256)) throw new Error('Artifact SHA-256 is invalid')
  assertText(artifact.storageReference, 'Artifact storage reference', 1024)
}

/**
 * Persistence boundary for the private Watchman pack catalog.
 *
 * No controller or route exposes these methods. Review/publish operations remain server-side until
 * Watchman has an authenticated administrative boundary.
 */
export class KnowledgePackRegistryService {
  async createCreator(input: CreateCreatorInput): Promise<string> {
    assertKnowledgePackIdentifier(input.representativeId, 'Representative ID')
    assertText(input.displayName, 'Creator display name', 255)
    const id = randomUUID()
    const now = nowSql()
    await db.table('knowledge_pack_creators').insert({
      id,
      representative_id: input.representativeId,
      display_name: input.displayName.trim(),
      is_active: true,
      created_at: now,
      updated_at: now,
    })
    return id
  }

  async createPack(input: CreatePackInput): Promise<string> {
    assertKnowledgePackSlug(input.slug)
    assertText(input.title, 'Pack title', 255)
    if (input.summary && input.summary.length > 10_000) throw new Error('Pack summary is too long')
    assertKnowledgePackCategory(input.category)
    assertKnowledgePackOwnership(input.ownership)
    if (input.supportOwnerRef) {
      assertKnowledgePackIdentifier(input.supportOwnerRef, 'Support owner reference')
    }

    const id = randomUUID()
    await db.transaction(async (trx) => {
      if (input.ownership.creatorId) {
        const creator = await trx
          .from('knowledge_pack_creators')
          .where('id', input.ownership.creatorId)
          .where('is_active', true)
          .first()
        if (!creator) throw new Error('The financial creator is not active or does not exist')
      }

      const now = nowSql()
      await trx.table('knowledge_packs').insert({
        id,
        slug: input.slug,
        title: input.title.trim(),
        summary: input.summary?.trim() || null,
        category: input.category,
        owner_type: input.ownership.ownerType,
        creator_id: input.ownership.creatorId,
        approval_status: 'DRAFT',
        is_active: true,
        is_published: false,
        support_owner_type: input.supportOwnerType ?? 'VIGILANT_WATCHMAN',
        support_owner_ref: input.supportOwnerRef ?? null,
        published_at: null,
        created_at: now,
        updated_at: now,
      })
    })
    return id
  }

  async createVersion(input: CreateVersionInput): Promise<string> {
    assertKnowledgePackIdentifier(input.packId, 'Pack ID')
    assertKnowledgePackVersion(input.version)
    assertKnowledgePackVersion(input.minimumWatchmanVersion, 'Minimum Watchman version')
    if (input.releaseNotes && input.releaseNotes.length > 20_000) {
      throw new Error('Release notes are too long')
    }

    const missionIds = input.missionIds ?? []
    const serviceAreas = input.serviceAreas ?? []
    const sources = input.sources ?? []
    const artifacts = input.artifacts ?? []
    for (const entries of [missionIds, serviceAreas, sources, artifacts]) {
      if (entries.length > MAX_ASSOCIATIONS) throw new Error('Too many pack associations')
    }
    missionIds.forEach((id) => assertKnowledgePackIdentifier(id, 'Mission ID'))
    assertUnique(missionIds, 'Mission list')
    const serviceAreaKeys = serviceAreas.map(knowledgePackServiceAreaKey)
    assertUnique(serviceAreaKeys, 'Service area list')
    sources.forEach(assertSource)
    artifacts.forEach(assertArtifact)
    assertUnique(
      artifacts.map((artifact) => artifact.path),
      'Artifact list'
    )
    assertUnique(
      artifacts.map((artifact) => artifact.id),
      'Artifact ID list'
    )
    assertUnique(
      sources.map((source) => source.id),
      'Source ID list'
    )

    const versionId = randomUUID()
    await db.transaction(async (trx) => {
      const pack = await trx.from('knowledge_packs').where('id', input.packId).forUpdate().first()
      if (!pack || !pack.is_active) throw new Error('Knowledge Pack does not exist or is inactive')
      const ownership = {
        ownerType: pack.owner_type,
        creatorId: pack.creator_id,
      } as KnowledgePackOwnership
      assertKnowledgePackOwnership(ownership)

      const now = nowSql()
      await trx.table('knowledge_pack_versions').insert({
        id: versionId,
        pack_id: input.packId,
        version: input.version,
        title_snapshot: pack.title,
        summary_snapshot: pack.summary,
        category_snapshot: pack.category,
        owner_type_snapshot: ownership.ownerType,
        creator_id_snapshot: ownership.creatorId,
        approval_status: 'DRAFT',
        content_format: input.contentFormat,
        minimum_watchman_version: input.minimumWatchmanVersion,
        release_notes: input.releaseNotes?.trim() || null,
        is_published: false,
        published_at: null,
        created_at: now,
        updated_at: now,
      })

      if (missionIds.length) {
        await trx.table('knowledge_pack_version_missions').multiInsert(
          missionIds.map((missionId) => ({
            pack_version_id: versionId,
            mission_id: missionId,
            created_at: now,
          }))
        )
      }
      if (serviceAreas.length) {
        await trx.table('knowledge_pack_service_areas').multiInsert(
          serviceAreas.map((area, index) => ({
            id: randomUUID(),
            pack_version_id: versionId,
            area_type: area.type,
            area_key: serviceAreaKeys[index],
            country_code: area.countryCode,
            state_code: area.stateCode ?? null,
            postal_code: area.postalCode ?? null,
            service_area_id: area.serviceAreaId ?? null,
            label: area.label?.slice(0, 255) ?? null,
            created_at: now,
          }))
        )
      }
      if (sources.length) {
        await trx.table('knowledge_pack_sources').multiInsert(
          sources.map((source) => ({
            id: source.id,
            pack_version_id: versionId,
            source_authority: source.authority.trim(),
            source_title: source.title.trim(),
            source_url: source.url ?? null,
            source_checked_date: source.checkedDate ?? null,
            provenance_notes: source.provenanceNotes?.slice(0, 20_000) ?? null,
            rights_metadata: source.rightsMetadata?.slice(0, 20_000) ?? null,
            created_at: now,
          }))
        )
      }
      if (artifacts.length) {
        await trx.table('knowledge_pack_artifacts').multiInsert(
          artifacts.map((artifact) => ({
            id: artifact.id,
            pack_version_id: versionId,
            logical_name: artifact.path,
            content_type: artifact.contentType,
            byte_size: artifact.sizeBytes,
            sha256: artifact.sha256,
            compression: artifact.compression ?? null,
            storage_reference: artifact.storageReference,
            is_active: true,
            created_at: now,
            published_at: null,
          }))
        )
      }
    })
    return versionId
  }

  async transitionVersion(input: TransitionInput): Promise<void> {
    assertKnowledgePackIdentifier(input.packId, 'Pack ID')
    assertKnowledgePackIdentifier(input.packVersionId, 'Pack version ID')
    assertKnowledgePackIdentifier(input.reviewerRef, 'Reviewer reference')
    if (input.notes && input.notes.length > 20_000) throw new Error('Review notes are too long')

    await db.transaction(async (trx) => {
      const version = await trx
        .from('knowledge_pack_versions')
        .where('id', input.packVersionId)
        .where('pack_id', input.packId)
        .forUpdate()
        .first()
      if (!version) throw new Error('Knowledge Pack version does not exist')

      const from = version.approval_status as KnowledgePackApprovalStatus
      const decision = assertKnowledgePackApprovalTransition(from, input.to)
      const now = nowSql()
      const publishing = input.to === 'PUBLISHED'
      await trx
        .from('knowledge_pack_versions')
        .where('id', input.packVersionId)
        .update({
          approval_status: input.to,
          is_published: publishing ? true : version.is_published,
          published_at: publishing ? now : version.published_at,
          updated_at: now,
        })
      await trx.table('knowledge_pack_approvals').insert({
        id: randomUUID(),
        pack_version_id: input.packVersionId,
        reviewer_ref: input.reviewerRef,
        stage: input.to,
        decision,
        from_status: from,
        resulting_status: input.to,
        notes: input.notes?.trim() || null,
        created_at: now,
      })

      if (publishing) {
        await trx.from('knowledge_packs').where('id', input.packId).update({
          approval_status: 'PUBLISHED',
          is_published: true,
          published_at: now,
          updated_at: now,
        })
        await trx
          .from('knowledge_pack_artifacts')
          .where('pack_version_id', input.packVersionId)
          .update({ published_at: now })
      }
    })
  }

  /**
   * Explicit audited correction for future versions. Existing version ownership snapshots and
   * financial terms are never rewritten, so a support-owner or catalog edit cannot redirect old
   * creator royalties.
   */
  async correctOwnership(input: {
    packId: string
    ownership: KnowledgePackOwnership
    reviewerRef: string
    reason: string
  }): Promise<void> {
    assertKnowledgePackIdentifier(input.packId, 'Pack ID')
    assertKnowledgePackOwnership(input.ownership)
    assertKnowledgePackIdentifier(input.reviewerRef, 'Reviewer reference')
    assertText(input.reason, 'Ownership correction reason', 20_000)

    await db.transaction(async (trx) => {
      const pack = await trx.from('knowledge_packs').where('id', input.packId).forUpdate().first()
      if (!pack) throw new Error('Knowledge Pack does not exist')
      if (input.ownership.creatorId) {
        const creator = await trx
          .from('knowledge_pack_creators')
          .where('id', input.ownership.creatorId)
          .where('is_active', true)
          .first()
        if (!creator) throw new Error('Corrected creator is not active or does not exist')
      }
      const now = nowSql()
      await trx.from('knowledge_packs').where('id', input.packId).update({
        owner_type: input.ownership.ownerType,
        creator_id: input.ownership.creatorId,
        updated_at: now,
      })
      await trx.table('knowledge_pack_ownership_corrections').insert({
        id: randomUUID(),
        pack_id: input.packId,
        reviewer_ref: input.reviewerRef,
        prior_owner_type: pack.owner_type,
        prior_creator_id: pack.creator_id,
        new_owner_type: input.ownership.ownerType,
        new_creator_id: input.ownership.creatorId,
        reason: input.reason.trim(),
        created_at: now,
      })
    })
  }
}
