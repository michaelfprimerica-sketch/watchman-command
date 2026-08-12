import {
  BaseModel,
  beforeDelete,
  beforeUpdate,
  column,
  SnakeCaseNamingStrategy,
} from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type {
  KnowledgePackApprovalDecision,
  KnowledgePackApprovalStatus,
} from '../../types/knowledge_packs.js'

export default class KnowledgePackApproval extends BaseModel {
  static table = 'knowledge_pack_approvals'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare id: string
  @column() declare pack_version_id: string
  @column() declare reviewer_ref: string | null
  @column() declare stage: KnowledgePackApprovalStatus
  @column() declare decision: KnowledgePackApprovalDecision
  @column() declare from_status: KnowledgePackApprovalStatus
  @column() declare resulting_status: KnowledgePackApprovalStatus
  @column() declare notes: string | null
  @column.dateTime({ autoCreate: true }) declare created_at: DateTime

  @beforeUpdate()
  static rejectUpdate(): never {
    throw new Error('Knowledge Pack approval history is immutable')
  }

  @beforeDelete()
  static rejectDelete(): never {
    throw new Error('Knowledge Pack approval history is immutable')
  }
}
