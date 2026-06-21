export function createRenderScheduler({
  render,
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame,
}) {
  let frameId = null
  const reasons = new Set()

  function drain() {
    frameId = null
    const reason = [...reasons].join(',')
    reasons.clear()
    render(reason)
  }

  function schedule(reason = 'render') {
    reasons.add(reason)
    if (typeof requestFrame !== 'function') {
      drain()
      return
    }
    if (frameId !== null) return
    frameId = requestFrame(() => drain())
  }

  function flush() {
    if (frameId === null) return
    const id = frameId
    frameId = null
    cancelFrame?.(id)
    const reason = [...reasons].join(',')
    reasons.clear()
    render(reason)
  }

  function cancel() {
    if (frameId !== null) cancelFrame?.(frameId)
    frameId = null
    reasons.clear()
  }

  function isScheduled() {
    return frameId !== null
  }

  return { schedule, flush, cancel, isScheduled }
}
