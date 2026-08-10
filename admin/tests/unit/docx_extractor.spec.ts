import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import JSZip from 'jszip'
import {
  DocxExtractionError,
  extractDocxText,
  MAX_DOCX_BYTES,
} from '../../app/utils/docx_extractor.js'
import { determineFileType } from '../../app/utils/fs.js'

async function makeDocx(documentBody: string): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${documentBody}</w:body></w:document>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('safe DOCX extraction', () => {
  it('classifies DOCX separately from raw text and extracts paragraph content', async () => {
    assert.equal(determineFileType('FIELD-GUIDE.DOCX'), 'docx')
    const file = await makeDocx(
      '<w:p><w:r><w:t>Watchman field guide</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p>'
    )
    const text = await extractDocxText(file)
    assert.match(text, /Watchman field guide/)
    assert.match(text, /Second paragraph/)
    assert.doesNotMatch(text, /<w:/)
  })

  it('rejects empty, oversized, corrupt, and password-protected containers', async () => {
    await assert.rejects(extractDocxText(Buffer.alloc(0)), DocxExtractionError)
    await assert.rejects(extractDocxText(Buffer.alloc(MAX_DOCX_BYTES + 1)), /exceeds the 25 MiB/)
    await assert.rejects(extractDocxText(Buffer.from('PK-not-a-zip')), /corrupt or unsupported/)
    await assert.rejects(
      extractDocxText(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])),
      /Password-protected/
    )
  })

  it('rejects a structurally valid but text-empty DOCX', async () => {
    const file = await makeDocx('<w:p><w:r><w:t></w:t></w:r></w:p>')
    await assert.rejects(extractDocxText(file), /no extractable text/)
  })
})
