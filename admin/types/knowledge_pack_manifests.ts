import type { KnowledgePackManifestV1 } from './knowledge_packs.js'

export const KNOWLEDGE_PACK_SIGNATURE_ALGORITHM = 'Ed25519' as const
export const KNOWLEDGE_PACK_CANONICALIZATION = 'RFC8785' as const
export const KNOWLEDGE_PACK_SIGNATURE_ENCODING = 'base64url' as const

export type KnowledgePackSignatureMetadataV1 = {
  algorithm: typeof KNOWLEDGE_PACK_SIGNATURE_ALGORITHM
  canonicalization: typeof KNOWLEDGE_PACK_CANONICALIZATION
  encoding: typeof KNOWLEDGE_PACK_SIGNATURE_ENCODING
  keyId: string
}

/** All security-relevant metadata lives inside this signed payload. */
export type SignedKnowledgePackPayloadV1 = KnowledgePackManifestV1 & {
  signatureMetadata: KnowledgePackSignatureMetadataV1
}

export type SignedKnowledgePackManifestV1 = {
  signed: SignedKnowledgePackPayloadV1
  signature: string
}

export function unsignedKnowledgePackManifest(
  signed: SignedKnowledgePackPayloadV1
): KnowledgePackManifestV1 {
  const { signatureMetadata, ...manifest } = signed
  void signatureMetadata
  return manifest
}
