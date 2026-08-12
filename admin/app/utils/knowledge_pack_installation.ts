import type {
  PromotedKnowledgePackArtifact,
  RecordPromotedKnowledgePackReleaseInput,
} from '../../types/knowledge_pack_installation.js'
import { KNOWLEDGE_PACK_INSTALLATION_SOURCES } from '../../types/knowledge_pack_installation.js'
import {
  assertKnowledgePackIdentifier,
  assertKnowledgePackVersion,
  assertSafeKnowledgePackArtifactPath,
} from './knowledge_pack_governance.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_ARTIFACTS_PER_RELEASE = 256

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${label} is invalid`)
}

function assertArtifact(artifact: PromotedKnowledgePackArtifact): void {
  assertKnowledgePackIdentifier(artifact.artifactId, 'Artifact ID')
  assertSafeKnowledgePackArtifactPath(artifact.path)
  if (!artifact.contentType.trim() || artifact.contentType.length > 255) {
    throw new Error('Artifact content type is invalid')
  }
  if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0) {
    throw new Error('Artifact size is invalid')
  }
  assertSha256(artifact.sha256, 'Artifact SHA-256')
}

export function assertPromotedKnowledgePackRelease(
  input: RecordPromotedKnowledgePackReleaseInput
): void {
  assertKnowledgePackIdentifier(input.packId, 'Pack ID')
  if (input.packId.length > 36) throw new Error('Pack ID is too long')
  assertKnowledgePackVersion(input.packVersion)
  assertKnowledgePackIdentifier(input.signingKeyId, 'Signing key ID')
  if (!KNOWLEDGE_PACK_INSTALLATION_SOURCES.includes(input.source)) {
    throw new Error('Installation source is invalid')
  }
  assertSha256(input.manifestSha256, 'Manifest SHA-256')

  if (input.artifacts.length === 0 || input.artifacts.length > MAX_ARTIFACTS_PER_RELEASE) {
    throw new Error('Installed release must contain between 1 and 256 artifacts')
  }
  input.artifacts.forEach(assertArtifact)

  const artifactIds = input.artifacts.map((artifact) => artifact.artifactId)
  if (new Set(artifactIds).size !== artifactIds.length) {
    throw new Error('Installed release contains duplicate artifact IDs')
  }
  const artifactPaths = input.artifacts.map((artifact) => artifact.path)
  if (new Set(artifactPaths).size !== artifactPaths.length) {
    throw new Error('Installed release contains duplicate artifact paths')
  }
}
