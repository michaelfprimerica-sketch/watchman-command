import vine from '@vinejs/vine'

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
    collection: vine.string().nullable().optional(),
  })
)

export const renameKnowledgeCollectionSchema = vine.compile(
  vine.object({
    oldName: vine.string(),
    newName: vine.string(),
  })
)

export const deleteKnowledgeCollectionSchema = vine.compile(
  vine.object({
    name: vine.string(),
  })
)
