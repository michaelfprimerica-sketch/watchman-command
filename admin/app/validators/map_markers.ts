import vine from '@vinejs/vine'

import { MAP_MARKER_NOTES_MAX_LENGTH } from '../../types/maps.js'

const optionalNotes = () =>
  vine.string().trim().maxLength(MAP_MARKER_NOTES_MAX_LENGTH).nullable().optional()

export const createMapMarkerValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255),
    longitude: vine.number().min(-180).max(180),
    latitude: vine.number().min(-90).max(90),
    color: vine.string().trim().maxLength(20).optional(),
    notes: optionalNotes(),
    marker_type: vine.string().trim().maxLength(20).optional(),
  })
)

export const updateMapMarkerValidator = vine.compile(
  vine.object({
    name: vine.string().trim().minLength(1).maxLength(255).optional(),
    color: vine.string().trim().maxLength(20).optional(),
    longitude: vine.number().min(-180).max(180).optional(),
    latitude: vine.number().min(-90).max(90).optional(),
    notes: optionalNotes(),
    marker_type: vine.string().trim().maxLength(20).optional(),
  })
)
