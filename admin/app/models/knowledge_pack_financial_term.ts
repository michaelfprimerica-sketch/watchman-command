import {
  BaseModel,
  beforeDelete,
  beforeUpdate,
  column,
  SnakeCaseNamingStrategy,
} from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { KnowledgePackOwnerType } from '../../types/knowledge_packs.js'

export default class KnowledgePackFinancialTerm extends BaseModel {
  static table = 'knowledge_pack_financial_terms'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare id: string
  @column() declare pack_version_id: string
  @column() declare terms_version: number
  @column() declare supersedes_terms_id: string | null
  @column() declare owner_type_snapshot: KnowledgePackOwnerType
  @column() declare creator_id_snapshot: string | null
  @column() declare creator_royalty_rate_bps: number
  @column.dateTime() declare effective_from: DateTime
  @column() declare created_by_ref: string
  @column.dateTime({ autoCreate: true }) declare created_at: DateTime

  @beforeUpdate()
  static rejectUpdate(): never {
    throw new Error('Knowledge Pack financial terms are immutable')
  }

  @beforeDelete()
  static rejectDelete(): never {
    throw new Error('Knowledge Pack financial terms are immutable')
  }
}
