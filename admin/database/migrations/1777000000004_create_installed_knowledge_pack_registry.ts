import { BaseSchema } from '@adonisjs/lucid/schema'

const INSTALLATION_SOURCES = ['ACQUISITION', 'SIDELOAD', 'RESTORE']

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('installed_knowledge_pack_releases', (table) => {
      table.string('id', 36).primary()
      table.string('pack_id', 36).notNullable()
      table.string('pack_version', 64).notNullable()
      table.enum('source', INSTALLATION_SOURCES).notNullable()
      table.string('manifest_sha256', 64).notNullable()
      table.string('signing_key_id', 128).notNullable()
      table.enum('install_status', ['INSTALLED']).notNullable()
      table.timestamp('installed_at').notNullable()

      // Supports a composite current-pointer FK that cannot cross pack IDs.
      table.unique(['pack_id', 'id'], 'installed_kp_release_pack_id_unique')
      table.unique(['pack_id', 'pack_version'], 'installed_kp_release_version_unique')
      table.index(['pack_id', 'installed_at'], 'installed_kp_release_history_index')
      table.check(
        'CHAR_LENGTH(manifest_sha256) = 64',
        {},
        'installed_kp_release_manifest_hash_length_check'
      )
      table.check("install_status = 'INSTALLED'", {}, 'installed_kp_release_promoted_status_check')
    })

    this.schema.createTable('installed_knowledge_pack_artifacts', (table) => {
      table.string('id', 36).primary()
      table.string('installed_release_id', 36).notNullable().index()
      table.string('artifact_id', 128).notNullable()
      table.string('logical_path', 512).notNullable()
      table.string('content_type', 255).notNullable()
      table.bigInteger('byte_size').unsigned().notNullable()
      table.string('sha256', 64).notNullable()

      table.unique(['installed_release_id', 'artifact_id'], 'installed_kp_artifact_id_unique')
      table.unique(['installed_release_id', 'logical_path'], 'installed_kp_artifact_path_unique')
      table
        .foreign('installed_release_id')
        .references('installed_knowledge_pack_releases.id')
        .onDelete('RESTRICT')
      table.check('CHAR_LENGTH(sha256) = 64', {}, 'installed_kp_artifact_hash_length_check')
    })

    this.schema.createTable('installed_knowledge_packs', (table) => {
      table.string('pack_id', 36).primary()
      table.string('current_release_id', 36).notNullable()
      table.timestamp('updated_at').notNullable()

      table
        .foreign(['pack_id', 'current_release_id'], 'installed_kp_current_release_fk')
        .references(['pack_id', 'id'])
        .inTable('installed_knowledge_pack_releases')
        .onDelete('RESTRICT')
    })
  }

  async down() {
    // Installed history represents locally usable purchased content. Empty test
    // databases remain reversible, while populated history is explicitly one-way.
    this.defer(async (db) => {
      for (const tableName of [
        'installed_knowledge_packs',
        'installed_knowledge_pack_artifacts',
        'installed_knowledge_pack_releases',
      ]) {
        const row = await db.from(tableName).count('* as total').first()
        if (Number(row?.total ?? 0) > 0) {
          throw new Error(
            `Refusing to roll back populated installed Knowledge Pack history (${tableName})`
          )
        }
      }
    })

    this.schema.dropTable('installed_knowledge_packs')
    this.schema.dropTable('installed_knowledge_pack_artifacts')
    this.schema.dropTable('installed_knowledge_pack_releases')
  }
}
