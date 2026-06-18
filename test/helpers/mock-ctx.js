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
]

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
  return ctx
}
