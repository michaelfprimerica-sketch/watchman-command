import { BaseSchema } from '@adonisjs/lucid/schema'

const APPROVAL_STATUSES = [
  'DRAFT',
  'PROPOSED',
  'CREDENTIALS_REVIEW',
  'CONTENT_REVIEW',
  'SAFETY_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'SUSPENDED',
  'RETIRED',
  'REJECTED',
]

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('knowledge_pack_creators', (table) => {
      table.string('id', 36).primary()
      table.string('representative_id', 128).notNullable().unique()
      table.string('display_name', 255).notNullable()
      table.boolean('is_active').notNullable().defaultTo(true)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })

    this.schema.createTable('knowledge_packs', (table) => {
      table.string('id', 36).primary()
      table.string('slug', 160).notNullable().unique()
      table.string('title', 255).notNullable()
      table.text('summary').nullable()
      table.string('category', 64).notNullable().index()
      table.enum('owner_type', ['VIGILANT_WATCHMAN', 'AUTHORIZED_WATCHMAN_CREATOR']).notNullable()
      table.string('creator_id', 36).nullable().index()
      table.enum('approval_status', APPROVAL_STATUSES).notNullable().defaultTo('DRAFT').index()
      table.boolean('is_active').notNullable().defaultTo(true)
      table.boolean('is_published').notNullable().defaultTo(false)
      table
        .enum('support_owner_type', ['VIGILANT_WATCHMAN', 'AUTHORIZED_WATCHMAN_CREATOR'])
        .notNullable()
        .defaultTo('VIGILANT_WATCHMAN')
      table.string('support_owner_ref', 128).nullable()
      table.timestamp('published_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.foreign('creator_id').references('knowledge_pack_creators.id').onDelete('RESTRICT')
      table.check(
        `(owner_type = 'VIGILANT_WATCHMAN' AND creator_id IS NULL) OR ` +
          `(owner_type = 'AUTHORIZED_WATCHMAN_CREATOR' AND creator_id IS NOT NULL)`,
        {},
        'knowledge_packs_owner_creator_check'
      )
    })

    this.schema.createTable('knowledge_pack_versions', (table) => {
      table.string('id', 36).primary()
      table.string('pack_id', 36).notNullable().index()
      table.string('version', 64).notNullable()
      table.string('title_snapshot', 255).notNullable()
      table.text('summary_snapshot').nullable()
      table.string('category_snapshot', 64).notNullable()
      table
        .enum('owner_type_snapshot', ['VIGILANT_WATCHMAN', 'AUTHORIZED_WATCHMAN_CREATOR'])
        .notNullable()
      table.string('creator_id_snapshot', 36).nullable()
      table.enum('approval_status', APPROVAL_STATUSES).notNullable().defaultTo('DRAFT').index()
      table
        .enum('content_format', ['ZIM', 'DOCUMENT_BUNDLE', 'DATASET', 'MODEL', 'MIXED'])
        .notNullable()
      table.string('minimum_watchman_version', 64).notNullable()
      table.text('release_notes').nullable()
      table.boolean('is_published').notNullable().defaultTo(false)
      table.timestamp('published_at').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.unique(['pack_id', 'version'])
      table.foreign('pack_id').references('knowledge_packs.id').onDelete('RESTRICT')
      table
        .foreign('creator_id_snapshot')
        .references('knowledge_pack_creators.id')
        .onDelete('RESTRICT')
      table.check(
        `(owner_type_snapshot = 'VIGILANT_WATCHMAN' AND creator_id_snapshot IS NULL) OR ` +
          `(owner_type_snapshot = 'AUTHORIZED_WATCHMAN_CREATOR' AND creator_id_snapshot IS NOT NULL)`,
        {},
        'knowledge_pack_versions_owner_creator_check'
      )
    })

    this.schema.createTable('knowledge_pack_version_missions', (table) => {
      table.increments('id').primary()
      table.string('pack_version_id', 36).notNullable().index()
      table.string('mission_id', 128).notNullable()
      table.timestamp('created_at').notNullable()
      table.unique(['pack_version_id', 'mission_id'])
      table.foreign('pack_version_id').references('knowledge_pack_versions.id').onDelete('RESTRICT')
    })

    this.schema.createTable('knowledge_pack_service_areas', (table) => {
      table.string('id', 36).primary()
      table.string('pack_version_id', 36).notNullable().index()
      table.enum('area_type', ['NATIONAL', 'STATE', 'ZIP', 'SERVICE_AREA']).notNullable()
      table.string('area_key', 255).notNullable()
      table.string('country_code', 2).notNullable()
      table.string('state_code', 32).nullable()
      table.string('postal_code', 20).nullable()
      table.string('service_area_id', 128).nullable()
      table.string('label', 255).nullable()
      table.timestamp('created_at').notNullable()
      table.index(['area_type', 'country_code', 'state_code'])
      table.index(['postal_code'])
      table.unique(['pack_version_id', 'area_key'])
      table.foreign('pack_version_id').references('knowledge_pack_versions.id').onDelete('RESTRICT')
      table.check(
        `(area_type = 'NATIONAL' AND state_code IS NULL AND postal_code IS NULL AND service_area_id IS NULL) OR ` +
          `(area_type = 'STATE' AND state_code IS NOT NULL AND postal_code IS NULL AND service_area_id IS NULL) OR ` +
          `(area_type = 'ZIP' AND postal_code IS NOT NULL AND service_area_id IS NULL) OR ` +
          `(area_type = 'SERVICE_AREA' AND service_area_id IS NOT NULL)`,
        {},
        'knowledge_pack_service_areas_shape_check'
      )
    })

    this.schema.createTable('knowledge_pack_sources', (table) => {
      table.string('id', 36).primary()
      table.string('pack_version_id', 36).notNullable().index()
      table.string('source_id', 128).notNullable()
      table.string('source_authority', 255).notNullable()
      table.string('source_title', 512).notNullable()
      table.string('source_url', 2048).nullable()
      table.date('source_checked_date').nullable()
      table.text('provenance_notes').nullable()
      table.text('rights_metadata').nullable()
      table.timestamp('created_at').notNullable()
      table.unique(['pack_version_id', 'source_id'])
      table.foreign('pack_version_id').references('knowledge_pack_versions.id').onDelete('RESTRICT')
    })

    this.schema.createTable('knowledge_pack_artifacts', (table) => {
      table.string('id', 36).primary()
      table.string('pack_version_id', 36).notNullable().index()
      table.string('artifact_id', 128).notNullable()
      table.string('logical_name', 512).notNullable()
      table.string('content_type', 255).notNullable()
      table.bigInteger('byte_size').unsigned().notNullable()
      table.string('sha256', 64).notNullable()
      table.string('compression', 64).nullable()
      table.string('storage_reference', 1024).notNullable()
      table.boolean('is_active').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable()
      table.timestamp('published_at').nullable()
      table.unique(['pack_version_id', 'artifact_id'])
      table.unique(['pack_version_id', 'logical_name'])
      table.foreign('pack_version_id').references('knowledge_pack_versions.id').onDelete('RESTRICT')
    })

    this.schema.createTable('knowledge_pack_approvals', (table) => {
      table.string('id', 36).primary()
      table.string('pack_version_id', 36).notNullable().index()
      table.string('reviewer_ref', 128).nullable()
      table.enum('stage', APPROVAL_STATUSES).notNullable()
      table
        .enum('decision', [
          'SUBMIT',
          'ADVANCE',
          'APPROVE',
          'PUBLISH',
          'SUSPEND',
          'RETIRE',
          'REJECT',
        ])
        .notNullable()
      table.enum('from_status', APPROVAL_STATUSES).notNullable()
      table.enum('resulting_status', APPROVAL_STATUSES).notNullable()
      table.text('notes').nullable()
      table.timestamp('created_at').notNullable()
      table.foreign('pack_version_id').references('knowledge_pack_versions.id').onDelete('RESTRICT')
    })

    this.schema.createTable('knowledge_pack_ownership_corrections', (table) => {
      table.string('id', 36).primary()
      table.string('pack_id', 36).notNullable().index()
      table.string('reviewer_ref', 128).notNullable()
      table
        .enum('prior_owner_type', ['VIGILANT_WATCHMAN', 'AUTHORIZED_WATCHMAN_CREATOR'])
        .notNullable()
      table.string('prior_creator_id', 36).nullable()
      table
        .enum('new_owner_type', ['VIGILANT_WATCHMAN', 'AUTHORIZED_WATCHMAN_CREATOR'])
        .notNullable()
      table.string('new_creator_id', 36).nullable()
      table.text('reason').notNullable()
      table.timestamp('created_at').notNullable()
      table.foreign('pack_id').references('knowledge_packs.id').onDelete('RESTRICT')
      table
        .foreign('prior_creator_id')
        .references('knowledge_pack_creators.id')
        .onDelete('RESTRICT')
      table.foreign('new_creator_id').references('knowledge_pack_creators.id').onDelete('RESTRICT')
      table.check(
        `(prior_owner_type = 'VIGILANT_WATCHMAN' AND prior_creator_id IS NULL) OR ` +
          `(prior_owner_type = 'AUTHORIZED_WATCHMAN_CREATOR' AND prior_creator_id IS NOT NULL)`,
        {},
        'knowledge_pack_prior_owner_creator_check'
      )
      table.check(
        `(new_owner_type = 'VIGILANT_WATCHMAN' AND new_creator_id IS NULL) OR ` +
          `(new_owner_type = 'AUTHORIZED_WATCHMAN_CREATOR' AND new_creator_id IS NOT NULL)`,
        {},
        'knowledge_pack_new_owner_creator_check'
      )
    })
  }

  async down() {
    this.defer(async (db) => {
      for (const tableName of [
        'knowledge_pack_ownership_corrections',
        'knowledge_pack_approvals',
        'knowledge_pack_artifacts',
        'knowledge_pack_sources',
        'knowledge_pack_service_areas',
        'knowledge_pack_version_missions',
        'knowledge_pack_versions',
        'knowledge_packs',
        'knowledge_pack_creators',
      ]) {
        const row = await db.from(tableName).count('* as total').first()
        if (Number(row?.total ?? 0) > 0) {
          throw new Error(
            `Refusing to roll back populated immutable Knowledge Pack history (${tableName})`
          )
        }
      }
    })
    this.schema.dropTable('knowledge_pack_ownership_corrections')
    this.schema.dropTable('knowledge_pack_approvals')
    this.schema.dropTable('knowledge_pack_artifacts')
    this.schema.dropTable('knowledge_pack_sources')
    this.schema.dropTable('knowledge_pack_service_areas')
    this.schema.dropTable('knowledge_pack_version_missions')
    this.schema.dropTable('knowledge_pack_versions')
    this.schema.dropTable('knowledge_packs')
    this.schema.dropTable('knowledge_pack_creators')
  }
}
