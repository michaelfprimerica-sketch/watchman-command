import {
  BaseModel,
  beforeDelete,
  beforeUpdate,
  column,
  SnakeCaseNamingStrategy,
} from '@adonisjs/lucid/orm'

/** Immutable artifact hash snapshot for an installed release. */
export default class InstalledKnowledgePackArtifact extends BaseModel {
  static table = 'installed_knowledge_pack_artifacts'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare id: string
  @column() declare installed_release_id: string
  @column() declare artifact_id: string
  @column() declare logical_path: string
  @column() declare content_type: string
  @column() declare byte_size: string
  @column() declare sha256: string

  @beforeUpdate()
  static rejectUpdate(): never {
    throw new Error('Installed Knowledge Pack artifact history is immutable')
  }

  @beforeDelete()
  static rejectDelete(): never {
    throw new Error('Installed Knowledge Pack artifact history is immutable')
  }
}
