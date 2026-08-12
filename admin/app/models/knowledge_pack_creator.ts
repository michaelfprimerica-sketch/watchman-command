import { BaseModel, beforeUpdate, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class KnowledgePackCreator extends BaseModel {
  static table = 'knowledge_pack_creators'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare id: string
  @column() declare representative_id: string
  @column() declare display_name: string
  @column() declare is_active: boolean
  @column.dateTime({ autoCreate: true }) declare created_at: DateTime
  @column.dateTime({ autoCreate: true, autoUpdate: true }) declare updated_at: DateTime

  @beforeUpdate()
  static rejectRepresentativeReassignment(creator: KnowledgePackCreator): void {
    if (creator.isDirty('representative_id')) {
      throw new Error('Knowledge Pack creator representative identity is immutable')
    }
  }
}
