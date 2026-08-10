import vine from '@vinejs/vine'
import { KNOWLEDGE_COLLECTION_MAX_INPUT_LENGTH } from '../utils/knowledge_collection.js'

export const getJobStatusSchema = vine.compile(
  vine.object({
    filePath: vine.string(),
  })
)

export const deleteFileSchema = vine.compile(
  vine.object({
    source: vine.string(),
  })
)

export const embedFileSchema = vine.compile(
  vine.object({
    source: vine.string().minLength(1),
    force: vine.boolean().optional(),
  })
)

export const fileSourceSchema = vine.compile(
  vine.object({
    source: vine.string().minLength(1),
  })
)

export const estimateBatchSchema = vine.compile(
  vine.object({
    files: vine
      .array(
        vine.object({
          filename: vine.string().minLength(1).maxLength(255),
          sizeBytes: vine.number().min(0),
        })
      )
      .minLength(1)
      .maxLength(500),
  })
)

export const updateFileCollectionSchema = vine.compile(
  vine.object({
    source: vine.string().minLength(1).maxLength(2048),
    collection: vine
      .string()
      .maxLength(KNOWLEDGE_COLLECTION_MAX_INPUT_LENGTH)
      .nullable()
      .optional(),
  })
)

export const renameKnowledgeCollectionSchema = vine.compile(
  vine.object({
    oldName: vine.string().maxLength(KNOWLEDGE_COLLECTION_MAX_INPUT_LENGTH),
    newName: vine.string().maxLength(KNOWLEDGE_COLLECTION_MAX_INPUT_LENGTH),
  })
)

export const deleteKnowledgeCollectionSchema = vine.compile(
  vine.object({
    name: vine.string().maxLength(KNOWLEDGE_COLLECTION_MAX_INPUT_LENGTH),
  })
)
