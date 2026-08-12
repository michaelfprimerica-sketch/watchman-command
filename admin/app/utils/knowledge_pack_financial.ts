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
// mysql2 returns BIGINT columns as JavaScript numbers by default. Keeping persisted amounts inside
// the exact-integer range prevents a database round trip from introducing floating-point loss.
const MAX_EXACT_LEDGER_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_EXACT_LEDGER_INTEGER = -MAX_EXACT_LEDGER_INTEGER

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
  if (amount > MAX_EXACT_LEDGER_INTEGER) throw new Error(`${label} exceeds the ledger range`)
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
  const currentRate = currentCreatorRoyaltyRateBps(input.ownerType)
  if (input.termsBasis === 'CURRENT_PROGRAM') {
    if (input.creatorRoyaltyRateBps !== currentRate) {
      throw new Error('Current-program terms must use the approved creator royalty rate')
    }
    if (input.agreementReference || input.negotiationReason || input.approvedByRef) {
      throw new Error('Current-program terms cannot contain negotiated-term metadata')
    }
  } else {
    if (input.ownerType !== 'AUTHORIZED_WATCHMAN_CREATOR') {
      throw new Error('HQ Knowledge Pack economics cannot use negotiated creator terms')
    }
    if (!input.agreementReference || !input.negotiationReason?.trim() || !input.approvedByRef) {
      throw new Error('Negotiated terms require agreement, reason, and approver references')
    }
    assertKnowledgePackIdentifier(input.agreementReference, 'Agreement reference')
    assertKnowledgePackIdentifier(input.approvedByRef, 'Terms approver reference')
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
  reversesEntryType?: KnowledgePackLedgerEntryType | null
}): void {
  if (
    typeof input.amountMinor !== 'bigint' ||
    input.amountMinor === 0n ||
    input.amountMinor < MIN_EXACT_LEDGER_INTEGER ||
    input.amountMinor > MAX_EXACT_LEDGER_INTEGER
  ) {
    throw new Error('Ledger amount is outside the exact minor-unit range')
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
  if (isReversal !== Boolean(input.reversesEntryType)) {
    throw new Error('Reversal entries must record the original entry type')
  }
  if (input.reversesEntryType) {
    if (
      input.entryType !== 'REFUND' &&
      input.entryType !== 'CHARGEBACK' &&
      input.entryType !== 'REVERSAL'
    ) {
      throw new Error('Only reversal entries may record an original entry type')
    }
    assertKnowledgePackReversalTarget(input.reversesEntryType, input.entryType)
  }
}

export function assertKnowledgePackReversalTarget(
  originalEntryType: KnowledgePackLedgerEntryType,
  reversalEntryType: 'REFUND' | 'CHARGEBACK' | 'REVERSAL'
): void {
  if (
    (reversalEntryType === 'REFUND' || reversalEntryType === 'CHARGEBACK') &&
    originalEntryType !== 'GROSS_SALE'
  ) {
    throw new Error('Refund and chargeback entries may reverse only a gross sale')
  }
  if (
    originalEntryType === 'REFUND' ||
    originalEntryType === 'CHARGEBACK' ||
    originalEntryType === 'REVERSAL'
  ) {
    throw new Error('A reversal entry cannot itself be reversed here')
  }
}
