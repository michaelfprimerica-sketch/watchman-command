import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

describe('Meshtastic Daemon retirement migration', () => {
  it('deletes only uninstalled rows and deprecates installed rows', async () => {
    const source = await readFile(
      new URL(
        '../../database/migrations/1776400000001_sunset_meshtastic_daemon.ts',
        import.meta.url
      ),
      'utf8'
    )
    assert.match(source, /MESHTASTICD[\s\S]*where\('installed', false\)[\s\S]*delete\(\)/)
    assert.match(
      source,
      /MESHTASTICD[\s\S]*where\('installed', true\)[\s\S]*update\(\{ is_deprecated: true \}\)/
    )
    assert.doesNotMatch(source, /docker|storage|container\.remove/i)
  })
})
