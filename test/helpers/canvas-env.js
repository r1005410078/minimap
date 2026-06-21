// Minimap.vue 组件测试用的 canvas / ResizeObserver 打桩。
import { createMockCtx } from './mock-ctx.js'

// 每次有代码调用 canvas.getContext('2d')，就生成一个新的 mock ctx 并记下来；
// contexts.at(-1) 总是拿到“最近一次挂载”对应的 ctx。
export function stubCanvasContext() {
  const contexts = []
  globalThis.HTMLCanvasElement.prototype.getContext = function () {
    const ctx = createMockCtx()
    contexts.push(ctx)
    return ctx
  }
  return contexts
}

export function stubResizeObserver() {
  const instances = []
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      instances.push(this)
    }
    observe() {}
    disconnect() {
      this.disconnected = true
    }
    trigger() {
      this.callback([], this)
    }
  }
  globalThis.ResizeObserver = FakeResizeObserver
  return instances
}

export function stubAnimationFrame() {
  const scheduled = []
  const cancelled = []
  let nextId = 1
  let cumulativeTime = 0

  globalThis.requestAnimationFrame = (callback) => {
    const id = nextId++
    scheduled.push({ id, callback, cancelled: false })
    return id
  }
  globalThis.cancelAnimationFrame = (id) => {
    cancelled.push(id)
    const frame = scheduled.find((item) => item.id === id)
    if (frame) frame.cancelled = true
  }

  return {
    scheduled,
    cancelled,
    runNext(deltaTime = 0) {
      const frame = scheduled.find((item) => !item.cancelled && !item.ran)
      if (!frame) return false
      frame.ran = true
      cumulativeTime += deltaTime
      frame.callback(cumulativeTime)
      return true
    },
  }
}
