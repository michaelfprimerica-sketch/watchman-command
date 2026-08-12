import * as assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  assertFinancialTerms,
  assertLedgerEntry,
  calculateKnowledgePackRevenueShares,
  computeNetKnowledgePackRevenue,
  currentCreatorRoyaltyRateBps,
} from '../../app/utils/knowledge_pack_financial.js'
import {
  AUTHORIZED_WATCHMAN_CREATOR_DEFAULT_ROYALTY_BPS,
  HQ_KNOWLEDGE_PACK_CREATOR_ROYALTY_BPS,
} from '../../types/knowledge_packs.js'

test('uses the approved current 80/20 creator economics and 100% HQ economics', () => {
  assert.equal(AUTHORIZED_WATCHMAN_CREATOR_DEFAULT_ROYALTY_BPS, 8000)
  assert.equal(currentCreatorRoyaltyRateBps('AUTHORIZED_WATCHMAN_CREATOR'), 8000)
  assert.equal(HQ_KNOWLEDGE_PACK_CREATOR_ROYALTY_BPS, 0)
  assert.equal(currentCreatorRoyaltyRateBps('VIGILANT_WATCHMAN'), 0)

  assert.deepEqual(calculateKnowledgePackRevenueShares(10_001n, 8000), {
    creatorShareMinor: 8_000n,
    vigilantWatchmanShareMinor: 2_001n,
  })
  assert.deepEqual(calculateKnowledgePackRevenueShares(10_001n, 0), {
    creatorShareMinor: 0n,
    vigilantWatchmanShareMinor: 10_001n,
  })
})

test('net pack revenue subtracts only explicit transaction-specific deductions', () => {
  assert.equal(
    computeNetKnowledgePackRevenue({
      collectedMinor: 20_000n,
      refundsMinor: 1_000n,
      chargebacksMinor: 500n,
      taxesCollectedMinor: 1_200n,
      processingFeesMinor: 600n,
      platformTransactionFeesMinor: 200n,
    }),
    16_500n
  )
  assert.throws(() =>
    computeNetKnowledgePackRevenue({ collectedMinor: 100n, processingFeesMinor: 101n })
  )
})

test('financial terms bind creator identity and permit future explicit negotiated rates', () => {
  assert.doesNotThrow(() =>
    assertFinancialTerms({
      packId: 'pack-field-guide',
      packVersionId: 'version-field-guide-v1',
      termsVersion: 1,
      ownerType: 'AUTHORIZED_WATCHMAN_CREATOR',
      creatorId: 'creator-ada-01',
      creatorRoyaltyRateBps: 8000,
      effectiveFrom: '2026-08-11T00:00:00Z',
      termsBasis: 'CURRENT_PROGRAM',
    })
  )
  assert.doesNotThrow(() =>
    assertFinancialTerms({
      packId: 'pack-future-negotiated',
      packVersionId: 'version-future-v2',
      termsVersion: 2,
      ownerType: 'AUTHORIZED_WATCHMAN_CREATOR',
      creatorId: 'creator-ada-01',
      creatorRoyaltyRateBps: 7500,
      effectiveFrom: '2027-01-01T00:00:00Z',
      termsBasis: 'NEGOTIATED',
      agreementReference: 'agreement-2027-01',
      negotiationReason: 'Future approved individual creator agreement',
      approvedByRef: 'watchman-reviewer-01',
    })
  )
  assert.throws(() =>
    assertFinancialTerms({
      packId: 'pack-hq',
      packVersionId: 'version-hq-v1',
      termsVersion: 1,
      ownerType: 'VIGILANT_WATCHMAN',
      creatorId: 'unrelated-representative',
      creatorRoyaltyRateBps: 8000,
      effectiveFrom: '2026-08-11T00:00:00Z',
      termsBasis: 'CURRENT_PROGRAM',
    })
  )
  assert.throws(() =>
    assertFinancialTerms({
      packId: 'pack-obsolete-split',
      packVersionId: 'version-obsolete-v1',
      termsVersion: 1,
      ownerType: 'AUTHORIZED_WATCHMAN_CREATOR',
      creatorId: 'creator-ada-01',
      creatorRoyaltyRateBps: 4000,
      effectiveFrom: '2026-08-11T00:00:00Z',
      termsBasis: 'CURRENT_PROGRAM',
    })
  )
})

test('ledger uses integer minor units and append-only reversal entries', () => {
  assert.doesNotThrow(() =>
    assertLedgerEntry({
      entryType: 'GROSS_SALE',
      amountMinor: 10_000n,
      currency: 'USD',
      reversesEntryId: null,
    })
  )
  assert.doesNotThrow(() =>
    assertLedgerEntry({
      entryType: 'REFUND',
      amountMinor: -10_000n,
      currency: 'USD',
      reversesEntryId: 'ledger-original-sale',
    })
  )
  assert.doesNotThrow(() =>
    assertLedgerEntry({
      entryType: 'CHARGEBACK',
      amountMinor: -10_000n,
      currency: 'USD',
      reversesEntryId: 'ledger-original-sale',
    })
  )
  assert.throws(() =>
    assertLedgerEntry({
      entryType: 'REFUND',
      amountMinor: 10_000n,
      currency: 'USD',
      reversesEntryId: 'ledger-original-sale',
    })
  )
  assert.throws(() =>
    assertLedgerEntry({
      entryType: 'PROCESSING_FEE_DEDUCTION',
      amountMinor: -200n,
      currency: 'usd',
      reversesEntryId: null,
    })
  )
})

test('financial migration protects immutable terms and ledger history', async () => {
  const source = await readFile(
    new URL(
      '../../database/migrations/1777000000002_create_knowledge_pack_financial_tables.ts',
      import.meta.url
    ),
    'utf8'
  )
  assert.match(source, /creator_royalty_rate_bps >= 0/)
  assert.match(source, /creator_royalty_rate_bps <= 10000/)
  assert.match(source, /knowledge_pack_terms_owner_check/)
  assert.match(source, /knowledge_pack_terms_basis_check/)
  assert.match(source, /creator_royalty_rate_bps = 8000/)
  assert.match(source, /amount_minor/)
  assert.match(source, /reverses_entry_id/)
  assert.match(source, /Refusing to roll back populated immutable Knowledge Pack financial history/)
  assert.doesNotMatch(
    source,
    /\bpayroll\b|\brent\b|\bmarketing\b|\boffice costs?\b|development overhead|corporate overhead/i
  )
})

test('transaction posting resolves effective terms and derives shares internally', async () => {
  const source = await readFile(
    new URL('../../app/services/knowledge_pack_financial_service.ts', import.meta.url),
    'utf8'
  )
  assert.match(source, /async postTransaction/)
  assert.match(source, /where\('effective_from', '<=', occurredAtSql\)/)
  assert.match(source, /calculateKnowledgePackRevenueShares/)
  assert.match(source, /computeNetKnowledgePackRevenue/)
  assert.doesNotMatch(source, /async appendEntry/)
})
