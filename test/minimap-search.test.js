import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { searchNodes } from '../src/minimap/edit/search.js'

test('searchNodes matches id and label case-insensitively', () => {
  const graph = createDemoGraph()
  assert.deepEqual(searchNodes(graph, 'feeder'), ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.deepEqual(searchNodes(graph, 'FEEDER'), ['feeder-1', 'feeder-2', 'feeder-3'])
})

test('searchNodes matches a grouped child by exact substring', () => {
  const graph = createDemoGraph()
  assert.deepEqual(searchNodes(graph, 'cluster-24'), ['cluster-24'])
})

test('searchNodes returns matches in depth-first document order', () => {
  const graph = createDemoGraph()
  const matches = searchNodes(graph, 'cluster')
  assert.equal(matches.length, 25)
  assert.deepEqual(matches.slice(0, 3), ['cluster-1', 'cluster-2', 'cluster-3'])
  assert.equal(matches.at(-1), 'cluster-25')
})

test('searchNodes returns empty array for empty or whitespace-only keyword', () => {
  const graph = createDemoGraph()
  assert.deepEqual(searchNodes(graph, ''), [])
  assert.deepEqual(searchNodes(graph, '   '), [])
})

test('searchNodes returns empty array when nothing matches', () => {
  const graph = createDemoGraph()
  assert.deepEqual(searchNodes(graph, 'zzz-nope'), [])
})
