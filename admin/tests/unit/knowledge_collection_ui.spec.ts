import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { mergeCollectionOptions } from '../../inertia/lib/knowledge_collections.js'

describe('Knowledge Collection UI options', () => {
  it('handles empty and large lists in stable locale order', () => {
    assert.deepEqual(mergeCollectionOptions([]), [])
    const values = Array.from({ length: 500 }, (_, index) => `collection ${500 - index}`)
    const result = mergeCollectionOptions(values)
    assert.equal(result.length, 500)
    assert.deepEqual(
      result,
      [...result].sort((a, b) => a.localeCompare(b))
    )
  })

  it('deduplicates case/Unicode-equivalent names and includes a creatable draft', () => {
    assert.deepEqual(
      mergeCollectionOptions(['Field Guides', 'field guides', 'Ｗａｔｃｈｍａｎ'], 'Watchman'),
      ['Field Guides', 'Ｗａｔｃｈｍａｎ']
    )
  })

  it('does not interpret collection names as HTML', () => {
    assert.deepEqual(mergeCollectionOptions(['<img src=x onerror=alert(1)>']), [
      '<img src=x onerror=alert(1)>',
    ])
  })

  it('uses accessible native controls, Watchman theme tokens, and no raw HTML rendering', async () => {
    const combobox = await readFile(
      new URL('../../inertia/components/chat/CollectionCombobox.tsx', import.meta.url),
      'utf8'
    )
    const chat = await readFile(
      new URL('../../inertia/components/chat/index.tsx', import.meta.url),
      'utf8'
    )
    assert.match(combobox, /<label[\s\S]*<input[\s\S]*<datalist/)
    assert.match(combobox, /bg-surface-primary/)
    assert.match(combobox, /text-text-primary/)
    assert.match(combobox, /focus:ring-desert-green/)
    assert.doesNotMatch(combobox, /dangerouslySetInnerHTML/)
    assert.match(chat, /collection: selectedCollection \|\| undefined/)
    assert.match(chat, /All knowledge/)
  })
})
