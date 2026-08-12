import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'

import type {
  KnowledgePackArtifactManifestEntry,
  KnowledgePackManifestV1,
  KnowledgePackServiceArea,
  KnowledgePackSourceReference,
} from '../../types/knowledge_packs.js'
import { unsignedKnowledgePackManifest } from '../../types/knowledge_pack_manifests.js'
import {
  assertKnowledgePackIdentifier,
  knowledgePackServiceAreaKey,
} from '../utils/knowledge_pack_governance.js'
import { KnowledgePackManifestService } from './knowledge_pack_manifest_service.js'
import type { VerifiedKnowledgePackManifest } from './knowledge_pack_verification_service.js'

export type KnowledgePackCatalogSnapshot = {
  packId: string
  packVersion: string
  title: string
  summary: string | null
  category: string
  owner: KnowledgePackManifestV1['owner']
  missionIds: string[]
  serviceAreas: KnowledgePackServiceArea[]
  contentFormat: KnowledgePackManifestV1['contentFormat']
  artifacts: KnowledgePackArtifactManifestEntry[]
  minimumWatchmanVersion: string
  releaseNotes: string | null
  sources: KnowledgePackSourceReference[]
}

export const normalizeKnowledgePackManifestSnapshot = (
  manifest: KnowledgePackManifestV1
): KnowledgePackCatalogSnapshot => ({
  packId: manifest.packId,
  packVersion: manifest.packVersion,
  title: manifest.title,
  summary: manifest.summary ?? null,
  category: manifest.category,
  owner: manifest.owner,
  missionIds: [...manifest.missionIds].sort(),
  serviceAreas: [...manifest.serviceAreas]
    .map((area) => ({
      type: area.type,
      countryCode: area.countryCode,
      stateCode: area.stateCode ?? null,
      postalCode: area.postalCode ?? null,
      serviceAreaId: area.serviceAreaId ?? null,
      label: area.label ?? null,
    }))
    .sort((left, right) =>
      knowledgePackServiceAreaKey(left).localeCompare(knowledgePackServiceAreaKey(right))
    ),
  contentFormat: manifest.contentFormat,
  artifacts: [...manifest.artifacts]
    .map((artifact) => ({ ...artifact, compression: artifact.compression ?? null }))
    .sort((left, right) => left.path.localeCompare(right.path)),
  minimumWatchmanVersion: manifest.minimumWatchmanVersion,
  releaseNotes: manifest.releaseNotes ?? null,
  sources: [...manifest.sources]
    .map((source) => ({
      ...source,
      url: source.url ?? null,
      checkedDate: source.checkedDate ?? null,
      provenanceNotes: source.provenanceNotes ?? null,
      rightsMetadata: source.rightsMetadata ?? null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id)),
})

const dateOnly = (value: Date | string | null): string | null => {
  if (value === null) return null
  const parsed =
    value instanceof Date
      ? DateTime.fromJSDate(value, { zone: 'utc' })
      : DateTime.fromISO(value, { zone: 'utc' })
  if (!parsed.isValid) throw new Error('Stored Knowledge Pack source date is invalid')
  return parsed.toISODate()
}

export async function loadKnowledgePackCatalogSnapshot(
  trx: TransactionClientContract,
  packVersionId: string
): Promise<KnowledgePackCatalogSnapshot> {
  const version = await trx.from('knowledge_pack_versions').where('id', packVersionId).first()
  if (!version) throw new Error('Knowledge Pack version does not exist')

  const [missions, areas, artifacts, sources] = await Promise.all([
    trx.from('knowledge_pack_version_missions').where('pack_version_id', packVersionId),
    trx.from('knowledge_pack_service_areas').where('pack_version_id', packVersionId),
    trx.from('knowledge_pack_artifacts').where('pack_version_id', packVersionId),
    trx.from('knowledge_pack_sources').where('pack_version_id', packVersionId),
  ])

  return {
    packId: version.pack_id,
    packVersion: version.version,
    title: version.title_snapshot,
    summary: version.summary_snapshot ?? null,
    category: version.category_snapshot,
    owner:
      version.owner_type_snapshot === 'VIGILANT_WATCHMAN'
        ? { ownerType: 'VIGILANT_WATCHMAN', creatorId: null }
        : {
            ownerType: 'AUTHORIZED_WATCHMAN_CREATOR',
            creatorId: version.creator_id_snapshot,
          },
    missionIds: missions.map((row) => row.mission_id as string).sort(),
    serviceAreas: areas
      .map((row) => ({
        type: row.area_type,
        countryCode: row.country_code,
        stateCode: row.state_code ?? null,
        postalCode: row.postal_code ?? null,
        serviceAreaId: row.service_area_id ?? null,
        label: row.label ?? null,
      }))
      .sort((left, right) =>
        knowledgePackServiceAreaKey(left).localeCompare(knowledgePackServiceAreaKey(right))
      ),
    contentFormat: version.content_format,
    artifacts: artifacts
      .map((row) => {
        const sizeBytes = Number(row.byte_size)
        if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
          throw new Error('Stored Knowledge Pack artifact size is invalid')
        }
        return {
          id: row.id,
          path: row.logical_name,
          contentType: row.content_type,
          sizeBytes,
          sha256: row.sha256,
          compression: row.compression ?? null,
        }
      })
      .sort((left, right) => left.path.localeCompare(right.path)),
    minimumWatchmanVersion: version.minimum_watchman_version,
    releaseNotes: version.release_notes ?? null,
    sources: sources
      .map((row) => ({
        id: row.id,
        authority: row.source_authority,
        title: row.source_title,
        url: row.source_url ?? null,
        checkedDate: dateOnly(row.source_checked_date as Date | string | null),
        provenanceNotes: row.provenance_notes ?? null,
        rightsMetadata: row.rights_metadata ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  } as KnowledgePackCatalogSnapshot
}

export function assertKnowledgePackManifestMatchesCatalog(
  manifest: KnowledgePackManifestV1,
  catalog: KnowledgePackCatalogSnapshot
): void {
  if (!isDeepStrictEqual(normalizeKnowledgePackManifestSnapshot(manifest), catalog)) {
    throw new Error('Signed manifest does not match the immutable Knowledge Pack catalog snapshot')
  }
}

/**
 * Immutable persistence boundary for a manifest that already passed asymmetric verification.
 * This method does not grant publication: callers must separately require governed approval and
 * immutable financial terms before transitioning the version to PUBLISHED.
 */
export class KnowledgePackSignedManifestService {
  constructor(private readonly manifestService = new KnowledgePackManifestService()) {}

  async recordVerifiedManifest(input: {
    packVersionId: string
    verified: VerifiedKnowledgePackManifest
  }): Promise<string> {
    assertKnowledgePackIdentifier(input.packVersionId, 'Pack version ID')
    const canonicalEnvelope = this.manifestService.serializeSignedManifest(
      input.verified.signedManifest
    )
    const manifestSha256 = this.manifestService.signedManifestSha256(canonicalEnvelope)
    const signedManifest = unsignedKnowledgePackManifest(input.verified.signedManifest.signed)
    const metadata = input.verified.signedManifest.signed.signatureMetadata
    if (
      manifestSha256 !== input.verified.manifestSha256 ||
      canonicalEnvelope !== input.verified.canonicalSignedManifest ||
      metadata.keyId !== input.verified.signingKeyId ||
      !this.manifestService
        .canonicalManifestBytes(signedManifest)
        .equals(this.manifestService.canonicalManifestBytes(input.verified.manifest))
    ) {
      throw new Error('Verified Knowledge Pack manifest result is inconsistent')
    }

    let persistedId = randomUUID()
    await db.transaction(async (trx) => {
      const version = await trx
        .from('knowledge_pack_versions')
        .where('id', input.packVersionId)
        .forUpdate()
        .first()
      if (!version) throw new Error('Knowledge Pack version does not exist')
      if (
        version.pack_id !== signedManifest.packId ||
        version.version !== signedManifest.packVersion
      ) {
        throw new Error('Signed manifest does not match its Knowledge Pack version')
      }

      assertKnowledgePackManifestMatchesCatalog(
        signedManifest,
        await loadKnowledgePackCatalogSnapshot(trx, input.packVersionId)
      )

      const manifestPublishedAt = DateTime.fromISO(signedManifest.publishedAt, { zone: 'utc' })
      if (
        !manifestPublishedAt.isValid ||
        manifestPublishedAt > DateTime.utc().plus({ minutes: 5 })
      ) {
        throw new Error('Signed manifest publication timestamp is invalid or too far in the future')
      }

      const existing = await trx
        .from('knowledge_pack_signed_manifests')
        .where('pack_version_id', input.packVersionId)
        .first()
      if (existing) {
        if (existing.manifest_sha256 === manifestSha256) {
          persistedId = existing.id
          return
        }
        throw new Error('Knowledge Pack version already has a different immutable signed manifest')
      }

      await trx.table('knowledge_pack_signed_manifests').insert({
        id: persistedId,
        pack_version_id: input.packVersionId,
        schema_version: signedManifest.schemaVersion,
        manifest_sha256: manifestSha256,
        signing_key_id: metadata.keyId,
        signature_algorithm: metadata.algorithm,
        canonicalization: metadata.canonicalization,
        signature_encoding: metadata.encoding,
        manifest_published_at: manifestPublishedAt.toSQL({ includeOffset: false }),
        canonical_envelope: canonicalEnvelope,
        created_at: DateTime.utc().toSQL({ includeOffset: false }),
      })
    })
    return persistedId
  }
}
