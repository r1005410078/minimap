// 给 node --test 注入一个 jsdom 全局环境，供 @vue/test-utils mount 真实 .vue 组件使用。
// 用 EXCLUDE 名单排除 Node 已经原生提供的全局（尤其是定时器和 console）：
// 如果把 jsdom 的 window.setTimeout 也覆盖到 globalThis，会和 jsdom 内部实现互相递归导致栈溢出。
import { JSDOM } from 'jsdom'

const EXCLUDE = new Set([
  'window', 'document', 'navigator', 'location',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  'console', 'process', 'global', 'globalThis', 'Buffer',
  'performance', 'fetch', 'Request', 'Response', 'Headers',
])

export function installDomEnv() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  const { window } = dom

  globalThis.window = window
  globalThis.document = window.document
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })

  for (const key of Object.getOwnPropertyNames(window)) {
    if (EXCLUDE.has(key)) continue
    try {
      globalThis[key] = window[key]
    } catch {
      // 个别属性在 globalThis 上已经是只读的，跳过即可
    }
  }

  return dom
}

// jsdom 不跑真实排版，clientWidth/clientHeight 永远是 0；
// 需要非零容器尺寸的组件测试要调用这个函数打桩。
export function stubElementSize(width = 800, height = 600) {
  Object.defineProperty(globalThis.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(globalThis.HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    value: height,
  })
}
