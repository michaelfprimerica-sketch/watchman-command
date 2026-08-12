import {
  KnowledgePackApprovalDecision,
  KnowledgePackApprovalStatus,
  KnowledgePackOwnership,
  KnowledgePackServiceArea,
} from '../../types/knowledge_packs.js'
import { posix } from 'node:path'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/
const STATE_CODE_PATTERN = /^[A-Z0-9-]{1,32}$/
const POSTAL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9 -]{0,19}$/

export const KNOWLEDGE_PACK_ALLOWED_TRANSITIONS: Readonly<
  Record<KnowledgePackApprovalStatus, readonly KnowledgePackApprovalStatus[]>
> = {
  DRAFT: ['PROPOSED'],
  PROPOSED: ['CREDENTIALS_REVIEW', 'REJECTED'],
  CREDENTIALS_REVIEW: ['CONTENT_REVIEW', 'REJECTED'],
  CONTENT_REVIEW: ['SAFETY_REVIEW', 'REJECTED'],
  SAFETY_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['PUBLISHED'],
  PUBLISHED: ['SUSPENDED', 'RETIRED'],
  SUSPENDED: ['PUBLISHED', 'RETIRED'],
  RETIRED: [],
  REJECTED: [],
}

export function assertKnowledgePackIdentifier(value: string, label: string): void {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

export function assertKnowledgePackSlug(value: string): void {
  if (typeof value !== 'string' || value.length > 160 || !SLUG_PATTERN.test(value)) {
    throw new Error('Pack slug is invalid')
  }
}

export function assertKnowledgePackCategory(value: string): void {
  if (typeof value !== 'string' || !CATEGORY_PATTERN.test(value)) {
    throw new Error('Pack category is invalid')
  }
}

export function assertKnowledgePackVersion(value: string, label = 'Pack version'): void {
  if (typeof value !== 'string' || value.length > 64 || !SEMVER_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

export function assertSafeKnowledgePackArtifactPath(value: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    posix.normalize(value) !== value ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error('Knowledge Pack artifact path is unsafe')
  }
}

export function assertKnowledgePackOwnership(ownership: KnowledgePackOwnership): void {
  if (ownership.ownerType === 'VIGILANT_WATCHMAN') {
    if (ownership.creatorId !== null) throw new Error('HQ packs cannot have a financial creator')
    return
  }
  assertKnowledgePackIdentifier(ownership.creatorId, 'Creator ID')
}

export function assertKnowledgePackServiceArea(area: KnowledgePackServiceArea): void {
  if (typeof area?.countryCode !== 'string' || !COUNTRY_CODE_PATTERN.test(area.countryCode)) {
    throw new Error('Country code is invalid')
  }

  if (area.type === 'NATIONAL') {
    if (area.stateCode || area.postalCode || area.serviceAreaId) {
      throw new Error('National areas cannot include state, ZIP, or service-area identifiers')
    }
    return
  }

  if (area.type === 'STATE') {
    if (!area.stateCode || !STATE_CODE_PATTERN.test(area.stateCode)) {
      throw new Error('State areas require a normalized state code')
    }
    if (area.postalCode || area.serviceAreaId) {
      throw new Error('State areas cannot include ZIP or service-area identifiers')
    }
    return
  }

  if (area.type === 'ZIP') {
    if (!area.postalCode || !POSTAL_CODE_PATTERN.test(area.postalCode)) {
      throw new Error('ZIP areas require a normalized postal code')
    }
    if (area.serviceAreaId) throw new Error('ZIP areas cannot include service-area identifiers')
    return
  }

  if (!area.serviceAreaId) throw new Error('Service areas require a stable identifier')
  assertKnowledgePackIdentifier(area.serviceAreaId, 'Service area ID')
}

export function knowledgePackServiceAreaKey(area: KnowledgePackServiceArea): string {
  assertKnowledgePackServiceArea(area)
  if (area.type === 'NATIONAL') return `NATIONAL:${area.countryCode}`
  if (area.type === 'STATE') return `STATE:${area.countryCode}:${area.stateCode}`
  if (area.type === 'ZIP') {
    return `ZIP:${area.countryCode}:${area.stateCode ?? ''}:${area.postalCode}`
  }
  return `SERVICE_AREA:${area.countryCode}:${area.serviceAreaId}`
}

export function assertKnowledgePackApprovalTransition(
  from: KnowledgePackApprovalStatus,
  to: KnowledgePackApprovalStatus
): KnowledgePackApprovalDecision {
  if (!KNOWLEDGE_PACK_ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`Knowledge Pack approval transition ${from} -> ${to} is not allowed`)
  }

  if (to === 'PROPOSED') return 'SUBMIT'
  if (to === 'APPROVED') return 'APPROVE'
  if (to === 'PUBLISHED') return 'PUBLISH'
  if (to === 'SUSPENDED') return 'SUSPEND'
  if (to === 'RETIRED') return 'RETIRE'
  if (to === 'REJECTED') return 'REJECT'
  return 'ADVANCE'
}

export function assertPublicationAllowed(status: KnowledgePackApprovalStatus): void {
  if (status !== 'APPROVED') throw new Error('Only an approved Knowledge Pack may be published')
}
