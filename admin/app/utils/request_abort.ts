export interface CloseEventSource {
  once(event: 'close', listener: () => void): unknown
  off(event: 'close', listener: () => void): unknown
}

export function abortOnClientClose(source: CloseEventSource): {
  signal: AbortSignal
  dispose: () => void
} {
  const controller = new AbortController()
  const onClose = () => controller.abort()
  source.once('close', onClose)
  return {
    signal: controller.signal,
    dispose: () => source.off('close', onClose),
  }
}
