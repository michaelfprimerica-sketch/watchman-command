import {
  BaseModel,
  beforeDelete,
  beforeUpdate,
  column,
  SnakeCaseNamingStrategy,
} from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { KnowledgePackLedgerEntryType } from '../../types/knowledge_packs.js'

export default class KnowledgePackLedgerEntry extends BaseModel {
  static table = 'knowledge_pack_ledger_entries'
  static namingStrategy = new SnakeCaseNamingStrategy()

  @column({ isPrimary: true }) declare id: string
  @column() declare financial_terms_id: string
  @column() declare transaction_ref: string
  @column() declare idempotency_key: string
  @column() declare entry_type: KnowledgePackLedgerEntryType
  @column() declare amount_minor: string
  @column() declare currency: string
  @column() declare reverses_entry_id: string | null
  @column() declare external_reference: string | null
  @column.dateTime() declare occurred_at: DateTime
  @column.dateTime({ autoCreate: true }) declare created_at: DateTime

  @beforeUpdate()
  static rejectUpdate(): never {
    throw new Error('Knowledge Pack ledger entries are append-only')
  }

  @beforeDelete()
  static rejectDelete(): never {
    throw new Error('Knowledge Pack ledger entries are append-only')
  }
}
