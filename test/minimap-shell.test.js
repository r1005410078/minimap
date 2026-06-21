import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { clearClipboard } from '../src/minimap/edit/clipboard.js'
import { computeLayout, keepAnchorStable, childRectInGroup } from '../src/minimap/graph/layout.js'
import { easeOutCubic } from '../src/minimap/graph/layout-transition.js'
import { resolveEdges } from '../src/minimap/render/renderer.js'
import { defaultTheme } from '../src/minimap/render/theme.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
const observers = stubResizeObserver()
const frames = stubAnimationFrame()

const { mountMinimap } = await import('./helpers/mount-minimap.js')

test('renders canvas shell with search, overview, and bottom controls', () => {
  const wrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })

  assert.equal(wrapper.find('.minimap-toolbar').exists(), false)
  assert.equal(wrapper.find('.minimap-bottom-controls').exists(), true)
  assert.equal(wrapper.find('.minimap-control-button[aria-label="撤销"]').exists(), true)
  assert.equal(wrapper.find('canvas').attributes('tabindex'), '0')
  assert.equal(wrapper.find('.minimap-search').exists(), true)
  assert.equal(wrapper.find('.minimap-overview-panel').exists(), true)

  wrapper.destroy()
})

test('search and overview options still hide their panels in the polished shell', () => {
  const wrapper = mountMinimap( {
    propsData: {
      graph: createDemoGraph(),
      options: { enableSearch: false, enableOverview: false },
    },
  })

  assert.equal(wrapper.find('.minimap-search').exists(), false)
  assert.equal(wrapper.find('.minimap-overview-panel').exists(), false)
  assert.equal(wrapper.find('.minimap-bottom-controls').exists(), true)

  wrapper.destroy()
})

test('active canvas border is opt-in and disabled by default', () => {
  const defaultWrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
  assert.equal(defaultWrapper.find('canvas').classes().includes('is-active-border-enabled'), false)
  defaultWrapper.destroy()

  const enabledWrapper = mountMinimap( {
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

function dispatchContextMenu(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    button: 2,
    pointerId: 11,
    pointerType: 'mouse',
  }))
  canvasEl.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    button: 2,
    pointerId: 11,
    pointerType: 'mouse',
  }))
  const evt = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
  })
  canvasEl.dispatchEvent(evt)
  return evt
}

function dispatchPointer(wrapper, type, point, options = {}) {
  const canvasEl = wrapper.find('canvas').element
  const evt = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    button: options.button ?? 0,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
  })
  Object.defineProperty(evt, 'pointerId', { value: options.pointerId ?? 1, configurable: true })
  canvasEl.dispatchEvent(evt)
  return evt
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
  const wrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'clearRect'))
  assert.ok(ctx.calls.some((call) => call.method === 'fillRect'))
  wrapper.destroy()
})

test('a ResizeObserver callback re-syncs canvas size and re-renders', () => {
  const wrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
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
  const wrapper = mountMinimap( {
    propsData: { graph, layoutDirection: 'horizontal' },
  })
  const startViewport = wrapper.vm.getViewport()
  const targetViewport = keepAnchorStable(
    startViewport,
    centerOf(horizontalLayout.nodes.get('energy-root')),
    centerOf(verticalLayout.nodes.get('energy-root')),
  )
  const progress = easeOutCubic(0.5)
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
  const wrapper = mountMinimap( { propsData: { graph } })
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
  const wrapper = mountMinimap( {
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
  const wrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
  const scheduledBefore = frames.scheduled.length
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length

  observers.at(-1).trigger()

  assert.equal(frames.scheduled.length, scheduledBefore)
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})

test('blank canvas pan coalesces repeated pointer moves into one render frame', () => {
  const wrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  dispatchPointer(wrapper, 'pointerdown', { x: 780, y: 580 })
  const callsAfterDown = ctx.calls.length
  const frameBaseline = frames.scheduled.length

  dispatchPointer(wrapper, 'pointermove', { x: 760, y: 570 })
  dispatchPointer(wrapper, 'pointermove', { x: 740, y: 560 })
  dispatchPointer(wrapper, 'pointermove', { x: 720, y: 550 })

  assert.equal(frames.scheduled.length, frameBaseline + 1)
  assert.equal(ctx.calls.length, callsAfterDown)
  assert.equal(runFrameFrom(frameBaseline, 1000), true)
  assert.ok(ctx.calls.length > callsAfterDown)
  wrapper.destroy()
})

test('marquee pointerup flushes a scheduled selection render immediately', () => {
  const wrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)

  dispatchPointer(wrapper, 'pointerdown', { x: 780, y: 580 }, { metaKey: true })
  const callsAfterDown = ctx.calls.length
  const frameBaseline = frames.scheduled.length
  dispatchPointer(wrapper, 'pointermove', { x: 720, y: 530 }, { metaKey: true })

  assert.equal(frames.scheduled.length, frameBaseline + 1)
  assert.equal(ctx.calls.length, callsAfterDown)

  dispatchPointer(wrapper, 'pointerup', { x: 720, y: 530 }, { metaKey: true })

  assert.ok(ctx.calls.length > callsAfterDown)
  wrapper.destroy()
})

test('pan text hiding is opt-in through options', () => {
  const defaultWrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
  const defaultCtx = contexts.at(-1)
  const defaultFrameBaseline = frames.scheduled.length
  dispatchPointer(defaultWrapper, 'pointerdown', { x: 780, y: 580 })
  dispatchPointer(defaultWrapper, 'pointermove', { x: 740, y: 560 })

  assert.equal(runFrameFrom(defaultFrameBaseline, 1000), true)
  assert.equal(
    callsSinceLastClear(defaultCtx).some((call) => call.method === 'fillText' && call.args[0] === 'Energy Root'),
    true,
  )
  defaultWrapper.destroy()

  const enabledWrapper = mountMinimap( {
    propsData: {
      graph: createDemoGraph(),
      options: { hideTextDuringInteraction: true },
    },
  })
  const enabledCtx = contexts.at(-1)
  const enabledFrameBaseline = frames.scheduled.length
  dispatchPointer(enabledWrapper, 'pointerdown', { x: 780, y: 580 })
  dispatchPointer(enabledWrapper, 'pointermove', { x: 740, y: 560 })

  assert.equal(runFrameFrom(enabledFrameBaseline, 1100), true)
  assert.equal(
    callsSinceLastClear(enabledCtx).some((call) => call.method === 'fillText' && call.args[0] === 'Energy Root'),
    false,
  )
  enabledWrapper.destroy()
})

test('new layout changes cancel the previous animation frame', async () => {
  const wrapper = mountMinimap( {
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
  const wrapper = mountMinimap( {
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
  const wrapper = mountMinimap( {
    propsData: {
      graph,
      layoutDirection: 'horizontal',
      selectedIds: ['heap-1'],
    },
  })
  const startViewport = wrapper.vm.getViewport()
  const targetViewport = keepAnchorStable(
    startViewport,
    centerOf(horizontalLayout.nodes.get('heap-1')),
    centerOf(verticalLayout.nodes.get('heap-1')),
  )
  const progress = easeOutCubic(0.5)
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
  const wrapper = mountMinimap( {
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
  const wrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
  const observer = observers.at(-1)
  wrapper.destroy()
  assert.equal(observer.disconnected, true)
})

test('nodeRenderer prop replaces default node drawing', () => {
  let calls = 0
  const wrapper = mountMinimap( {
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
  const wrapper = mountMinimap( {
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
  const wrapper = mountMinimap( {
    propsData: { graph, edgeRenderer: (_ctx, payload) => payloads.push(payload) },
  })
  assert.equal(payloads.length, expectedEdgeCount)
  wrapper.destroy()
})

test('renderer props default to null and do not affect default drawing', () => {
  const wrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'fillText' && call.args[0] === 'Energy Root'))
  wrapper.destroy()
})

test('undo and redo exposed methods restore a dropped node', async () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })
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
  const wrapper = mountMinimap( { propsData: { graph } })

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
  const wrapper = mountMinimap( { propsData: { graph } })

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

test('copySelection captures a clipboard snapshot without mutating the graph', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })
  const beforeSize = graph.nodes.size

  wrapper.vm.select(['grid-tie'])
  const result = wrapper.vm.copySelection()

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.size, beforeSize)
  assert.deepEqual(wrapper.emitted('copy')[0][0].capturedIds.sort(), ['feeder-1', 'feeder-2', 'feeder-3', 'grid-tie'])
  assert.equal(wrapper.emitted('change'), undefined)
  assert.equal(wrapper.vm.canUndo(), false)
  wrapper.destroy()
})

test('paste inserts the clipboard snapshot as a child of the selected node and supports undo', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })

  wrapper.vm.select(['feeder-1'])
  wrapper.vm.copySelection()
  wrapper.vm.select(['cluster-25'])
  const result = wrapper.vm.paste()

  assert.equal(result.applied, true)
  const pastedId = result.operation.payload.pastedIds[0]
  assert.equal(graph.nodes.get('cluster-25').children.includes(pastedId), true)
  assert.equal(graph.nodes.get(pastedId).parentId, 'cluster-25')
  assert.equal(wrapper.emitted('paste')[0][0].pastedIds[0], pastedId)
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'paste-nodes')

  wrapper.vm.undo()
  assert.equal(graph.nodes.has(pastedId), false)
  wrapper.destroy()
})

test('pasting the same clipboard twice produces two independent copies', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })

  wrapper.vm.select(['feeder-1'])
  wrapper.vm.copySelection()
  wrapper.vm.select(['cluster-25'])
  const first = wrapper.vm.paste()
  const second = wrapper.vm.paste()

  const firstId = first.operation.payload.pastedIds[0]
  const secondId = second.operation.payload.pastedIds[0]
  assert.notEqual(firstId, secondId)
  assert.equal(graph.nodes.has(firstId), true)
  assert.equal(graph.nodes.has(secondId), true)
  assert.deepEqual(graph.nodes.get('cluster-25').children.slice(-2), [firstId, secondId])
  wrapper.destroy()
})

test('paste targets the real parent node when the selection is a group box', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })

  wrapper.vm.select(['feeder-1'])
  wrapper.vm.copySelection()
  wrapper.vm.select(['heap-1::g0'])
  const result = wrapper.vm.paste()

  assert.equal(result.applied, true)
  const pastedId = result.operation.payload.pastedIds[0]
  assert.equal(graph.nodes.get('heap-1').children.includes(pastedId), true)
  assert.equal(graph.nodes.get(pastedId).parentId, 'heap-1')
  wrapper.destroy()
})

test('paste returns empty when there is no selection or no clipboard content', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })

  assert.equal(wrapper.vm.paste().reason, 'empty')

  wrapper.vm.select(['cluster-25'])
  assert.equal(wrapper.vm.paste().reason, 'empty')
  wrapper.destroy()
})

test('exportGraph returns JSON-safe data and does not enter history', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })

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
  const wrapper = mountMinimap( { propsData: { graph } })
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
  const wrapper = mountMinimap( { propsData: { graph } })

  const result = wrapper.vm.importGraph({ version: 999, nodes: [], rootIds: [] })

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'invalid-version')
  assert.equal(graph.nodes.has('energy-root'), true)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('readonly and before hooks block delete paste and import methods, but not copy', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( {
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
  assert.equal(wrapper.vm.copySelection().applied, true)
  assert.equal(wrapper.vm.paste().reason, 'readonly')
  assert.equal(wrapper.vm.importGraph({ version: 1, nodes: [], rootIds: [] }).reason, 'readonly')
  assert.equal(graph.nodes.has('grid-tie'), true)
  wrapper.destroy()

  const blockedGraph = createDemoGraph()
  const blocked = mountMinimap( {
    propsData: {
      graph: blockedGraph,
      beforeDelete: () => false,
      beforeCopy: () => false,
      beforePaste: () => false,
      beforeImport: () => false,
    },
  })
  blocked.vm.select(['grid-tie'])

  assert.equal(blocked.vm.deleteSelection().reason, 'blocked')
  assert.equal(blocked.vm.copySelection().reason, 'blocked')
  assert.equal(blocked.vm.paste().reason, 'blocked')
  assert.equal(blocked.vm.importGraph({ version: 1, nodes: [], rootIds: [] }).reason, 'blocked')
  assert.equal(blockedGraph.nodes.has('grid-tie'), true)
  blocked.destroy()
})

test('keyboard Delete Backspace Cmd/Ctrl+C and Cmd/Ctrl+V trigger edit commands', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })

  wrapper.vm.select(['grid-tie'])
  dispatchKey(wrapper, 'Delete')
  assert.equal(graph.nodes.has('grid-tie'), false)

  wrapper.vm.undo()
  wrapper.vm.select(['grid-tie'])
  dispatchKey(wrapper, 'Backspace')
  assert.equal(graph.nodes.has('grid-tie'), false)

  wrapper.vm.undo()
  wrapper.vm.select(['feeder-1'])
  dispatchKey(wrapper, 'c', { metaKey: true })
  assert.equal(wrapper.emitted('copy').length, 1)

  wrapper.vm.select(['cluster-25'])
  dispatchKey(wrapper, 'v', { metaKey: true })
  assert.equal(wrapper.emitted('paste').length, 1)
  const pastedId = wrapper.emitted('paste')[0][0].pastedIds[0]
  assert.equal(graph.nodes.get('cluster-25').children.includes(pastedId), true)

  wrapper.vm.select(['grid-tie'])
  dispatchKey(wrapper, 'Delete')
  assert.equal(graph.nodes.has('grid-tie'), false)

  dispatchKey(wrapper, 'z', { metaKey: true })
  assert.equal(graph.nodes.has('grid-tie'), true)

  dispatchKey(wrapper, 'z', { metaKey: true, shiftKey: true })
  assert.equal(graph.nodes.has('grid-tie'), false)

  wrapper.destroy()
})

function bottomControlButton(wrapper, label) {
  return wrapper.find(`.minimap-control-button[aria-label="${label}"]`)
}

test('bottom history controls and edit methods call real edit commands', async () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap( { propsData: { graph } })

  wrapper.vm.select(['feeder-1'])
  wrapper.vm.copySelection()
  assert.equal(wrapper.emitted('copy').length, 1)

  wrapper.vm.select(['cluster-25'])
  wrapper.vm.paste()
  assert.equal(wrapper.emitted('paste').length, 1)
  const pastedId = wrapper.emitted('paste')[0][0].pastedIds[0]
  assert.equal(graph.nodes.get('cluster-25').children.includes(pastedId), true)

  wrapper.vm.select([pastedId])
  wrapper.vm.deleteSelection()
  assert.equal(graph.nodes.has(pastedId), false)
  await wrapper.vm.$nextTick()

  await bottomControlButton(wrapper, '撤销').trigger('click')
  assert.equal(graph.nodes.has(pastedId), true)

  await bottomControlButton(wrapper, '重做').trigger('click')
  assert.equal(graph.nodes.has(pastedId), false)

  wrapper.destroy()
})

async function openContextMenu(wrapper, point) {
  dispatchContextMenu(wrapper, point)
  await wrapper.vm.$nextTick()
}

async function clickContextMenuItem(wrapper, id) {
  await wrapper.find(`.minimap-context-menu-item[data-menu-id="${id}"]`).trigger('click')
}

test('right-clicking a node opens the node context menu with common canvas actions', async () => {
  const wrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
  flushAnimationFrames()
  const ctx = contexts.at(-1)
  const rootRect = renderedRectForLabel(ctx, 'Energy Root')
  const event = dispatchContextMenu(wrapper, centerOf(rootRect))
  await wrapper.vm.$nextTick()

  assert.equal(event.defaultPrevented, true)
  assert.equal(wrapper.find('.minimap-context-menu').exists(), true)
  const ids = wrapper.findAll('.minimap-context-menu-item').wrappers.map((item) => item.attributes('data-menu-id'))
  assert.ok(ids.includes('add-child'))
  assert.ok(ids.includes('copy'))
  assert.ok(ids.includes('fit-to-screen'))
  assert.ok(ids.includes('toggle-search'))
  assert.ok(wrapper.find('.minimap-context-menu-item[data-menu-id="add-child"]').attributes('disabled'))

  wrapper.destroy()
})

test('right-clicking blank canvas opens only common canvas actions and closes on Escape', async () => {
  const wrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
  await openContextMenu(wrapper, { x: 760, y: 560 })

  const labels = wrapper.findAll('.minimap-context-menu-item').wrappers.map((item) => item.text())
  assert.equal(labels.includes('复制'), false)
  assert.ok(labels.includes('粘贴'))
  assert.ok(labels.includes('居中选中'))

  wrapper.find('canvas').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await wrapper.vm.$nextTick()
  assert.equal(wrapper.find('.minimap-context-menu').exists(), false)

  wrapper.destroy()
})

test('context menu position is clamped inside the canvas container', async () => {
  const wrapper = mountMinimap( { propsData: { graph: createDemoGraph() } })
  await openContextMenu(wrapper, { x: 795, y: 595 })

  const style = wrapper.find('.minimap-context-menu').attributes('style')
  assert.match(style, /left: \d+px/)
  assert.match(style, /top: \d+px/)
  assert.doesNotMatch(style, /left: 795px/)

  wrapper.destroy()
})

test('context menu copy, paste, delete and config actions reuse existing commands', async () => {
  const graph = createDemoGraph()

  const copyWrapper = mountMinimap( { propsData: { graph } })
  const ctx = contexts.at(-1)
  const feederRect = renderedRectForLabel(ctx, 'Feeder 2')
  await openContextMenu(copyWrapper, centerOf(feederRect))
  await clickContextMenuItem(copyWrapper, 'copy')
  assert.equal(copyWrapper.emitted('copy').at(-1)[0].capturedIds.includes('feeder-2'), true)
  copyWrapper.destroy()

  const pasteGraph = createDemoGraph()
  const pasteWrapper = mountMinimap( { propsData: { graph: pasteGraph } })
  pasteWrapper.vm.select(['cluster-25'])
  await openContextMenu(pasteWrapper, { x: 760, y: 560 })
  await clickContextMenuItem(pasteWrapper, 'paste')
  assert.equal(pasteWrapper.emitted('paste').at(-1)[0].targetParentId, 'cluster-25')
  pasteWrapper.destroy()

  const deleteGraph = createDemoGraph()
  const deleteWrapper = mountMinimap( { propsData: { graph: deleteGraph } })
  const deleteCtx = contexts.at(-1)
  const deleteRect = renderedRectForLabel(deleteCtx, 'Feeder 3')
  await openContextMenu(deleteWrapper, centerOf(deleteRect))
  await clickContextMenuItem(deleteWrapper, 'delete')
  assert.equal(deleteGraph.nodes.has('feeder-3'), false)
  deleteWrapper.destroy()

  const groupDeleteGraph = createDemoGraph()
  const groupLayout = computeLayout(groupDeleteGraph, { viewportWidth: 800, viewportHeight: 600 })
  const heapGroup = groupLayout.groups.find((item) => item.parentId === 'heap-1')
  const clusterRect = childRectInGroup(heapGroup, 'cluster-3')
  const siblingsBefore = groupDeleteGraph.nodes.get('heap-1').children.length
  const groupDeleteWrapper = mountMinimap({ propsData: { graph: groupDeleteGraph } })
  await openContextMenu(groupDeleteWrapper, centerOf(clusterRect))
  await clickContextMenuItem(groupDeleteWrapper, 'delete')
  assert.equal(groupDeleteGraph.nodes.has('cluster-3'), false)
  assert.equal(groupDeleteGraph.nodes.get('heap-1').children.includes('cluster-3'), false)
  assert.equal(groupDeleteGraph.nodes.get('heap-1').children.length, siblingsBefore - 1)
  assert.equal(groupDeleteGraph.nodes.has('cluster-1'), true)
  groupDeleteWrapper.destroy()

  const configWrapper = mountMinimap( {
    propsData: {
      graph: createDemoGraph(),
      options: { enableSearch: true, showGrid: true, showPerformance: false },
    },
  })
  await openContextMenu(configWrapper, { x: 760, y: 560 })
  await clickContextMenuItem(configWrapper, 'toggle-search')
  assert.equal(configWrapper.find('.minimap-search').exists(), false)
  await openContextMenu(configWrapper, { x: 760, y: 560 })
  await clickContextMenuItem(configWrapper, 'toggle-grid')
  assert.equal(configWrapper.emitted('config-change').at(-1)[0].key, 'showGrid')
  assert.equal(configWrapper.emitted('config-change').at(-1)[0].value, false)
  assert.equal(
    callsSinceLastClear(contexts.at(-1)).some((call) => call.method === 'arc'),
    false,
  )
  await openContextMenu(configWrapper, { x: 760, y: 560 })
  await clickContextMenuItem(configWrapper, 'toggle-performance')
  assert.equal(configWrapper.find('.minimap-performance').exists(), true)
  assert.match(configWrapper.find('.minimap-performance').text(), /ms/)
  await openContextMenu(configWrapper, { x: 760, y: 560 })
  await clickContextMenuItem(configWrapper, 'toggle-hide-text-during-interaction')
  assert.equal(configWrapper.emitted('config-change').at(-1)[0].key, 'hideTextDuringInteraction')
  assert.equal(configWrapper.emitted('config-change').at(-1)[0].value, true)
  await openContextMenu(configWrapper, { x: 760, y: 560 })
  assert.equal(
    configWrapper
      .find('.minimap-context-menu-item[data-menu-id="toggle-grid"] .minimap-context-menu-check')
      .text()
      .trim(),
    '',
  )
  configWrapper.destroy()
})

test('contextMenuItems can hide defaults and append custom actions', async () => {
  const wrapper = mountMinimap( {
    propsData: {
      graph: createDemoGraph(),
      contextMenuItems: (context, defaults) =>
        defaults
          .filter((item) => item.id !== 'toggle-performance')
          .concat({ id: 'inspect-node', label: '查看详情', action: 'inspect-node' }),
    },
  })

  await openContextMenu(wrapper, { x: 760, y: 560 })
  assert.equal(wrapper.find('.minimap-context-menu-item[data-menu-id="toggle-performance"]').exists(), false)
  await clickContextMenuItem(wrapper, 'inspect-node')
  assert.equal(wrapper.emitted('context-menu-action').at(-1)[0].action, 'inspect-node')
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})
