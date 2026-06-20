import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'
import { defaultTheme } from '../src/minimap/theme.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

function dispatchPointerDown(wrapper, point, options = {}) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX: point.x,
      clientY: point.y,
      bubbles: true,
      shiftKey: options.shiftKey ?? false,
      metaKey: options.metaKey ?? false,
      ctrlKey: options.ctrlKey ?? false,
      pointerId: options.pointerId ?? 1,
    }),
  )
}

function dispatchPointerMove(wrapper, point, options = {}) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointermove', {
      clientX: point.x,
      clientY: point.y,
      bubbles: true,
      shiftKey: options.shiftKey ?? false,
      metaKey: options.metaKey ?? false,
      ctrlKey: options.ctrlKey ?? false,
      pointerId: options.pointerId ?? 1,
    }),
  )
}

function dispatchPointerUp(wrapper, point, options = {}) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerup', {
      clientX: point.x,
      clientY: point.y,
      bubbles: true,
      shiftKey: options.shiftKey ?? false,
      metaKey: options.metaKey ?? false,
      ctrlKey: options.ctrlKey ?? false,
      pointerId: options.pointerId ?? 1,
    }),
  )
}

function dispatchKeyDown(wrapper, key) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

function setCanvasRect(wrapper, rect) {
  const canvasEl = wrapper.find('canvas').element
  Object.defineProperty(canvasEl, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
    }),
  })
}

// 只看最近一次 render()（最后一次 clearRect 之后）的绘制调用，
// 避免一个组件实例多次渲染的历史调用互相污染断言。
function selectedLabels(ctx, theme) {
  const lastClear = ctx.calls.map((c) => c.method).lastIndexOf('clearRect')
  const calls = ctx.calls.slice(lastClear + 1)
  const labels = []
  calls.forEach((call, i) => {
    if (call.method !== 'fillText') return
    for (let j = i - 1; j >= 0; j--) {
      if (calls[j].method === 'set:strokeStyle') {
        if (calls[j].args[0] === theme.node.selectedStroke) labels.push(call.args[0])
        break
      }
    }
  })
  return labels
}

test('clicking a node selects it (uncontrolled) and highlights it on the next render', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const rect = layout.nodes.get('grid-tie')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  dispatchPointerDown(wrapper, point)
  dispatchPointerUp(wrapper, point)

  assert.deepEqual(wrapper.emitted('select')[0][0], ['grid-tie'])
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), ['Grid Tie'])
  wrapper.destroy()
})

test('clicking blank space clears the selection', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const rect = layout.nodes.get('grid-tie')
  const wrapper = mount(Minimap, { propsData: { graph } })
  dispatchPointerDown(wrapper, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

  dispatchPointerDown(wrapper, { x: -100000, y: -100000 })

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], [])
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), [])
  wrapper.destroy()
})

test('modifier clicking adds and toggles multiple selections', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const gridPoint = { x: grid.x + grid.width / 2, y: grid.y + grid.height / 2 }
  const groupPoint = { x: heapGroup.x + heapGroup.width / 2, y: heapGroup.y + heapGroup.height / 2 }

  dispatchPointerDown(wrapper, gridPoint)
  dispatchPointerUp(wrapper, gridPoint)
  dispatchPointerDown(wrapper, groupPoint, { shiftKey: true })
  dispatchPointerDown(wrapper, gridPoint, { ctrlKey: true })
  dispatchPointerUp(wrapper, gridPoint, { ctrlKey: true })

  assert.deepEqual(wrapper.emitted('select')[0][0], ['grid-tie'])
  assert.deepEqual(wrapper.emitted('select')[1][0], ['grid-tie', heapGroup.id])
  assert.deepEqual(wrapper.emitted('select')[2][0], [heapGroup.id])
  wrapper.destroy()
})

test('Escape clears the current selection', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const point = { x: grid.x + grid.width / 2, y: grid.y + grid.height / 2 }
  dispatchPointerDown(wrapper, point)
  dispatchPointerUp(wrapper, point)
  dispatchKeyDown(wrapper, 'Escape')

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], [])
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), [])
  wrapper.destroy()
})

test('Cmd/Ctrl dragging blank space selects visible items inside the marquee', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  dispatchPointerDown(wrapper, { x: 150, y: 50 }, { ctrlKey: true })
  dispatchPointerMove(wrapper, { x: heapGroup.x + heapGroup.width + 20, y: heapGroup.y + 60 }, { ctrlKey: true })
  dispatchPointerUp(wrapper, { x: heapGroup.x + heapGroup.width + 20, y: heapGroup.y + 60 }, { ctrlKey: true })

  const latest = wrapper.emitted('select').at(-1)[0]
  assert.ok(latest.includes('grid-tie'))
  assert.ok(latest.includes(heapGroup.id))
  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

test('Cmd/Ctrl marquee starts at the mouse position even when the canvas is offset', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  setCanvasRect(wrapper, { left: 80, top: 40, width: 800, height: 600 })

  dispatchPointerDown(wrapper, { x: 180, y: 140 }, { metaKey: true })
  dispatchPointerMove(wrapper, { x: 260, y: 200 }, { metaKey: true })

  const calls = contexts.at(-1).calls.filter((call) => call.method === 'strokeRect')
  assert.deepEqual(calls.at(-1).args, [100, 100, 80, 60])
  wrapper.destroy()
})

test('Cmd/Ctrl dragging blank space over empty area clears selection', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  dispatchPointerDown(wrapper, { x: 10, y: 10 }, { ctrlKey: true })
  dispatchPointerMove(wrapper, { x: 20, y: 20 }, { ctrlKey: true })
  dispatchPointerUp(wrapper, { x: 20, y: 20 }, { ctrlKey: true })

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], [])
  wrapper.destroy()
})

test('selectedIds prop puts the component in controlled mode', async () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const wrapper = mount(Minimap, { propsData: { graph, selectedIds: ['grid-tie'] } })
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), ['Grid Tie'])

  const rootRect = layout.nodes.get('energy-root')
  const point = { x: rootRect.x + rootRect.width / 2, y: rootRect.y + rootRect.height / 2 }
  dispatchPointerDown(wrapper, point)
  dispatchPointerUp(wrapper, point)

  assert.deepEqual(wrapper.emitted('select')[0][0], ['energy-root'])
  // 受控模式：prop 还没变，下一次渲染应该还是原来的选中状态
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), ['Grid Tie'])

  await wrapper.setProps({ selectedIds: ['energy-root'] })
  await wrapper.vm.$nextTick()
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), ['Energy Root'])
  wrapper.destroy()
})

test('clicking while controlled does not leak into a later uncontrolled render', async () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const wrapper = mount(Minimap, { propsData: { graph, selectedIds: ['grid-tie'] } })

  const rootRect = layout.nodes.get('energy-root')
  dispatchPointerDown(wrapper, { x: rootRect.x + rootRect.width / 2, y: rootRect.y + rootRect.height / 2 })

  // 切回非受控模式：如果 setSelected 在受控期间偷偷写了 internalSelectedId，
  // 这里就会错误地显示 energy-root 被选中，而不是真正的"无选中"。
  await wrapper.setProps({ selectedIds: null })
  await wrapper.vm.$nextTick()
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), [])
  wrapper.destroy()
})
