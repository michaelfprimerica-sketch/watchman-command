import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import semver from 'semver'

import type {
  InstalledKnowledgePackRelease,
  KnowledgePackInstallationRegistry,
  KnowledgePackInstallationSource,
  PromotedKnowledgePackArtifact,
  RecordPromotedKnowledgePackReleaseInput,
} from '../../types/knowledge_pack_installation.js'
import { assertKnowledgePackIdentifier } from '../utils/knowledge_pack_governance.js'
import { assertPromotedKnowledgePackRelease } from '../utils/knowledge_pack_installation.js'

type ReleaseRow = {
  id: string
  pack_id: string
  pack_version: string
  source: KnowledgePackInstallationSource
  manifest_sha256: string
  signing_key_id: string
  install_status: 'INSTALLED'
  installed_at: Date | string
}

type ArtifactRow = {
  installed_release_id: string
  artifact_id: string
  logical_path: string
  content_type: string
  byte_size: number | string
  sha256: string
}

function timestampToIso(value: Date | string): string {
  const parsed =
    value instanceof Date
      ? DateTime.fromJSDate(value, { zone: 'utc' })
      : DateTime.fromSQL(value, { zone: 'utc' })
  if (!parsed.isValid) throw new Error('Installed Knowledge Pack timestamp is invalid')
  return parsed.toUTC().toISO() as string
}

function mapArtifact(row: ArtifactRow): PromotedKnowledgePackArtifact {
  const sizeBytes = Number(row.byte_size)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error('Installed Knowledge Pack artifact size exceeds the safe integer range')
  }
  return {
    artifactId: row.artifact_id,
    path: row.logical_path,
    contentType: row.content_type,
    sizeBytes,
    sha256: row.sha256,
  }
}

function mapRelease(
  row: ReleaseRow,
  artifacts: PromotedKnowledgePackArtifact[]
): InstalledKnowledgePackRelease {
  return {
    id: row.id,
    packId: row.pack_id,
    packVersion: row.pack_version,
    source: row.source,
    manifestSha256: row.manifest_sha256,
    signingKeyId: row.signing_key_id,
    installStatus: row.install_status,
    installedAt: timestampToIso(row.installed_at),
    artifacts,
  }
}

function assertSameVerifiedRelease(
  row: ReleaseRow,
  artifacts: PromotedKnowledgePackArtifact[],
  input: RecordPromotedKnowledgePackReleaseInput
): void {
  const artifactSnapshot = (values: PromotedKnowledgePackArtifact[]) =>
    [...values]
      .sort((left, right) => left.artifactId.localeCompare(right.artifactId))
      .map((artifact) => [
        artifact.artifactId,
        artifact.path,
        artifact.contentType,
        artifact.sizeBytes,
        artifact.sha256,
      ])

  if (
    row.manifest_sha256 !== input.manifestSha256 ||
    row.signing_key_id !== input.signingKeyId ||
    row.source !== input.source ||
    row.install_status !== 'INSTALLED' ||
    JSON.stringify(artifactSnapshot(artifacts)) !==
      JSON.stringify(artifactSnapshot(input.artifacts))
  ) {
    throw new Error(
      'This Knowledge Pack version is already installed with different verified metadata'
    )
  }
}

/**
 * Lucid-backed local installation registry.
 *
 * It has no catalog, software-license, membership, entitlement, or customer
 * foreign key. Once installed, a release remains locally registered regardless
 * of later membership state. The installer is responsible for staging,
 * verification, and atomic filesystem promotion before calling
 * recordPromotedRelease.
 */
export class LucidKnowledgePackInstallationRegistry implements KnowledgePackInstallationRegistry {
  async recordPromotedRelease(
    input: RecordPromotedKnowledgePackReleaseInput
  ): Promise<InstalledKnowledgePackRelease> {
    assertPromotedKnowledgePackRelease(input)

    return db.transaction(async (trx) => {
      const existing = (await trx
        .from('installed_knowledge_pack_releases')
        .where('pack_id', input.packId)
        .where('pack_version', input.packVersion)
        .forUpdate()
        .first()) as ReleaseRow | undefined

      let release: InstalledKnowledgePackRelease
      if (existing) {
        const artifactRows = (await trx
          .from('installed_knowledge_pack_artifacts')
          .where('installed_release_id', existing.id)
          .orderBy('logical_path', 'asc')) as ArtifactRow[]
        const artifacts = artifactRows.map(mapArtifact)
        assertSameVerifiedRelease(existing, artifacts, input)
        release = mapRelease(existing, artifacts)
      } else {
        const releaseId = randomUUID()
        const installedAt = DateTime.utc().startOf('second')
        const installedAtSql = installedAt.toSQL({ includeOffset: false }) as string

        await trx.table('installed_knowledge_pack_releases').insert({
          id: releaseId,
          pack_id: input.packId,
          pack_version: input.packVersion,
          source: input.source,
          manifest_sha256: input.manifestSha256,
          signing_key_id: input.signingKeyId,
          install_status: 'INSTALLED',
          installed_at: installedAtSql,
        })

        await trx.table('installed_knowledge_pack_artifacts').multiInsert(
          input.artifacts.map((artifact) => ({
            id: randomUUID(),
            installed_release_id: releaseId,
            artifact_id: artifact.artifactId,
            logical_path: artifact.path,
            content_type: artifact.contentType,
            byte_size: artifact.sizeBytes,
            sha256: artifact.sha256,
          }))
        )

        release = {
          id: releaseId,
          packId: input.packId,
          packVersion: input.packVersion,
          source: input.source,
          manifestSha256: input.manifestSha256,
          signingKeyId: input.signingKeyId,
          installStatus: 'INSTALLED',
          installedAt: installedAt.toISO() as string,
          artifacts: input.artifacts.map((artifact) => ({ ...artifact })),
        }
      }

      const pointerUpdatedAt = DateTime.utc()
        .startOf('second')
        .toSQL({ includeOffset: false }) as string

      // Lock an existing pointer so a release and its current pointer cannot be
      // observed half-updated. An insert race fails and rolls back this release.
      const current = await trx
        .from('installed_knowledge_packs')
        .where('pack_id', input.packId)
        .forUpdate()
        .first()

      if (current) {
        const currentRelease = (await trx
          .from('installed_knowledge_pack_releases')
          .where('id', current.current_release_id)
          .first()) as ReleaseRow | undefined
        if (!currentRelease) throw new Error('Installed Knowledge Pack pointer is invalid')
        if (semver.gt(currentRelease.pack_version, release.packVersion)) {
          throw new Error('Knowledge Pack downgrade is not allowed')
        }
        await trx.from('installed_knowledge_packs').where('pack_id', input.packId).update({
          current_release_id: release.id,
          updated_at: pointerUpdatedAt,
        })
      } else {
        await trx.table('installed_knowledge_packs').insert({
          pack_id: input.packId,
          current_release_id: release.id,
          updated_at: pointerUpdatedAt,
        })
      }

      return release
    })
  }

  async getCurrentRelease(packId: string): Promise<InstalledKnowledgePackRelease | null> {
    assertKnowledgePackIdentifier(packId, 'Pack ID')
    if (packId.length > 36) throw new Error('Pack ID is too long')

    const row = (await db
      .from('installed_knowledge_packs as current')
      .innerJoin(
        'installed_knowledge_pack_releases as release',
        'release.id',
        'current.current_release_id'
      )
      .where('current.pack_id', packId)
      .select('release.*')
      .first()) as ReleaseRow | null

    if (!row) return null
    const artifacts = await this.getArtifacts([row.id])
    return mapRelease(row, artifacts.get(row.id) ?? [])
  }

  async listReleaseHistory(packId: string): Promise<InstalledKnowledgePackRelease[]> {
    assertKnowledgePackIdentifier(packId, 'Pack ID')
    if (packId.length > 36) throw new Error('Pack ID is too long')

    const rows = (await db
      .from('installed_knowledge_pack_releases')
      .where('pack_id', packId)
      .orderBy('installed_at', 'desc')) as ReleaseRow[]
    if (rows.length === 0) return []

    const artifacts = await this.getArtifacts(rows.map((row) => row.id))
    return rows.map((row) => mapRelease(row, artifacts.get(row.id) ?? []))
  }

  private async getArtifacts(
    releaseIds: string[]
  ): Promise<Map<string, PromotedKnowledgePackArtifact[]>> {
    const rows = (await db
      .from('installed_knowledge_pack_artifacts')
      .whereIn('installed_release_id', releaseIds)
      .orderBy('logical_path', 'asc')) as ArtifactRow[]

    const byRelease = new Map<string, PromotedKnowledgePackArtifact[]>()
    for (const row of rows) {
      const artifacts = byRelease.get(row.installed_release_id) ?? []
      artifacts.push(mapArtifact(row))
      byRelease.set(row.installed_release_id, artifacts)
    }
    return byRelease
  }
}
