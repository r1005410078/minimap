import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
const observers = stubResizeObserver()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

test('mounting draws the initial graph onto the canvas', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'clearRect'))
  assert.ok(ctx.calls.some((call) => call.method === 'fillRect'))
  wrapper.destroy()
})

test('a ResizeObserver callback re-syncs canvas size and re-renders', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length
  observers.at(-1).trigger()
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})

test('changing layoutDirection triggers a re-render', async () => {
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), layoutDirection: 'horizontal' },
  })
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length
  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})

test('unmounting disconnects the ResizeObserver', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const observer = observers.at(-1)
  wrapper.destroy()
  assert.equal(observer.disconnected, true)
})
