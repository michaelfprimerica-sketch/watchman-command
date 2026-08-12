export type EntitlementSubject = {
  customerId: string
  organizationId?: string | null
}

/** The application license is intentionally independent from content ownership. */
export type SoftwareLicenseEntitlement = {
  licenseId: string
  subject: EntitlementSubject
  state: 'ACTIVE' | 'EXPIRED' | 'REVOKED'
  validUntil?: string | null
}

/** Membership may grant new content or updates, but is not proof of a pack purchase. */
export type MembershipEntitlement = {
  membershipId: string
  subject: EntitlementSubject
  state: 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'REVOKED'
  validFrom: string
  validUntil?: string | null
}

/** A registered device seat is not a software license or a content entitlement. */
export type DeviceSeatEntitlement = {
  seatId: string
  subject: EntitlementSubject
  deviceId: string
  state: 'REGISTERED' | 'RELEASED' | 'REVOKED'
}

export const KNOWLEDGE_PACK_REVOCATION_REASONS = ['REFUND', 'FRAUD', 'SECURITY'] as const
export type KnowledgePackRevocationReason = (typeof KNOWLEDGE_PACK_REVOCATION_REASONS)[number]

type ActiveVersionGrant = {
  state: 'ACTIVE'
  revokedAt?: never
  revocationReason?: never
}

type RevokedVersionGrant = {
  state: 'REVOKED'
  revokedAt: string
  revocationReason: KnowledgePackRevocationReason
}

type VersionGrantState = ActiveVersionGrant | RevokedVersionGrant

type PurchasedVersionGrant = {
  source: 'PURCHASE'
  useRights: 'PERPETUAL'
  packVersion: string
  grantedAt: string
  membershipId?: never
}

type MembershipVersionGrant = {
  source: 'MEMBERSHIP'
  useRights: 'WHILE_MEMBERSHIP_ACTIVE'
  packVersion: string
  grantedAt: string
  membershipId: string
}

type AdministrativeVersionGrant = {
  source: 'ADMINISTRATIVE_GRANT'
  useRights: 'PERPETUAL'
  packVersion: string
  grantedAt: string
  membershipId?: never
}

/**
 * Purchase grants are structurally perpetual. Ordinary membership expiration is deliberately not
 * a revocation reason; only an explicit refund, fraud, or security action can revoke this record.
 */
export type KnowledgePackVersionGrant = (
  | PurchasedVersionGrant
  | MembershipVersionGrant
  | AdministrativeVersionGrant
) &
  VersionGrantState

export type KnowledgePackEntitlement = {
  entitlementId: string
  subject: EntitlementSubject
  packId: string
  versionGrants: readonly KnowledgePackVersionGrant[]
}

export type InstalledKnowledgePackSnapshot = {
  packId: string
  packVersion: string
  installState: 'INSTALLED' | 'STAGED' | 'FAILED' | 'REMOVED'
  manifestSignatureVerified: boolean
  artifactHashesVerified: boolean
}

export type KnowledgePackAccessDecision =
  | {
      allowed: true
      reason: 'PERPETUAL_VERSION_GRANT' | 'ACTIVE_MEMBERSHIP_GRANT'
    }
  | {
      allowed: false
      reason:
        | 'PACK_MISMATCH'
        | 'SUBJECT_MISMATCH'
        | 'INSTALL_NOT_READY'
        | 'INSTALL_NOT_VERIFIED'
        | 'VERSION_NOT_GRANTED'
        | 'EXPLICIT_REVOCATION'
        | 'MEMBERSHIP_INACTIVE'
      revocationReason?: KnowledgePackRevocationReason
    }

export type KnowledgePackEntitlementRequest = {
  subject: EntitlementSubject
  packId: string
  packVersion?: string
}

export type KnowledgePackUpdateEntitlementRequest = KnowledgePackEntitlementRequest & {
  installedVersion: string
  requestedVersion: string
}

export interface SoftwareLicenseProvider {
  getSoftwareLicense(subject: EntitlementSubject): Promise<SoftwareLicenseEntitlement | null>
}

export interface MembershipProvider {
  getMembership(subject: EntitlementSubject): Promise<MembershipEntitlement | null>
}

export interface DeviceSeatProvider {
  getDeviceSeat(
    subject: EntitlementSubject,
    deviceId: string
  ): Promise<DeviceSeatEntitlement | null>
}

export type OfflineKnowledgePackGrantClaimsBase = {
  schemaVersion: 'watchman.offline-pack-grant/v1'
  grantId: string
  entitlementId: string
  subject: EntitlementSubject
  packId: string
  packVersion: string
  issuedAt: string
  notBefore?: string | null
}

export type OfflineKnowledgePackGrantClaims = OfflineKnowledgePackGrantClaimsBase &
  (
    | {
        source: 'PURCHASE' | 'ADMINISTRATIVE_GRANT'
        useRights: 'PERPETUAL'
        expiresAt: null
        membershipId?: never
      }
    | {
        source: 'MEMBERSHIP'
        useRights: 'WHILE_MEMBERSHIP_ACTIVE'
        expiresAt: string
        membershipId: string
      }
  )

/**
 * Placeholder envelope only. Phase 5 must define canonical serialization and provider-backed
 * signature verification before accepting one of these grants.
 */
export type SignedOfflineKnowledgePackGrant = {
  claims: OfflineKnowledgePackGrantClaims
  signature: {
    algorithm: 'Ed25519'
    keyId: string
    value: string
  }
}

export type OfflineKnowledgePackGrantValidationRequest = {
  grant: SignedOfflineKnowledgePackGrant
  expectedSubject: EntitlementSubject
  expectedPackId: string
  expectedPackVersion: string
  evaluatedAt: string
}

export type OfflineKnowledgePackGrantValidationResult =
  | { valid: true; claims: OfflineKnowledgePackGrantClaims }
  | {
      valid: false
      reason:
        | 'INVALID_SIGNATURE'
        | 'UNKNOWN_KEY'
        | 'CLAIMS_INVALID'
        | 'NOT_YET_VALID'
        | 'EXPIRED'
        | 'SUBJECT_MISMATCH'
        | 'PACK_MISMATCH'
    }

/** Provider contract only. No licensing vendor or remote dependency is selected in Phase 4. */
export interface PackEntitlementService {
  canAcquirePack(request: KnowledgePackEntitlementRequest): Promise<KnowledgePackAccessDecision>
  canInstallPack(request: KnowledgePackEntitlementRequest): Promise<KnowledgePackAccessDecision>
  ownsPackVersion(request: Required<KnowledgePackEntitlementRequest>): Promise<boolean>
  canReceivePackUpdate(
    request: KnowledgePackUpdateEntitlementRequest
  ): Promise<KnowledgePackAccessDecision>
  getPackEntitlement(
    subject: EntitlementSubject,
    packId: string
  ): Promise<KnowledgePackEntitlement | null>
  validateOfflinePackGrant(
    request: OfflineKnowledgePackGrantValidationRequest
  ): Promise<OfflineKnowledgePackGrantValidationResult>
}

export type KnowledgePackLedgerReference = {
  entryId: string
  transactionReference: string
}

/**
 * Read-only coordination boundary. Ledger records never grant content access and entitlement
 * records never substitute for immutable financial postings.
 */
export interface KnowledgePackLedgerBoundary {
  listPackVersionLedgerReferences(
    packId: string,
    packVersion: string
  ): Promise<readonly KnowledgePackLedgerReference[]>
}

/** Makes the five independent domains visible at every composition root. */
export interface KnowledgePackCommercialBoundaries {
  softwareLicenses: SoftwareLicenseProvider
  memberships: MembershipProvider
  packEntitlements: PackEntitlementService
  deviceSeats: DeviceSeatProvider
  ledger: KnowledgePackLedgerBoundary
}

export const KNOWLEDGE_PACK_ACQUISITION_GRANT_MAX_TTL_MS = 15 * 60 * 1_000

export type KnowledgePackAcquisitionGrantRequest = {
  subject: EntitlementSubject
  entitlementId: string
  packId: string
  packVersion: string
  requestedArtifactIds: readonly string[]
}

export type KnowledgePackArtifactAuthorization = {
  artifactId: string
  rangeRequestsAllowed: boolean
}

/**
 * The grant ID is an auditable opaque reference, not a permanent bearer credential. Delivery URLs
 * and provider tokens are intentionally absent from this Phase 4 placeholder.
 */
export type KnowledgePackAcquisitionGrant = {
  schemaVersion: 'watchman.pack-acquisition-grant/v1'
  grantId: string
  entitlementId: string
  subject: EntitlementSubject
  packId: string
  packVersion: string
  issuedAt: string
  expiresAt: string
  artifactAuthorizations: readonly KnowledgePackArtifactAuthorization[]
  auditEventId: string
}

export interface KnowledgePackAcquisitionGrantIssuer {
  issueAcquisitionGrant(
    request: KnowledgePackAcquisitionGrantRequest
  ): Promise<KnowledgePackAcquisitionGrant>
}
