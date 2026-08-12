import { BaseModel, column, SnakeCaseNamingStrategy } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

/** Mutable pointer to the current successfully installed release for a pack. */
export default class InstalledKnowledgePack extends BaseModel {
  static table = 'installed_knowledge_packs'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare pack_id: string
  @column() declare current_release_id: string
  @column.dateTime({ autoCreate: true, autoUpdate: true }) declare updated_at: DateTime
}
