import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubAnimationFrame, stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { computeLayout } from '../src/minimap/graph/layout.js'
import { centerViewportOn } from '../src/minimap/coords/viewport.js'
import { computeOverviewViewport, mainViewportFrameRect, clampRectToCanvas } from '../src/minimap/render/overview.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

const { mountMinimap } = await import('./helpers/mount-minimap.js')
const Overview = (await import('../src/minimap/components/Overview.vue')).default

function settle() {
  frames.runNext(0)
  frames.runNext(200)
}

function referenceLayout() {
  return computeLayout(createDemoGraph(), { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
}

// Vue 先挂载子组件再触发父组件自己的 onMounted，所以紧跟在 mount(Minimap) 之后，
// contexts 数组里倒数第二个 ctx 属于 Overview 的画布，最后一个才是主画布。
function overviewCtxFor() {
  const ctx = contexts.at(-2)
  assert.equal(ctx.methodsOf('fillText').length, 0, '取到的应该是 Overview 的 ctx（不画文字），不是主画布')
  return ctx
}

test('navigating from the overview pans the main viewport and preserves scale', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })
  settle()

  wrapper.findComponent(Overview).vm.$emit('navigate', { x: 123, y: 456 })

  const expected = centerViewportOn({ x: 123, y: 456 }, { x: 0, y: 0, scale: 1 }, 800, 600)
  assert.deepEqual(wrapper.vm.getViewport(), expected)
  assert.deepEqual(wrapper.emitted('viewport-change').at(-1)[0], expected)
  wrapper.destroy()
})

test('controlled viewport: navigating from the overview only emits, never mutates the rendered viewport', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph, viewport: { x: 0, y: 0, scale: 1 } } })
  settle()

  wrapper.findComponent(Overview).vm.$emit('navigate', { x: 123, y: 456 })

  const expected = centerViewportOn({ x: 123, y: 456 }, { x: 0, y: 0, scale: 1 }, 800, 600)
  assert.deepEqual(wrapper.emitted('viewport-change').at(-1)[0], expected)
  assert.deepEqual(wrapper.vm.getViewport(), { x: 0, y: 0, scale: 1 })
  wrapper.destroy()
})

test('renderCurrent feeds the overview the live layout/viewport so its frame tracks setViewport', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })
  settle()
  const ctx = overviewCtxFor()

  wrapper.vm.setViewport({ x: 0, y: 0, scale: 2 })

  const bounds = referenceLayout().bounds
  const overviewViewport = computeOverviewViewport(bounds, 200, 140)
  const frame = mainViewportFrameRect({ x: 0, y: 0, scale: 2 }, 800, 600, overviewViewport)
  const expected = clampRectToCanvas(frame, 200, 140)
  const strokeRects = ctx.methodsOf('strokeRect')
  assert.deepEqual(strokeRects.at(-1).args, [expected.x, expected.y, expected.width, expected.height])
  wrapper.destroy()
})

test('options.enableOverview false hides the overview', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph, options: { enableOverview: false } } })
  settle()

  assert.equal(wrapper.findComponent(Overview).exists(), false)
  wrapper.destroy()
})

test('options.enableOverview defaults to true', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })
  settle()

  assert.equal(wrapper.findComponent(Overview).exists(), true)
  wrapper.destroy()
})
