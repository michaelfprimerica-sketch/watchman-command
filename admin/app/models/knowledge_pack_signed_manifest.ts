import {
  BaseModel,
  beforeDelete,
  beforeUpdate,
  column,
  SnakeCaseNamingStrategy,
} from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class KnowledgePackSignedManifest extends BaseModel {
  static table = 'knowledge_pack_signed_manifests'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare id: string
  @column() declare pack_version_id: string
  @column() declare schema_version: 'watchman.knowledge-pack/v1'
  @column() declare manifest_sha256: string
  @column() declare signing_key_id: string
  @column() declare signature_algorithm: 'Ed25519'
  @column() declare canonicalization: 'RFC8785'
  @column() declare signature_encoding: 'base64url'
  @column.dateTime() declare manifest_published_at: DateTime
  @column() declare canonical_envelope: string
  @column.dateTime({ autoCreate: true }) declare created_at: DateTime

  @beforeUpdate()
  static rejectUpdate(): never {
    throw new Error('Signed Knowledge Pack manifests are immutable')
  }

  @beforeDelete()
  static rejectDelete(): never {
    throw new Error('Signed Knowledge Pack manifests are immutable')
  }
}
