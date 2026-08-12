import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'knowledge_pack_signed_manifests'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id', 36).primary()
      table.string('pack_version_id', 36).notNullable().unique()
      table.string('schema_version', 64).notNullable()
      table.string('manifest_sha256', 64).notNullable().unique()
      table.string('signing_key_id', 128).notNullable().index()
      table.string('signature_algorithm', 16).notNullable()
      table.string('canonicalization', 16).notNullable()
      table.string('signature_encoding', 16).notNullable()
      table.text('canonical_envelope', 'longtext').notNullable()
      table.timestamp('created_at').notNullable()
      table.foreign('pack_version_id').references('knowledge_pack_versions.id').onDelete('RESTRICT')
      table.check(
        `schema_version = 'watchman.knowledge-pack/v1'`,
        {},
        'knowledge_pack_signed_manifest_schema_check'
      )
      table.check(
        `signature_algorithm = 'Ed25519' AND canonicalization = 'RFC8785' ` +
          `AND signature_encoding = 'base64url'`,
        {},
        'knowledge_pack_signed_manifest_crypto_check'
      )
      table.check(
        `manifest_sha256 REGEXP '^[a-f0-9]{64}$'`,
        {},
        'knowledge_pack_signed_manifest_hash_check'
      )
    })
  }

  async down() {
    this.defer(async (db) => {
      const row = await db.from(this.tableName).count('* as total').first()
      if (Number(row?.total ?? 0) > 0) {
        throw new Error('Refusing to roll back immutable signed Knowledge Pack manifests')
      }
    })
    this.schema.dropTable(this.tableName)
  }
}
