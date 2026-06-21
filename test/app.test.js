import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()

const { mount } = await import('@vue/test-utils')
const App = (await import('../src/App.vue')).default

test('App mounts the demo graph and resource tree without throwing', () => {
  const wrapper = mount(App)
  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'clearRect'))
  assert.ok(wrapper.find('.resource-tree-title').exists())
  assert.ok(wrapper.find('.resource-row.resource-category-row').exists())
  wrapper.destroy()
})
