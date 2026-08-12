import type {
  KnowledgePackFinancialTermsInput,
  KnowledgePackLedgerEntryType,
  KnowledgePackOwnerType,
} from '../../types/knowledge_packs.js'
import {
  AUTHORIZED_WATCHMAN_CREATOR_DEFAULT_ROYALTY_BPS,
  FULL_REVENUE_BPS,
  HQ_KNOWLEDGE_PACK_CREATOR_ROYALTY_BPS,
} from '../../types/knowledge_packs.js'
import { assertKnowledgePackIdentifier } from './knowledge_pack_governance.js'

const CURRENCY_PATTERN = /^[A-Z]{3}$/
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n
const MIN_SIGNED_BIGINT = -9_223_372_036_854_775_808n

const NEGATIVE_ENTRY_TYPES = new Set<KnowledgePackLedgerEntryType>([
  'TAX_DEDUCTION',
  'PROCESSING_FEE_DEDUCTION',
  'PLATFORM_TRANSACTION_FEE_DEDUCTION',
  'REFUND',
  'CHARGEBACK',
])

const POSITIVE_ENTRY_TYPES = new Set<KnowledgePackLedgerEntryType>([
  'GROSS_SALE',
  'NET_REVENUE',
  'CREATOR_SHARE',
  'VIGILANT_WATCHMAN_SHARE',
])

export type NetKnowledgePackRevenueInput = {
  collectedMinor: bigint
  refundsMinor?: bigint
  chargebacksMinor?: bigint
  taxesCollectedMinor?: bigint
  processingFeesMinor?: bigint
  platformTransactionFeesMinor?: bigint
}

const assertNonNegativeMoney = (amount: bigint, label: string) => {
  if (typeof amount !== 'bigint' || amount < 0n) throw new Error(`${label} must be non-negative`)
  if (amount > MAX_SIGNED_BIGINT) throw new Error(`${label} exceeds the ledger range`)
}

export function currentCreatorRoyaltyRateBps(ownerType: KnowledgePackOwnerType): number {
  return ownerType === 'AUTHORIZED_WATCHMAN_CREATOR'
    ? AUTHORIZED_WATCHMAN_CREATOR_DEFAULT_ROYALTY_BPS
    : HQ_KNOWLEDGE_PACK_CREATOR_ROYALTY_BPS
}

export function computeNetKnowledgePackRevenue(input: NetKnowledgePackRevenueInput): bigint {
  assertNonNegativeMoney(input.collectedMinor, 'Collected amount')
  const deductions = [
    ['Refunds', input.refundsMinor ?? 0n],
    ['Chargebacks', input.chargebacksMinor ?? 0n],
    ['Taxes collected', input.taxesCollectedMinor ?? 0n],
    ['Processing fees', input.processingFeesMinor ?? 0n],
    ['Platform transaction fees', input.platformTransactionFeesMinor ?? 0n],
  ] as const

  let totalDeductions = 0n
  for (const [label, amount] of deductions) {
    assertNonNegativeMoney(amount, label)
    totalDeductions += amount
  }
  const net = input.collectedMinor - totalDeductions
  if (net < 0n) throw new Error('Transaction-specific deductions exceed the collected amount')
  return net
}

export function calculateKnowledgePackRevenueShares(
  netRevenueMinor: bigint,
  creatorRoyaltyRateBps: number
): { creatorShareMinor: bigint; vigilantWatchmanShareMinor: bigint } {
  assertNonNegativeMoney(netRevenueMinor, 'Net Knowledge Pack revenue')
  assertCreatorRoyaltyRateBps(creatorRoyaltyRateBps)
  const creatorShareMinor =
    (netRevenueMinor * BigInt(creatorRoyaltyRateBps)) / BigInt(FULL_REVENUE_BPS)
  return {
    creatorShareMinor,
    vigilantWatchmanShareMinor: netRevenueMinor - creatorShareMinor,
  }
}

export function assertCreatorRoyaltyRateBps(rate: number): void {
  if (!Number.isInteger(rate) || rate < 0 || rate > FULL_REVENUE_BPS) {
    throw new Error('Creator royalty rate must be an integer from 0 through 10000 basis points')
  }
}

export function assertFinancialTerms(input: KnowledgePackFinancialTermsInput): void {
  assertKnowledgePackIdentifier(input.packId, 'Pack ID')
  assertKnowledgePackIdentifier(input.packVersionId, 'Pack version ID')
  if (!Number.isInteger(input.termsVersion) || input.termsVersion < 1) {
    throw new Error('Terms version must be a positive integer')
  }
  assertCreatorRoyaltyRateBps(input.creatorRoyaltyRateBps)
  if (input.ownerType === 'VIGILANT_WATCHMAN') {
    if (input.creatorId !== null || input.creatorRoyaltyRateBps !== 0) {
      throw new Error('HQ packs must retain 100% of net Knowledge Pack revenue')
    }
  } else if (!input.creatorId) {
    throw new Error('Creator-owned terms require the actual creator identity')
  } else {
    assertKnowledgePackIdentifier(input.creatorId, 'Creator ID')
  }
  if (!Number.isFinite(Date.parse(input.effectiveFrom))) {
    throw new Error('Financial terms effective date is invalid')
  }
}

export function assertLedgerEntry(input: {
  entryType: KnowledgePackLedgerEntryType
  amountMinor: bigint
  currency: string
  reversesEntryId?: string | null
}): void {
  if (
    typeof input.amountMinor !== 'bigint' ||
    input.amountMinor === 0n ||
    input.amountMinor < MIN_SIGNED_BIGINT ||
    input.amountMinor > MAX_SIGNED_BIGINT
  ) {
    throw new Error('Ledger amount is outside the signed 64-bit minor-unit range')
  }
  if (!CURRENCY_PATTERN.test(input.currency)) throw new Error('Ledger currency is invalid')
  if (NEGATIVE_ENTRY_TYPES.has(input.entryType) && input.amountMinor >= 0n) {
    throw new Error(`${input.entryType} must be negative`)
  }
  if (POSITIVE_ENTRY_TYPES.has(input.entryType) && input.amountMinor <= 0n) {
    throw new Error(`${input.entryType} must be positive`)
  }
  const isReversal = ['REFUND', 'CHARGEBACK', 'REVERSAL'].includes(input.entryType)
  if (isReversal !== Boolean(input.reversesEntryId)) {
    throw new Error('Refund, chargeback, and reversal entries must reference the original entry')
  }
  if (input.reversesEntryId) {
    assertKnowledgePackIdentifier(input.reversesEntryId, 'Reversed entry ID')
  }
}
