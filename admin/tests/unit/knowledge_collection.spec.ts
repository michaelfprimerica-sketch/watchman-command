import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'
import {
  KNOWLEDGE_COLLECTION_MAX_LENGTH,
  KNOWLEDGE_COLLECTION_MAX_INPUT_LENGTH,
  normalizeKnowledgeCollection,
  resolveEffectiveCollection,
} from '../../app/utils/knowledge_collection.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

describe('Knowledge Collection normalization', () => {
  it('preserves Unicode while applying NFKC, whitespace, and case normalization', () => {
    assert.equal(normalizeKnowledgeCollection('  Médical\t  RÉFÉRENCE  '), 'médical référence')
    assert.equal(normalizeKnowledgeCollection('Ｗａｔｃｈｍａｎ'), 'watchman')
  })

  it('makes case-only and whitespace-only duplicates identical', () => {
    assert.equal(
      normalizeKnowledgeCollection('Field Guides'),
      normalizeKnowledgeCollection(' field   GUIDES ')
    )
  })

  it('uses null for missing, empty, or whitespace-only labels', () => {
    assert.equal(normalizeKnowledgeCollection(undefined), null)
    assert.equal(normalizeKnowledgeCollection(''), null)
    assert.equal(normalizeKnowledgeCollection(' \n\t '), null)
  })

  it('accepts the maximum length and rejects longer names by Unicode code point', () => {
    assert.equal(
      normalizeKnowledgeCollection('🗺️'.repeat(KNOWLEDGE_COLLECTION_MAX_LENGTH / 2)),
      '🗺️'.repeat(KNOWLEDGE_COLLECTION_MAX_LENGTH / 2)
    )
    assert.throws(
      () => normalizeKnowledgeCollection('a'.repeat(KNOWLEDGE_COLLECTION_MAX_LENGTH + 1)),
      RangeError
    )
  })

  it('rejects abusive raw input before Unicode normalization', () => {
    assert.throws(
      () => normalizeKnowledgeCollection(' '.repeat(KNOWLEDGE_COLLECTION_MAX_INPUT_LENGTH + 1)),
      /input is too long/
    )
  })
})

describe('Knowledge Collection ingestion assignment', () => {
  it('preserves an assignment made before indexing and permits an explicit job override', () => {
    assert.equal(resolveEffectiveCollection(undefined, 'field guides'), 'field guides')
    assert.equal(resolveEffectiveCollection('mission brief', 'field guides'), 'mission brief')
    assert.equal(resolveEffectiveCollection(undefined, null), undefined)
  })
})

describe('Knowledge Collection migration contract', () => {
  it('adds a nullable field without changing existing rows and supports rollback', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE kb_ingest_state (
        id INTEGER PRIMARY KEY,
        file_path TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        chunks_embedded INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO kb_ingest_state (file_path, state) VALUES ('existing.zim', 'indexed');
      ALTER TABLE kb_ingest_state ADD COLUMN collection VARCHAR(64) NULL;
      CREATE INDEX kb_ingest_state_collection_index ON kb_ingest_state(collection);
    `)

    const row = database.prepare('SELECT * FROM kb_ingest_state').get() as Record<string, unknown>
    assert.equal(row.file_path, 'existing.zim')
    assert.equal(row.collection, null)

    database.exec(`
      DROP INDEX kb_ingest_state_collection_index;
      ALTER TABLE kb_ingest_state DROP COLUMN collection;
    `)
    const columns = database.prepare('PRAGMA table_info(kb_ingest_state)').all() as Array<{
      name: string
    }>
    assert.equal(
      columns.some((column) => column.name === 'collection'),
      false
    )
    database.close()
  })
})
