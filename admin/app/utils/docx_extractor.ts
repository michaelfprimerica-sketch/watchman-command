import mammoth from 'mammoth'

export const MAX_DOCX_BYTES = 25 * 1024 * 1024
export const MAX_DOCX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
const MAX_DOCX_ENTRIES = 10_000

export class DocxExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocxExtractionError'
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 65_557)
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

/** Validate ZIP metadata without inflating any entry. */
export function validateDocxArchive(fileBuffer: Buffer): void {
  const endOffset = findEndOfCentralDirectory(fileBuffer)
  if (endOffset < 0) throw new DocxExtractionError('DOCX central directory is missing.')

  const entryCount = fileBuffer.readUInt16LE(endOffset + 10)
  const centralSize = fileBuffer.readUInt32LE(endOffset + 12)
  const centralOffset = fileBuffer.readUInt32LE(endOffset + 16)
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entryCount > MAX_DOCX_ENTRIES
  ) {
    throw new DocxExtractionError('DOCX ZIP64 or excessive-entry archives are not supported.')
  }
  if (centralOffset + centralSize > endOffset || centralOffset < 0) {
    throw new DocxExtractionError('DOCX central directory is invalid.')
  }

  let cursor = centralOffset
  let totalUncompressed = 0
  let hasDocumentXml = false
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > fileBuffer.length || fileBuffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new DocxExtractionError('DOCX central directory is corrupt.')
    }
    const flags = fileBuffer.readUInt16LE(cursor + 8)
    if ((flags & 0x1) !== 0) {
      throw new DocxExtractionError('Encrypted or password-protected DOCX files are not supported.')
    }
    const uncompressedSize = fileBuffer.readUInt32LE(cursor + 24)
    if (uncompressedSize === 0xffffffff) {
      throw new DocxExtractionError('DOCX ZIP64 archives are not supported.')
    }
    totalUncompressed += uncompressedSize
    if (totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES) {
      throw new DocxExtractionError('DOCX expanded content exceeds the 100 MiB safety limit.')
    }

    const nameLength = fileBuffer.readUInt16LE(cursor + 28)
    const extraLength = fileBuffer.readUInt16LE(cursor + 30)
    const commentLength = fileBuffer.readUInt16LE(cursor + 32)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (next > fileBuffer.length) throw new DocxExtractionError('DOCX entry metadata is corrupt.')
    const name = fileBuffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw new DocxExtractionError('DOCX contains an unsafe archive path.')
    }
    if (name === 'word/document.xml') hasDocumentXml = true
    cursor = next
  }

  if (!hasDocumentXml) throw new DocxExtractionError('DOCX main document content is missing.')
}

/** Extract bounded plain text only; no HTML rendering, scripts, or temp files. */
export async function extractDocxText(fileBuffer: Buffer): Promise<string> {
  if (fileBuffer.length === 0) throw new DocxExtractionError('DOCX file is empty.')
  if (fileBuffer.length > MAX_DOCX_BYTES) {
    throw new DocxExtractionError('DOCX file exceeds the 25 MiB extraction limit.')
  }

  // Password-protected Office documents use the OLE compound-file envelope,
  // not the normal PKZIP-based OOXML container Mammoth expects.
  if (fileBuffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    throw new DocxExtractionError('Password-protected DOCX files are not supported.')
  }
  if (!fileBuffer.subarray(0, 2).equals(Buffer.from('PK'))) {
    throw new DocxExtractionError('Invalid or unsupported DOCX container.')
  }
  validateDocxArchive(fileBuffer)

  try {
    const { value } = await mammoth.extractRawText({ buffer: fileBuffer })
    const text = value.replace(/\0/gu, '').trim()
    if (!text) throw new DocxExtractionError('DOCX file contains no extractable text.')
    return text
  } catch (error) {
    if (error instanceof DocxExtractionError) throw error
    throw new DocxExtractionError('DOCX file is corrupt or unsupported.')
  }
}
