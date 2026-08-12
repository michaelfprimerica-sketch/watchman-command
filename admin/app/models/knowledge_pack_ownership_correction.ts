import {
  BaseModel,
  beforeDelete,
  beforeUpdate,
  column,
  SnakeCaseNamingStrategy,
} from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { KnowledgePackOwnerType } from '../../types/knowledge_packs.js'

export default class KnowledgePackOwnershipCorrection extends BaseModel {
  static table = 'knowledge_pack_ownership_corrections'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare id: string
  @column() declare pack_id: string
  @column() declare reviewer_ref: string
  @column() declare prior_owner_type: KnowledgePackOwnerType
  @column() declare prior_creator_id: string | null
  @column() declare new_owner_type: KnowledgePackOwnerType
  @column() declare new_creator_id: string | null
  @column() declare reason: string
  @column.dateTime({ autoCreate: true }) declare created_at: DateTime

  @beforeUpdate()
  static rejectUpdate(): never {
    throw new Error('Knowledge Pack ownership correction history is immutable')
  }

  @beforeDelete()
  static rejectDelete(): never {
    throw new Error('Knowledge Pack ownership correction history is immutable')
  }
}
