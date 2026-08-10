import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

describe('Watchman reasoning UI privacy', () => {
  it('renders status only and never renders or stores raw model thinking', async () => {
    const bubble = await readFile(
      new URL('../../inertia/components/chat/ChatMessageBubble.tsx', import.meta.url),
      'utf8'
    )
    const chat = await readFile(
      new URL('../../inertia/components/chat/index.tsx', import.meta.url),
      'utf8'
    )
    const types = await readFile(new URL('../../types/chat.ts', import.meta.url), 'utf8')

    assert.match(bubble, /message\.reasoningStatus/)
    assert.match(bubble, /Reasoning details are hidden/)
    assert.doesNotMatch(bubble, /message\.thinking|thinkingDuration|<details/)
    assert.doesNotMatch(chat, /thinkingContent|chunkThinking|message\.thinking/)
    assert.doesNotMatch(types, /thinking\??:/)
    assert.match(chat, /Searching local knowledge/)
    assert.match(chat, /Analyzing/)
  })
})
