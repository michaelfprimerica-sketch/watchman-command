import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assertOfflineKnowledgePackGrantClaimSemantics,
  assertShortLivedKnowledgePackAcquisitionGrant,
  evaluateInstalledKnowledgePackUse,
} from '../../app/services/knowledge_pack_entitlement_service.js'
import type {
  InstalledKnowledgePackSnapshot,
  KnowledgePackAcquisitionGrant,
  KnowledgePackEntitlement,
  MembershipEntitlement,
  OfflineKnowledgePackGrantClaims,
} from '../../types/knowledge_pack_entitlements.js'

const installedPack: InstalledKnowledgePackSnapshot = {
  packId: 'pack-first-aid',
  packVersion: '1.0.0',
  installState: 'INSTALLED',
  manifestSignatureVerified: true,
  artifactHashesVerified: true,
}

const requestingSubject = { customerId: 'customer-1', organizationId: null }

const purchasedEntitlement: KnowledgePackEntitlement = {
  entitlementId: 'entitlement-purchase-1',
  subject: { customerId: 'customer-1' },
  packId: 'pack-first-aid',
  versionGrants: [
    {
      source: 'PURCHASE',
      useRights: 'PERPETUAL',
      packVersion: '1.0.0',
      grantedAt: '2026-08-01T12:00:00.000Z',
      state: 'ACTIVE',
    },
  ],
}

test('keeps a verified purchased version usable after membership expires', () => {
  const expiredMembership: MembershipEntitlement = {
    membershipId: 'membership-1',
    subject: { customerId: 'customer-1' },
    state: 'EXPIRED',
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-07-01T00:00:00.000Z',
  }

  assert.deepEqual(
    evaluateInstalledKnowledgePackUse({
      requestingSubject,
      installed: installedPack,
      entitlement: purchasedEntitlement,
      membership: expiredMembership,
      evaluatedAt: '2026-08-11T12:00:00.000Z',
    }),
    { allowed: true, reason: 'PERPETUAL_VERSION_GRANT' }
  )

  const acquiredAfterMembershipGrant: KnowledgePackEntitlement = {
    ...purchasedEntitlement,
    versionGrants: [
      {
        source: 'MEMBERSHIP',
        useRights: 'WHILE_MEMBERSHIP_ACTIVE',
        membershipId: 'membership-1',
        packVersion: '1.0.0',
        grantedAt: '2026-07-01T12:00:00.000Z',
        state: 'ACTIVE',
      },
      ...purchasedEntitlement.versionGrants,
    ],
  }
  assert.deepEqual(
    evaluateInstalledKnowledgePackUse({
      requestingSubject,
      installed: installedPack,
      entitlement: acquiredAfterMembershipGrant,
      membership: expiredMembership,
      evaluatedAt: '2026-08-11T12:00:00.000Z',
    }),
    { allowed: true, reason: 'PERPETUAL_VERSION_GRANT' }
  )
})

test('rejects another customer or organization before evaluating a perpetual grant', () => {
  const organizationEntitlement: KnowledgePackEntitlement = {
    ...purchasedEntitlement,
    subject: { customerId: 'customer-1', organizationId: 'organization-a' },
  }

  for (const mismatchedSubject of [
    { customerId: 'customer-2', organizationId: 'organization-a' },
    { customerId: 'customer-1', organizationId: 'organization-b' },
  ]) {
    assert.deepEqual(
      evaluateInstalledKnowledgePackUse({
        requestingSubject: mismatchedSubject,
        installed: installedPack,
        entitlement: organizationEntitlement,
        membership: null,
        evaluatedAt: '2026-08-11T12:00:00.000Z',
      }),
      { allowed: false, reason: 'SUBJECT_MISMATCH' }
    )
  }
})

test('uses membership only for the version granted by that active membership', () => {
  const membershipEntitlement: KnowledgePackEntitlement = {
    entitlementId: 'entitlement-membership-1',
    subject: { customerId: 'customer-1' },
    packId: 'pack-first-aid',
    versionGrants: [
      {
        source: 'MEMBERSHIP',
        useRights: 'WHILE_MEMBERSHIP_ACTIVE',
        membershipId: 'membership-1',
        packVersion: '1.0.0',
        grantedAt: '2026-08-01T12:00:00.000Z',
        state: 'ACTIVE',
      },
    ],
  }
  const membership: MembershipEntitlement = {
    membershipId: 'membership-1',
    subject: { customerId: 'customer-1' },
    state: 'ACTIVE',
    validFrom: '2026-08-01T00:00:00.000Z',
    validUntil: '2026-09-01T00:00:00.000Z',
  }

  assert.equal(
    evaluateInstalledKnowledgePackUse({
      requestingSubject,
      installed: installedPack,
      entitlement: membershipEntitlement,
      membership,
      evaluatedAt: '2026-08-11T12:00:00.000Z',
    }).allowed,
    true
  )
  membership.state = 'EXPIRED'
  assert.deepEqual(
    evaluateInstalledKnowledgePackUse({
      requestingSubject,
      installed: installedPack,
      entitlement: membershipEntitlement,
      membership,
      evaluatedAt: '2026-08-11T12:00:00.000Z',
    }),
    { allowed: false, reason: 'MEMBERSHIP_INACTIVE' }
  )
})

test('requires explicit refund, fraud, or security revocation for a purchased version', () => {
  const revoked: KnowledgePackEntitlement = {
    ...purchasedEntitlement,
    versionGrants: [
      {
        ...purchasedEntitlement.versionGrants[0],
        state: 'REVOKED',
        revokedAt: '2026-08-10T00:00:00.000Z',
        revocationReason: 'REFUND',
      },
    ],
  }

  assert.deepEqual(
    evaluateInstalledKnowledgePackUse({
      requestingSubject,
      installed: installedPack,
      entitlement: revoked,
      membership: null,
      evaluatedAt: '2026-08-11T12:00:00.000Z',
    }),
    { allowed: false, reason: 'EXPLICIT_REVOCATION', revocationReason: 'REFUND' }
  )
})

test('models perpetual offline claims without an expiry and expiring membership claims', () => {
  const perpetualClaims: OfflineKnowledgePackGrantClaims = {
    schemaVersion: 'watchman.offline-pack-grant/v1',
    grantId: 'offline-1',
    entitlementId: 'entitlement-purchase-1',
    subject: { customerId: 'customer-1' },
    packId: 'pack-first-aid',
    packVersion: '1.0.0',
    issuedAt: '2026-08-11T12:00:00.000Z',
    source: 'PURCHASE',
    useRights: 'PERPETUAL',
    expiresAt: null,
  }
  assert.doesNotThrow(() => assertOfflineKnowledgePackGrantClaimSemantics(perpetualClaims))

  const membershipClaims: OfflineKnowledgePackGrantClaims = {
    ...perpetualClaims,
    source: 'MEMBERSHIP',
    useRights: 'WHILE_MEMBERSHIP_ACTIVE',
    membershipId: 'membership-1',
    expiresAt: '2026-08-12T12:00:00.000Z',
  }
  assert.doesNotThrow(() => assertOfflineKnowledgePackGrantClaimSemantics(membershipClaims))
})

test('accepts only short-lived, current, uniquely scoped acquisition grants', () => {
  const grant: KnowledgePackAcquisitionGrant = {
    schemaVersion: 'watchman.pack-acquisition-grant/v1',
    grantId: 'acquisition-1',
    entitlementId: 'entitlement-purchase-1',
    subject: { customerId: 'customer-1' },
    packId: 'pack-first-aid',
    packVersion: '1.0.0',
    issuedAt: '2026-08-11T12:00:00.000Z',
    expiresAt: '2026-08-11T12:10:00.000Z',
    artifactAuthorizations: [
      { artifactId: 'artifact-zim-1', rangeRequestsAllowed: true },
      { artifactId: 'artifact-map-1', rangeRequestsAllowed: true },
    ],
    auditEventId: 'audit-acquisition-1',
  }
  assert.doesNotThrow(() =>
    assertShortLivedKnowledgePackAcquisitionGrant(grant, '2026-08-11T12:05:00.000Z')
  )
  assert.throws(() =>
    assertShortLivedKnowledgePackAcquisitionGrant(
      { ...grant, expiresAt: '2026-08-11T12:16:00.000Z' },
      '2026-08-11T12:05:00.000Z'
    )
  )
  assert.throws(() =>
    assertShortLivedKnowledgePackAcquisitionGrant(
      {
        ...grant,
        artifactAuthorizations: [
          { artifactId: 'artifact-zim-1', rangeRequestsAllowed: true },
          { artifactId: 'artifact-zim-1', rangeRequestsAllowed: false },
        ],
      },
      '2026-08-11T12:05:00.000Z'
    )
  )
})
