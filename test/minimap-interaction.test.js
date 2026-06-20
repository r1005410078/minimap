import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, GROUP, visibleGroupChildren } from '../src/minimap/layout.js'
import {
  hitTest,
  findInsertionIndex,
  groupGridIndexAt,
  exceedsDragThreshold,
  groupAutoScrollSpeed,
  groupInsertIndexToParentIndex,
  resolveDropTarget,
  edgePanVelocity,
} from '../src/minimap/interaction.js'

const VIEWPORT = { direction: 'horizontal', viewportWidth: 1200, viewportHeight: 760 }

// root -> p -> [a0..a5, mid(带子节点,不参与合并), b0..b5]
// a0..a5、b0..b5 各自超过默认阈值(5)，各自独立折叠成一个分组；mid 是普通节点。
function multiGroupGraph() {
  const nodes = new Map()
  nodes.set('root', { id: 'root', label: 'root', parentId: null, children: ['p'] })
  const childIds = []
  for (let i = 0; i < 6; i++) {
    const id = `a${i}`
    childIds.push(id)
    nodes.set(id, { id, label: id, parentId: 'p', children: [] })
  }
  childIds.push('mid')
  nodes.set('mid', { id: 'mid', label: 'mid', parentId: 'p', children: ['mid-child'] })
  nodes.set('mid-child', { id: 'mid-child', label: 'mid-child', parentId: 'mid', children: [] })
  for (let i = 0; i < 6; i++) {
    const id = `b${i}`
    childIds.push(id)
    nodes.set(id, { id, label: id, parentId: 'p', children: [] })
  }
  nodes.set('p', { id: 'p', label: 'p', parentId: 'root', children: childIds })
  return { version: 1, nodes, rootIds: ['root'], edges: [] }
}

function firstItemCenter(group) {
  return {
    x: group.x + GROUP.padding + GROUP.itemW / 2,
    y: group.y + GROUP.header + GROUP.padding + GROUP.itemH / 2,
  }
}

test('hitTest finds the node under a point', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const rect = layout.nodes.get('energy-root')
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  assert.deepEqual(hitTest(layout, point), { type: 'node', id: 'energy-root' })
})

test('hitTest returns null when nothing is under the point', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  assert.equal(hitTest(layout, { x: -100000, y: -100000 }), null)
})

test('hitTest detects the header zone of a group and has no childId', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const point = { x: group.x + group.width / 2, y: group.y + GROUP.header / 2 }
  assert.deepEqual(hitTest(layout, point), { type: 'group', id: group.id, zone: 'header' })
})

test('hitTest detects the item zone of a group and returns the childId under the point', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const firstChild = visibleGroupChildren(group)[0]
  const point = {
    x: firstChild.rect.x + firstChild.rect.width / 2,
    y: firstChild.rect.y + firstChild.rect.height / 2,
  }
  assert.deepEqual(hitTest(layout, point), {
    type: 'group',
    id: group.id,
    zone: 'item',
    childId: firstChild.id,
  })
})

test('hitTest detects the body zone of a group for blank space inside the box', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  // 刚好在 header 下方、第一行子节点上方的 padding 缝隙里，不落在任何子节点格子上。
  const point = { x: group.x + 2, y: group.y + GROUP.header + 2 }
  assert.deepEqual(hitTest(layout, point), { type: 'group', id: group.id, zone: 'body' })
})

test('findInsertionIndex inserts before the first sibling when the point is above all of them', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const firstRect = layout.nodes.get('grid-tie')
  const point = { x: firstRect.x, y: firstRect.y - 1000 }
  assert.equal(findInsertionIndex(graph, layout, 'energy-root', point, 'horizontal'), 0)
})

test('findInsertionIndex inserts between two siblings', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const a = layout.nodes.get('grid-tie')
  const b = layout.nodes.get('heap-1')
  const midY = (a.y + a.height / 2 + b.y + b.height / 2) / 2
  const point = { x: a.x, y: midY }
  assert.equal(findInsertionIndex(graph, layout, 'energy-root', point, 'horizontal'), 1)
})

test('findInsertionIndex appends after the last sibling when the point is below all of them', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const lastRect = layout.nodes.get('cluster-25')
  const point = { x: lastRect.x, y: lastRect.y + lastRect.height + 1000 }
  assert.equal(findInsertionIndex(graph, layout, 'energy-root', point, 'horizontal'), 3)
})

test('findInsertionIndex falls back to appending when the parent is fully folded into one group', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const heap = graph.nodes.get('heap-1')
  assert.equal(findInsertionIndex(graph, layout, 'heap-1', { x: 0, y: 0 }, 'horizontal'), heap.children.length)
})

test('findInsertionIndex returns 0 for a parent with no children', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  assert.equal(findInsertionIndex(graph, layout, 'feeder-1', { x: 0, y: 0 }, 'horizontal'), 0)
})

test('findInsertionIndex lands inside a specific group segment when the point falls in its rect', () => {
  const graph = multiGroupGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const parent = graph.nodes.get('p')
  const aGroup = layout.groups.find((g) => g.children.includes('a0'))
  const point = { x: aGroup.x + aGroup.width / 2, y: aGroup.y + aGroup.height / 2 }
  const index = findInsertionIndex(graph, layout, 'p', point, 'horizontal')
  assert.equal(index, parent.children.indexOf('a5') + 1)
})

test('findInsertionIndex can insert before the first visible group segment', () => {
  const graph = multiGroupGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const aGroup = layout.groups.find((g) => g.children.includes('a0'))
  const point = { x: aGroup.x, y: aGroup.y - 1000 }
  const index = findInsertionIndex(graph, layout, 'p', point, 'horizontal')
  assert.equal(index, 0)
})

test('findInsertionIndex falls through to the ungrouped sibling between two group segments', () => {
  const graph = multiGroupGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const parent = graph.nodes.get('p')
  const aGroup = layout.groups.find((g) => g.children.includes('a0'))
  const midRect = layout.nodes.get('mid')
  const point = { x: midRect.x, y: (aGroup.y + aGroup.height + midRect.y) / 2 }
  const index = findInsertionIndex(graph, layout, 'p', point, 'horizontal')
  assert.equal(index, parent.children.indexOf('mid'))
})

test('findInsertionIndex can insert before a later visible group segment', () => {
  const graph = multiGroupGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const parent = graph.nodes.get('p')
  const midRect = layout.nodes.get('mid')
  const bGroup = layout.groups.find((g) => g.children.includes('b0'))
  const point = { x: bGroup.x, y: (midRect.y + midRect.height + bGroup.y) / 2 }
  const index = findInsertionIndex(graph, layout, 'p', point, 'horizontal')
  assert.equal(index, parent.children.indexOf('b0'))
})

test('groupGridIndexAt clamps to 0 for points above and left of the grid', () => {
  const group = {
    children: Array.from({ length: 10 }, (_, i) => `c${i}`),
    columns: 2,
    scrollTop: 0,
    x: 0,
    y: 0,
  }
  assert.equal(groupGridIndexAt(group, { x: -1000, y: -1000 }), 0)
})

test('groupGridIndexAt returns the centered child index when the point sits on its cell', () => {
  const group = {
    children: Array.from({ length: 10 }, (_, i) => `c${i}`),
    columns: 2,
    scrollTop: 0,
    x: 0,
    y: 0,
  }
  // 第一个格子(index 0)中心：x=12+60=72, y=28+12+20=60
  assert.equal(groupGridIndexAt(group, { x: 72, y: 60 }), 0)
  // 最后一个格子(index 9, row4 col1)中心：x=142+60=202, y=240+20=260
  assert.equal(groupGridIndexAt(group, { x: 202, y: 260 }), 9)
})

test('groupGridIndexAt swaps when the pointer enters a cell instead of crossing slot midpoints', () => {
  const group = {
    children: ['a', 'b', 'c', 'd'],
    columns: 2,
    scrollTop: 0,
    x: 0,
    y: 0,
  }
  // 进入 index 1 格子左上角即换位
  assert.equal(groupGridIndexAt(group, { x: 142, y: 41 }), 1)
  // 仍在 index 0 格子右半边时保持 0（round 会提前切到 1）
  assert.equal(groupGridIndexAt(group, { x: 112, y: 41 }), 0)
})

test('groupGridIndexAt clamps to children.length for points beyond the grid', () => {
  const group = {
    children: Array.from({ length: 10 }, (_, i) => `c${i}`),
    columns: 2,
    scrollTop: 0,
    x: 0,
    y: 0,
  }
  assert.equal(groupGridIndexAt(group, { x: 10000, y: 10000 }), 10)
})

test('exceedsDragThreshold compares the screen-pixel distance against the threshold', () => {
  assert.equal(exceedsDragThreshold({ x: 0, y: 0 }, { x: 0, y: 4 }, 4), false)
  assert.equal(exceedsDragThreshold({ x: 0, y: 0 }, { x: 0, y: 5 }, 4), true)
  assert.equal(exceedsDragThreshold({ x: 0, y: 0 }, { x: 3, y: 0 }), false)
})

test('groupAutoScrollSpeed returns negative speed near the top edge and positive near the bottom edge', () => {
  const group = { y: 100, height: 200, overflowY: true } // top=128, bottom=300
  assert.equal(groupAutoScrollSpeed(group, 128), -8)
  assert.equal(groupAutoScrollSpeed(group, 300), 8)
  assert.equal(groupAutoScrollSpeed(group, 140), -4) // ratio=(152-140)/24=0.5 -> -8*0.5
})

test('groupAutoScrollSpeed returns 0 outside the hot zone or when the group does not overflow', () => {
  const group = { y: 100, height: 200, overflowY: true }
  assert.equal(groupAutoScrollSpeed(group, 200), 0)
  assert.equal(groupAutoScrollSpeed(group, 127), 0)
  assert.equal(groupAutoScrollSpeed(group, 301), 0)
  assert.equal(groupAutoScrollSpeed({ ...group, overflowY: false }, 128), 0)
})

test('groupInsertIndexToParentIndex offsets by 0 when the group covers all of the parent children', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const parent = graph.nodes.get('heap-1')
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  assert.equal(groupInsertIndexToParentIndex(parent, group, 'cluster-1', 5), 5)
  assert.equal(groupInsertIndexToParentIndex(parent, group, 'cluster-24', 0), 0)
})

test('groupInsertIndexToParentIndex offsets by the segment start when the group is not the full children list', () => {
  const graph = multiGroupGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const parent = graph.nodes.get('p')
  const bGroup = layout.groups.find((g) => g.children.includes('b0'))
  // rest = [b0,b1,b2,b4,b5]；插到下标2，即夹在 b1 和 b2 之间。
  const index = groupInsertIndexToParentIndex(parent, bGroup, 'b3', 2)
  assert.equal(index, 9)
})

test('resolveDropTarget resolves a non-sibling plain node hit as the new parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const targetRect = layout.nodes.get('cluster-25')
  const point = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2 }

  const target = resolveDropTarget(graph, layout, point, 'feeder-1')

  assert.equal(target.valid, true)
  assert.equal(target.parentId, 'cluster-25')
  assert.equal(target.group, null)
  assert.equal(target.insertIndex, null)
})

test('resolveDropTarget resolves a sibling plain node hit as a same-parent reorder target', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const targetRect = layout.nodes.get('feeder-2')
  const beforePoint = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + 2 }
  const afterPoint = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height - 2 }

  const beforeTarget = resolveDropTarget(graph, layout, beforePoint, 'feeder-3')
  const afterTarget = resolveDropTarget(graph, layout, afterPoint, 'feeder-1')

  assert.equal(beforeTarget.valid, true)
  assert.equal(beforeTarget.parentId, 'grid-tie')
  assert.equal(beforeTarget.group, null)
  assert.equal(beforeTarget.insertIndex, 1)
  assert.equal(afterTarget.valid, true)
  assert.equal(afterTarget.parentId, 'grid-tie')
  assert.equal(afterTarget.group, null)
  assert.equal(afterTarget.insertIndex, 1)
})

test('resolveDropTarget treats the middle of a sibling rect as a nest target, not a reorder', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const targetRect = layout.nodes.get('feeder-2')
  const point = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2 }

  const target = resolveDropTarget(graph, layout, point, 'feeder-1')

  assert.equal(target.valid, true)
  assert.equal(target.parentId, 'feeder-2')
  assert.equal(target.group, null)
  assert.equal(target.insertIndex, null)
  assert.equal(target.previewRect, null)
})

test('resolveDropTarget resolves a hit in the gap between two siblings as an insert between them', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const feeder2Rect = layout.nodes.get('feeder-2')
  const feeder3Rect = layout.nodes.get('feeder-3')
  const point = {
    x: feeder2Rect.x + feeder2Rect.width / 2,
    y: (feeder2Rect.y + feeder2Rect.height + feeder3Rect.y) / 2,
  }

  const target = resolveDropTarget(graph, layout, point, 'feeder-1')

  assert.equal(target.valid, true)
  assert.equal(target.parentId, 'grid-tie')
  assert.equal(target.group, null)
  assert.equal(target.insertIndex, 1)
  assert.ok(target.previewRect)
})

test('resolveDropTarget edge-band threshold scales with viewport.scale', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const targetRect = layout.nodes.get('feeder-2')
  // 离顶边4个世界单位：scale=1 时阈值是5世界单位，落在窄带内（reorder）；
  // scale=2 时阈值是2.5世界单位，落在窄带外，应该判定成 nest。
  const point = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + 4 }

  const atScale1 = resolveDropTarget(graph, layout, point, 'feeder-3', 'horizontal', 1)
  const atScale2 = resolveDropTarget(graph, layout, point, 'feeder-3', 'horizontal', 2)

  assert.equal(atScale1.parentId, 'grid-tie')
  assert.equal(atScale1.insertIndex, 1)
  assert.equal(atScale2.parentId, 'feeder-2')
  assert.equal(atScale2.insertIndex, null)
})

test('resolveDropTarget computes the sibling gap along the cross axis for a vertical layout', () => {
  const graph = createDemoGraph()
  const verticalOpts = { ...VIEWPORT, direction: 'vertical' }
  const layout = computeLayout(graph, verticalOpts)
  const feeder2Rect = layout.nodes.get('feeder-2')
  const feeder3Rect = layout.nodes.get('feeder-3')
  const point = {
    x: (feeder2Rect.x + feeder2Rect.width + feeder3Rect.x) / 2,
    y: feeder2Rect.y + feeder2Rect.height / 2,
  }

  const target = resolveDropTarget(graph, layout, point, 'feeder-1', 'vertical')

  assert.equal(target.valid, true)
  assert.equal(target.insertIndex, 1)
  assert.ok(target.previewRect)
})

test('resolveDropTarget resolves a group item hit to the group real parent and an insert index', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const point = firstItemCenter(group)

  const target = resolveDropTarget(graph, layout, point, 'feeder-1')

  assert.equal(target.valid, true)
  assert.equal(target.parentId, 'heap-1')
  assert.equal(target.group.id, group.id)
  assert.equal(target.insertIndex, 0)
})

test('resolveDropTarget rejects dropping a node onto itself or its own descendant', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const selfRect = layout.nodes.get('grid-tie')
  const descendantRect = layout.nodes.get('feeder-1')

  assert.equal(
    resolveDropTarget(graph, layout, { x: selfRect.x + 1, y: selfRect.y + 1 }, 'grid-tie').valid,
    false,
  )
  assert.equal(
    resolveDropTarget(graph, layout, { x: descendantRect.x + 1, y: descendantRect.y + 1 }, 'grid-tie').valid,
    false,
  )
})

test('resolveDropTarget returns invalid for a miss or a group header hit', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const headerPoint = { x: group.x + 5, y: group.y + 5 }

  assert.equal(resolveDropTarget(graph, layout, { x: -9999, y: -9999 }, 'feeder-1').valid, false)
  assert.equal(resolveDropTarget(graph, layout, headerPoint, 'feeder-1').valid, false)
})

test('edgePanVelocity returns nonzero velocity only near container edges', () => {
  assert.deepEqual(edgePanVelocity({ x: 400, y: 300 }, 800, 600), { x: 0, y: 0 })
  assert.ok(edgePanVelocity({ x: 2, y: 300 }, 800, 600).x < 0)
  assert.ok(edgePanVelocity({ x: 798, y: 300 }, 800, 600).x > 0)
  assert.ok(edgePanVelocity({ x: 400, y: 2 }, 800, 600).y < 0)
  assert.ok(edgePanVelocity({ x: 400, y: 598 }, 800, 600).y > 0)
})

test('edgePanVelocity scales toward maxSpeed at the very edge', () => {
  const atEdge = edgePanVelocity({ x: 0, y: 300 }, 800, 600, 24, 12)
  const nearEdge = edgePanVelocity({ x: 20, y: 300 }, 800, 600, 24, 12)
  assert.ok(Math.abs(atEdge.x) > Math.abs(nearEdge.x))
  assert.ok(Math.abs(atEdge.x) <= 12)
})
