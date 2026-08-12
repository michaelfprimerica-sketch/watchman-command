export const KNOWLEDGE_PACK_INSTALLATION_SOURCES = ['ACQUISITION', 'SIDELOAD', 'RESTORE'] as const

export type KnowledgePackInstallationSource = (typeof KNOWLEDGE_PACK_INSTALLATION_SOURCES)[number]

export type PromotedKnowledgePackArtifact = {
  artifactId: string
  path: string
  contentType: string
  sizeBytes: number
  sha256: string
}

/**
 * Metadata accepted only after an installer has atomically promoted a verified
 * staged release into its final local location.
 */
export type RecordPromotedKnowledgePackReleaseInput = {
  packId: string
  packVersion: string
  source: KnowledgePackInstallationSource
  manifestSha256: string
  signingKeyId: string
  artifacts: PromotedKnowledgePackArtifact[]
}

export type InstalledKnowledgePackRelease = {
  id: string
  packId: string
  packVersion: string
  source: KnowledgePackInstallationSource
  manifestSha256: string
  signingKeyId: string
  installStatus: 'INSTALLED'
  installedAt: string
  artifacts: PromotedKnowledgePackArtifact[]
}

export interface KnowledgePackInstallationRegistry {
  /**
   * Append immutable release metadata and advance the pack's current pointer
   * together in one database transaction.
   *
   * The caller must invoke this only after successful atomic filesystem
   * promotion. Verification or staging failures must never call this method.
   */
  recordPromotedRelease(
    input: RecordPromotedKnowledgePackReleaseInput
  ): Promise<InstalledKnowledgePackRelease>

  getCurrentRelease(packId: string): Promise<InstalledKnowledgePackRelease | null>

  listReleaseHistory(packId: string): Promise<InstalledKnowledgePackRelease[]>
}

/** Opaque, one-use handle for a service-created private acquisition directory. */
export type KnowledgePackStagingHandle = Readonly<{
  id: string
  artifactRoot: string
}>

export type InstallKnowledgePackInput = {
  staging: KnowledgePackStagingHandle
  signedManifest: string | Uint8Array
  source: KnowledgePackInstallationSource
}

export type InstallKnowledgePackResult = {
  release: InstalledKnowledgePackRelease
  releaseDirectory: string
}
