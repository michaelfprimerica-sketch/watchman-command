import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createMapMarkerValidator,
  updateMapMarkerValidator,
} from '../../app/validators/map_markers.js'
import { MAP_MARKER_NOTES_MAX_LENGTH } from '../../types/maps.js'

const marker = { name: 'Aid station', longitude: -77.04, latitude: 38.9 }

test('accepts old marker requests and optional null notes', async () => {
  assert.deepEqual(await createMapMarkerValidator.validate(marker), marker)
  assert.equal((await createMapMarkerValidator.validate({ ...marker, notes: null })).notes, null)
})

test('preserves multiline, Unicode, and HTML-like marker notes as plain strings', async () => {
  const notes = 'First line\n第二行 🚑\n<script>alert("no")</script>'
  const result = await createMapMarkerValidator.validate({ ...marker, notes })
  assert.equal(result.notes, notes)
})

test('accepts notes at the maximum length and rejects oversized notes', async () => {
  const maximum = 'x'.repeat(MAP_MARKER_NOTES_MAX_LENGTH)
  assert.equal(
    (await createMapMarkerValidator.validate({ ...marker, notes: maximum })).notes,
    maximum
  )
  await assert.rejects(
    createMapMarkerValidator.validate({
      ...marker,
      notes: 'x'.repeat(MAP_MARKER_NOTES_MAX_LENGTH + 1),
    })
  )
})

test('supports editing and clearing notes while rejecting malformed note values', async () => {
  assert.equal((await updateMapMarkerValidator.validate({ notes: 'updated' })).notes, 'updated')
  assert.equal((await updateMapMarkerValidator.validate({ notes: null })).notes, null)
  await assert.rejects(updateMapMarkerValidator.validate({ notes: { nested: true } }))
})
