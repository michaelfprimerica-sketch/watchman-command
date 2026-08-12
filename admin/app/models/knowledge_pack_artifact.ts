import { BaseModel, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class KnowledgePackArtifact extends BaseModel {
  static table = 'knowledge_pack_artifacts'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare id: string
  @column() declare pack_version_id: string
  @column() declare logical_name: string
  @column() declare content_type: string
  @column() declare byte_size: string
  @column() declare sha256: string
  @column() declare compression: string | null
  @column() declare storage_reference: string
  @column() declare is_active: boolean
  @column.dateTime({ autoCreate: true }) declare created_at: DateTime
  @column.dateTime() declare published_at: DateTime | null
}
