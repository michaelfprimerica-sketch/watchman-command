import {
  BaseModel,
  beforeDelete,
  beforeUpdate,
  column,
  SnakeCaseNamingStrategy,
} from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { KnowledgePackInstallationSource } from '../../types/knowledge_pack_installation.js'

/** Immutable snapshot of one successfully promoted local Knowledge Pack release. */
export default class InstalledKnowledgePackRelease extends BaseModel {
  static table = 'installed_knowledge_pack_releases'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare id: string
  @column() declare pack_id: string
  @column() declare pack_version: string
  @column() declare source: KnowledgePackInstallationSource
  @column() declare manifest_sha256: string
  @column() declare signing_key_id: string
  @column() declare install_status: 'INSTALLED'
  @column.dateTime() declare installed_at: DateTime

  @beforeUpdate()
  static rejectUpdate(): never {
    throw new Error('Installed Knowledge Pack release history is immutable')
  }

  @beforeDelete()
  static rejectDelete(): never {
    throw new Error('Installed Knowledge Pack release history is immutable')
  }
}
