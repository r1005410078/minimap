import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph.js'
import { createGraphOperationManager } from '../src/minimap/graph-operations.js'

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
