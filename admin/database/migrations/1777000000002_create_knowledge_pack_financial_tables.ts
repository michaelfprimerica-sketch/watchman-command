import { BaseSchema } from '@adonisjs/lucid/schema'

const OWNER_TYPES = ['VIGILANT_WATCHMAN', 'AUTHORIZED_WATCHMAN_CREATOR']
const LEDGER_ENTRY_TYPES = [
  'GROSS_SALE',
  'TAX_DEDUCTION',
  'PROCESSING_FEE_DEDUCTION',
  'PLATFORM_TRANSACTION_FEE_DEDUCTION',
  'REFUND',
  'CHARGEBACK',
  'NET_REVENUE',
  'CREATOR_SHARE',
  'VIGILANT_WATCHMAN_SHARE',
  'REVERSAL',
]

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('knowledge_pack_financial_terms', (table) => {
      table.string('id', 36).primary()
      table.string('pack_version_id', 36).notNullable().index()
      table.integer('terms_version').unsigned().notNullable()
      table.string('supersedes_terms_id', 36).nullable().unique()
      table.enum('owner_type_snapshot', OWNER_TYPES).notNullable()
      table.string('creator_id_snapshot', 36).nullable()
      table.integer('creator_royalty_rate_bps').unsigned().notNullable()
      table.enum('terms_basis', ['CURRENT_PROGRAM', 'NEGOTIATED']).notNullable()
      table.string('agreement_reference', 128).nullable()
      table.text('negotiation_reason').nullable()
      table.string('approved_by_ref', 128).nullable()
      table.timestamp('effective_from').notNullable()
      table.string('created_by_ref', 128).notNullable()
      table.timestamp('created_at').notNullable()
      table.unique(['pack_version_id', 'terms_version'])
      table.unique(['pack_version_id', 'effective_from'])
      table.unique(['pack_version_id', 'id'], 'knowledge_pack_terms_version_id_unique')
      table.foreign('pack_version_id').references('knowledge_pack_versions.id').onDelete('RESTRICT')
      table
        .foreign('creator_id_snapshot')
        .references('knowledge_pack_creators.id')
        .onDelete('RESTRICT')
      table
        .foreign(['pack_version_id', 'supersedes_terms_id'], 'knowledge_pack_terms_supersession_fk')
        .references(['pack_version_id', 'id'])
        .inTable('knowledge_pack_financial_terms')
        .onDelete('RESTRICT')
      table.check(
        'creator_royalty_rate_bps >= 0 AND creator_royalty_rate_bps <= 10000',
        {},
        'knowledge_pack_terms_rate_check'
      )
      table.check(
        `(owner_type_snapshot = 'VIGILANT_WATCHMAN' AND creator_id_snapshot IS NULL ` +
          `AND creator_royalty_rate_bps = 0) OR ` +
          `(owner_type_snapshot = 'AUTHORIZED_WATCHMAN_CREATOR' ` +
          `AND creator_id_snapshot IS NOT NULL)`,
        {},
        'knowledge_pack_terms_owner_check'
      )
      table.check(
        `(terms_basis = 'CURRENT_PROGRAM' AND agreement_reference IS NULL ` +
          `AND negotiation_reason IS NULL AND approved_by_ref IS NULL ` +
          `AND ((owner_type_snapshot = 'VIGILANT_WATCHMAN' ` +
          `AND creator_royalty_rate_bps = 0) OR ` +
          `(owner_type_snapshot = 'AUTHORIZED_WATCHMAN_CREATOR' ` +
          `AND creator_royalty_rate_bps = 8000))) OR ` +
          `(terms_basis = 'NEGOTIATED' ` +
          `AND owner_type_snapshot = 'AUTHORIZED_WATCHMAN_CREATOR' ` +
          `AND CHAR_LENGTH(TRIM(agreement_reference)) > 0 ` +
          `AND CHAR_LENGTH(TRIM(negotiation_reason)) > 0 ` +
          `AND CHAR_LENGTH(TRIM(approved_by_ref)) > 0)`,
        {},
        'knowledge_pack_terms_basis_check'
      )
    })

    this.schema.createTable('knowledge_pack_ledger_entries', (table) => {
      table.string('id', 36).primary()
      table.string('financial_terms_id', 36).notNullable().index()
      table.string('transaction_ref', 128).notNullable().index()
      table.string('idempotency_key', 128).notNullable().unique()
      table.enum('entry_type', LEDGER_ENTRY_TYPES).notNullable()
      table.bigInteger('amount_minor').notNullable()
      table.string('currency', 3).notNullable()
      table.string('reverses_entry_id', 36).nullable().unique()
      table.string('external_reference', 255).nullable()
      table.timestamp('occurred_at').notNullable()
      table.timestamp('created_at').notNullable()
      table
        .foreign('financial_terms_id')
        .references('knowledge_pack_financial_terms.id')
        .onDelete('RESTRICT')
      table
        .foreign('reverses_entry_id')
        .references('knowledge_pack_ledger_entries.id')
        .onDelete('RESTRICT')
      table.check('amount_minor <> 0', {}, 'knowledge_pack_ledger_nonzero_check')
      table.check(`currency REGEXP '^[A-Z]{3}$'`, {}, 'knowledge_pack_ledger_currency_check')
      table.check(
        `(entry_type IN ('REFUND', 'CHARGEBACK', 'REVERSAL') AND reverses_entry_id IS NOT NULL) OR ` +
          `(entry_type NOT IN ('REFUND', 'CHARGEBACK', 'REVERSAL') AND reverses_entry_id IS NULL)`,
        {},
        'knowledge_pack_ledger_reversal_check'
      )
      table.check(
        `(entry_type IN ('TAX_DEDUCTION', 'PROCESSING_FEE_DEDUCTION', ` +
          `'PLATFORM_TRANSACTION_FEE_DEDUCTION', 'REFUND', 'CHARGEBACK') AND amount_minor < 0) OR ` +
          `(entry_type IN ('GROSS_SALE', 'NET_REVENUE', 'CREATOR_SHARE', ` +
          `'VIGILANT_WATCHMAN_SHARE') AND amount_minor > 0) OR entry_type = 'REVERSAL'`,
        {},
        'knowledge_pack_ledger_sign_check'
      )
    })
  }

  async down() {
    this.defer(async (db) => {
      for (const tableName of ['knowledge_pack_ledger_entries', 'knowledge_pack_financial_terms']) {
        const row = await db.from(tableName).count('* as total').first()
        if (Number(row?.total ?? 0) > 0) {
          throw new Error(
            `Refusing to roll back populated immutable Knowledge Pack financial history (${tableName})`
          )
        }
      }
    })
    this.schema.dropTable('knowledge_pack_ledger_entries')
    this.schema.dropTable('knowledge_pack_financial_terms')
  }
}
