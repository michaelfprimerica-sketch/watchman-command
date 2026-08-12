import { BaseModel, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type {
  KnowledgePackApprovalStatus,
  KnowledgePackOwnerType,
} from '../../types/knowledge_packs.js'

export default class KnowledgePack extends BaseModel {
  static table = 'knowledge_packs'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare id: string
  @column() declare slug: string
  @column() declare title: string
  @column() declare summary: string | null
  @column() declare category: string
  @column() declare owner_type: KnowledgePackOwnerType
  @column() declare creator_id: string | null
  @column() declare approval_status: KnowledgePackApprovalStatus
  @column() declare is_active: boolean
  @column() declare is_published: boolean
  @column() declare support_owner_type: KnowledgePackOwnerType
  @column() declare support_owner_ref: string | null
  @column.dateTime() declare published_at: DateTime | null
  @column.dateTime({ autoCreate: true }) declare created_at: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true }) declare updated_at: DateTime
}
