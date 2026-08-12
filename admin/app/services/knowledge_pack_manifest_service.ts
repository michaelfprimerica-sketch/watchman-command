import { createHash } from 'node:crypto'

import canonicalize from 'canonicalize'
import semver from 'semver'

import type {
  KnowledgePackArtifactManifestEntry,
  KnowledgePackManifestV1,
  KnowledgePackServiceArea,
  KnowledgePackSourceReference,
} from '../../types/knowledge_packs.js'
import {
  KNOWLEDGE_PACK_CONTENT_FORMATS,
  KNOWLEDGE_PACK_SERVICE_AREA_TYPES,
} from '../../types/knowledge_packs.js'
import {
  KNOWLEDGE_PACK_CANONICALIZATION,
  KNOWLEDGE_PACK_SIGNATURE_ALGORITHM,
  KNOWLEDGE_PACK_SIGNATURE_ENCODING,
  type SignedKnowledgePackManifestV1,
  type SignedKnowledgePackPayloadV1,
  unsignedKnowledgePackManifest,
} from '../../types/knowledge_pack_manifests.js'
import {
  assertKnowledgePackCategory,
  assertKnowledgePackIdentifier,
  assertKnowledgePackOwnership,
  assertKnowledgePackServiceArea,
  assertSafeKnowledgePackArtifactPath,
  knowledgePackServiceAreaKey,
} from '../utils/knowledge_pack_governance.js'

export const KNOWLEDGE_PACK_MANIFEST_SCHEMA_V1 = 'watchman.knowledge-pack/v1' as const
export const KNOWLEDGE_PACK_MANIFEST_MAX_BYTES = 256 * 1024
export const KNOWLEDGE_PACK_MAX_ARTIFACTS = 64
export const KNOWLEDGE_PACK_MAX_ASSOCIATIONS = 256
export const KNOWLEDGE_PACK_MAX_ARTIFACT_BYTES = 256 * 1024 * 1024 * 1024
export const KNOWLEDGE_PACK_MAX_TOTAL_ARTIFACT_BYTES = 512 * 1024 * 1024 * 1024

const MAX_JSON_DEPTH = 32
const MAX_JSON_NODES = 50_000
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/
const SAFE_ARTIFACT_COMPONENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const WINDOWS_RESERVED_COMPONENT_PATTERN = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i
const MIME_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

type JsonRecord = Record<string, unknown>

export class KnowledgePackManifestError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_ENCODING'
      | 'INVALID_JSON'
      | 'NON_CANONICAL_JSON'
      | 'MANIFEST_TOO_LARGE'
      | 'INVALID_SCHEMA'
  ) {
    super(message)
    this.name = 'KnowledgePackManifestError'
  }
}

function schemaError(message: string): never {
  throw new KnowledgePackManifestError(message, 'INVALID_SCHEMA')
}

function hasOwn(value: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function assertRecord(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = []
): asserts value is JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    schemaError(`${label} must be an object`)
  }
  const record = value as JsonRecord
  const prototype = Object.getPrototypeOf(record)
  if (prototype !== Object.prototype && prototype !== null) {
    schemaError(`${label} must be a plain JSON object`)
  }

  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) schemaError(`${label} contains unknown field ${key}`)
  }
  for (const key of required) {
    if (!hasOwn(record, key)) schemaError(`${label} is missing ${key}`)
  }
}

function assertString(
  value: unknown,
  label: string,
  maxBytes: number,
  options: { allowEmpty?: boolean; allowNewlines?: boolean } = {}
): asserts value is string {
  const containsDisallowedControl =
    typeof value === 'string' &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a) || codePoint === 0x7f
    })
  if (
    typeof value !== 'string' ||
    (!options.allowEmpty && value.length === 0) ||
    Buffer.byteLength(value, 'utf8') > maxBytes ||
    containsDisallowedControl ||
    (!options.allowNewlines && /[\r\n]/u.test(value))
  ) {
    schemaError(`${label} is invalid`)
  }
}

function assertNullableString(
  value: unknown,
  label: string,
  maxBytes: number,
  options: { allowNewlines?: boolean } = {}
): asserts value is string | null {
  if (value === null) return
  assertString(value, label, maxBytes, options)
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) schemaError(`${label} contains duplicates`)
}

function assertNoArtifactPrefixCollisions(paths: readonly string[]): void {
  const normalized = new Set(paths.map((path) => path.toLowerCase()))
  for (const path of normalized) {
    const parts = path.split('/')
    for (let length = 1; length < parts.length; length += 1) {
      if (normalized.has(parts.slice(0, length).join('/'))) {
        schemaError('Artifact paths contain a file/directory prefix collision')
      }
    }
  }
}

function assertRealDate(parts: readonly number[], label: string): void {
  const [year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0] = parts
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, millisecond)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    schemaError(`${label} is invalid`)
  }
}

function assertRfc3339(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') schemaError(`${label} is invalid`)
  const match = RFC3339_PATTERN.exec(value)
  if (!match) schemaError(`${label} must be a UTC RFC 3339 timestamp`)
  const milliseconds = Number((match[7] ?? '').padEnd(3, '0'))
  assertRealDate(
    [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
      milliseconds,
    ],
    label
  )
}

function assertDate(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') schemaError(`${label} is invalid`)
  const match = DATE_PATTERN.exec(value)
  if (!match) schemaError(`${label} must use YYYY-MM-DD`)
  assertRealDate([Number(match[1]), Number(match[2]), Number(match[3])], label)
}

function assertStrictSemver(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length > 64 || semver.valid(value) !== value) {
    schemaError(`${label} must be a strict semantic version`)
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length > KNOWLEDGE_PACK_MAX_ASSOCIATIONS) {
    schemaError(`${label} is invalid`)
  }
  for (const entry of value) {
    if (typeof entry !== 'string') schemaError(`${label} contains a non-string value`)
  }
}

function assertArtifactPath(path: string): void {
  try {
    assertSafeKnowledgePackArtifactPath(path)
  } catch {
    schemaError('Knowledge Pack artifact path is unsafe')
  }
  const components = path.split('/')
  if (
    Buffer.byteLength(path, 'utf8') > 512 ||
    components.length > 32 ||
    components.some(
      (component) =>
        !SAFE_ARTIFACT_COMPONENT_PATTERN.test(component) ||
        component.endsWith('.') ||
        WINDOWS_RESERVED_COMPONENT_PATTERN.test(component)
    )
  ) {
    schemaError('Knowledge Pack artifact path must use bounded portable ASCII components')
  }
}

function assertArtifact(
  value: unknown,
  index: number
): asserts value is KnowledgePackArtifactManifestEntry {
  const label = `Artifact ${index}`
  assertRecord(value, label, ['id', 'path', 'contentType', 'sizeBytes', 'sha256'], ['compression'])
  try {
    assertKnowledgePackIdentifier(value.id as string, `${label} ID`)
  } catch {
    schemaError(`${label} ID is invalid`)
  }
  if (typeof value.path !== 'string') schemaError(`${label} path is invalid`)
  assertArtifactPath(value.path)
  assertString(value.contentType, `${label} content type`, 255)
  if (!MIME_TYPE_PATTERN.test(value.contentType)) schemaError(`${label} content type is invalid`)
  if (
    !Number.isSafeInteger(value.sizeBytes) ||
    (value.sizeBytes as number) < 0 ||
    (value.sizeBytes as number) > KNOWLEDGE_PACK_MAX_ARTIFACT_BYTES
  ) {
    schemaError(`${label} byte size is invalid`)
  }
  if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
    schemaError(`${label} SHA-256 is invalid`)
  }
  if (hasOwn(value, 'compression')) {
    assertNullableString(value.compression, `${label} compression`, 64)
    if (value.compression !== null && !TOKEN_PATTERN.test(value.compression)) {
      schemaError(`${label} compression is invalid`)
    }
  }
}

function assertServiceArea(
  value: unknown,
  index: number
): asserts value is KnowledgePackServiceArea {
  const label = `Service area ${index}`
  assertRecord(
    value,
    label,
    ['type', 'countryCode'],
    ['stateCode', 'postalCode', 'serviceAreaId', 'label']
  )
  if (
    typeof value.type !== 'string' ||
    !KNOWLEDGE_PACK_SERVICE_AREA_TYPES.includes(
      value.type as (typeof KNOWLEDGE_PACK_SERVICE_AREA_TYPES)[number]
    )
  ) {
    schemaError(`${label} type is invalid`)
  }
  assertString(value.countryCode, `${label} country code`, 2)
  for (const [field, maxBytes] of [
    ['stateCode', 32],
    ['postalCode', 20],
    ['serviceAreaId', 128],
    ['label', 255],
  ] as const) {
    if (hasOwn(value, field)) assertNullableString(value[field], `${label} ${field}`, maxBytes)
  }
  try {
    assertKnowledgePackServiceArea(value as unknown as KnowledgePackServiceArea)
  } catch (error) {
    schemaError(error instanceof Error ? error.message : `${label} is invalid`)
  }
}

function assertSource(
  value: unknown,
  index: number
): asserts value is KnowledgePackSourceReference {
  const label = `Source ${index}`
  assertRecord(
    value,
    label,
    ['id', 'authority', 'title'],
    ['url', 'checkedDate', 'provenanceNotes', 'rightsMetadata']
  )
  try {
    assertKnowledgePackIdentifier(value.id as string, `${label} ID`)
  } catch {
    schemaError(`${label} ID is invalid`)
  }
  assertString(value.authority, `${label} authority`, 255)
  assertString(value.title, `${label} title`, 512)
  if (hasOwn(value, 'url')) {
    assertNullableString(value.url, `${label} URL`, 2048)
    if (value.url !== null) {
      let parsed: URL
      try {
        parsed = new URL(value.url)
      } catch {
        schemaError(`${label} URL is invalid`)
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) {
        schemaError(`${label} URL must be HTTPS and contain no credentials`)
      }
    }
  }
  if (hasOwn(value, 'checkedDate')) {
    if (value.checkedDate !== null) assertDate(value.checkedDate, `${label} checked date`)
  }
  if (hasOwn(value, 'provenanceNotes')) {
    assertNullableString(value.provenanceNotes, `${label} provenance notes`, 20_000, {
      allowNewlines: true,
    })
  }
  if (hasOwn(value, 'rightsMetadata')) {
    assertNullableString(value.rightsMetadata, `${label} rights metadata`, 20_000, {
      allowNewlines: true,
    })
  }
}

function assertNoAmbiguousJsonValues(value: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  const seen = new WeakSet<object>()
  let nodes = 0

  while (stack.length) {
    const current = stack.pop()!
    nodes += 1
    if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) {
      schemaError('Manifest JSON exceeds structural limits')
    }
    if (typeof current.value === 'string') {
      for (let index = 0; index < current.value.length; index += 1) {
        const code = current.value.charCodeAt(index)
        if (code >= 0xd800 && code <= 0xdbff) {
          const following = current.value.charCodeAt(index + 1)
          if (following < 0xdc00 || following > 0xdfff) {
            schemaError('Manifest contains an unpaired Unicode surrogate')
          }
          index += 1
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          schemaError('Manifest contains an unpaired Unicode surrogate')
        }
      }
      continue
    }
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value) || !Number.isSafeInteger(current.value)) {
        schemaError('Manifest numbers must be finite safe integers')
      }
      if (Object.is(current.value, -0)) schemaError('Manifest cannot contain negative zero')
      continue
    }
    if (current.value === null || typeof current.value === 'boolean') continue
    if (typeof current.value !== 'object') schemaError('Manifest contains a non-JSON value')
    if (seen.has(current.value)) schemaError('Manifest cannot contain circular references')
    seen.add(current.value)

    if (Array.isArray(current.value)) {
      for (const entry of current.value) stack.push({ value: entry, depth: current.depth + 1 })
      continue
    }
    const prototype = Object.getPrototypeOf(current.value)
    if (prototype !== Object.prototype && prototype !== null) {
      schemaError('Manifest must contain only plain JSON objects')
    }
    for (const [key, entry] of Object.entries(current.value as JsonRecord)) {
      stack.push({ value: key, depth: current.depth + 1 })
      stack.push({ value: entry, depth: current.depth + 1 })
    }
  }
}

export function assertKnowledgePackManifestV1(
  value: unknown
): asserts value is KnowledgePackManifestV1 {
  assertNoAmbiguousJsonValues(value)
  assertRecord(
    value,
    'Knowledge Pack manifest',
    [
      'schemaVersion',
      'packId',
      'packVersion',
      'title',
      'category',
      'owner',
      'missionIds',
      'serviceAreas',
      'contentFormat',
      'artifacts',
      'minimumWatchmanVersion',
      'publishedAt',
      'sources',
    ],
    ['summary', 'releaseNotes']
  )
  if (value.schemaVersion !== KNOWLEDGE_PACK_MANIFEST_SCHEMA_V1) {
    schemaError('Unsupported Knowledge Pack manifest schema version')
  }
  try {
    assertKnowledgePackIdentifier(value.packId as string, 'Pack ID')
  } catch {
    schemaError('Pack ID is invalid')
  }
  if ((value.packId as string).length > 36) schemaError('Pack ID is too long')
  assertStrictSemver(value.packVersion, 'Pack version')
  assertString(value.title, 'Pack title', 255)
  try {
    assertKnowledgePackCategory(value.category as string)
  } catch {
    schemaError('Pack category is invalid')
  }
  if (hasOwn(value, 'summary')) {
    assertNullableString(value.summary, 'Pack summary', 10_000, { allowNewlines: true })
  }

  assertRecord(value.owner, 'Pack owner', ['ownerType', 'creatorId'])
  if (
    value.owner.ownerType !== 'VIGILANT_WATCHMAN' &&
    value.owner.ownerType !== 'AUTHORIZED_WATCHMAN_CREATOR'
  ) {
    schemaError('Pack owner type is invalid')
  }
  try {
    assertKnowledgePackOwnership(value.owner as never)
  } catch (error) {
    schemaError(error instanceof Error ? error.message : 'Pack owner is invalid')
  }

  assertStringArray(value.missionIds, 'Mission IDs')
  for (const missionId of value.missionIds) {
    try {
      assertKnowledgePackIdentifier(missionId, 'Mission ID')
    } catch {
      schemaError('Mission ID is invalid')
    }
  }
  assertUnique(value.missionIds, 'Mission IDs')

  if (
    !Array.isArray(value.serviceAreas) ||
    value.serviceAreas.length > KNOWLEDGE_PACK_MAX_ASSOCIATIONS
  ) {
    schemaError('Service areas are invalid')
  }
  value.serviceAreas.forEach(assertServiceArea)
  assertUnique(value.serviceAreas.map(knowledgePackServiceAreaKey), 'Service areas')

  if (
    typeof value.contentFormat !== 'string' ||
    !KNOWLEDGE_PACK_CONTENT_FORMATS.includes(
      value.contentFormat as (typeof KNOWLEDGE_PACK_CONTENT_FORMATS)[number]
    )
  ) {
    schemaError('Knowledge Pack content format is invalid')
  }

  if (
    !Array.isArray(value.artifacts) ||
    value.artifacts.length === 0 ||
    value.artifacts.length > KNOWLEDGE_PACK_MAX_ARTIFACTS
  ) {
    schemaError('Artifact list is invalid')
  }
  value.artifacts.forEach(assertArtifact)
  assertUnique(
    value.artifacts.map((artifact) => artifact.id),
    'Artifact IDs'
  )
  assertUnique(
    value.artifacts.map((artifact) => artifact.path),
    'Artifact paths'
  )
  assertUnique(
    value.artifacts.map((artifact) => artifact.path.toLowerCase()),
    'Case-insensitive artifact paths'
  )
  assertNoArtifactPrefixCollisions(value.artifacts.map((artifact) => artifact.path))
  const totalBytes = value.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0)
  if (!Number.isSafeInteger(totalBytes) || totalBytes > KNOWLEDGE_PACK_MAX_TOTAL_ARTIFACT_BYTES) {
    schemaError('Aggregate artifact size is invalid')
  }

  assertStrictSemver(value.minimumWatchmanVersion, 'Minimum Watchman version')
  assertRfc3339(value.publishedAt, 'Published timestamp')
  if (hasOwn(value, 'releaseNotes')) {
    assertNullableString(value.releaseNotes, 'Release notes', 20_000, { allowNewlines: true })
  }

  if (!Array.isArray(value.sources) || value.sources.length > KNOWLEDGE_PACK_MAX_ASSOCIATIONS) {
    schemaError('Source list is invalid')
  }
  value.sources.forEach(assertSource)
  assertUnique(
    value.sources.map((source) => source.id),
    'Source IDs'
  )
}

export function assertSignedKnowledgePackPayloadV1(
  value: unknown
): asserts value is SignedKnowledgePackPayloadV1 {
  assertNoAmbiguousJsonValues(value)
  assertRecord(
    value,
    'Signed Knowledge Pack payload',
    [
      'schemaVersion',
      'packId',
      'packVersion',
      'title',
      'category',
      'owner',
      'missionIds',
      'serviceAreas',
      'contentFormat',
      'artifacts',
      'minimumWatchmanVersion',
      'publishedAt',
      'sources',
      'signatureMetadata',
    ],
    ['summary', 'releaseNotes']
  )
  assertKnowledgePackManifestV1(
    unsignedKnowledgePackManifest(value as SignedKnowledgePackPayloadV1)
  )
  assertRecord(value.signatureMetadata, 'Manifest signature metadata', [
    'algorithm',
    'canonicalization',
    'encoding',
    'keyId',
  ])
  if (value.signatureMetadata.algorithm !== KNOWLEDGE_PACK_SIGNATURE_ALGORITHM) {
    schemaError('Only Ed25519 Knowledge Pack signatures are supported')
  }
  if (value.signatureMetadata.canonicalization !== KNOWLEDGE_PACK_CANONICALIZATION) {
    schemaError('Only RFC 8785 Knowledge Pack canonicalization is supported')
  }
  if (value.signatureMetadata.encoding !== KNOWLEDGE_PACK_SIGNATURE_ENCODING) {
    schemaError('Only base64url Knowledge Pack signatures are supported')
  }
  try {
    assertKnowledgePackIdentifier(value.signatureMetadata.keyId as string, 'Signing key ID')
  } catch {
    schemaError('Signing key ID is invalid')
  }
}

export function assertSignedKnowledgePackManifest(
  value: unknown
): asserts value is SignedKnowledgePackManifestV1 {
  assertNoAmbiguousJsonValues(value)
  assertRecord(value, 'Signed Knowledge Pack manifest', ['signed', 'signature'])
  assertSignedKnowledgePackPayloadV1(value.signed)
  if (typeof value.signature !== 'string' || !SIGNATURE_PATTERN.test(value.signature)) {
    schemaError('Manifest signature must be an unpadded base64url Ed25519 signature')
  }
  const signature = Buffer.from(value.signature, 'base64url')
  if (signature.length !== 64 || signature.toString('base64url') !== value.signature) {
    schemaError('Manifest signature encoding is invalid')
  }
}

function canonicalBytes(value: unknown): Buffer {
  const serialized = canonicalize(value)
  if (serialized === undefined) schemaError('Manifest cannot be canonicalized')
  return Buffer.from(serialized, 'utf8')
}

function assertManifestSize(bytes: Buffer): Buffer {
  if (bytes.length > KNOWLEDGE_PACK_MANIFEST_MAX_BYTES) {
    throw new KnowledgePackManifestError(
      `Manifest exceeds ${KNOWLEDGE_PACK_MANIFEST_MAX_BYTES} bytes`,
      'MANIFEST_TOO_LARGE'
    )
  }
  return bytes
}

function decodeManifestBytes(input: string | Uint8Array): { bytes: Buffer; text: string } {
  if (typeof input === 'string') {
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index)
      if (code >= 0xd800 && code <= 0xdbff) {
        const following = input.charCodeAt(index + 1)
        if (following < 0xdc00 || following > 0xdfff) {
          throw new KnowledgePackManifestError(
            'Manifest contains an unpaired Unicode surrogate',
            'INVALID_ENCODING'
          )
        }
        index += 1
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new KnowledgePackManifestError(
          'Manifest contains an unpaired Unicode surrogate',
          'INVALID_ENCODING'
        )
      }
    }
  }
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input)
  if (bytes.length === 0) {
    throw new KnowledgePackManifestError('Manifest is empty', 'INVALID_JSON')
  }
  if (bytes.length > KNOWLEDGE_PACK_MANIFEST_MAX_BYTES) {
    throw new KnowledgePackManifestError(
      `Manifest exceeds ${KNOWLEDGE_PACK_MANIFEST_MAX_BYTES} bytes`,
      'MANIFEST_TOO_LARGE'
    )
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new KnowledgePackManifestError(
      'Manifest must not contain a UTF-8 BOM',
      'INVALID_ENCODING'
    )
  }

  try {
    return { bytes, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    throw new KnowledgePackManifestError('Manifest is not valid UTF-8', 'INVALID_ENCODING')
  }
}

export class KnowledgePackManifestService {
  canonicalManifestBytes(manifest: KnowledgePackManifestV1): Buffer {
    assertKnowledgePackManifestV1(manifest)
    return canonicalBytes(manifest)
  }

  canonicalSignedPayloadBytes(payload: SignedKnowledgePackPayloadV1): Buffer {
    assertSignedKnowledgePackPayloadV1(payload)
    return canonicalBytes(payload)
  }

  canonicalSignedManifestBytes(envelope: SignedKnowledgePackManifestV1): Buffer {
    assertSignedKnowledgePackManifest(envelope)
    return assertManifestSize(canonicalBytes(envelope))
  }

  serializeSignedManifest(envelope: SignedKnowledgePackManifestV1): string {
    return this.canonicalSignedManifestBytes(envelope).toString('utf8')
  }

  parseSignedManifest(input: string | Uint8Array): SignedKnowledgePackManifestV1 {
    const { bytes, text } = decodeManifestBytes(input)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new KnowledgePackManifestError('Manifest is not valid JSON', 'INVALID_JSON')
    }
    assertSignedKnowledgePackManifest(parsed)
    const canonical = canonicalBytes(parsed)
    if (!bytes.equals(canonical)) {
      throw new KnowledgePackManifestError(
        'Manifest JSON is not the required RFC 8785 canonical representation',
        'NON_CANONICAL_JSON'
      )
    }
    return parsed
  }

  signedManifestSha256(input: SignedKnowledgePackManifestV1 | string | Uint8Array): string {
    const bytes =
      typeof input === 'string' || input instanceof Uint8Array
        ? this.canonicalSignedManifestBytes(this.parseSignedManifest(input))
        : this.canonicalSignedManifestBytes(input)
    return createHash('sha256').update(bytes).digest('hex')
  }
}
