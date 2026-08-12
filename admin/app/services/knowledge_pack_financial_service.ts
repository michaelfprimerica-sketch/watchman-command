import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'

import type {
  KnowledgePackFinancialTermsInput,
  KnowledgePackLedgerEntryType,
  KnowledgePackOwnerType,
} from '../../types/knowledge_packs.js'
import {
  assertCreatorRoyaltyRateBps,
  assertFinancialTerms,
  assertLedgerEntry,
  currentCreatorRoyaltyRateBps,
} from '../utils/knowledge_pack_financial.js'
import { assertKnowledgePackIdentifier } from '../utils/knowledge_pack_governance.js'

type CreateFinancialTermsInput = {
  packVersionId: string
  creatorRoyaltyRateBps?: number
  effectiveFrom: string
  createdByRef: string
}

type AppendLedgerEntryInput = {
  financialTermsId: string
  transactionRef: string
  idempotencyKey: string
  entryType: Exclude<KnowledgePackLedgerEntryType, 'REFUND' | 'CHARGEBACK' | 'REVERSAL'>
  amountMinor: bigint
  currency: string
  occurredAt: string
  externalReference?: string | null
}

type AppendReversalInput = {
  originalEntryId: string
  entryType: 'REFUND' | 'CHARGEBACK' | 'REVERSAL'
  idempotencyKey: string
  occurredAt: string
  externalReference?: string | null
}

const nowSql = () => DateTime.utc().toSQL({ includeOffset: false }) as string

const assertOpaqueReference = (value: string, label: string) => {
  assertKnowledgePackIdentifier(value, label)
}

const assertTimestamp = (value: string, label: string) => {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid`)
}

/** Append-only financial foundation. This service posts records; it never settles or pays funds. */
export class KnowledgePackFinancialService {
  async createTerms(input: CreateFinancialTermsInput): Promise<string> {
    assertOpaqueReference(input.packVersionId, 'Pack version ID')
    assertOpaqueReference(input.createdByRef, 'Terms author reference')
    assertTimestamp(input.effectiveFrom, 'Effective date')
    if (input.creatorRoyaltyRateBps !== undefined) {
      assertCreatorRoyaltyRateBps(input.creatorRoyaltyRateBps)
    }

    const id = randomUUID()
    await db.transaction(async (trx) => {
      const version = await trx
        .from('knowledge_pack_versions')
        .where('id', input.packVersionId)
        .forUpdate()
        .first()
      if (!version) throw new Error('Knowledge Pack version does not exist')

      const latest = await trx
        .from('knowledge_pack_financial_terms')
        .where('pack_version_id', input.packVersionId)
        .orderBy('terms_version', 'desc')
        .forUpdate()
        .first()
      const ownerType = version.owner_type_snapshot as KnowledgePackOwnerType
      const termsVersion = latest ? Number(latest.terms_version) + 1 : 1
      const rate = input.creatorRoyaltyRateBps ?? currentCreatorRoyaltyRateBps(ownerType)
      const terms: KnowledgePackFinancialTermsInput = {
        packId: version.pack_id,
        packVersionId: input.packVersionId,
        termsVersion,
        ownerType,
        creatorId: version.creator_id_snapshot,
        creatorRoyaltyRateBps: rate,
        effectiveFrom: input.effectiveFrom,
      }
      assertFinancialTerms(terms)

      await trx.table('knowledge_pack_financial_terms').insert({
        id,
        pack_version_id: input.packVersionId,
        terms_version: termsVersion,
        supersedes_terms_id: latest?.id ?? null,
        owner_type_snapshot: ownerType,
        creator_id_snapshot: version.creator_id_snapshot,
        creator_royalty_rate_bps: rate,
        effective_from: DateTime.fromISO(input.effectiveFrom)
          .toUTC()
          .toSQL({ includeOffset: false }),
        created_by_ref: input.createdByRef,
        created_at: nowSql(),
      })
    })
    return id
  }

  async appendEntry(input: AppendLedgerEntryInput): Promise<string> {
    assertOpaqueReference(input.financialTermsId, 'Financial terms ID')
    assertOpaqueReference(input.transactionRef, 'Transaction reference')
    assertOpaqueReference(input.idempotencyKey, 'Idempotency key')
    assertTimestamp(input.occurredAt, 'Ledger occurrence date')
    if (input.externalReference) {
      assertOpaqueReference(input.externalReference, 'External reference')
    }
    assertLedgerEntry({
      entryType: input.entryType,
      amountMinor: input.amountMinor,
      currency: input.currency,
      reversesEntryId: null,
    })

    const id = randomUUID()
    await db.transaction(async (trx) => {
      const terms = await trx
        .from('knowledge_pack_financial_terms')
        .where('id', input.financialTermsId)
        .first()
      if (!terms) throw new Error('Financial terms do not exist')
      await trx.table('knowledge_pack_ledger_entries').insert({
        id,
        financial_terms_id: input.financialTermsId,
        transaction_ref: input.transactionRef,
        idempotency_key: input.idempotencyKey,
        entry_type: input.entryType,
        amount_minor: input.amountMinor.toString(),
        currency: input.currency,
        reverses_entry_id: null,
        external_reference: input.externalReference ?? null,
        occurred_at: DateTime.fromISO(input.occurredAt).toUTC().toSQL({ includeOffset: false }),
        created_at: nowSql(),
      })
    })
    return id
  }

  async appendReversal(input: AppendReversalInput): Promise<string> {
    assertOpaqueReference(input.originalEntryId, 'Original ledger entry ID')
    assertOpaqueReference(input.idempotencyKey, 'Idempotency key')
    assertTimestamp(input.occurredAt, 'Reversal occurrence date')
    if (input.externalReference) {
      assertOpaqueReference(input.externalReference, 'External reference')
    }

    const id = randomUUID()
    await db.transaction(async (trx) => {
      const original = await trx
        .from('knowledge_pack_ledger_entries')
        .where('id', input.originalEntryId)
        .forUpdate()
        .first()
      if (!original) throw new Error('Original ledger entry does not exist')
      if (original.reverses_entry_id) throw new Error('A reversal cannot itself be reversed here')

      const amountMinor = -BigInt(original.amount_minor)
      assertLedgerEntry({
        entryType: input.entryType,
        amountMinor,
        currency: original.currency,
        reversesEntryId: input.originalEntryId,
      })
      await trx.table('knowledge_pack_ledger_entries').insert({
        id,
        financial_terms_id: original.financial_terms_id,
        transaction_ref: original.transaction_ref,
        idempotency_key: input.idempotencyKey,
        entry_type: input.entryType,
        amount_minor: amountMinor.toString(),
        currency: original.currency,
        reverses_entry_id: input.originalEntryId,
        external_reference: input.externalReference ?? null,
        occurred_at: DateTime.fromISO(input.occurredAt).toUTC().toSQL({ includeOffset: false }),
        created_at: nowSql(),
      })
    })
    return id
  }
}
