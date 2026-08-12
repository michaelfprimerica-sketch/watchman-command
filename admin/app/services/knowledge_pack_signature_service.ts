import { type KeyObject, sign as ed25519Sign, verify as ed25519Verify } from 'node:crypto'

import type { KnowledgePackManifestV1 } from '../../types/knowledge_packs.js'
import {
  KNOWLEDGE_PACK_CANONICALIZATION,
  KNOWLEDGE_PACK_SIGNATURE_ALGORITHM,
  KNOWLEDGE_PACK_SIGNATURE_ENCODING,
  type SignedKnowledgePackManifestV1,
  type SignedKnowledgePackPayloadV1,
} from '../../types/knowledge_pack_manifests.js'
import { assertKnowledgePackIdentifier } from '../utils/knowledge_pack_governance.js'
import { KnowledgePackManifestService } from './knowledge_pack_manifest_service.js'

export const KNOWLEDGE_PACK_SIGNATURE_CONTEXT = Buffer.from(
  'WATCHMAN-KNOWLEDGE-PACK-MANIFEST\0v1\0',
  'ascii'
)

export interface KnowledgePackSigningProvider {
  readonly algorithm: typeof KNOWLEDGE_PACK_SIGNATURE_ALGORITHM
  readonly keyId: string
  sign(data: Uint8Array): Promise<Uint8Array>
}

export interface KnowledgePackVerificationProvider {
  readonly algorithm: typeof KNOWLEDGE_PACK_SIGNATURE_ALGORITHM
  hasTrustedKey(keyId: string): boolean
  verify(keyId: string, data: Uint8Array, signature: Uint8Array): Promise<boolean>
}

export type TrustedKnowledgePackPublicKey = {
  keyId: string
  publicKey: KeyObject
}

export class UnknownKnowledgePackSigningKeyError extends Error {
  constructor(readonly keyId: string) {
    super(`Knowledge Pack signing key ${keyId} is not trusted`)
    this.name = 'UnknownKnowledgePackSigningKeyError'
  }
}

function assertKeyId(keyId: string): void {
  try {
    assertKnowledgePackIdentifier(keyId, 'Signing key ID')
  } catch {
    throw new Error('Signing key ID is invalid')
  }
}

function assertEd25519Key(key: KeyObject, expectedType: 'private' | 'public'): void {
  if (key.type !== expectedType || key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`Knowledge Pack ${expectedType} key must be an Ed25519 ${expectedType} key`)
  }
}

export function knowledgePackManifestSigningBytes(
  signedPayload: SignedKnowledgePackPayloadV1,
  manifestService = new KnowledgePackManifestService()
): Buffer {
  return Buffer.concat([
    KNOWLEDGE_PACK_SIGNATURE_CONTEXT,
    manifestService.canonicalSignedPayloadBytes(signedPayload),
  ])
}

/**
 * Server-side/test signing adapter. It accepts an already-provisioned in-memory key and contains no
 * key loader, environment-variable lookup, or persistence behavior. Production private keys belong
 * exclusively in external server-side signing infrastructure and never in Watchman Command.
 */
export class Ed25519KnowledgePackSigningProvider implements KnowledgePackSigningProvider {
  readonly algorithm = KNOWLEDGE_PACK_SIGNATURE_ALGORITHM

  constructor(
    readonly keyId: string,
    private readonly privateKey: KeyObject
  ) {
    assertKeyId(keyId)
    assertEd25519Key(privateKey, 'private')
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    return ed25519Sign(null, Buffer.from(data), this.privateKey)
  }
}

/** Public-key-only provider intended for the Watchman client trust store. */
export class Ed25519KnowledgePackVerificationProvider implements KnowledgePackVerificationProvider {
  readonly algorithm = KNOWLEDGE_PACK_SIGNATURE_ALGORITHM
  private readonly keys = new Map<string, KeyObject>()

  constructor(keys: Iterable<TrustedKnowledgePackPublicKey>) {
    for (const trusted of keys) {
      assertKeyId(trusted.keyId)
      if (this.keys.has(trusted.keyId)) throw new Error(`Duplicate signing key ID ${trusted.keyId}`)
      assertEd25519Key(trusted.publicKey, 'public')
      this.keys.set(trusted.keyId, trusted.publicKey)
    }
  }

  hasTrustedKey(keyId: string): boolean {
    return this.keys.has(keyId)
  }

  async verify(keyId: string, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const publicKey = this.keys.get(keyId)
    if (!publicKey) throw new UnknownKnowledgePackSigningKeyError(keyId)
    return ed25519Verify(null, Buffer.from(data), publicKey, Buffer.from(signature))
  }
}

export class KnowledgePackSigningService {
  constructor(
    private readonly provider: KnowledgePackSigningProvider,
    private readonly manifestService = new KnowledgePackManifestService()
  ) {
    if (provider.algorithm !== KNOWLEDGE_PACK_SIGNATURE_ALGORITHM) {
      throw new Error('Only Ed25519 Knowledge Pack signing providers are supported')
    }
    assertKeyId(provider.keyId)
  }

  async signManifest(manifest: KnowledgePackManifestV1): Promise<SignedKnowledgePackManifestV1> {
    const signed: SignedKnowledgePackPayloadV1 = {
      ...manifest,
      signatureMetadata: {
        algorithm: KNOWLEDGE_PACK_SIGNATURE_ALGORITHM,
        canonicalization: KNOWLEDGE_PACK_CANONICALIZATION,
        encoding: KNOWLEDGE_PACK_SIGNATURE_ENCODING,
        keyId: this.provider.keyId,
      },
    }
    const signature = await this.provider.sign(
      knowledgePackManifestSigningBytes(signed, this.manifestService)
    )
    if (signature.byteLength !== 64)
      throw new Error('Ed25519 provider returned an invalid signature')

    const envelope: SignedKnowledgePackManifestV1 = {
      signed,
      signature: Buffer.from(signature).toString('base64url'),
    }
    this.manifestService.canonicalSignedManifestBytes(envelope)
    return envelope
  }
}
