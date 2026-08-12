export const KNOWLEDGE_PACK_OWNER_TYPES = [
  'VIGILANT_WATCHMAN',
  'AUTHORIZED_WATCHMAN_CREATOR',
] as const
export type KnowledgePackOwnerType = (typeof KNOWLEDGE_PACK_OWNER_TYPES)[number]

export const KNOWLEDGE_PACK_APPROVAL_STATUSES = [
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
] as const
export type KnowledgePackApprovalStatus = (typeof KNOWLEDGE_PACK_APPROVAL_STATUSES)[number]

export const KNOWLEDGE_PACK_CONTENT_FORMATS = [
  'ZIM',
  'DOCUMENT_BUNDLE',
  'DATASET',
  'MODEL',
  'MIXED',
] as const
export type KnowledgePackContentFormat = (typeof KNOWLEDGE_PACK_CONTENT_FORMATS)[number]

export const KNOWLEDGE_PACK_SERVICE_AREA_TYPES = [
  'NATIONAL',
  'STATE',
  'ZIP',
  'SERVICE_AREA',
] as const
export type KnowledgePackServiceAreaType = (typeof KNOWLEDGE_PACK_SERVICE_AREA_TYPES)[number]

export const KNOWLEDGE_PACK_APPROVAL_DECISIONS = [
  'SUBMIT',
  'ADVANCE',
  'APPROVE',
  'PUBLISH',
  'SUSPEND',
  'RETIRE',
  'REJECT',
] as const
export type KnowledgePackApprovalDecision = (typeof KNOWLEDGE_PACK_APPROVAL_DECISIONS)[number]

export const KNOWLEDGE_PACK_LEDGER_ENTRY_TYPES = [
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
] as const
export type KnowledgePackLedgerEntryType = (typeof KNOWLEDGE_PACK_LEDGER_ENTRY_TYPES)[number]

export const AUTHORIZED_WATCHMAN_CREATOR_DEFAULT_ROYALTY_BPS = 8_000
export const HQ_KNOWLEDGE_PACK_CREATOR_ROYALTY_BPS = 0
export const FULL_REVENUE_BPS = 10_000

export type KnowledgePackOwnership =
  | { ownerType: 'VIGILANT_WATCHMAN'; creatorId: null }
  | { ownerType: 'AUTHORIZED_WATCHMAN_CREATOR'; creatorId: string }

export type KnowledgePackServiceArea = {
  type: KnowledgePackServiceAreaType
  countryCode: string
  stateCode?: string | null
  postalCode?: string | null
  serviceAreaId?: string | null
  label?: string | null
}

export type KnowledgePackSourceReference = {
  id: string
  authority: string
  title: string
  url?: string | null
  checkedDate?: string | null
  provenanceNotes?: string | null
  rightsMetadata?: string | null
}

export type KnowledgePackArtifactManifestEntry = {
  id: string
  path: string
  contentType: string
  sizeBytes: number
  sha256: string
  compression?: string | null
}

export type KnowledgePackManifestV1 = {
  schemaVersion: 'watchman.knowledge-pack/v1'
  packId: string
  packVersion: string
  title: string
  category: string
  summary?: string | null
  owner: KnowledgePackOwnership
  missionIds: string[]
  serviceAreas: KnowledgePackServiceArea[]
  contentFormat: KnowledgePackContentFormat
  artifacts: KnowledgePackArtifactManifestEntry[]
  minimumWatchmanVersion: string
  publishedAt: string
  releaseNotes?: string | null
  sources: KnowledgePackSourceReference[]
}

export type KnowledgePackSignatureMetadata = {
  algorithm: 'Ed25519'
  keyId: string
}

export type SignedKnowledgePackManifest = {
  manifest: KnowledgePackManifestV1
  signature: KnowledgePackSignatureMetadata & { value: string }
}

export type KnowledgePackFinancialTermsInput = {
  packId: string
  packVersionId: string
  termsVersion: number
  ownerType: KnowledgePackOwnerType
  creatorId: string | null
  creatorRoyaltyRateBps: number
  effectiveFrom: string
}

export type KnowledgePackLedgerAmount = {
  amountMinor: bigint
  currency: string
}
