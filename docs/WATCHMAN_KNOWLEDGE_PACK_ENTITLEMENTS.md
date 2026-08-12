# Watchman Knowledge Pack entitlement boundary

Phase 4 defines a provider-neutral contract for future licensing work. It does not activate a
licensing vendor, customer account system, payment flow, download route, cloud-storage integration,
or runtime entitlement check.

## Independent domains

The software license, membership, Knowledge Pack entitlement, device seat, and financial ledger are
separate domains. They must not be collapsed into one license row or inferred from one another:

- A software license governs use of the Watchman Command application.
- Membership may govern eligibility for new packs, future versions, or updates.
- A Knowledge Pack entitlement records the exact pack versions and use rights granted to a customer.
- A device seat records device registration and does not establish ownership of software or content.
- The append-only financial ledger records money and historical terms; it never grants content
  access.

The TypeScript composition contract makes all five dependencies explicit so a future provider cannot
silently treat a membership row or a ledger transaction as pack ownership.

## Perpetual installed-pack use

A purchased pack-version grant is structurally `PERPETUAL`. Once that exact version has been safely
installed and its manifest signature and artifact hashes have been verified, the local-use policy
allows it without consulting membership state or an online service. Membership expiration or
cancellation may stop acquisition of future content and updates, but it must not brick a purchased
installed version.

Refund, fraud, and security actions are explicit pack-version revocation reasons. Ordinary membership
expiration is intentionally not one of them. A future implementation must audit explicit revocations
and must not synthesize one merely because membership is inactive.

## Future offline grants

The boundary reserves an Ed25519 signed offline-grant envelope. Purchase claims express perpetual
rights with no expiry; membership claims must expire. Phase 5 must define canonical claim
serialization, trusted public-key distribution, key rotation, clock policy, replay policy, and the
provider that verifies signatures. Only public verification keys may be present on customer devices;
private signing keys must remain outside shipped images and this repository.

The Phase 4 claim-semantic helper does not authenticate a grant. It only protects the perpetual versus
membership-expiring distinction while the signature verifier remains deferred.

## Short-lived acquisition placeholder

The optional acquisition boundary can later authorize specific artifacts for a pack/version and
record an audit event. Grants have a maximum 15-minute lifetime, carry explicit artifact IDs, and can
declare HTTP Range/resume support. The placeholder contains no download URL, storage credential, or
permanent bearer token. Issuance, authorization, signed URLs, storage, routes, and controllers remain
deferred.
