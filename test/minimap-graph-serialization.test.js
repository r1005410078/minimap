import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import {
  deserializeGraph,
  serializeGraph,
  validateGraphVersion,
} from '../src/minimap/graph/graph-serialization.js'

test('serializeGraph returns JSON-safe graph data with array nodes', () => {
  const graph = createDemoGraph()
  graph.edges.push({ id: 'e1', source: 'grid-tie', target: 'cluster-25', kind: 'link' })

  const data = serializeGraph(graph)

  assert.equal(data.version, 1)
  assert.equal(Array.isArray(data.nodes), true)
  assert.equal(data.nodes.some((node) => node.id === 'energy-root'), true)
  assert.deepEqual(data.rootIds, ['energy-root'])
  assert.deepEqual(data.edges, [{ id: 'e1', source: 'grid-tie', target: 'cluster-25', kind: 'link' }])
  assert.equal(JSON.parse(JSON.stringify(data)).nodes.length, graph.nodes.size)
})

test('deserializeGraph converts JSON-safe graph data back to the internal Map shape', () => {
  const graph = createDemoGraph()
  const data = serializeGraph(graph)
  const parsed = deserializeGraph(JSON.stringify(data))

  assert.equal(parsed.valid, true)
  assert.equal(parsed.graph.version, 1)
  assert.equal(parsed.graph.nodes instanceof Map, true)
  assert.deepEqual(parsed.graph.nodes.get('energy-root').children, ['grid-tie', 'heap-1', 'cluster-25'])
  assert.deepEqual(parsed.graph.rootIds, ['energy-root'])
  assert.deepEqual(parsed.graph.edges, [])
})

test('deserializeGraph accepts missing edges and children defaults', () => {
  const parsed = deserializeGraph({
    version: 1,
    nodes: [{ id: 'root', label: 'Root', parentId: null }],
    rootIds: ['root'],
  })

  assert.equal(parsed.valid, true)
  assert.deepEqual(parsed.graph.nodes.get('root').children, [])
  assert.deepEqual(parsed.graph.edges, [])
})

test('validateGraphVersion rejects unsupported versions', () => {
  assert.deepEqual(validateGraphVersion({ version: 999 }), { valid: false, reason: 'invalid-version' })
  assert.deepEqual(validateGraphVersion({ version: 1 }), { valid: true, reason: null })
})

test('deserializeGraph rejects invalid shapes without throwing', () => {
  assert.deepEqual(deserializeGraph('{bad json'), { valid: false, reason: 'invalid', graph: null })
  assert.deepEqual(deserializeGraph({ version: 999, nodes: [], rootIds: [] }), {
    valid: false,
    reason: 'invalid-version',
    graph: null,
  })
  assert.deepEqual(deserializeGraph({ version: 1, nodes: 'bad', rootIds: [] }), {
    valid: false,
    reason: 'invalid',
    graph: null,
  })
})
