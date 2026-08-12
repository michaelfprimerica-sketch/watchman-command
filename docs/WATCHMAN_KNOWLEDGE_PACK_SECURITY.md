# Watchman Knowledge Pack security boundary

Phase 4 establishes the signed-content and safe-install foundation. It does not expose a public
marketplace, implement customer licensing, select an entitlement vendor, or provide a production
signing-key store.

## Signing and trust

Knowledge Pack manifests use RFC 8785 canonical JSON and Ed25519 signatures. The algorithm,
canonicalization identifier, encoding, and key ID are inside the signed payload. Watchman clients
accept only locally configured trusted Ed25519 public keys. They never accept a verification key
from a manifest or download server.

Private signing keys belong only in Vigilant Watchman server-side signing infrastructure. No private
key, private-key loader, shared signing secret, or signing environment variable may ship in the
Watchman Command client image or customer runtime storage. The Phase 4 signing adapter accepts an
already provisioned in-memory key so tests and future external signing infrastructure can implement
the interface; it does not load or persist one.

Public-key rotation retains old trusted verification keys for previously purchased pack versions.
Ordinary membership expiration must not remove the ability to verify or use an installed perpetual
pack. Compromised-key response and explicit security revocation policy remain a controlled Phase 5
design task.

## Manifest and artifact acceptance

The parser limits manifest size and structure, requires canonical on-disk bytes, rejects malformed
UTF-8, duplicate/escaped duplicate keys, unknown fields, unsafe integer encodings, ambiguous Unicode,
unsafe paths, lax semantic versions, non-HTTPS source URLs, and algorithm substitution. A persisted
manifest is bound to the exact version, ownership, Mission associations, structured geography,
artifacts, hashes, compatibility version, and provenance snapshot in the private registry.

Artifact verification requires the exact declared file set. Sources are opened without following
symlinks and copied into a service-owned private installation stage while the same open descriptor is
hashed and byte-counted. Archives remain opaque signed artifacts: Phase 4 never extracts ZIP, TAR,
ZIM, model, or dataset content.

Filesystem promotion precedes installed-registry advancement. Therefore a database failure can leave
a complete, immutable, unregistered orphan for later reconciliation, but the registry never points at
partial content and the previous installed version remains intact.

## Deferred controlled-lab validation

Before a public production rollout, validate the additive migrations against disposable MySQL 8 on
the supported deployment architecture, including enforced checks, foreign keys, uniqueness,
concurrent publication/install attempts, populated-history rollback refusal, and idempotency. Also
exercise crash/power-loss durability and directory `fsync`/atomic-rename behavior on every supported
mounted filesystem and CPU architecture. These tests must never target a customer database or live
content volume.
