import vine from '@vinejs/vine'
import { KNOWLEDGE_COLLECTION_MAX_INPUT_LENGTH } from '../utils/knowledge_collection.js'

export const chatSchema = vine.compile(
  vine.object({
    model: vine.string().trim().minLength(1),
    messages: vine.array(
      vine.object({
        role: vine.enum(['system', 'user', 'assistant'] as const),
        content: vine.string(),
      })
    ),
    stream: vine.boolean().optional(),
    sessionId: vine.number().positive().optional(),
    collection: vine.string().maxLength(KNOWLEDGE_COLLECTION_MAX_INPUT_LENGTH).optional(),
  })
)

export const unloadChatModelsSchema = vine.compile(
  vine.object({
    targetModel: vine.string().trim().minLength(1).nullable().optional(),
  })
)

export const getAvailableModelsSchema = vine.compile(
  vine.object({
    sort: vine.enum(['pulls', 'name'] as const).optional(),
    recommendedOnly: vine.boolean().optional(),
    query: vine.string().trim().optional(),
    limit: vine.number().positive().optional(),
    force: vine.boolean().optional(),
  })
)
