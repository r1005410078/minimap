// 记录调用的假 Canvas 2D ctx，用于在 node --test 下断言绘制行为（非像素断言）。

const METHODS = [
  'clearRect',
  'fillRect',
  'strokeRect',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'stroke',
  'fill',
  'fillText',
  'strokeText',
  'save',
  'restore',
  'rect',
  'arc',
  'roundRect',
  'setLineDash',
  'translate',
  'scale',
  'setTransform',
  'clip',
]

// 这几个属性会被赋值（不是方法调用），也记录进 calls，
// 方便测试判断"画某个节点时 strokeStyle 是不是选中色"。
const TRACKED_PROPERTIES = ['fillStyle', 'strokeStyle', 'font', 'lineWidth', 'globalAlpha']

export function createMockCtx() {
  const calls = []
  const ctx = {
    calls,
    methodsOf(name) {
      return calls.filter((call) => call.method === name)
    },
    firstIndexOf(name) {
      return calls.findIndex((call) => call.method === name)
    },
  }
  for (const method of METHODS) {
    ctx[method] = (...args) => {
      calls.push({ method, args })
    }
  }
  for (const prop of TRACKED_PROPERTIES) {
    let value
    Object.defineProperty(ctx, prop, {
      get() {
        return value
      },
      set(v) {
        value = v
        calls.push({ method: `set:${prop}`, args: [v] })
      },
    })
  }
  return ctx
}
