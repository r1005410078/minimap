import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph.js'
import { createGraphOperationManager, captureSubtreeSnapshot } from '../src/minimap/graph-operations.js'

function labels(graph, parentId) {
  return graph.nodes.get(parentId).children.slice()
}

test('drop-node inserts a new node and can undo and redo it', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const beforeSize = graph.nodes.size

  const result = manager.apply({
    type: 'drop-node',
    payload: {
      resource: { id: 'solar-array', label: 'Solar Array' },
      parentId: 'energy-root',
      index: 1,
      id: 'res-solar-array-1',
    },
  })

  assert.equal(result.applied, true)
  assert.equal(result.type, 'drop-node')
  assert.equal(graph.nodes.size, beforeSize + 1)
  assert.equal(graph.nodes.get('res-solar-array-1').label, 'Solar Array')
  assert.equal(graph.nodes.get('energy-root').children[1], 'res-solar-array-1')
  assert.equal(manager.canUndo(), true)
  assert.equal(manager.canRedo(), false)

  const undo = manager.undo()
  assert.equal(undo.applied, true)
  assert.equal(undo.type, 'undo')
  assert.equal(graph.nodes.has('res-solar-array-1'), false)
  assert.equal(graph.nodes.size, beforeSize)
  assert.equal(manager.canUndo(), false)
  assert.equal(manager.canRedo(), true)

  const redo = manager.redo()
  assert.equal(redo.applied, true)
  assert.equal(redo.type, 'redo')
  assert.equal(graph.nodes.has('res-solar-array-1'), true)
  assert.equal(graph.nodes.get('energy-root').children[1], 'res-solar-array-1')
})

test('reorder-group-child moves a child and can undo and redo it', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const before = labels(graph, 'heap-1')

  const result = manager.apply({
    type: 'reorder-group-child',
    payload: { groupId: 'heap-1::g0', parentId: 'heap-1', childId: 'cluster-8', index: 0 },
  })

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.get('heap-1').children[0], 'cluster-8')
  assert.equal(new Set(graph.nodes.get('heap-1').children).size, 24)

  manager.undo()
  assert.deepEqual(labels(graph, 'heap-1'), before)

  manager.redo()
  assert.equal(graph.nodes.get('heap-1').children[0], 'cluster-8')
})

test('new operation clears the redo stack', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  manager.apply({
    type: 'drop-node',
    payload: {
      resource: { id: 'a', label: 'A' },
      parentId: 'energy-root',
      index: 0,
      id: 'res-a-1',
    },
  })
  manager.undo()
  assert.equal(manager.canRedo(), true)

  manager.apply({
    type: 'drop-node',
    payload: {
      resource: { id: 'b', label: 'B' },
      parentId: 'energy-root',
      index: 0,
      id: 'res-b-1',
    },
  })

  assert.equal(manager.canRedo(), false)
})

test('readonly and before hooks block operations without mutating graph', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const before = labels(graph, 'energy-root')

  const readonlyResult = manager.apply(
    {
      type: 'drop-node',
      payload: {
        resource: { id: 'blocked', label: 'Blocked' },
        parentId: 'energy-root',
        index: 0,
        id: 'res-blocked-1',
      },
    },
    { readonly: true },
  )
  assert.equal(readonlyResult.applied, false)
  assert.equal(readonlyResult.reason, 'readonly')

  const hookResult = manager.apply(
    {
      type: 'drop-node',
      payload: {
        resource: { id: 'blocked-hook', label: 'Blocked Hook' },
        parentId: 'energy-root',
        index: 0,
        id: 'res-blocked-hook-1',
      },
    },
    { before: () => false },
  )
  assert.equal(hookResult.applied, false)
  assert.equal(hookResult.reason, 'blocked')
  assert.deepEqual(labels(graph, 'energy-root'), before)
  assert.equal(manager.canUndo(), false)
})

test('invalid operations return invalid and do not throw', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  assert.equal(
    manager.apply({
      type: 'drop-node',
      payload: {
        resource: { id: 'x', label: 'X' },
        parentId: 'missing',
        index: 0,
        id: 'res-x-1',
      },
    }).reason,
    'invalid',
  )
  assert.equal(
    manager.apply({
      type: 'drop-node',
      payload: {
        resource: { id: 'x', label: 'X' },
        parentId: 'energy-root',
        index: 0,
        id: 'energy-root',
      },
    }).reason,
    'invalid',
  )
  assert.equal(
    manager.apply({
      type: 'reorder-group-child',
      payload: { groupId: 'heap-1::g0', parentId: 'heap-1', childId: 'not-a-child', index: 0 },
    }).reason,
    'invalid',
  )
  assert.equal(manager.undo().reason, 'empty')
  assert.equal(manager.redo().reason, 'empty')
})

test('delete-nodes removes selected subtrees, root ids, and related edges with undo redo', () => {
  const graph = createDemoGraph()
  graph.rootIds.push('standalone')
  graph.nodes.set('standalone', { id: 'standalone', label: 'Standalone', parentId: null, children: [] })
  graph.edges.push({ id: 'edge-a', source: 'grid-tie', target: 'feeder-1' })
  graph.edges.push({ id: 'edge-b', source: 'heap-1', target: 'standalone' })
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'delete-nodes',
    payload: { ids: ['grid-tie', 'feeder-1', 'standalone'], expandedIds: ['grid-tie', 'feeder-1', 'standalone'] },
  })

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.has('grid-tie'), false)
  assert.equal(graph.nodes.has('feeder-1'), false)
  assert.equal(graph.nodes.has('standalone'), false)
  assert.deepEqual(graph.nodes.get('energy-root').children, ['heap-1', 'cluster-25'])
  assert.deepEqual(graph.rootIds, ['energy-root'])
  assert.deepEqual(graph.edges, [])

  manager.undo()
  assert.equal(graph.nodes.has('grid-tie'), true)
  assert.equal(graph.nodes.has('feeder-1'), true)
  assert.equal(graph.nodes.has('standalone'), true)
  assert.deepEqual(graph.nodes.get('energy-root').children, ['grid-tie', 'heap-1', 'cluster-25'])
  assert.deepEqual(graph.rootIds, ['energy-root', 'standalone'])
  assert.equal(graph.edges.length, 2)

  manager.redo()
  assert.equal(graph.nodes.has('grid-tie'), false)
  assert.deepEqual(graph.edges, [])
})

test('replace-graph swaps graph contents and can undo redo', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const next = {
    version: 1,
    nodes: new Map([['new-root', { id: 'new-root', label: 'New Root', parentId: null, children: [] }]]),
    rootIds: ['new-root'],
    edges: [],
  }

  const result = manager.apply({ type: 'replace-graph', payload: { graph: next } })

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.has('energy-root'), false)
  assert.equal(graph.nodes.has('new-root'), true)
  assert.deepEqual(graph.rootIds, ['new-root'])

  manager.undo()
  assert.equal(graph.nodes.has('energy-root'), true)
  assert.equal(graph.nodes.has('new-root'), false)

  manager.redo()
  assert.equal(graph.nodes.has('new-root'), true)
})

test('replace-graph rejects graph payloads with missing edges', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const malformed = {
    version: 1,
    nodes: new Map([['new-root', { id: 'new-root', label: 'New Root', parentId: null, children: [] }]]),
    rootIds: ['new-root'],
  }

  const result = manager.apply({ type: 'replace-graph', payload: { graph: malformed } })

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'invalid')
})

test('delete paste and import operations respect readonly and before hooks', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const snapshot = captureSubtreeSnapshot(graph, ['grid-tie'])

  assert.equal(
    manager.apply(
      { type: 'delete-nodes', payload: { ids: ['grid-tie'], expandedIds: ['grid-tie'] } },
      { readonly: true },
    ).reason,
    'readonly',
  )
  assert.equal(
    manager.apply(
      {
        type: 'paste-nodes',
        payload: {
          targetParentId: 'cluster-25',
          snapshot,
          idMap: {
            'grid-tie': 'paste-grid-tie-1',
            'feeder-1': 'paste-feeder-1-1',
            'feeder-2': 'paste-feeder-2-1',
            'feeder-3': 'paste-feeder-3-1',
          },
        },
      },
      { before: () => false },
    ).reason,
    'blocked',
  )
  assert.equal(
    manager.apply(
      { type: 'replace-graph', payload: { graph: createDemoGraph() } },
      { before: () => false },
    ).reason,
    'blocked',
  )
})

test('delete and paste return empty or invalid for unusable payloads', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const snapshot = captureSubtreeSnapshot(graph, ['grid-tie'])

  assert.equal(manager.apply({ type: 'delete-nodes', payload: { ids: [], expandedIds: [] } }).reason, 'empty')
  assert.equal(
    manager.apply({ type: 'paste-nodes', payload: { targetParentId: null, snapshot, idMap: {} } }).reason,
    'empty',
  )
  assert.equal(
    manager.apply({
      type: 'paste-nodes',
      payload: { targetParentId: 'cluster-25', snapshot: { rootIds: [], nodes: [] }, idMap: {} },
    }).reason,
    'empty',
  )
  assert.equal(
    manager.apply({
      type: 'paste-nodes',
      payload: { targetParentId: 'cluster-25', snapshot, idMap: {} },
    }).reason,
    'invalid',
  )
})

test('captureSubtreeSnapshot returns a JSON-safe snapshot decoupled from the live graph', () => {
  const graph = createDemoGraph()

  const snapshot = captureSubtreeSnapshot(graph, ['grid-tie'])

  assert.deepEqual(snapshot.rootIds, ['grid-tie'])
  assert.equal(snapshot.nodes.length, 4)
  assert.equal(snapshot.nodes.some((node) => node.id === 'grid-tie'), true)
  assert.equal(snapshot.nodes.some((node) => node.id === 'feeder-1'), true)
  assert.equal(JSON.parse(JSON.stringify(snapshot)).nodes.length, 4)

  const clonedNode = snapshot.nodes.find((node) => node.id === 'grid-tie')
  clonedNode.children.push('mutated')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-1', 'feeder-2', 'feeder-3'])
})

test('captureSubtreeSnapshot deduplicates a selected parent and its own descendant', () => {
  const graph = createDemoGraph()

  const snapshot = captureSubtreeSnapshot(graph, ['grid-tie', 'feeder-1'])

  assert.deepEqual(snapshot.rootIds, ['grid-tie'])
  assert.equal(snapshot.nodes.length, 4)
})

test('captureSubtreeSnapshot returns an empty snapshot for an empty selection', () => {
  const graph = createDemoGraph()

  assert.deepEqual(captureSubtreeSnapshot(graph, []), { rootIds: [], nodes: [] })
})

test('paste-nodes inserts a snapshot as children of the target and can undo redo', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const snapshot = captureSubtreeSnapshot(graph, ['grid-tie'])

  const result = manager.apply({
    type: 'paste-nodes',
    payload: {
      targetParentId: 'cluster-25',
      snapshot,
      idMap: {
        'grid-tie': 'paste-grid-tie-1',
        'feeder-1': 'paste-feeder-1-1',
        'feeder-2': 'paste-feeder-2-1',
        'feeder-3': 'paste-feeder-3-1',
      },
    },
  })

  assert.equal(result.applied, true)
  assert.deepEqual(result.operation.payload.pastedIds, ['paste-grid-tie-1'])
  assert.equal(graph.nodes.has('paste-grid-tie-1'), true)
  assert.deepEqual(graph.nodes.get('paste-grid-tie-1').children, [
    'paste-feeder-1-1',
    'paste-feeder-2-1',
    'paste-feeder-3-1',
  ])
  assert.equal(graph.nodes.get('paste-feeder-1-1').parentId, 'paste-grid-tie-1')
  assert.equal(graph.nodes.get('paste-grid-tie-1').parentId, 'cluster-25')
  assert.equal(graph.nodes.get('cluster-25').children.at(-1), 'paste-grid-tie-1')
  assert.equal(graph.nodes.has('grid-tie'), true)

  manager.undo()
  assert.equal(graph.nodes.has('paste-grid-tie-1'), false)
  assert.equal(graph.nodes.get('cluster-25').children.includes('paste-grid-tie-1'), false)

  manager.redo()
  assert.equal(graph.nodes.has('paste-grid-tie-1'), true)
})

test('paste-nodes can be applied twice with different idMaps without id collisions', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const snapshot = captureSubtreeSnapshot(graph, ['feeder-1'])

  manager.apply({
    type: 'paste-nodes',
    payload: { targetParentId: 'cluster-25', snapshot, idMap: { 'feeder-1': 'paste-feeder-1-1' } },
  })
  manager.apply({
    type: 'paste-nodes',
    payload: { targetParentId: 'cluster-25', snapshot, idMap: { 'feeder-1': 'paste-feeder-1-2' } },
  })

  assert.equal(graph.nodes.has('paste-feeder-1-1'), true)
  assert.equal(graph.nodes.has('paste-feeder-1-2'), true)
  assert.deepEqual(graph.nodes.get('cluster-25').children.slice(-2), ['paste-feeder-1-1', 'paste-feeder-1-2'])
})

test('paste-nodes rejects idMap values that collide with existing node ids', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const snapshot = captureSubtreeSnapshot(graph, ['feeder-1'])
  const gridTieOriginalLabel = graph.nodes.get('grid-tie').label
  const gridTieOriginalParentId = graph.nodes.get('grid-tie').parentId
  const cluster25ChildrenBefore = graph.nodes.get('cluster-25').children.slice()

  const result = manager.apply({
    type: 'paste-nodes',
    payload: {
      targetParentId: 'cluster-25',
      snapshot,
      idMap: { 'feeder-1': 'grid-tie' },
    },
  })

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'invalid')
  assert.equal(graph.nodes.get('grid-tie').label, gridTieOriginalLabel)
  assert.equal(graph.nodes.get('grid-tie').parentId, gridTieOriginalParentId)
  assert.deepEqual(graph.nodes.get('cluster-25').children, cluster25ChildrenBefore)
})

test('move-node moves a node and its subtree to a new parent and can undo redo', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'move-node',
    payload: { nodeId: 'grid-tie', toParentId: 'cluster-25', index: 1 },
  })

  assert.equal(result.applied, true)
  assert.equal(result.operation.payload.index, 1)
  assert.equal(graph.nodes.get('grid-tie').parentId, 'cluster-25')
  assert.equal(graph.nodes.get('energy-root').children.includes('grid-tie'), false)
  assert.equal(graph.nodes.get('cluster-25').children[1], 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')

  manager.undo()
  assert.equal(graph.nodes.get('grid-tie').parentId, 'energy-root')
  assert.equal(graph.nodes.get('energy-root').children.includes('grid-tie'), true)
  assert.equal(graph.nodes.get('cluster-25').children.includes('grid-tie'), false)

  manager.redo()
  assert.equal(graph.nodes.get('grid-tie').parentId, 'cluster-25')
})

test('move-node removes a moved root from rootIds', () => {
  const graph = createDemoGraph()
  graph.rootIds.push('standalone')
  graph.nodes.set('standalone', { id: 'standalone', label: 'Standalone', parentId: null, children: [] })
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'move-node',
    payload: { nodeId: 'standalone', toParentId: 'cluster-25', index: 0 },
  })

  assert.equal(result.applied, true)
  assert.deepEqual(graph.rootIds, ['energy-root'])
  assert.equal(graph.nodes.get('standalone').parentId, 'cluster-25')

  manager.undo()
  assert.deepEqual(graph.rootIds, ['energy-root', 'standalone'])
})

test('move-node rejects moving a node onto itself or its own descendant', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  assert.equal(
    manager.apply({ type: 'move-node', payload: { nodeId: 'grid-tie', toParentId: 'grid-tie', index: 0 } }).reason,
    'invalid',
  )
  assert.equal(
    manager.apply({ type: 'move-node', payload: { nodeId: 'grid-tie', toParentId: 'feeder-1', index: 0 } }).reason,
    'invalid',
  )
  assert.equal(graph.nodes.get('grid-tie').parentId, 'energy-root')
})

test('move-node returns invalid for a missing node or missing target parent', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  assert.equal(
    manager.apply({ type: 'move-node', payload: { nodeId: 'missing', toParentId: 'cluster-25', index: 0 } }).reason,
    'invalid',
  )
  assert.equal(
    manager.apply({ type: 'move-node', payload: { nodeId: 'grid-tie', toParentId: 'missing', index: 0 } }).reason,
    'invalid',
  )
})

test('move-node respects readonly and before hooks', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  assert.equal(
    manager.apply(
      { type: 'move-node', payload: { nodeId: 'grid-tie', toParentId: 'cluster-25', index: 0 } },
      { readonly: true },
    ).reason,
    'readonly',
  )
  assert.equal(
    manager.apply(
      { type: 'move-node', payload: { nodeId: 'grid-tie', toParentId: 'cluster-25', index: 0 } },
      { before: () => false },
    ).reason,
    'blocked',
  )
  assert.equal(graph.nodes.get('grid-tie').parentId, 'energy-root')
})
