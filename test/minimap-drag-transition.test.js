import test from 'node:test'
import assert from 'node:assert/strict'
import { computeLayout, GROUP } from '../src/minimap/layout.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { easeOutCubic } from '../src/minimap/layout-transition.js'
import {
  buildVirtualOrder,
  childWorldRectsById,
  currentShiftRects,
  dragShiftEasedProgress,
  interpolateChildRects,
} from '../src/minimap/drag-transition.js'

const LAYOUT_OPTS = { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 }

test('buildVirtualOrder inserts the dragged child at the target index', () => {
  const group = { children: ['a', 'b', 'c', 'd'] }
  assert.deepEqual(buildVirtualOrder(group, 'b', 0), ['b', 'a', 'c', 'd'])
  assert.deepEqual(buildVirtualOrder(group, 'b', 2), ['a', 'c', 'b', 'd'])
})

test('childWorldRectsById shifts visible children when the virtual order changes', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((item) => item.parentId === 'heap-1')
  const original = childWorldRectsById(group, group.children)
  const reordered = childWorldRectsById(group, buildVirtualOrder(group, 'cluster-1', 2))

  assert.notEqual(original['cluster-1'].y, reordered['cluster-1'].y)
  assert.notEqual(original['cluster-2'].x, reordered['cluster-2'].x)
})

test('interpolateChildRects blends matching child world rects', () => {
  const from = { a: { x: 0, y: 0, width: 120, height: 40 } }
  const to = { a: { x: 100, y: 50, width: 120, height: 40 } }
  const eased = easeOutCubic(0.5)
  const mid = interpolateChildRects(from, to, eased)

  assert.equal(mid.a.x, 100 * eased)
  assert.equal(mid.a.y, 50 * eased)
})

test('currentShiftRects returns the target rects when the shift duration has elapsed', () => {
  const from = { a: { x: 0, y: 0, width: 120, height: 40 } }
  const to = { a: { x: 100, y: 50, width: 120, height: 40 } }
  const rects = currentShiftRects(from, to, 0, 150, 200)
  assert.deepEqual(rects, to)
})

test('dragShiftEasedProgress eases toward 1 over time', () => {
  assert.equal(dragShiftEasedProgress(0, 150, 0), 0)
  assert.ok(dragShiftEasedProgress(0, 150, 75) > 0.4)
  assert.equal(dragShiftEasedProgress(0, 150, 150), 1)
})
