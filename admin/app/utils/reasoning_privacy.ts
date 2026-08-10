export type SafeReasoningChunk = {
  content: string
  reasoningActive: boolean
}

export function hasNativeReasoning(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    (typeof record.thinking === 'string' && record.thinking.length > 0) ||
    (typeof record.reasoning === 'string' && record.reasoning.length > 0)
  )
}

/**
 * Removes chain-of-thought tags across arbitrary stream boundaries. Only a
 * boolean activity signal leaves this class; private reasoning text does not.
 */
export class SafeReasoningStreamNormalizer {
  private buffer = ''
  private inReasoning = false

  push(rawContent: string, nativeDelta?: unknown): SafeReasoningChunk {
    this.buffer += rawContent
    let content = ''
    let sawReasoning = hasNativeReasoning(nativeDelta)

    while (this.buffer.length > 0) {
      if (this.inReasoning) {
        const closeIndex = this.buffer.indexOf('</think>')
        if (closeIndex >= 0) {
          sawReasoning = sawReasoning || closeIndex > 0
          this.buffer = this.buffer.slice(closeIndex + '</think>'.length)
          this.inReasoning = false
          continue
        }
        const held = this.partialSuffix('</think>')
        sawReasoning = sawReasoning || this.buffer.length - held > 0
        this.buffer = this.buffer.slice(this.buffer.length - held)
        break
      }

      const openIndex = this.buffer.indexOf('<think>')
      if (openIndex >= 0) {
        content += this.buffer.slice(0, openIndex)
        this.buffer = this.buffer.slice(openIndex + '<think>'.length)
        this.inReasoning = true
        sawReasoning = true
        continue
      }
      const held = this.partialSuffix('<think>')
      content += this.buffer.slice(0, this.buffer.length - held)
      this.buffer = this.buffer.slice(this.buffer.length - held)
      break
    }

    return { content, reasoningActive: sawReasoning || this.inReasoning }
  }

  finish(): SafeReasoningChunk {
    const content = this.inReasoning ? '' : this.buffer
    const reasoningActive = this.inReasoning
    this.buffer = ''
    this.inReasoning = false
    return { content, reasoningActive }
  }

  private partialSuffix(tag: string): number {
    for (let length = Math.min(tag.length - 1, this.buffer.length); length >= 1; length--) {
      if (this.buffer.endsWith(tag.slice(0, length))) return length
    }
    return 0
  }
}

/** Apply the stream privacy rules to a complete non-streaming response. */
export function normalizeCompleteReasoning(
  rawContent: string,
  nativeMessage?: unknown
): SafeReasoningChunk {
  const normalizer = new SafeReasoningStreamNormalizer()
  const normalized = normalizer.push(rawContent, nativeMessage)
  const trailing = normalizer.finish()
  return {
    content: normalized.content + trailing.content,
    reasoningActive: normalized.reasoningActive || trailing.reasoningActive,
  }
}
