import type {
  EntitlementSubject,
  InstalledKnowledgePackSnapshot,
  KnowledgePackAccessDecision,
  KnowledgePackAcquisitionGrant,
  KnowledgePackEntitlement,
  MembershipEntitlement,
  OfflineKnowledgePackGrantClaims,
} from '../../types/knowledge_pack_entitlements.js'
import { KNOWLEDGE_PACK_ACQUISITION_GRANT_MAX_TTL_MS } from '../../types/knowledge_pack_entitlements.js'

type InstalledPackUseInput = {
  requestingSubject: EntitlementSubject
  installed: InstalledKnowledgePackSnapshot
  entitlement: KnowledgePackEntitlement
  membership?: MembershipEntitlement | null
  evaluatedAt: string
}

const OPAQUE_REFERENCE_PATTERN = /^\S.{0,255}$/u

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO-compatible timestamp`)
  return parsed
}

function assertOpaqueReference(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    !OPAQUE_REFERENCE_PATTERN.test(value) ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint < 0x20 || codePoint === 0x7f
    })
  ) {
    throw new Error(`${label} is invalid`)
  }
}

function subjectsMatch(left: EntitlementSubject, right: EntitlementSubject): boolean {
  return (
    left.customerId === right.customerId &&
    (left.organizationId ?? null) === (right.organizationId ?? null)
  )
}

function membershipIsActive(
  membership: MembershipEntitlement | null | undefined,
  membershipId: string,
  expectedSubject: EntitlementSubject,
  evaluatedAt: number
): boolean {
  if (!membership || membership.membershipId !== membershipId || membership.state !== 'ACTIVE') {
    return false
  }
  if (!subjectsMatch(membership.subject, expectedSubject)) return false

  const validFrom = timestamp(membership.validFrom, 'Membership valid-from date')
  if (evaluatedAt < validFrom) return false
  if (!membership.validUntil) return true
  return evaluatedAt < timestamp(membership.validUntil, 'Membership valid-until date')
}

/**
 * Pure local-use policy. A verified installed version with an active perpetual grant remains usable
 * without consulting membership state or any online provider.
 */
export function evaluateInstalledKnowledgePackUse(
  input: InstalledPackUseInput
): KnowledgePackAccessDecision {
  if (!subjectsMatch(input.requestingSubject, input.entitlement.subject)) {
    return { allowed: false, reason: 'SUBJECT_MISMATCH' }
  }
  if (input.installed.packId !== input.entitlement.packId) {
    return { allowed: false, reason: 'PACK_MISMATCH' }
  }
  if (input.installed.installState !== 'INSTALLED') {
    return { allowed: false, reason: 'INSTALL_NOT_READY' }
  }
  if (!input.installed.manifestSignatureVerified || !input.installed.artifactHashesVerified) {
    return { allowed: false, reason: 'INSTALL_NOT_VERIFIED' }
  }

  const grants = input.entitlement.versionGrants.filter(
    (candidate) => candidate.packVersion === input.installed.packVersion
  )
  if (grants.length === 0) return { allowed: false, reason: 'VERSION_NOT_GRANTED' }
  if (grants.some((grant) => grant.state === 'ACTIVE' && grant.useRights === 'PERPETUAL')) {
    return { allowed: true, reason: 'PERPETUAL_VERSION_GRANT' }
  }

  const evaluatedAt = timestamp(input.evaluatedAt, 'Evaluation date')
  const activeMembershipGrants = grants.filter(
    (grant) => grant.state === 'ACTIVE' && grant.useRights === 'WHILE_MEMBERSHIP_ACTIVE'
  )
  for (const grant of activeMembershipGrants) {
    if (
      membershipIsActive(
        input.membership,
        grant.membershipId,
        input.entitlement.subject,
        evaluatedAt
      )
    ) {
      return { allowed: true, reason: 'ACTIVE_MEMBERSHIP_GRANT' }
    }
  }
  if (activeMembershipGrants.length > 0) {
    return { allowed: false, reason: 'MEMBERSHIP_INACTIVE' }
  }

  const revokedGrant = grants.find((grant) => grant.state === 'REVOKED')
  return {
    allowed: false,
    reason: 'EXPLICIT_REVOCATION',
    revocationReason: revokedGrant?.revocationReason,
  }
}

/**
 * Checks entitlement semantics only. It does not parse, canonicalize, or verify a signature.
 */
export function assertOfflineKnowledgePackGrantClaimSemantics(
  claims: OfflineKnowledgePackGrantClaims
): void {
  assertOpaqueReference(claims.grantId, 'Offline grant ID')
  assertOpaqueReference(claims.entitlementId, 'Entitlement ID')
  assertOpaqueReference(claims.subject.customerId, 'Customer ID')
  assertOpaqueReference(claims.packId, 'Pack ID')
  assertOpaqueReference(claims.packVersion, 'Pack version')

  const issuedAt = timestamp(claims.issuedAt, 'Offline grant issue date')
  if (claims.notBefore && timestamp(claims.notBefore, 'Offline grant not-before date') < issuedAt) {
    throw new Error('Offline grant not-before date cannot precede its issue date')
  }

  if (claims.useRights === 'PERPETUAL') {
    if (claims.expiresAt !== null) {
      throw new Error('A perpetual offline Knowledge Pack grant cannot expire')
    }
    return
  }

  assertOpaqueReference(claims.membershipId, 'Membership ID')
  if (timestamp(claims.expiresAt, 'Offline membership grant expiry') <= issuedAt) {
    throw new Error('Offline membership grant must expire after it is issued')
  }
}

/**
 * Validates the non-secret acquisition envelope. Authorization and artifact delivery remain provider
 * responsibilities; this function deliberately creates neither URLs nor bearer credentials.
 */
export function assertShortLivedKnowledgePackAcquisitionGrant(
  grant: KnowledgePackAcquisitionGrant,
  evaluatedAt: string
): void {
  assertOpaqueReference(grant.grantId, 'Acquisition grant ID')
  assertOpaqueReference(grant.entitlementId, 'Entitlement ID')
  assertOpaqueReference(grant.subject.customerId, 'Customer ID')
  assertOpaqueReference(grant.packId, 'Pack ID')
  assertOpaqueReference(grant.packVersion, 'Pack version')
  assertOpaqueReference(grant.auditEventId, 'Audit event ID')

  const issuedAt = timestamp(grant.issuedAt, 'Acquisition grant issue date')
  const expiresAt = timestamp(grant.expiresAt, 'Acquisition grant expiry')
  const evaluatedAtTimestamp = timestamp(evaluatedAt, 'Acquisition grant evaluation date')
  if (expiresAt <= issuedAt) throw new Error('Acquisition grant must expire after it is issued')
  if (expiresAt - issuedAt > KNOWLEDGE_PACK_ACQUISITION_GRANT_MAX_TTL_MS) {
    throw new Error('Acquisition grant exceeds the maximum lifetime')
  }
  if (evaluatedAtTimestamp < issuedAt || evaluatedAtTimestamp >= expiresAt) {
    throw new Error('Acquisition grant is not currently valid')
  }
  if (grant.artifactAuthorizations.length === 0) {
    throw new Error('Acquisition grant must authorize at least one artifact')
  }

  const artifactIds = new Set<string>()
  for (const artifact of grant.artifactAuthorizations) {
    assertOpaqueReference(artifact.artifactId, 'Artifact ID')
    if (artifactIds.has(artifact.artifactId)) {
      throw new Error('Acquisition grant contains a duplicate artifact authorization')
    }
    artifactIds.add(artifact.artifactId)
  }
}
