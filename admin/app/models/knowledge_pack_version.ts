import {
  BaseModel,
  beforeDelete,
  beforeUpdate,
  column,
  SnakeCaseNamingStrategy,
} from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type {
  KnowledgePackApprovalStatus,
  KnowledgePackContentFormat,
  KnowledgePackOwnerType,
} from '../../types/knowledge_packs.js'

export default class KnowledgePackVersion extends BaseModel {
  static table = 'knowledge_pack_versions'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare id: string
  @column() declare pack_id: string
  @column() declare version: string
  @column() declare title_snapshot: string
  @column() declare summary_snapshot: string | null
  @column() declare category_snapshot: string
  @column() declare owner_type_snapshot: KnowledgePackOwnerType
  @column() declare creator_id_snapshot: string | null
  @column() declare approval_status: KnowledgePackApprovalStatus
  @column() declare content_format: KnowledgePackContentFormat
  @column() declare minimum_watchman_version: string
  @column() declare release_notes: string | null
  @column() declare is_published: boolean
  @column.dateTime() declare published_at: DateTime | null
  @column.dateTime({ autoCreate: true }) declare created_at: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true }) declare updated_at: DateTime

  @beforeUpdate()
  static rejectIdentityOrOwnershipUpdate(version: KnowledgePackVersion): void {
    if (
      version.isDirty([
        'pack_id',
        'version',
        'title_snapshot',
        'summary_snapshot',
        'category_snapshot',
        'owner_type_snapshot',
        'creator_id_snapshot',
        'content_format',
        'minimum_watchman_version',
        'release_notes',
      ])
    ) {
      throw new Error('Knowledge Pack version content and ownership snapshots are immutable')
    }
  }

  @beforeDelete()
  static rejectDelete(): never {
    throw new Error('Knowledge Pack version history requires an explicit guarded deletion workflow')
  }
}
