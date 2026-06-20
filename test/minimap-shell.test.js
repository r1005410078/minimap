import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, keepAnchorStable } from '../src/minimap/layout.js'
import { easeOutCubic } from '../src/minimap/layout-transition.js'
import { resolveEdges } from '../src/minimap/renderer.js'
import { defaultTheme } from '../src/minimap/theme.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
const observers = stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

test('renders the dark workbench toolbar shell without removing canvas, search, or overview', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })

  assert.equal(wrapper.find('.minimap-toolbar').exists(), true)
  assert.equal(wrapper.findAll('.minimap-toolbar-button').length >= 9, true)
  assert.equal(wrapper.find('.minimap-toolbar-button[aria-label="撤销"]').exists(), true)
  assert.equal(wrapper.find('.minimap-toolbar-button[aria-label="撤销"]').attributes('disabled'), undefined)
  assert.equal(wrapper.find('canvas').attributes('tabindex'), '0')
  assert.equal(wrapper.find('.minimap-search').exists(), true)
  assert.equal(wrapper.find('.minimap-overview-panel').exists(), true)

  wrapper.destroy()
})

test('search and overview options still hide their panels in the polished shell', () => {
  const wrapper = mount(Minimap, {
    propsData: {
      graph: createDemoGraph(),
      options: { enableSearch: false, enableOverview: false },
    },
  })

  assert.equal(wrapper.find('.minimap-search').exists(), false)
  assert.equal(wrapper.find('.minimap-overview-panel').exists(), false)
  assert.equal(wrapper.find('.minimap-toolbar').exists(), true)

  wrapper.destroy()
})

test('active canvas border is opt-in and disabled by default', () => {
  const defaultWrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  assert.equal(defaultWrapper.find('canvas').classes().includes('is-active-border-enabled'), false)
  defaultWrapper.destroy()

  const enabledWrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), options: { enableActiveBorder: true } },
  })
  assert.equal(enabledWrapper.find('canvas').classes().includes('is-active-border-enabled'), true)
  enabledWrapper.destroy()
})

function dispatchDrop(wrapper, payload, point) {
  const canvasEl = wrapper.find('canvas').element
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'dataTransfer', { value: { getData: () => JSON.stringify(payload) } })
  Object.defineProperty(evt, 'clientX', { value: point.x, configurable: true })
  Object.defineProperty(evt, 'clientY', { value: point.y, configurable: true })
  canvasEl.dispatchEvent(evt)
}

function callsSinceLastClear(ctx) {
  const lastClear = ctx.calls.map((call) => call.method).lastIndexOf('clearRect')
  return ctx.calls.slice(lastClear + 1)
}

function renderedRectForLabel(ctx, label) {
  const calls = callsSinceLastClear(ctx)
  const labelIndex = calls.findLastIndex((call, index) => {
    if (call.method !== 'fillText' || call.args[0] !== label) return false
    const priorCalls = calls.slice(Math.max(0, index - 6), index)
    return priorCalls.some(
      (priorCall) => priorCall.method === 'set:fillStyle' && priorCall.args[0] === defaultTheme.node.text,
    )
  })
  assert.notEqual(labelIndex, -1)
  const rectCall = calls
    .slice(0, labelIndex)
    .findLast((call) => {
      if (call.method !== 'roundRect' && call.method !== 'strokeRect') return false
      const [, , width, height] = call.args
      return width > 20 && height > 20
    })
  assert.ok(rectCall)
  const [x, y, width, height] = rectCall.args
  return { x, y, width, height }
}

function centerOf(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  }
}

function flushAnimationFrames(limit = 32) {
  let ran = false
  for (let i = 0; i < limit; i++) {
    const next = frames.runNext(1000 + i * 200)
    if (!next) return ran
    ran = true
  }
  return ran
}

function runFrameFrom(index, time) {
  const frame = frames.scheduled.slice(index).find((item) => !item.cancelled && !item.ran)
  if (!frame) return false
  frame.ran = true
  frame.callback(time)
  return true
}

function interpolateRect(from, to, progress) {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    width: from.width + (to.width - from.width) * progress,
    height: from.height + (to.height - from.height) * progress,
  }
}

function interpolateViewport(from, to, progress) {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    scale: from.scale,
  }
}

function screenRect(rect, viewport) {
  return {
    x: rect.x * viewport.scale + viewport.x,
    y: rect.y * viewport.scale + viewport.y,
    width: rect.width * viewport.scale,
    height: rect.height * viewport.scale,
  }
}

function assertApprox(actual, expected, tolerance = 0.001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)
}

function assertRectApprox(actual, expected, tolerance = 0.001) {
  assertApprox(actual.x, expected.x, tolerance)
  assertApprox(actual.y, expected.y, tolerance)
  assertApprox(actual.width, expected.width, tolerance)
  assertApprox(actual.height, expected.height, tolerance)
}

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

test('changing layoutDirection animates through requestAnimationFrame', async () => {
  flushAnimationFrames()
  const graph = createDemoGraph()
  const horizontalLayout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const verticalLayout = computeLayout(graph, { direction: 'vertical', viewportWidth: 800, viewportHeight: 600 })
  const startViewport = { x: 0, y: 0, scale: 1 }
  const targetViewport = keepAnchorStable(
    startViewport,
    centerOf(horizontalLayout.nodes.get('energy-root')),
    centerOf(verticalLayout.nodes.get('energy-root')),
  )
  const progress = easeOutCubic(0.5)
  const wrapper = mount(Minimap, {
    propsData: { graph, layoutDirection: 'horizontal' },
  })
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length
  const baseline = frames.scheduled.length

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()

  assert.equal(runFrameFrom(baseline, 1000), true)
  assert.equal(runFrameFrom(baseline, 1100), true)
  assert.ok(ctx.calls.length > callsBefore)

  const actual = renderedRectForLabel(ctx, 'Storage Heap 1')
  const oldScreen = screenRect(horizontalLayout.nodes.get('heap-1'), startViewport)
  const finalScreen = screenRect(verticalLayout.nodes.get('heap-1'), targetViewport)
  const expected = screenRect(
    interpolateRect(horizontalLayout.nodes.get('heap-1'), verticalLayout.nodes.get('heap-1'), progress),
    interpolateViewport(startViewport, targetViewport, progress),
  )
  assert.ok(Math.abs(actual.x - oldScreen.x) > 1)
  assert.ok(Math.abs(actual.y - finalScreen.y) > 1)
  assertRectApprox(actual, expected)
  wrapper.destroy()
})

test('replacing graph prop animates through requestAnimationFrame', async () => {
  const graph = createDemoGraph()
  const nextGraph = createDemoGraph()
  nextGraph.nodes.set('aux-root', { id: 'aux-root', label: 'Aux Root', parentId: 'energy-root', children: [] })
  nextGraph.nodes.get('energy-root').children.push('aux-root')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const scheduledBefore = frames.scheduled.length
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length

  await wrapper.setProps({ graph: nextGraph })
  await wrapper.vm.$nextTick()

  assert.ok(frames.scheduled.length > scheduledBefore)
  assert.equal(frames.runNext(1000), true)
  assert.equal(frames.runNext(1100), true)
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})

test('completed layout animation does not schedule another frame', async () => {
  flushAnimationFrames()
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), layoutDirection: 'horizontal' },
  })
  const baseline = frames.scheduled.length

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  assert.equal(runFrameFrom(baseline, 1000), true)
  const scheduledAfterFirstTick = frames.scheduled.length

  assert.equal(runFrameFrom(baseline, 1200), true)
  assert.equal(frames.scheduled.length, scheduledAfterFirstTick)
  wrapper.destroy()
})

test('resize re-renders without starting a layout animation', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const scheduledBefore = frames.scheduled.length
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length

  observers.at(-1).trigger()

  assert.equal(frames.scheduled.length, scheduledBefore)
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})

test('new layout changes cancel the previous animation frame', async () => {
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), layoutDirection: 'horizontal' },
  })

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  const firstFrame = frames.scheduled.at(-1).id

  await wrapper.setProps({ layoutDirection: 'horizontal' })
  await wrapper.vm.$nextTick()

  assert.ok(frames.cancelled.includes(firstFrame))
  wrapper.destroy()
})

test('unmounting cancels an active layout animation frame', async () => {
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), layoutDirection: 'horizontal' },
  })

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  const frame = frames.scheduled.at(-1).id

  wrapper.destroy()

  assert.ok(frames.cancelled.includes(frame))
})

test('selected anchor contributes a compensated viewport during layout animation', async () => {
  flushAnimationFrames()
  const graph = createDemoGraph()
  const horizontalLayout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const verticalLayout = computeLayout(graph, { direction: 'vertical', viewportWidth: 800, viewportHeight: 600 })
  const startViewport = { x: 0, y: 0, scale: 1 }
  const targetViewport = keepAnchorStable(
    startViewport,
    centerOf(horizontalLayout.nodes.get('heap-1')),
    centerOf(verticalLayout.nodes.get('heap-1')),
  )
  const progress = easeOutCubic(0.5)
  const wrapper = mount(Minimap, {
    propsData: {
      graph,
      layoutDirection: 'horizontal',
      selectedIds: ['heap-1'],
    },
  })
  const ctx = contexts.at(-1)
  const baseline = frames.scheduled.length

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  runFrameFrom(baseline, 1000)
  runFrameFrom(baseline, 1100)

  const latestCalls = callsSinceLastClear(ctx)
  const gridFill = latestCalls
    .filter((call) => call.method === 'fillRect')
    .find((call) => call.args[0] === 0 && call.args[1] === 0 && call.args[2] === 800 && call.args[3] === 600)
  const gridDots = latestCalls.filter((call) => call.method === 'arc')

  assert.ok(gridFill)
  assert.ok(gridDots.length > 0)

  const actualCenter = centerOf(renderedRectForLabel(ctx, 'Storage Heap 1'))
  const expectedCenter = centerOf(
    screenRect(
      interpolateRect(horizontalLayout.nodes.get('heap-1'), verticalLayout.nodes.get('heap-1'), progress),
      interpolateViewport(startViewport, targetViewport, progress),
    ),
  )
  const originalCenter = centerOf(screenRect(horizontalLayout.nodes.get('heap-1'), startViewport))
  assertApprox(actualCenter.x, expectedCenter.x)
  assertApprox(actualCenter.y, expectedCenter.y)
  assertApprox(actualCenter.x, originalCenter.x)
  assertApprox(actualCenter.y, originalCenter.y)
  wrapper.destroy()
})

test('drop during layout animation settles before computing insertion index', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, {
    propsData: {
      graph,
      layoutDirection: 'horizontal',
      selectedIds: ['energy-root'],
    },
  })

  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  const activeFrame = frames.scheduled.at(-1).id

  dispatchDrop(wrapper, { id: 'inverter', label: 'Inverter' }, { x: 191, y: 0 })

  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'energy-root')
  assert.equal(payload.index, 2)
  assert.ok(frames.cancelled.includes(activeFrame))
  wrapper.destroy()
})

test('unmounting disconnects the ResizeObserver', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const observer = observers.at(-1)
  wrapper.destroy()
  assert.equal(observer.disconnected, true)
})

test('nodeRenderer prop replaces default node drawing', () => {
  let calls = 0
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), nodeRenderer: () => { calls++ } },
  })
  const ctx = contexts.at(-1)
  assert.ok(calls > 0)
  assert.equal(
    ctx.calls.some((call) => call.method === 'fillText' && call.args[0] === 'Energy Root'),
    false,
  )
  wrapper.destroy()
})

test('groupRenderer prop replaces default group drawing', () => {
  let calls = 0
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), groupRenderer: () => { calls++ } },
  })
  const ctx = contexts.at(-1)
  assert.ok(calls > 0)
  assert.equal(
    ctx.calls.some(
      (call) => call.method === 'fillText' && typeof call.args[0] === 'string' && call.args[0].startsWith('heap-1'),
    ),
    false,
  )
  wrapper.destroy()
})

test('edgeRenderer prop replaces default edge drawing', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const expectedEdgeCount = resolveEdges(graph, layout).length
  const payloads = []
  const wrapper = mount(Minimap, {
    propsData: { graph, edgeRenderer: (_ctx, payload) => payloads.push(payload) },
  })
  assert.equal(payloads.length, expectedEdgeCount)
  wrapper.destroy()
})

test('renderer props default to null and do not affect default drawing', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'fillText' && call.args[0] === 'Energy Root'))
  wrapper.destroy()
})

test('undo and redo exposed methods restore a dropped node', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const beforeSize = graph.nodes.size

  const canvasEl = wrapper.find('canvas').element
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'dataTransfer', {
    value: { getData: () => JSON.stringify({ id: 'undoable', label: 'Undoable' }) },
  })
  Object.defineProperty(evt, 'clientX', { value: 0, configurable: true })
  Object.defineProperty(evt, 'clientY', { value: 0, configurable: true })
  canvasEl.dispatchEvent(evt)

  const insertedId = graph.nodes.get('energy-root').children.find((id) => id.startsWith('res-undoable-'))
  assert.ok(insertedId)
  assert.equal(wrapper.vm.canUndo(), true)
  assert.equal(wrapper.vm.canRedo(), false)

  const undo = wrapper.vm.undo()
  assert.equal(undo.applied, true)
  assert.equal(undo.type, 'undo')
  assert.equal(graph.nodes.has(insertedId), false)
  assert.equal(graph.nodes.size, beforeSize)
  assert.equal(wrapper.vm.canUndo(), false)
  assert.equal(wrapper.vm.canRedo(), true)

  const redo = wrapper.vm.redo()
  assert.equal(redo.applied, true)
  assert.equal(redo.type, 'redo')
  assert.equal(graph.nodes.has(insertedId), true)
  assert.equal(wrapper.vm.canUndo(), true)
  assert.equal(wrapper.vm.canRedo(), false)

  const changes = wrapper.emitted('change').map((entry) => entry[0].type)
  assert.deepEqual(changes, ['drop-node', 'undo', 'redo'])
  wrapper.destroy()
})

test('undo and redo are empty no-ops when history stacks are empty', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  assert.equal(wrapper.vm.canUndo(), false)
  assert.equal(wrapper.vm.canRedo(), false)
  assert.equal(wrapper.vm.undo().reason, 'empty')
  assert.equal(wrapper.vm.redo().reason, 'empty')
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

function dispatchKey(wrapper, key, options = {}) {
  wrapper.find('canvas').element.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }),
  )
}

test('deleteSelection deletes selected nodes, emits events, and supports undo', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['grid-tie'])
  const result = wrapper.vm.deleteSelection()

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.has('grid-tie'), false)
  assert.equal(graph.nodes.has('feeder-1'), false)
  assert.deepEqual(wrapper.emitted('delete')[0][0].deletedIds.sort(), ['feeder-1', 'feeder-2', 'feeder-3', 'grid-tie'])
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'delete-nodes')
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], [])

  wrapper.vm.undo()
  assert.equal(graph.nodes.has('grid-tie'), true)
  wrapper.destroy()
})

test('copySelection duplicates selected nodes and emits events', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['grid-tie'])
  const result = wrapper.vm.copySelection()

  assert.equal(result.applied, true)
  const copiedId = wrapper.emitted('copy')[0][0].idMap['grid-tie']
  assert.equal(graph.nodes.has(copiedId), true)
  assert.equal(graph.nodes.get(copiedId).children.length, 3)
  assert.deepEqual(graph.nodes.get('energy-root').children.slice(0, 2), ['grid-tie', copiedId])
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'copy-nodes')
  wrapper.destroy()
})

test('exportGraph returns JSON-safe data and does not enter history', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  const exported = wrapper.vm.exportGraph()

  assert.equal(Array.isArray(exported.nodes), true)
  assert.equal(exported.nodes.some((node) => node.id === 'energy-root'), true)
  assert.equal(wrapper.vm.canUndo(), false)
  assert.equal(wrapper.emitted('export')[0][0].graph, exported)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('importGraph replaces graph contents and supports undo', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const data = {
    version: 1,
    nodes: [{ id: 'new-root', label: 'New Root', parentId: null, children: [] }],
    rootIds: ['new-root'],
    edges: [],
  }

  const result = wrapper.vm.importGraph(data)

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.has('energy-root'), false)
  assert.equal(graph.nodes.has('new-root'), true)
  assert.equal(wrapper.emitted('import')[0][0].graph, graph)
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'replace-graph')

  wrapper.vm.undo()
  assert.equal(graph.nodes.has('energy-root'), true)
  wrapper.destroy()
})

test('invalid importGraph returns a failed result without emitting change', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  const result = wrapper.vm.importGraph({ version: 999, nodes: [], rootIds: [] })

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'invalid-version')
  assert.equal(graph.nodes.has('energy-root'), true)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('readonly and before hooks block delete copy and import methods', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, {
    propsData: {
      graph,
      readonly: true,
      beforeDelete: () => {
        throw new Error('readonly should short-circuit before hooks')
      },
    },
  })
  wrapper.vm.select(['grid-tie'])

  assert.equal(wrapper.vm.deleteSelection().reason, 'readonly')
  assert.equal(wrapper.vm.copySelection().reason, 'readonly')
  assert.equal(wrapper.vm.importGraph({ version: 1, nodes: [], rootIds: [] }).reason, 'readonly')
  assert.equal(graph.nodes.has('grid-tie'), true)
  wrapper.destroy()

  const blockedGraph = createDemoGraph()
  const blocked = mount(Minimap, {
    propsData: {
      graph: blockedGraph,
      beforeDelete: () => false,
      beforeCopy: () => false,
      beforeImport: () => false,
    },
  })
  blocked.vm.select(['grid-tie'])

  assert.equal(blocked.vm.deleteSelection().reason, 'blocked')
  assert.equal(blocked.vm.copySelection().reason, 'blocked')
  assert.equal(blocked.vm.importGraph({ version: 1, nodes: [], rootIds: [] }).reason, 'blocked')
  assert.equal(blockedGraph.nodes.has('grid-tie'), true)
  blocked.destroy()
})

test('keyboard Delete Backspace and Cmd/Ctrl+C trigger edit commands', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['grid-tie'])
  dispatchKey(wrapper, 'Delete')
  assert.equal(graph.nodes.has('grid-tie'), false)

  wrapper.vm.undo()
  wrapper.vm.select(['grid-tie'])
  dispatchKey(wrapper, 'Backspace')
  assert.equal(graph.nodes.has('grid-tie'), false)

  wrapper.vm.undo()
  wrapper.vm.select(['grid-tie'])
  dispatchKey(wrapper, 'c', { metaKey: true })
  assert.equal(wrapper.emitted('copy').length, 1)

  wrapper.destroy()
})

function toolbarButton(wrapper, label) {
  return wrapper.find(`.minimap-toolbar-button[aria-label="${label}"]`)
}

test('toolbar undo redo delete and copy buttons call real edit commands', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['grid-tie'])
  await toolbarButton(wrapper, '删除').trigger('click')
  assert.equal(graph.nodes.has('grid-tie'), false)

  await toolbarButton(wrapper, '撤销').trigger('click')
  assert.equal(graph.nodes.has('grid-tie'), true)

  await toolbarButton(wrapper, '重做').trigger('click')
  assert.equal(graph.nodes.has('grid-tie'), false)

  await toolbarButton(wrapper, '撤销').trigger('click')
  wrapper.vm.select(['grid-tie'])
  await toolbarButton(wrapper, '复制').trigger('click')
  assert.equal(wrapper.emitted('copy').length, 1)

  wrapper.destroy()
})
