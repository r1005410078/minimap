import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { computeLayout } from '../src/minimap/graph/layout.js'
import {
  applySelectionClick,
  applySelectionSet,
  buildSelectionRelations,
  idsInSelectionRect,
  intersectsRect,
} from '../src/minimap/interaction/selection.js'

test('applySelectionClick replaces selection without modifier keys', () => {
  assert.deepEqual(applySelectionClick(['a', 'b'], 'c', { additive: false }), ['c'])
})

test('applySelectionClick toggles selection with modifier keys', () => {
  assert.deepEqual(applySelectionClick(['a'], 'b', { additive: true }), ['a', 'b'])
  assert.deepEqual(applySelectionClick(['a', 'b'], 'a', { additive: true }), ['b'])
})

test('intersectsRect handles reversed drag rectangles', () => {
  const rect = { x: 200, y: 200, width: -100, height: -80 }
  assert.equal(intersectsRect(rect, { x: 120, y: 130, width: 20, height: 20 }), true)
  assert.equal(intersectsRect(rect, { x: 20, y: 20, width: 20, height: 20 }), false)
})

test('idsInSelectionRect returns visible nodes and groups intersecting the marquee', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')

  const ids = idsInSelectionRect(
    layout,
    {
      x: grid.x - 8,
      y: grid.y - 8,
      width: heapGroup.x + heapGroup.width - grid.x + 16,
      height: heapGroup.y + heapGroup.height - grid.y + 16,
    },
    { x: 0, y: 0, scale: 1 },
  )

  assert.ok(ids.includes('grid-tie'))
  assert.ok(ids.includes(heapGroup.id))
})

test('buildSelectionRelations marks parents, children, and tree edges as related', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const relations = buildSelectionRelations(graph, layout, ['grid-tie'])

  assert.equal(relations.selectedIds.has('grid-tie'), true)
  assert.equal(relations.highlightedIds.has('energy-root'), true)
  assert.equal(relations.highlightedIds.has('feeder-1'), true)
  assert.equal(relations.highlightedIds.has('feeder-2'), true)
  assert.equal(relations.highlightedIds.has('feeder-3'), true)
  assert.equal(relations.dimmedIds.has('heap-1'), true)
  assert.equal(relations.highlightedEdgeIds.has('tree:energy-root:grid-tie'), true)
  assert.equal(relations.dimmedEdgeIds.has('tree:group:heap-1::g0'), true)
})

test('applySelectionSet replace mode ignores current selection', () => {
  assert.deepEqual(applySelectionSet(['a', 'b'], ['c'], 'replace'), ['c'])
  assert.deepEqual(applySelectionSet(['a', 'b'], ['c']), ['c'])
})

test('applySelectionSet add mode unions without duplicates', () => {
  assert.deepEqual(applySelectionSet(['a', 'b'], ['b', 'c'], 'add'), ['a', 'b', 'c'])
})

test('applySelectionSet remove mode subtracts the given ids', () => {
  assert.deepEqual(applySelectionSet(['a', 'b', 'c'], ['b'], 'remove'), ['a', 'c'])
})

test('applySelectionSet toggle mode flips each id independently', () => {
  assert.deepEqual(applySelectionSet(['a'], ['a', 'b'], 'toggle'), ['b'])
  assert.deepEqual(applySelectionSet([], ['a', 'b'], 'toggle'), ['a', 'b'])
})
