import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph.js'
import { clearClipboard, getClipboard } from '../src/minimap/clipboard.js'
import { createEditController } from '../src/minimap/edit-controller.js'

function createDeps(graph, overrides = {}) {
  const emitted = { delete: [], copy: [], paste: [], import: [], export: [], change: [] }
  let selectedIds = []
  let layout = null
  const layoutCalls = []
  const { getSelectedIds: initialGetSelectedIds, ...restOverrides } = overrides
  if (initialGetSelectedIds) selectedIds = [...initialGetSelectedIds()]
  const deps = {
    getGraph: () => graph,
    getLayout: () => layout,
    getSelectedIds: () => selectedIds,
    setSelected: (ids) => { selectedIds = ids },
    getReadonly: () => false,
    updateLayout: (opts) => layoutCalls.push(opts),
    getBeforeDelete: () => null,
    getBeforeCopy: () => null,
    getBeforeImport: () => null,
    getBeforePaste: () => null,
    emitDelete: (p) => emitted.delete.push(p),
    emitCopy: (p) => emitted.copy.push(p),
    emitPaste: (p) => emitted.paste.push(p),
    emitImport: (p) => emitted.import.push(p),
    emitExport: (p) => emitted.export.push(p),
    emitChange: (p) => emitted.change.push(p),
    ...restOverrides,
  }
  return {
    deps,
    emitted,
    layoutCalls,
    setSelectedIds: (ids) => { selectedIds = ids },
    setLayout: (l) => { layout = l },
  }
}

test('copySelection expands a selected collapsed-group id into its real child ids via getLayout', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps, setLayout, emitted } = createDeps(graph, { getSelectedIds: () => ['heap-1::g0'] })
  // heap-1 在 createDemoGraph() 里有 24 个叶子子节点，真实代码会把它折叠成一个分组；
  // 这里直接构造 layout 形状（group 的 id 跟 parentId 不同，children 是真实节点 id），
  // 不依赖 computeLayout，专测 selectedRealNodeIds 的展开逻辑。
  setLayout({ groups: [{ id: 'heap-1::g0', parentId: 'heap-1', children: ['cluster-1', 'cluster-2'] }] })
  const controller = createEditController(deps)

  const result = controller.copySelection()

  assert.equal(result.applied, true)
  assert.deepEqual(emitted.copy[0].capturedIds.sort(), ['cluster-1', 'cluster-2'].sort())
})

test('deleteSelection blocked by readonly leaves the graph untouched', () => {
  const graph = createDemoGraph()
  const { deps, layoutCalls } = createDeps(graph, { getReadonly: () => true, getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)

  const result = controller.deleteSelection()

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'readonly')
  assert.equal(layoutCalls.length, 0)
  assert.ok(graph.nodes.has('feeder-1'))
})

test('deleteSelection blocked by beforeDelete returning false leaves the graph untouched', () => {
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, {
    getSelectedIds: () => ['feeder-1'],
    getBeforeDelete: () => () => false,
  })
  const controller = createEditController(deps)

  const result = controller.deleteSelection()

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'blocked')
  assert.ok(graph.nodes.has('feeder-1'))
})

test('deleteSelection removes the node, updates layout, clears selection, emits delete and change', () => {
  const graph = createDemoGraph()
  const { deps, emitted, layoutCalls } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)

  const result = controller.deleteSelection()

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.has('feeder-1'), false)
  assert.deepEqual(layoutCalls, [{ animate: false }])
  assert.equal(emitted.delete.length, 1)
  assert.equal(emitted.change.length, 1)
  assert.deepEqual(deps.getSelectedIds(), [])
})

test('undo restores a deleted node and redo re-removes it; canUndo/canRedo reflect history', () => {
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)
  assert.equal(controller.canUndo(), false)

  controller.deleteSelection()
  assert.equal(controller.canUndo(), true)
  assert.equal(controller.canRedo(), false)

  controller.undo()
  assert.ok(graph.nodes.has('feeder-1'))
  assert.equal(controller.canRedo(), true)

  controller.redo()
  assert.equal(graph.nodes.has('feeder-1'), false)
})

test('onGraphReplaced resets the undo/redo history', () => {
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)
  controller.deleteSelection()
  assert.equal(controller.canUndo(), true)

  controller.onGraphReplaced()

  assert.equal(controller.canUndo(), false)
})

test('copySelection with no selection returns an unapplied "empty" result and does not touch the clipboard', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, { getSelectedIds: () => [] })
  const controller = createEditController(deps)

  const result = controller.copySelection()

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'empty')
  assert.equal(getClipboard(), null)
})

test('copySelection blocked by beforeCopy returning false does not touch the clipboard', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, {
    getSelectedIds: () => ['feeder-1'],
    getBeforeCopy: () => () => false,
  })
  const controller = createEditController(deps)

  const result = controller.copySelection()

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'blocked')
  assert.equal(getClipboard(), null)
})

test('copySelection writes a snapshot to the clipboard and emits copy', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps, emitted } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)

  const result = controller.copySelection()

  assert.equal(result.applied, true)
  assert.ok(getClipboard())
  assert.equal(emitted.copy.length, 1)
  assert.deepEqual(emitted.copy[0].ids, ['feeder-1'])
})

test('pasteInto inserts the clipboard snapshot under the target parent, updates layout, emits paste and change', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps: copyDeps } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  createEditController(copyDeps).copySelection()

  const { deps, emitted, layoutCalls } = createDeps(graph, { getSelectedIds: () => ['grid-tie'] })
  const controller = createEditController(deps)

  const result = controller.pasteInto('grid-tie')

  assert.equal(result.applied, true)
  assert.ok(layoutCalls.length > 0)
  assert.equal(emitted.paste.length, 1)
  assert.equal(emitted.change.length, 1)
  const pastedId = result.operation.payload.pastedIds[0]
  assert.ok(graph.nodes.get('grid-tie').children.includes(pastedId))
})

test('paste() defaults the target to the selected id itself when it is not a collapsed group', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps: copyDeps } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  createEditController(copyDeps).copySelection()

  const { deps } = createDeps(graph, { getSelectedIds: () => ['feeder-2'] })
  const controller = createEditController(deps)

  const result = controller.paste()

  assert.equal(result.applied, true)
  assert.equal(result.operation.payload.targetParentId, 'feeder-2')
})

test('exportGraph serializes the graph and emits export', () => {
  const graph = createDemoGraph()
  const { deps, emitted } = createDeps(graph)
  const controller = createEditController(deps)

  const exported = controller.exportGraph()

  assert.equal(exported.version, graph.version)
  assert.equal(emitted.export.length, 1)
})

test('importGraph blocked by readonly never parses the data and leaves the graph untouched', () => {
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, { getReadonly: () => true })
  const controller = createEditController(deps)

  const result = controller.importGraph('not even json')

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'readonly')
})

test('importGraph replaces the graph contents, clears selection, updates layout, emits import and change', () => {
  const graph = createDemoGraph()
  const { deps, emitted, layoutCalls } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)
  const replacement = {
    version: graph.version,
    nodes: [{ id: 'solo', label: 'Solo', parentId: null, children: [] }],
    rootIds: ['solo'],
    edges: [],
  }

  const result = controller.importGraph(replacement)

  assert.equal(result.applied, true)
  assert.deepEqual(deps.getSelectedIds(), [])
  assert.deepEqual(layoutCalls, [{ animate: false }])
  assert.equal(emitted.import.length, 1)
  assert.equal(emitted.change.length, 1)
})

test('applyOperation is exposed for cross-controller use (e.g. drag-controller in a later slice)', () => {
  const graph = createDemoGraph()
  const { deps } = createDeps(graph)
  const controller = createEditController(deps)
  const beforeCalls = []

  const blocked = controller.applyOperation(
    { type: 'delete-nodes', payload: { ids: ['feeder-1'], expandedIds: ['feeder-1'] } },
    { before: (payload) => { beforeCalls.push(payload); return false } },
  )

  assert.equal(blocked.applied, false)
  assert.equal(blocked.reason, 'blocked')
  assert.equal(beforeCalls.length, 1)
  assert.ok(graph.nodes.has('feeder-1'))
})

test('emitChangeIfApplied is exposed for cross-controller reuse (e.g. drag-controller) and only emits when applied', () => {
  const graph = createDemoGraph()
  const { deps, emitted } = createDeps(graph)
  const controller = createEditController(deps)

  controller.emitChangeIfApplied({ applied: false, type: 'move-node', operation: {}, previousGraph: graph, nextGraph: graph, reason: 'blocked' })
  assert.equal(emitted.change.length, 0)

  controller.emitChangeIfApplied({ applied: true, type: 'move-node', operation: { type: 'move-node', payload: {} }, previousGraph: graph, nextGraph: graph, reason: null })
  assert.equal(emitted.change.length, 1)
  assert.equal(emitted.change[0].type, 'move-node')
})
