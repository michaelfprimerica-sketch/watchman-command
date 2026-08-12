import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'

import type {
  KnowledgePackFinancialTermsBasis,
  KnowledgePackFinancialTermsInput,
  KnowledgePackLedgerEntryType,
  KnowledgePackOwnerType,
} from '../../types/knowledge_packs.js'
import {
  assertCreatorRoyaltyRateBps,
  assertFinancialTerms,
  assertLedgerEntry,
  calculateKnowledgePackRevenueShares,
  computeNetKnowledgePackRevenue,
  currentCreatorRoyaltyRateBps,
} from '../utils/knowledge_pack_financial.js'
import { assertKnowledgePackIdentifier } from '../utils/knowledge_pack_governance.js'

type CreateFinancialTermsInput = {
  packVersionId: string
  creatorRoyaltyRateBps?: number
  termsBasis?: KnowledgePackFinancialTermsBasis
  agreementReference?: string | null
  negotiationReason?: string | null
  approvedByRef?: string | null
  effectiveFrom: string
  createdByRef: string
}

export type PostKnowledgePackTransactionInput = {
  packVersionId: string
  transactionRef: string
  idempotencyKey: string
  collectedMinor: bigint
  taxesCollectedMinor?: bigint
  processingFeesMinor?: bigint
  platformTransactionFeesMinor?: bigint
  currency: string
  occurredAt: string
  externalReference?: string | null
}

export type PostedKnowledgePackTransaction = {
  financialTermsId: string
  entryIds: string[]
  netRevenueMinor: bigint
  creatorShareMinor: bigint
  vigilantWatchmanShareMinor: bigint
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

const databaseTimestampMillis = (value: Date | string): number => {
  const parsed =
    value instanceof Date
      ? DateTime.fromJSDate(value, { zone: 'utc' })
      : DateTime.fromSQL(value, { zone: 'utc' })
  if (!parsed.isValid) throw new Error('Stored financial timestamp is invalid')
  return parsed.toMillis()
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
    if (input.agreementReference) {
      assertOpaqueReference(input.agreementReference, 'Agreement reference')
    }
    if (input.approvedByRef) {
      assertOpaqueReference(input.approvedByRef, 'Terms approver reference')
    }
    if (input.negotiationReason && input.negotiationReason.length > 20_000) {
      throw new Error('Negotiation reason is too long')
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
      const currentRate = currentCreatorRoyaltyRateBps(ownerType)
      const rate = input.creatorRoyaltyRateBps ?? currentRate
      const termsBasis = input.termsBasis ?? 'CURRENT_PROGRAM'
      if (rate !== currentRate && termsBasis !== 'NEGOTIATED') {
        throw new Error('A creator-rate deviation requires explicit negotiated terms')
      }
      const effective = DateTime.fromISO(input.effectiveFrom).toUTC()
      if (
        latest &&
        effective.toMillis() <= databaseTimestampMillis(latest.effective_from as Date | string)
      ) {
        throw new Error('New financial terms must take effect after the terms they supersede')
      }
      const terms: KnowledgePackFinancialTermsInput = {
        packId: version.pack_id,
        packVersionId: input.packVersionId,
        termsVersion,
        ownerType,
        creatorId: version.creator_id_snapshot,
        creatorRoyaltyRateBps: rate,
        effectiveFrom: input.effectiveFrom,
        termsBasis,
        agreementReference: input.agreementReference ?? null,
        negotiationReason: input.negotiationReason ?? null,
        approvedByRef: input.approvedByRef ?? null,
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
        terms_basis: termsBasis,
        agreement_reference: input.agreementReference ?? null,
        negotiation_reason: input.negotiationReason?.trim() || null,
        approved_by_ref: input.approvedByRef ?? null,
        effective_from: effective.toSQL({ includeOffset: false }),
        created_by_ref: input.createdByRef,
        created_at: nowSql(),
      })
    })
    return id
  }

  /**
   * Posts one internally balanced Knowledge Pack transaction against the immutable terms that were
   * effective when it occurred. Callers cannot choose terms or supply calculated share amounts.
   */
  async postTransaction(
    input: PostKnowledgePackTransactionInput
  ): Promise<PostedKnowledgePackTransaction> {
    assertOpaqueReference(input.packVersionId, 'Pack version ID')
    assertOpaqueReference(input.transactionRef, 'Transaction reference')
    assertOpaqueReference(input.idempotencyKey, 'Idempotency key')
    if (input.idempotencyKey.length > 80) throw new Error('Posting idempotency key is too long')
    assertTimestamp(input.occurredAt, 'Ledger occurrence date')
    if (input.externalReference) {
      assertOpaqueReference(input.externalReference, 'External reference')
    }
    if (input.collectedMinor <= 0n) throw new Error('Collected amount must be positive')

    const netRevenueMinor = computeNetKnowledgePackRevenue({
      collectedMinor: input.collectedMinor,
      taxesCollectedMinor: input.taxesCollectedMinor,
      processingFeesMinor: input.processingFeesMinor,
      platformTransactionFeesMinor: input.platformTransactionFeesMinor,
    })

    return db.transaction(async (trx) => {
      const occurredAt = DateTime.fromISO(input.occurredAt).toUTC()
      const occurredAtSql = occurredAt.toSQL({ includeOffset: false }) as string
      const terms = await trx
        .from('knowledge_pack_financial_terms')
        .where('pack_version_id', input.packVersionId)
        .where('effective_from', '<=', occurredAtSql)
        .orderBy('effective_from', 'desc')
        .orderBy('terms_version', 'desc')
        .forUpdate()
        .first()
      if (!terms) throw new Error('No financial terms were effective for this transaction')

      const shares = calculateKnowledgePackRevenueShares(
        netRevenueMinor,
        Number(terms.creator_royalty_rate_bps)
      )
      const amounts: Array<[KnowledgePackLedgerEntryType, bigint]> = [
        ['GROSS_SALE', input.collectedMinor],
        ['TAX_DEDUCTION', -(input.taxesCollectedMinor ?? 0n)],
        ['PROCESSING_FEE_DEDUCTION', -(input.processingFeesMinor ?? 0n)],
        ['PLATFORM_TRANSACTION_FEE_DEDUCTION', -(input.platformTransactionFeesMinor ?? 0n)],
        ['NET_REVENUE', netRevenueMinor],
        ['CREATOR_SHARE', shares.creatorShareMinor],
        ['VIGILANT_WATCHMAN_SHARE', shares.vigilantWatchmanShareMinor],
      ]
      const rows = amounts
        .filter(([, amount]) => amount !== 0n)
        .map(([entryType, amountMinor]) => {
          assertLedgerEntry({
            entryType,
            amountMinor,
            currency: input.currency,
            reversesEntryId: null,
          })
          return {
            id: randomUUID(),
            financial_terms_id: terms.id,
            transaction_ref: input.transactionRef,
            idempotency_key: `${input.idempotencyKey}:${entryType}`,
            entry_type: entryType,
            amount_minor: amountMinor.toString(),
            currency: input.currency,
            reverses_entry_id: null,
            external_reference: input.externalReference ?? null,
            occurred_at: occurredAtSql,
            created_at: nowSql(),
          }
        })

      const keys = rows.map((row) => row.idempotency_key)
      const existing = await trx
        .from('knowledge_pack_ledger_entries')
        .whereIn('idempotency_key', keys)
        .forUpdate()
      if (existing.length) {
        if (
          existing.length !== rows.length ||
          rows.some((row) => {
            const match = existing.find(
              (candidate) => candidate.idempotency_key === row.idempotency_key
            )
            return (
              !match ||
              match.financial_terms_id !== row.financial_terms_id ||
              match.transaction_ref !== row.transaction_ref ||
              match.entry_type !== row.entry_type ||
              BigInt(match.amount_minor) !== BigInt(row.amount_minor) ||
              match.currency !== row.currency
            )
          })
        ) {
          throw new Error('Ledger idempotency key conflicts with a different transaction')
        }
        return {
          financialTermsId: terms.id,
          entryIds: existing.map((entry) => entry.id as string),
          netRevenueMinor,
          ...shares,
        }
      }

      await trx.table('knowledge_pack_ledger_entries').multiInsert(rows)
      return {
        financialTermsId: terms.id,
        entryIds: rows.map((row) => row.id),
        netRevenueMinor,
        ...shares,
      }
    })
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
