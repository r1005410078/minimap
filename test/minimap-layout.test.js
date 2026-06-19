import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDemoGraph,
  createStressGraph,
  reorderGroupChild,
} from '../src/minimap/graph.js'
import {
  GROUP_THRESHOLD,
  computeLayout,
  keepAnchorStable,
  clampGroupScroll,
} from '../src/minimap/layout.js'

const VIEWPORT = { direction: 'horizontal', viewportWidth: 1200, viewportHeight: 760 }

// 生成一个 root -> p -> children 的小图；childSpecs 里字符串视为叶子 id，
// { id, children } 视为带子节点的非叶子兄弟（自身永不参与合并）。
function graphWithChildren(childSpecs) {
  const nodes = new Map()
  nodes.set('r', { id: 'r', label: 'r', parentId: null, children: ['p'] })
  const childIds = []
  for (const spec of childSpecs) {
    if (typeof spec === 'string') {
      childIds.push(spec)
      nodes.set(spec, { id: spec, label: spec, parentId: 'p', children: [] })
    } else {
      childIds.push(spec.id)
      nodes.set(spec.id, { id: spec.id, label: spec.id, parentId: 'p', children: spec.children })
      for (const grandchildId of spec.children) {
        nodes.set(grandchildId, { id: grandchildId, label: grandchildId, parentId: spec.id, children: [] })
      }
    }
  }
  nodes.set('p', { id: 'p', label: 'p', parentId: 'r', children: childIds })
  return { version: 1, nodes, rootIds: ['r'], edges: [] }
}

function leaves(prefix, count) {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`)
}

test('groups adjacent siblings only when the run is larger than the threshold', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, {
    direction: 'horizontal',
    viewportWidth: 1200,
    viewportHeight: 760,
  })

  const mainGroup = layout.groups.find((group) => group.parentId === 'heap-1')
  const smallGroup = layout.groups.find((group) => group.parentId === 'cluster-25')

  assert.equal(GROUP_THRESHOLD, 5)
  assert.equal(mainGroup.children.length, 24)
  assert.equal(smallGroup.children.length, 10)
  assert.ok(mainGroup.width <= 1200 * 0.48)
  assert.ok(mainGroup.height <= 760 * 0.42)
  assert.equal(mainGroup.overflowY, true)
})

test('supports horizontal and vertical layout directions', () => {
  const graph = createDemoGraph()
  const horizontal = computeLayout(graph, {
    direction: 'horizontal',
    viewportWidth: 1200,
    viewportHeight: 760,
  })
  const vertical = computeLayout(graph, {
    direction: 'vertical',
    viewportWidth: 1200,
    viewportHeight: 760,
  })

  assert.ok(horizontal.nodes.get('heap-1').x > horizontal.nodes.get('energy-root').x)
  assert.ok(vertical.nodes.get('heap-1').y > vertical.nodes.get('energy-root').y)
})

test('odd sibling counts align the parent to the middle child center', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, {
    direction: 'horizontal',
    viewportWidth: 1200,
    viewportHeight: 760,
  })

  const root = layout.nodes.get('energy-root')
  const heap = layout.nodes.get('heap-1')
  const rootCenter = root.y + root.height / 2
  const heapCenter = heap.y + heap.height / 2

  assert.equal(rootCenter, heapCenter)
})

test('reorders a child inside a group by changing graph child order', () => {
  const graph = createDemoGraph()

  reorderGroupChild(graph, 'heap-1', 'cluster-8', 1)

  const heap = graph.nodes.get('heap-1')
  assert.equal(heap.children[1], 'cluster-8')
  assert.equal(new Set(heap.children).size, heap.children.length)
})

test('keeps the selected anchor stable after relayout', () => {
  const before = { x: 100, y: 120 }
  const after = { x: 240, y: 300 }
  const viewport = { x: -40, y: -70, scale: 1 }

  const next = keepAnchorStable(viewport, before, after)

  assert.deepEqual(next, { x: -180, y: -250, scale: 1 })
})

test('creates a stress graph with 10000 child nodes', () => {
  const graph = createStressGraph(10000)
  const layout = computeLayout(graph, {
    direction: 'horizontal',
    viewportWidth: 1440,
    viewportHeight: 900,
  })

  assert.equal(graph.nodes.size, 10002)
  assert.equal(layout.groups[0].children.length, 10000)
  assert.ok(layout.visibleItems.length < graph.nodes.size)
})

test('even sibling counts keep the parent centered between the two middle children', () => {
  const nodes = new Map([
    ['root', { id: 'root', label: 'root', parentId: null, children: ['a', 'b'] }],
    ['a', { id: 'a', label: 'a', parentId: 'root', children: [] }],
    ['b', { id: 'b', label: 'b', parentId: 'root', children: [] }],
  ])
  const graph = { version: 1, nodes, rootIds: ['root'], edges: [] }
  const layout = computeLayout(graph, {
    direction: 'horizontal',
    viewportWidth: 1200,
    viewportHeight: 760,
  })

  const center = (id) => {
    const box = layout.nodes.get(id)
    return box.y + box.height / 2
  }
  const expected = (center('a') + center('b')) / 2

  assert.ok(Math.abs(center('root') - expected) < 1e-6)
})

test('a sibling with children truncates a leaf run into two independent groups', () => {
  const graph = graphWithChildren([
    ...leaves('a', 6),
    { id: 'mid', children: ['mid-child'] },
    ...leaves('b', 6),
  ])
  const layout = computeLayout(graph, VIEWPORT)

  assert.equal(layout.groups.length, 2)
  const [first, second] = layout.groups
  assert.notEqual(first.id, second.id)
  assert.deepEqual(first.children, leaves('a', 6))
  assert.deepEqual(second.children, leaves('b', 6))
  assert.ok(layout.nodes.has('mid'))
  assert.ok(!layout.nodes.has('a0'))
})

test('only the run that exceeds the threshold becomes a group', () => {
  const graph = graphWithChildren([
    ...leaves('a', 6),
    { id: 'mid', children: ['mid-child'] },
    ...leaves('b', 3),
  ])
  const layout = computeLayout(graph, VIEWPORT)

  assert.equal(layout.groups.length, 1)
  assert.deepEqual(layout.groups[0].children, leaves('a', 6))
  for (const id of leaves('b', 3)) assert.ok(layout.nodes.has(id))
})

test('options.groupThreshold overrides the default threshold', () => {
  const graph = graphWithChildren(leaves('c', 6))
  const folded = computeLayout(graph, { ...VIEWPORT, groupThreshold: 5 })
  const notFolded = computeLayout(graph, { ...VIEWPORT, groupThreshold: 6 })

  assert.equal(folded.groups.length, 1)
  assert.equal(notFolded.groups.length, 0)
})

test('group size never shrinks below the minimum usable grid', () => {
  const graph = graphWithChildren(leaves('d', 6))
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 10, viewportHeight: 10 })

  assert.equal(layout.groups[0].width, 144) // 2*12(padding) + 120(itemW)
  assert.equal(layout.groups[0].height, 92) // 28(header) + 2*12(padding) + 40(itemH)
})

test('clampGroupScroll clamps to the valid scroll range', () => {
  const overflowing = { height: 100, contentHeight: 250, overflowY: true }
  assert.equal(clampGroupScroll(overflowing, -50), 0)
  assert.equal(clampGroupScroll(overflowing, 1000), 150)
  assert.equal(clampGroupScroll(overflowing, 80), 80)

  const notOverflowing = { height: 250, contentHeight: 250, overflowY: false }
  assert.equal(clampGroupScroll(notOverflowing, 9999), 0)
})

test('options.groupStates can expand a group beyond the collapsed max height', () => {
  const graph = graphWithChildren(leaves('e', 30))
  const collapsedLayout = computeLayout(graph, VIEWPORT)
  assert.equal(collapsedLayout.groups[0].overflowY, true)
  const groupId = collapsedLayout.groups[0].id

  const expandedLayout = computeLayout(graph, {
    ...VIEWPORT,
    groupStates: new Map([[groupId, { expanded: true }]]),
  })
  const expandedGroup = expandedLayout.groups[0]

  assert.equal(expandedGroup.expanded, true)
  assert.equal(expandedGroup.overflowY, false)
  assert.equal(expandedGroup.scrollTop, 0)
  assert.equal(expandedGroup.height, expandedGroup.contentHeight)
  assert.ok(expandedGroup.height > collapsedLayout.groups[0].height)
  assert.equal(expandedGroup.columns, collapsedLayout.groups[0].columns)
})
