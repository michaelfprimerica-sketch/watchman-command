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
  const withNullNotes = await createMapMarkerValidator.validate({ ...marker, notes: null })
  assert.equal(withNullNotes.notes, null)
})

test('preserves multiline, Unicode, and HTML-like marker notes as plain strings', async () => {
  const notes = 'First line\n第二行 🚑\n<script>alert("no")</script>'
  const result = await createMapMarkerValidator.validate({ ...marker, notes })
  assert.equal(result.notes, notes)
})

test('accepts notes at the maximum length and rejects oversized notes', async () => {
  const maximum = 'x'.repeat(MAP_MARKER_NOTES_MAX_LENGTH)
  const atMaximum = await createMapMarkerValidator.validate({ ...marker, notes: maximum })
  assert.equal(atMaximum.notes, maximum)
  await assert.rejects(
    createMapMarkerValidator.validate({
      ...marker,
      notes: 'x'.repeat(MAP_MARKER_NOTES_MAX_LENGTH + 1),
    })
  )
})

test('supports editing and clearing notes while rejecting malformed note values', async () => {
  const updated = await updateMapMarkerValidator.validate({ notes: 'updated' })
  const cleared = await updateMapMarkerValidator.validate({ notes: null })
  assert.equal(updated.notes, 'updated')
  assert.equal(cleared.notes, null)
  await assert.rejects(updateMapMarkerValidator.validate({ notes: { nested: true } }))
})
