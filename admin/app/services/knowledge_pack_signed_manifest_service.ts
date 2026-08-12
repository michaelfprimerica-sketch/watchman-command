import { randomUUID } from 'node:crypto'

import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

import { unsignedKnowledgePackManifest } from '../../types/knowledge_pack_manifests.js'
import { assertKnowledgePackIdentifier } from '../utils/knowledge_pack_governance.js'
import { KnowledgePackManifestService } from './knowledge_pack_manifest_service.js'
import type { VerifiedKnowledgePackManifest } from './knowledge_pack_verification_service.js'

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
        canonical_envelope: canonicalEnvelope,
        created_at: DateTime.utc().toSQL({ includeOffset: false }),
      })
    })
    return persistedId
  }
}
