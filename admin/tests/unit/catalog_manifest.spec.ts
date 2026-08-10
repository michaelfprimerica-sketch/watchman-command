import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import vine from '@vinejs/vine'
import {
  wikipediaSpecSchema,
  zimCategoriesSpecSchema,
} from '../../app/validators/curated_collections.js'

async function readCollection(name: string): Promise<any> {
  return JSON.parse(
    await readFile(new URL(`../../../collections/${name}`, import.meta.url), 'utf8')
  )
}

describe('curated catalog manifests', () => {
  it('passes the application schemas', async () => {
    const categories = await readCollection('kiwix-categories.json')
    const wikipedia = await readCollection('wikipedia.json')
    await vine.compile(zimCategoriesSpecSchema).validate(categories)
    await vine.compile(wikipediaSpecSchema).validate(wikipedia)
  })

  it('uses HTTPS URLs and contains no Creator Pack entries', async () => {
    const categories = await readCollection('kiwix-categories.json')
    const wikipedia = await readCollection('wikipedia.json')
    const serialized = JSON.stringify({ categories, wikipedia })
    assert.doesNotMatch(serialized, /creator[ _-]?pack/i)

    const resources = categories.categories.flatMap((category: any) =>
      category.tiers.flatMap((tier: any) => tier.resources)
    )
    for (const resource of resources) {
      assert.match(resource.url, /^https:\/\//)
    }
    for (const option of wikipedia.options.filter((item: any) => item.url)) {
      assert.match(option.url, /^https:\/\//)
    }
  })

  it('contains only the approved upstream maintenance targets', async () => {
    const categories = await readCollection('kiwix-categories.json')
    const resources = categories.categories.flatMap((category: any) =>
      category.tiers.flatMap((tier: any) => tier.resources)
    )
    const byId = new Map<string, any>(
      resources.map((resource: any) => [resource.id, resource] as const)
    )

    assert.equal(byId.get('canadian-prepper_en_preppingfood')?.version, '2026-07')
    assert.equal(byId.get('lrnselfreliance_en_all')?.version, '2026-06')
    for (const id of [
      'devdocs_en_javascript',
      'devdocs_en_html',
      'devdocs_en_css',
      'devdocs_en_git',
      'devdocs_en_docker',
    ]) {
      assert.equal(byId.get(id)?.version, '2026-07')
    }
    assert.equal(byId.has('cd3wd_en_all'), false)
  })

  it('contains no duplicate resource or Wikipedia option IDs', async () => {
    const categories = await readCollection('kiwix-categories.json')
    const wikipedia = await readCollection('wikipedia.json')
    const resourceIds = categories.categories.flatMap((category: any) =>
      category.tiers.flatMap((tier: any) => tier.resources.map((resource: any) => resource.id))
    )
    const wikipediaIds = wikipedia.options.map((option: any) => option.id)

    assert.equal(new Set(resourceIds).size, resourceIds.length)
    assert.equal(new Set(wikipediaIds).size, wikipediaIds.length)
  })
})
