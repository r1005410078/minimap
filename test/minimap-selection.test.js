import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { computeLayout, visibleGroupChildren } from '../src/minimap/graph/layout.js'
import {
  applySelectionClick,
  applySelectionSet,
  buildSelectionRelations,
  expandSelectedNodeIds,
  idsInSelectionRect,
  intersectsRect,
  resolveDragNodeIds,
  stripRedundantGroupSelection,
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

test('idsInSelectionRect returns visible nodes intersecting the marquee but not group containers', () => {
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
  assert.equal(ids.includes(heapGroup.id), false)
  assert.ok(heapGroup.children.some((childId) => ids.includes(childId)))
})

test('stripRedundantGroupSelection removes a group id when its children are also selected', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')

  assert.deepEqual(
    stripRedundantGroupSelection([heapGroup.id, 'cluster-1', 'cluster-2'], layout).sort(),
    ['cluster-1', 'cluster-2'],
  )
  assert.deepEqual(stripRedundantGroupSelection([heapGroup.id], layout), [heapGroup.id])
})

test('expandSelectedNodeIds expands a lone group id but keeps individually selected children', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')

  assert.deepEqual(expandSelectedNodeIds(['cluster-1', 'cluster-2'], layout).sort(), ['cluster-1', 'cluster-2'])
  assert.deepEqual(
    expandSelectedNodeIds([heapGroup.id, 'cluster-1', 'cluster-2'], layout).sort(),
    ['cluster-1', 'cluster-2'],
  )
  assert.deepEqual(
    expandSelectedNodeIds([heapGroup.id], layout).sort(),
    [...heapGroup.children].sort(),
  )
})

test('buildSelectionRelations does not keep group chrome selected when individual children are selected', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const relations = buildSelectionRelations(graph, layout, [heapGroup.id, heapGroup.children[0], heapGroup.children[1]])

  assert.equal(relations.selectedIds.has(heapGroup.id), false)
  assert.equal(relations.selectedIds.has(heapGroup.children[0]), true)
  assert.equal(relations.selectedIds.has(heapGroup.children[1]), true)
})

test('resolveDragNodeIds returns all selected siblings when dragging one of them', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })

  assert.deepEqual(
    resolveDragNodeIds('feeder-2', ['feeder-1', 'feeder-2', 'feeder-3'], graph, layout),
    ['feeder-1', 'feeder-2', 'feeder-3'],
  )
  assert.deepEqual(resolveDragNodeIds('feeder-2', ['feeder-2'], graph, layout), ['feeder-2'])
  assert.deepEqual(resolveDragNodeIds('feeder-2', ['grid-tie', 'feeder-2'], graph, layout), ['feeder-2'])
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

test("idsInSelectionRect excludes a group's children when the marquee never touches the group box", () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const grid = layout.nodes.get('grid-tie')
  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const cluster25Group = layout.groups.find((group) => group.parentId === 'cluster-25')

  const ids = idsInSelectionRect(
    layout,
    { x: grid.x, y: grid.y, width: grid.width, height: grid.height },
    { x: 0, y: 0, scale: 1 },
  )

  assert.deepEqual(ids, ['grid-tie'])
  assert.equal(heapGroup.children.some((childId) => ids.includes(childId)), false)
  assert.equal(cluster25Group.children.some((childId) => ids.includes(childId)), false)
})

test("idsInSelectionRect includes a group's children when the marquee only grazes a corner of the group box", () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const heapGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const firstChild = visibleGroupChildren(heapGroup)[0]

  const ids = idsInSelectionRect(
    layout,
    {
      x: heapGroup.x,
      y: heapGroup.y,
      width: firstChild.rect.x + firstChild.rect.width / 2 - heapGroup.x,
      height: firstChild.rect.y + firstChild.rect.height / 2 - heapGroup.y,
    },
    { x: 0, y: 0, scale: 1 },
  )

  assert.ok(ids.includes(firstChild.id))
  assert.equal(ids.includes('grid-tie'), false)
  assert.equal(ids.includes('cluster-25'), false)
})
