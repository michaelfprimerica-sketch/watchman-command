import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, it } from 'node:test'

import type { RecordPromotedKnowledgePackReleaseInput } from '../../types/knowledge_pack_installation.js'
import { assertPromotedKnowledgePackRelease } from '../../app/utils/knowledge_pack_installation.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

function promotedRelease(
  overrides: Partial<RecordPromotedKnowledgePackReleaseInput> = {}
): RecordPromotedKnowledgePackReleaseInput {
  return {
    packId: '11111111-1111-4111-8111-111111111111',
    packVersion: '1.0.0',
    source: 'SIDELOAD',
    manifestSha256: HASH_A,
    signingKeyId: 'watchman-test-key-1',
    artifacts: [
      {
        artifactId: 'field-guide',
        path: 'content/field-guide.zim',
        contentType: 'application/octet-stream',
        sizeBytes: 42,
        sha256: HASH_B,
      },
    ],
    ...overrides,
  }
}

describe('installed Knowledge Pack registry input', () => {
  it('accepts verified promoted release metadata', () => {
    assert.doesNotThrow(() => assertPromotedKnowledgePackRelease(promotedRelease()))
  })

  it('rejects empty, duplicate, and unsafe artifact sets', () => {
    assert.throws(
      () => assertPromotedKnowledgePackRelease(promotedRelease({ artifacts: [] })),
      /between 1 and 256/
    )

    const artifact = promotedRelease().artifacts[0]
    assert.throws(
      () =>
        assertPromotedKnowledgePackRelease(
          promotedRelease({ artifacts: [artifact, { ...artifact }] })
        ),
      /duplicate artifact IDs/
    )
    assert.throws(() =>
      assertPromotedKnowledgePackRelease(
        promotedRelease({ artifacts: [{ ...artifact, path: '../escape.zim' }] })
      )
    )
  })

  it('rejects invalid hashes, unsafe sizes, and unknown sources', () => {
    assert.throws(() =>
      assertPromotedKnowledgePackRelease(promotedRelease({ manifestSha256: 'A'.repeat(64) }))
    )
    assert.throws(() =>
      assertPromotedKnowledgePackRelease(
        promotedRelease({
          artifacts: [
            { ...promotedRelease().artifacts[0], sizeBytes: Number.MAX_SAFE_INTEGER + 1 },
          ],
        })
      )
    )
    assert.throws(() =>
      assertPromotedKnowledgePackRelease(promotedRelease({ source: 'MEMBERSHIP' as never }))
    )
  })
})

describe('installed Knowledge Pack registry migration contract', () => {
  it('retains prior releases when the current pointer advances', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    database.exec(`
      CREATE TABLE installed_knowledge_pack_releases (
        id TEXT PRIMARY KEY,
        pack_id TEXT NOT NULL,
        pack_version TEXT NOT NULL,
        UNIQUE (pack_id, id),
        UNIQUE (pack_id, pack_version)
      );
      CREATE TABLE installed_knowledge_pack_artifacts (
        id TEXT PRIMARY KEY,
        installed_release_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        FOREIGN KEY (installed_release_id)
          REFERENCES installed_knowledge_pack_releases(id) ON DELETE RESTRICT
      );
      CREATE TABLE installed_knowledge_packs (
        pack_id TEXT PRIMARY KEY,
        current_release_id TEXT NOT NULL,
        FOREIGN KEY (pack_id, current_release_id)
          REFERENCES installed_knowledge_pack_releases(pack_id, id) ON DELETE RESTRICT
      );

      INSERT INTO installed_knowledge_pack_releases VALUES ('release-v1', 'pack-1', '1.0.0');
      INSERT INTO installed_knowledge_pack_artifacts VALUES ('a1', 'release-v1', 'guide-v1');
      INSERT INTO installed_knowledge_packs VALUES ('pack-1', 'release-v1');
      INSERT INTO installed_knowledge_pack_releases VALUES ('release-v2', 'pack-1', '2.0.0');
      INSERT INTO installed_knowledge_pack_artifacts VALUES ('a2', 'release-v2', 'guide-v2');
      UPDATE installed_knowledge_packs SET current_release_id = 'release-v2' WHERE pack_id = 'pack-1';
    `)

    const releases = database
      .prepare(
        'SELECT id, pack_version FROM installed_knowledge_pack_releases ORDER BY pack_version'
      )
      .all()
    assert.deepEqual(releases, [
      { id: 'release-v1', pack_version: '1.0.0' },
      { id: 'release-v2', pack_version: '2.0.0' },
    ])
    assert.equal(
      database
        .prepare('SELECT current_release_id FROM installed_knowledge_packs WHERE pack_id = ?')
        .pluck()
        .get('pack-1'),
      'release-v2'
    )
    assert.throws(() =>
      database
        .prepare('INSERT INTO installed_knowledge_packs VALUES (?, ?)')
        .run('different-pack', 'release-v1')
    )
    assert.throws(() =>
      database
        .prepare('DELETE FROM installed_knowledge_pack_releases WHERE id = ?')
        .run('release-v1')
    )
    database.close()
  })

  it('preserves history, advances an internally constrained pointer, and stays entitlement-free', async () => {
    const source = await readFile(
      new URL(
        '../../database/migrations/1777000000004_create_installed_knowledge_pack_registry.ts',
        import.meta.url
      ),
      'utf8'
    )

    assert.match(source, /installed_knowledge_pack_releases/)
    assert.match(source, /installed_knowledge_pack_artifacts/)
    assert.match(source, /installed_knowledge_packs/)
    assert.match(source, /foreign\(\['pack_id', 'current_release_id'\]/)
    assert.match(source, /references\(\['pack_id', 'id'\]\)/)
    assert.match(source, /unique\(\['pack_id', 'pack_version'\]/)
    assert.match(source, /onDelete\('RESTRICT'\)/)
    assert.match(source, /Refusing to roll back populated installed Knowledge Pack history/)
    assert.doesNotMatch(source, /membership|entitlement|software[_ -]?license|customer/i)
    const registrySource = await readFile(
      new URL('../../app/services/knowledge_pack_installation_registry.ts', import.meta.url),
      'utf8'
    )
    assert.match(registrySource, /semver\.gt\(currentRelease\.pack_version, release\.packVersion\)/)
    assert.doesNotMatch(source, /references\(['"]knowledge_packs[.'"]/)
  })
})
