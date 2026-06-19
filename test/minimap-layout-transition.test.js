import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createLayoutTransition,
  easeOutCubic,
  layoutAt,
  resolveAnchorCenter,
} from '../src/minimap/layout-transition.js'

function layoutOf({ nodes = [], groups = [], visibleItems = nodes.map(([id, rect]) => ({ type: 'node', id, ...rect })) }) {
  return {
    nodes: new Map(nodes),
    groups,
    visibleItems,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  }
}

test('layoutAt interpolates matching node rectangles with eased progress', () => {
  const transition = createLayoutTransition({
    fromLayout: layoutOf({ nodes: [['a', { x: 0, y: 10, width: 100, height: 40 }]] }),
    toLayout: layoutOf({ nodes: [['a', { x: 100, y: 50, width: 120, height: 60 }]] }),
    fromViewport: { x: 0, y: 0, scale: 1 },
    toViewport: { x: 0, y: 0, scale: 1 },
    durationMs: 200,
  })

  const { layout } = layoutAt(transition, 0.5)
  const eased = easeOutCubic(0.5)

  assert.deepEqual(layout.nodes.get('a'), {
    x: 0 + (100 - 0) * eased,
    y: 10 + (50 - 10) * eased,
    width: 100 + (120 - 100) * eased,
    height: 40 + (60 - 40) * eased,
  })
})

test('layoutAt interpolates matching group rectangles by id', () => {
  const fromGroup = { id: 'heap::g0', parentId: 'heap', children: ['a'], x: 0, y: 0, width: 200, height: 100 }
  const toGroup = { id: 'heap::g0', parentId: 'heap', children: ['a'], x: 80, y: 40, width: 260, height: 140 }
  const transition = createLayoutTransition({
    fromLayout: layoutOf({
      groups: [fromGroup],
      visibleItems: [{ type: 'group', id: 'heap::g0', parentId: 'heap', x: 0, y: 0, width: 200, height: 100 }],
    }),
    toLayout: layoutOf({
      groups: [toGroup],
      visibleItems: [{ type: 'group', id: 'heap::g0', parentId: 'heap', x: 80, y: 40, width: 260, height: 140 }],
    }),
    fromViewport: { x: 0, y: 0, scale: 1 },
    toViewport: { x: 0, y: 0, scale: 1 },
    durationMs: 200,
  })

  const { layout } = layoutAt(transition, 0.5)
  const group = layout.groups[0]

  assert.equal(group.id, 'heap::g0')
  assert.ok(group.x > fromGroup.x && group.x < toGroup.x)
  assert.ok(group.width > fromGroup.width && group.width < toGroup.width)
  assert.deepEqual(layout.visibleItems[0], {
    type: 'group',
    id: 'heap::g0',
    parentId: 'heap',
    x: group.x,
    y: group.y,
    width: group.width,
    height: group.height,
  })
})

test('layoutAt interpolates two groups under the same parentId independently', () => {
  const fromGroups = [
    { id: 'p::g0', parentId: 'p', children: ['a0'], x: 0, y: 0, width: 200, height: 100 },
    { id: 'p::g1', parentId: 'p', children: ['b0'], x: 0, y: 200, width: 200, height: 100 },
  ]
  const toGroups = [
    { id: 'p::g0', parentId: 'p', children: ['a0'], x: 50, y: 0, width: 200, height: 100 },
    { id: 'p::g1', parentId: 'p', children: ['b0'], x: 0, y: 500, width: 200, height: 100 },
  ]
  const toVisibleItems = toGroups.map((g) => ({
    type: 'group',
    id: g.id,
    parentId: g.parentId,
    x: g.x,
    y: g.y,
    width: g.width,
    height: g.height,
  }))
  const fromVisibleItems = fromGroups.map((g) => ({
    type: 'group',
    id: g.id,
    parentId: g.parentId,
    x: g.x,
    y: g.y,
    width: g.width,
    height: g.height,
  }))

  const transition = createLayoutTransition({
    fromLayout: layoutOf({ groups: fromGroups, visibleItems: fromVisibleItems }),
    toLayout: layoutOf({ groups: toGroups, visibleItems: toVisibleItems }),
    fromViewport: { x: 0, y: 0, scale: 1 },
    toViewport: { x: 0, y: 0, scale: 1 },
    durationMs: 200,
  })

  const { layout } = layoutAt(transition, 0.5)
  const g0 = layout.groups.find((g) => g.id === 'p::g0')
  const g1 = layout.groups.find((g) => g.id === 'p::g1')

  // g0 只在 x 上变化（0 -> 50），g1 只在 y 上变化（200 -> 500）；
  // 如果两个分组按 parentId 共享同一个 key，其中一个会被另一个的起始矩形污染。
  assert.ok(g0.x > 0 && g0.x < 50)
  assert.equal(g0.y, 0)
  assert.equal(g1.x, 0)
  assert.ok(g1.y > 200 && g1.y < 500)
})

test('layoutAt uses target rectangles for newly visible items', () => {
  const transition = createLayoutTransition({
    fromLayout: layoutOf({ nodes: [['a', { x: 0, y: 0, width: 100, height: 40 }]] }),
    toLayout: layoutOf({
      nodes: [
        ['a', { x: 100, y: 0, width: 100, height: 40 }],
        ['b', { x: 240, y: 80, width: 100, height: 40 }],
      ],
    }),
    fromViewport: { x: 0, y: 0, scale: 1 },
    toViewport: { x: 0, y: 0, scale: 1 },
    durationMs: 200,
  })

  const { layout } = layoutAt(transition, 0.25)

  assert.deepEqual(layout.nodes.get('b'), { x: 240, y: 80, width: 100, height: 40 })
  assert.deepEqual(layout.visibleItems.map((item) => item.id), ['a', 'b'])
})

test('layoutAt calculates bounds from transition visible items', () => {
  const transition = createLayoutTransition({
    fromLayout: layoutOf({ nodes: [['a', { x: 0, y: 0, width: 100, height: 40 }]] }),
    toLayout: layoutOf({
      nodes: [
        ['a', { x: 100, y: 80, width: 100, height: 40 }],
        ['b', { x: 300, y: -20, width: 50, height: 30 }],
      ],
    }),
    fromViewport: { x: 0, y: 0, scale: 1 },
    toViewport: { x: 0, y: 0, scale: 1 },
    durationMs: 200,
  })

  const { layout } = layoutAt(transition, 1)

  assert.deepEqual(layout.bounds, { minX: 100, minY: -20, maxX: 350, maxY: 120 })
})

test('layoutAt interpolates viewport x and y while preserving scale', () => {
  const transition = createLayoutTransition({
    fromLayout: layoutOf({ nodes: [['a', { x: 0, y: 0, width: 100, height: 40 }]] }),
    toLayout: layoutOf({ nodes: [['a', { x: 100, y: 80, width: 100, height: 40 }]] }),
    fromViewport: { x: 10, y: 20, scale: 2 },
    toViewport: { x: -90, y: -60, scale: 2 },
    durationMs: 200,
  })

  const { viewport } = layoutAt(transition, 0.5)
  const eased = easeOutCubic(0.5)

  assert.deepEqual(viewport, {
    x: 10 + (-90 - 10) * eased,
    y: 20 + (-60 - 20) * eased,
    scale: 2,
  })
})

test('resolveAnchorCenter returns the visible node center or null', () => {
  const layout = layoutOf({ nodes: [['a', { x: 10, y: 20, width: 100, height: 40 }]] })

  assert.deepEqual(resolveAnchorCenter(layout, 'a'), { x: 60, y: 40 })
  assert.equal(resolveAnchorCenter(layout, 'missing'), null)
})
