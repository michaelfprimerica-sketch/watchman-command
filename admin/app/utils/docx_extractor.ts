import mammoth from 'mammoth'

export const MAX_DOCX_BYTES = 25 * 1024 * 1024

export class DocxExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocxExtractionError'
  }
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
