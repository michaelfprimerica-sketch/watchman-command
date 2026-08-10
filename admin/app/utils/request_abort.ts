export interface CloseEventSource {
  destroyed?: boolean
  once(event: 'close', listener: () => void): unknown
  off(event: 'close', listener: () => void): unknown
}

export function abortOnClientClose(source: CloseEventSource): {
  signal: AbortSignal
  dispose: () => void
} {
  const controller = new AbortController()
  const onClose = () => controller.abort()
  if (source.destroyed) controller.abort()
  else source.once('close', onClose)
  return {
    signal: controller.signal,
    dispose: () => source.off('close', onClose),
  }
}
