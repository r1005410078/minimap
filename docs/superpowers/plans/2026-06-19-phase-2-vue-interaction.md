# Phase 2 Vue 交互 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成第二阶段「分组框能力」的最后一个切片——命中检测细分（header/item/body）、分组框内部拖拽换位（ghost + 让位 + 空位提示 + 自动滚动）、滚轮滚动、展开/折叠点击，以及 `groupStates`/`options` props 接线，使第二阶段验收标准全部达成。

**Architecture:** 几何计算（命中区域细分、组内插入下标、阈值判断、自动滚动速度、组内下标换算）做成 `src/minimap/interaction.js` 里不依赖 DOM 的纯函数；渲染层 `src/minimap/renderer.js` 的 `drawGroupChildren` 接受一个可选的 `dragContext` 复用已有的 `visibleGroupChildren` 画出"让位+空位提示+ghost"，不改 `layout.js`；指针状态机本身（`pointerdown`/`pointermove`/`pointerup`/`wheel`，`requestAnimationFrame` 驱动自动滚动）落在 `src/minimap/Minimap.vue` 内部模块级变量，跟现有 `viewport`/`layout`/`activeTransition` 写法一致。

**Tech Stack:** 纯 JavaScript + Vue 2.7 `<script setup>`，Canvas 2D（ctx 由外部传入），原生 `pointerdown`/`pointermove`/`pointerup`/`wheel` 事件，Node 内置 `node:test` + `node:assert/strict` + jsdom + `@vue/test-utils`。无新依赖。

## 进度

- [x] Task 1：`interaction.js`——命中检测细分 + `findInsertionIndex` 修复 + 拖拽几何纯函数
- [x] Task 2：`theme.js` + `renderer.js`——空位提示/ghost 绘制 + 分组选中身份修复
- [x] Task 3：`Minimap.vue`——`groupStates`/`options` props + 完整指针状态机 + 滚轮
- [x] Task 4：回归校验 + 进度文档同步（`npm test` 131 全过，`npm run build` 通过）

## Global Constraints

- 不引入新的第三方运行时或开发依赖。
- 本切片只改 `src/minimap/interaction.js`、`src/minimap/renderer.js`、`src/minimap/theme.js`、`src/minimap/Minimap.vue`、`test/helpers/mock-ctx.js`、`test/minimap-interaction.test.js`、`test/minimap-renderer.test.js`，并新建 `test/minimap-group-interaction.test.js`。不碰 `src/minimap/layout.js`、`src/minimap/layout-transition.js`、`src/minimap/graph.js`（`graph.js` 只读取既有的 `reorderGroupChild`，不修改它）。
- 分组命中区域：`hitTest` 对分组返回 `{ type:'group', id: group.id, zone: 'header'|'item'|'body', childId? }`（`item` 才带 `childId`）；分组选中身份统一用 `group.id`，不再用 `parentId`。
- 拖拽阈值固定 `4px`（屏幕像素坐标，不是世界坐标）；自动滚动热区 `24px`、最大速度 `8px/帧`（世界坐标）。
- 拖拽中不连续 `emit('group-state-change', ...)`：自动滚动期间只直接 mutate `group.scrollTop` 做即时视觉反馈，只有 `pointerup` 落地时才广播一次最终值；滚轮滚动（离散事件）每次都正常广播。
- `groupStates` prop 是普通对象 `{ [groupId]: { expanded, scrollTop } }`，不是 `Map`；受控/非受控判断方式跟现有 `selectedIds` 完全一致（`prop !== null` 即受控）。
- 每个任务完成后必须跑 `npm test`，最后一个任务跑 `npm run build`，确认通过才能提交。
- 字段/函数命名以 [spec](../specs/2026-06-19-phase-2-vue-interaction.md) 为准。

---

## 文件落点

- 修改：`src/minimap/interaction.js`——`hitTest` 分组命中细分；`findInsertionIndex` 修复多分组 bug；新增 `groupGridIndexAt`/`exceedsDragThreshold`/`groupAutoScrollSpeed`/`groupInsertIndexToParentIndex`。
- 修改：`src/minimap/renderer.js`——`drawGroupChildren` 新增 `dragContext` 支持 + 新增 `drawDropSlot`；`renderScene` 修复 `makeState(item.parentId,...)` → `makeState(item.id,...)`，并把 `state.groupDrag` 路由给对应分组。
- 修改：`src/minimap/theme.js`——`group` 主题新增 `dropSlot`。
- 修改：`test/helpers/mock-ctx.js`——`TRACKED_PROPERTIES` 加 `'globalAlpha'`。
- 修改：`src/minimap/Minimap.vue`——新增 `groupStates`/`options` props、`group-state-change`/`group-reorder` 事件、完整指针状态机、`wheel` 监听。
- 修改：`test/minimap-interaction.test.js`——更新分组命中用例为新 zone 格式；新增多分组 `findInsertionIndex` 用例；新增拖拽几何纯函数用例。
- 修改：`test/minimap-renderer.test.js`——新增 `dragContext` 绘制用例；新增分组选中身份修复的回归用例。
- 新建：`test/minimap-group-interaction.test.js`——`Minimap.vue` 层面的点击语义、拖拽换位、自动滚动、滚轮、`groupStates`/`options` 受控模式、分组分裂场景用例。

---

### Task 1: `interaction.js`——命中检测细分 + `findInsertionIndex` 修复 + 拖拽几何纯函数

**Files:**
- Modify: `src/minimap/interaction.js`
- Test: `test/minimap-interaction.test.js`

**Interfaces:**
- Consumes：`layout.groups`（`group.id`/`parentId`/`children`/`x`/`y`/`width`/`height`/`columns`/`scrollTop`/`overflowY`，来自分组逻辑切片）、`GROUP`/`visibleGroupChildren`（`src/minimap/layout.js`，已 export）。
- Produces（供 Task 3 的 `Minimap.vue` 使用，签名必须跟这里完全一致）：
  - `hitTest(layout, point)` → `{type:'node',id}` | `{type:'group',id,zone:'header'}` | `{type:'group',id,zone:'item',childId}` | `{type:'group',id,zone:'body'}` | `null`
  - `findInsertionIndex(graph, layout, parentId, point, direction)` → `number`（不变的对外签名，内部修复多分组 bug）
  - `groupGridIndexAt(group, point)` → `number`（0..`group.children.length`）
  - `exceedsDragThreshold(startScreenPoint, currentScreenPoint, thresholdPx = 4)` → `boolean`
  - `groupAutoScrollSpeed(group, pointerWorldY, edgeZone = 24, maxSpeed = 8)` → `number`
  - `groupInsertIndexToParentIndex(parent, group, draggingChildId, insertIndexInRest)` → `number`

- [ ] **Step 1: 写失败的测试**

完整替换 `test/minimap-interaction.test.js` 为以下内容：

```js
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
  // 最后一个格子(index 9, row4 col1)中心：x=142+60=202, y=216+20=236
  assert.equal(groupGridIndexAt(group, { x: 202, y: 236 }), 9)
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
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm test`
Expected: `test/minimap-interaction.test.js` 里除两个 `hitTest`/三个无分组相关的 `findInsertionIndex` 旧用例外，新用例全部失败（`hitTest`/`findInsertionIndex` 行为还是旧的；`groupGridIndexAt` 等函数 `is not a function`）。

- [ ] **Step 3: 完整替换 `src/minimap/interaction.js`**

```js
// Phase 1/2 Vue 壳切片：命中检测 + 拖入插入下标 + 分组内拖拽换位的几何计算，
// 纯函数、不依赖 DOM。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
// 和 docs/superpowers/specs/2026-06-19-phase-2-vue-interaction.md

import { GROUP, visibleGroupChildren } from './layout.js'

function containsPoint(rect, point) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

// 分组框内部按命中区域细分：header（含 ▾/▸ 整行）/ item（具体子节点格子）/ body（其余空白）。
function hitTestGroupZone(group, point) {
  const headerRect = { x: group.x, y: group.y, width: group.width, height: GROUP.header }
  if (containsPoint(headerRect, point)) return { type: 'group', id: group.id, zone: 'header' }

  for (const child of visibleGroupChildren(group)) {
    if (containsPoint(child.rect, point)) {
      return { type: 'group', id: group.id, zone: 'item', childId: child.id }
    }
  }

  return { type: 'group', id: group.id, zone: 'body' }
}

// 在 layout.visibleItems 里找世界坐标包含 point 的项。
// 树布局下节点和分组框天然不重叠，找到第一个命中项就返回。
export function hitTest(layout, point) {
  for (const item of layout.visibleItems) {
    if (!containsPoint(item, point)) continue
    if (item.type === 'node') return { type: 'node', id: item.id }
    const group = layout.groups.find((g) => g.id === item.id)
    return hitTestGroupZone(group, point)
  }
  return null
}

// 按 children 顺序比较交叉轴坐标，找第一个比 point 靠后的兄弟，插在它前面；
// 跳过已被任意分组消费的子节点（它们没有独立 rect）。
// 如果 point 落在该父节点某个具体分组的矩形范围内，插入到该分组对应 segment 的末尾之后
// ——分组框内部没有逐个子节点的世界坐标，无法精确定位到框内某一行，只能定位到段末尾。
export function findInsertionIndex(graph, layout, parentId, point, direction) {
  const parent = graph.nodes.get(parentId)
  const children = (parent && parent.children) || []
  if (children.length === 0) return 0

  const groupsOfParent = layout.groups.filter((group) => group.parentId === parentId)
  for (const group of groupsOfParent) {
    if (containsPoint(group, point)) {
      const lastChildId = group.children[group.children.length - 1]
      return children.indexOf(lastChildId) + 1
    }
  }

  const pointCross = direction === 'vertical' ? point.x : point.y
  for (let i = 0; i < children.length; i++) {
    if (groupsOfParent.some((group) => group.children.includes(children[i]))) continue
    const rect = layout.nodes.get(children[i])
    if (!rect) continue
    const cross = direction === 'vertical' ? rect.x + rect.width / 2 : rect.y + rect.height / 2
    if (pointCross < cross) return i
  }
  return children.length
}

// 世界坐标点 -> 分组网格里的插入下标（0..group.children.length）。
// 不要求该下标当前真的有子节点：用于拖拽悬停时实时算插入位置。
// col 用 Math.round 而非 Math.floor，靠近格子左右半边时四舍五入到更近的插入缝；
// 超出分组矩形范围的点会被 clamp 到最近的合法行/列，天然限制"只能在同一分组框内换位"。
export function groupGridIndexAt(group, point) {
  const rowHeight = GROUP.itemH + GROUP.itemGap
  const colWidth = GROUP.itemW + GROUP.itemGap
  const columns = Math.max(1, group.columns)
  const localX = point.x - group.x - GROUP.padding
  const localY = point.y - group.y - GROUP.header - GROUP.padding + group.scrollTop
  const col = Math.min(columns - 1, Math.max(0, Math.round(localX / colWidth)))
  const row = Math.max(0, Math.round(localY / rowHeight))
  return Math.min(group.children.length, row * columns + col)
}

// 阈值判断用屏幕像素坐标（不是世界坐标），保证以后第三阶段加入缩放后
// 阈值含义不变（像素距离，不受 viewport.scale 影响）。
export function exceedsDragThreshold(startScreenPoint, currentScreenPoint, thresholdPx = 4) {
  return Math.hypot(currentScreenPoint.x - startScreenPoint.x, currentScreenPoint.y - startScreenPoint.y) > thresholdPx
}

// 指针（世界坐标 y）靠近分组框上/下边缘 edgeZone 范围内时，返回这一帧应叠加到
// scrollTop 上的增量，越靠边缘越接近 maxSpeed；不可滚动或不在热区时返回 0。
export function groupAutoScrollSpeed(group, pointerWorldY, edgeZone = 24, maxSpeed = 8) {
  if (!group.overflowY) return 0
  const top = group.y + GROUP.header
  const bottom = group.y + group.height
  if (pointerWorldY < top + edgeZone) {
    return -maxSpeed * Math.min(1, (top + edgeZone - pointerWorldY) / edgeZone)
  }
  if (pointerWorldY > bottom - edgeZone) {
    return maxSpeed * Math.min(1, (pointerWorldY - (bottom - edgeZone)) / edgeZone)
  }
  return 0
}

// 把组内（相对于"去掉被拖项后的 group.children"）插入下标换算成 parent.children
// 的绝对下标，供 graph.js 的 reorderGroupChild 使用。分组永远是 parent.children
// 里的一段连续区间：在"去掉被拖项后的 parent.children"里找这段区间的起始位置，
// 加上组内插入下标。
export function groupInsertIndexToParentIndex(parent, group, draggingChildId, insertIndexInRest) {
  const filteredParentChildren = parent.children.filter((id) => id !== draggingChildId)
  const restGroupChildren = group.children.filter((id) => id !== draggingChildId)
  const segmentStart = filteredParentChildren.indexOf(restGroupChildren[0])
  return segmentStart + insertIndexInRest
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm test`
Expected: 全部测试通过（含其余文件的既有测试，因为这一步还没碰 `renderer.js`/`Minimap.vue`，它们此时还在调用旧的 `hitTest`/`findInsertionIndex` 行为——`renderer.js` 不依赖这两个函数，`Minimap.vue` 的 `interaction.js` 调用点在 Task 3 才会跟着新契约一起改，Task 1/2 阶段它们暂时不会被触发新行为，不会因为这次改动报错）。

- [ ] **Step 5: 提交**

```bash
git add src/minimap/interaction.js test/minimap-interaction.test.js
git commit -m "feat: split group hit-test zones and add drag geometry helpers

hitTest now distinguishes header/item/body inside a group box, fixes
findInsertionIndex's multi-group fallback bug, and adds groupGridIndexAt/
exceedsDragThreshold/groupAutoScrollSpeed/groupInsertIndexToParentIndex
for the upcoming Vue drag-reorder wiring."
```

---

### Task 2: `theme.js` + `renderer.js`——空位提示/ghost 绘制 + 分组选中身份修复

**Files:**
- Modify: `src/minimap/theme.js`
- Modify: `src/minimap/renderer.js`
- Modify: `test/helpers/mock-ctx.js`
- Test: `test/minimap-renderer.test.js`

**Interfaces:**
- Consumes：Task 1 暂不直接用到（这个任务只改渲染层，不调用 `interaction.js` 的新函数）；继续依赖 `visibleGroupChildren`/`GROUP`（`layout.js`，已 export）。
- Produces（供 Task 3 使用）：
  - `renderScene(ctx, scene)` 的 `scene.state.groupDrag` 字段：`{ groupId, order, draggingChildId, ghostRect } | null | undefined`。`groupId` 匹配某个分组时，那个分组的 `drawGroupChildren` 调用会收到这个 `dragContext`。
  - `renderScene` 内部分组选中态改用 `group.id` 判断（不再是 `parentId`），`Minimap.vue` 以后传 `selectedIds` 包含 `group.id` 时，分组 chrome 会显示选中态。

- [ ] **Step 1: 写失败的测试**

先给 `test/helpers/mock-ctx.js` 的 `TRACKED_PROPERTIES` 加 `'globalAlpha'`（ghost 半透明绘制需要被测试观察到）：

```js
const TRACKED_PROPERTIES = ['fillStyle', 'strokeStyle', 'font', 'lineWidth', 'globalAlpha']
```

然后在 `test/minimap-renderer.test.js` 末尾追加：

```js
test('group chrome receives selected state by group.id, not parentId', () => {
  const ctx = createMockCtx()
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  let observedState
  renderScene(ctx, {
    graph,
    layout,
    viewport: { x: 0, y: 0, scale: 1 },
    width: 2400,
    height: 1600,
    state: { selectedIds: new Set([group.id]) },
    renderers: { group: (_ctx, { state }) => { observedState = state }, node: () => {} },
  })
  assert.equal(observedState.selected, true)
})

test('drawGroupChildren in drag mode draws a drop slot and a single ghost for the dragged child', () => {
  const ctx = createMockCtx()
  const scene = demoScene()
  const group = scene.layout.groups.find((g) => g.parentId === 'heap-1')
  const visible = visibleGroupChildren(group)
  const draggingChildId = visible[0].id
  const order = group.children.filter((id) => id !== draggingChildId)
  order.splice(2, 0, draggingChildId)
  const ghostRect = { x: 999, y: 888, width: 120, height: 40 }

  renderScene(ctx, {
    ...scene,
    state: { groupDrag: { groupId: group.id, order, draggingChildId, ghostRect } },
  })

  const dropSlotFill = ctx.calls.filter(
    (c) => c.method === 'set:fillStyle' && c.args[0] === defaultTheme.group.dropSlot.fill,
  )
  assert.ok(dropSlotFill.length > 0)
  const ghostAlpha = ctx.calls.filter((c) => c.method === 'set:globalAlpha' && c.args[0] === 0.85)
  assert.ok(ghostAlpha.length > 0)
  // cluster 在网格里的原位置不画(改画空位提示)，只在 ghostRect 位置画一次。
  const labelCount = ctx.methodsOf('fillText').filter((c) => c.args[0] === draggingChildId).length
  assert.equal(labelCount, 1)
})

test('drawGroupChildren without dragContext behaves exactly like before (regression)', () => {
  const ctx = createMockCtx()
  const scene = demoScene()
  const stats = renderScene(ctx, scene)
  const labels = ctx.methodsOf('fillText').map((c) => c.args[0])
  assert.ok(labels.includes('cluster-1'))
  assert.equal(stats.drawn, stats.total - stats.culled)
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm test`
Expected: 三个新测试失败——第一个因为 `makeState(item.parentId, ...)` 还没改；第二个因为 `drawGroupChildren` 还不认识 `dragContext`、`theme.group.dropSlot` 不存在；第三个应该已经通过（纯回归，先确认它本来就是绿的）。

- [ ] **Step 3: 修改 `src/minimap/theme.js`**

```js
  group: {
    fill: '#16202b',
    stroke: '#3a4f66',
    header: '#9fb6cc',
    font: '12px sans-serif',
    scrollbar: { track: '#10161d', thumb: '#4a6280' },
    dropSlot: { fill: '#24344a', stroke: '#6f93b8' },
  },
```

- [ ] **Step 4: 修改 `src/minimap/renderer.js`——`drawGroupChildren` 与新增 `drawDropSlot`**

把现有的（第 310-326 行）：

```js
// 裁剪到分组框范围内，对当前可见的每个子节点调用 nodeRenderer ?? drawNode——
// 跟顶层节点完全同一套绘制路径，所以自定义节点视觉在分组框内外保持一致。
function drawGroupChildren(ctx, graph, group, rect, viewport, theme, renderers, selectedIds) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()
  for (const child of visibleGroupChildren(group)) {
    const node = graph.nodes.get(child.id)
    if (!node) continue
    const childRect = worldRectToScreen(child.rect, viewport)
    const itemState = makeState(child.id, selectedIds)
    if (renderers.node) renderers.node(ctx, { node, rect: childRect, state: itemState, theme, viewport })
    else drawNode(ctx, node, childRect, itemState, theme)
  }
  ctx.restore()
}
```

替换为：

```js
// 裁剪到分组框范围内，对当前可见的每个子节点调用 nodeRenderer ?? drawNode——
// 跟顶层节点完全同一套绘制路径，所以自定义节点视觉在分组框内外保持一致。
// dragContext（可选）= { order, draggingChildId, ghostRect }：拖拽换位时，order 是跟
// group.children 等长的虚拟顺序（被拖项已挪到目标插入下标），让其余子节点自动按新顺序
// "让位"；draggingChildId 对应的格子改画"空位提示"，循环结束后单独在 ghostRect 位置
// 把被拖节点本身再画一次（半透明，跟随鼠标）。
function drawGroupChildren(ctx, graph, group, rect, viewport, theme, renderers, selectedIds, dragContext) {
  const virtualGroup = dragContext ? { ...group, children: dragContext.order } : group
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()
  for (const child of visibleGroupChildren(virtualGroup)) {
    const childRect = worldRectToScreen(child.rect, viewport)
    if (dragContext && child.id === dragContext.draggingChildId) {
      drawDropSlot(ctx, childRect, theme)
      continue
    }
    const node = graph.nodes.get(child.id)
    if (!node) continue
    const itemState = makeState(child.id, selectedIds)
    if (renderers.node) renderers.node(ctx, { node, rect: childRect, state: itemState, theme, viewport })
    else drawNode(ctx, node, childRect, itemState, theme)
  }
  if (dragContext) {
    const draggingNode = graph.nodes.get(dragContext.draggingChildId)
    if (draggingNode) {
      ctx.save()
      ctx.globalAlpha = 0.85
      const ghostState = { ...makeState(dragContext.draggingChildId, selectedIds), dragging: true }
      if (renderers.node) renderers.node(ctx, { node: draggingNode, rect: dragContext.ghostRect, state: ghostState, theme, viewport })
      else drawNode(ctx, draggingNode, dragContext.ghostRect, ghostState, theme)
      ctx.restore()
    }
  }
  ctx.restore()
}

// 拖拽悬停时的"空位提示"：实心填充 + 虚线描边，颜色取 theme.group.dropSlot。
function drawDropSlot(ctx, rect, theme) {
  const dropSlot = { ...defaultTheme.group.dropSlot, ...(theme.group.dropSlot || {}) }
  ctx.save()
  ctx.fillStyle = dropSlot.fill
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = dropSlot.stroke
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  ctx.restore()
}
```

- [ ] **Step 5: 修改 `src/minimap/renderer.js`——`renderScene` 绘制循环**

把现有的（在 `renderScene` 内）：

```js
  const groupById = new Map(layout.groups.map((group) => [group.id, group]))
  for (const { item, screen } of items) {
    if (item.type !== 'group') continue
    const group = groupById.get(item.id)
    const itemState = makeState(item.parentId, selectedIds)
    if (renderers.group) renderers.group(ctx, { group, rect: screen, state: itemState, theme, viewport })
    else drawGroup(ctx, group, screen, theme)
    drawGroupChildren(ctx, graph, group, screen, viewport, theme, renderers, selectedIds)
    drawn++
  }
```

替换为：

```js
  const groupById = new Map(layout.groups.map((group) => [group.id, group]))
  for (const { item, screen } of items) {
    if (item.type !== 'group') continue
    const group = groupById.get(item.id)
    const itemState = makeState(item.id, selectedIds)
    if (renderers.group) renderers.group(ctx, { group, rect: screen, state: itemState, theme, viewport })
    else drawGroup(ctx, group, screen, theme)
    const dragContext = state.groupDrag && state.groupDrag.groupId === group.id ? state.groupDrag : undefined
    drawGroupChildren(ctx, graph, group, screen, viewport, theme, renderers, selectedIds, dragContext)
    drawn++
  }
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `npm test`
Expected: 全部测试通过。

- [ ] **Step 7: 提交**

```bash
git add src/minimap/theme.js src/minimap/renderer.js test/helpers/mock-ctx.js test/minimap-renderer.test.js
git commit -m "feat: render group drag ghost/drop-slot and fix group selection identity

drawGroupChildren now accepts an optional dragContext to draw a virtual
child order with a drop-slot placeholder and a semi-transparent ghost
at the dragged child's current pointer position. renderScene's group
chrome selection lookup switches from parentId to group.id so selecting
a specific group box highlights correctly in multi-group scenes."
```

---

### Task 3: `Minimap.vue`——`groupStates`/`options` props + 完整指针状态机 + 滚轮

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Test: `test/minimap-group-interaction.test.js` (new)

**Interfaces:**
- Consumes：Task 1 的 `hitTest`/`findInsertionIndex`/`groupGridIndexAt`/`exceedsDragThreshold`/`groupAutoScrollSpeed`/`groupInsertIndexToParentIndex`（`src/minimap/interaction.js`）；Task 2 的 `renderScene`/`worldRectToScreen`（`src/minimap/renderer.js`）的 `dragContext`/`state.groupDrag` 契约；`src/minimap/layout.js` 的 `GROUP`/`clampGroupScroll`；`src/minimap/graph.js` 的 `reorderGroupChild(graph, parentId, childId, newIndex)`。
- Produces：新 props `groupStates`/`options`；新事件 `group-state-change`/`group-reorder`；点击分组 header 切换展开折叠；点击分组内子节点格子（未拖拽）选中该子节点；点击分组空白处选中分组本身；框内拖拽换位（含自动滚动）；分组框内 `wheel` 滚动。

- [ ] **Step 1: 写失败的测试**

新建 `test/minimap-group-interaction.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, GROUP } from '../src/minimap/layout.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

const LAYOUT_OPTS = { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 }

function dispatchPointerDown(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }),
  )
}

function dispatchPointerMove(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointermove', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }),
  )
}

function dispatchPointerUp(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerup', { clientX: point.x, clientY: point.y, pointerId: 1, bubbles: true }),
  )
}

function dispatchWheel(wrapper, point, deltaY) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new WheelEvent('wheel', { clientX: point.x, clientY: point.y, deltaY, bubbles: true, cancelable: true }),
  )
}

function dispatchDrop(wrapper, payload, point) {
  const canvasEl = wrapper.find('canvas').element
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'dataTransfer', { value: { getData: () => JSON.stringify(payload) } })
  Object.defineProperty(evt, 'clientX', { value: point.x, configurable: true })
  Object.defineProperty(evt, 'clientY', { value: point.y, configurable: true })
  canvasEl.dispatchEvent(evt)
}

function callsSinceLastClear(ctx) {
  const lastClear = ctx.calls.map((c) => c.method).lastIndexOf('clearRect')
  return ctx.calls.slice(lastClear + 1)
}

function finishPendingAnimation() {
  frames.runNext(0)
  frames.runNext(100000)
}

function firstItemCenter(group) {
  return {
    x: group.x + GROUP.padding + GROUP.itemW / 2,
    y: group.y + GROUP.header + GROUP.padding + GROUP.itemH / 2,
  }
}

test('clicking a group header toggles expanded and does not emit select', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const headerPoint = { x: group.x + group.width / 2, y: group.y + GROUP.header / 2 }
  dispatchPointerDown(wrapper, headerPoint)

  assert.equal(wrapper.emitted('select'), undefined)
  assert.deepEqual(wrapper.emitted('group-state-change')[0][0], { [group.id]: { expanded: true } })
  wrapper.destroy()
})

test('clicking a child item inside a group without dragging selects the child', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const itemPoint = firstItemCenter(group)
  dispatchPointerDown(wrapper, itemPoint)
  dispatchPointerUp(wrapper, itemPoint)

  assert.deepEqual(wrapper.emitted('select')[0][0], ['cluster-1'])
  wrapper.destroy()
})

test('clicking blank space inside a group box selects the group itself', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const bodyPoint = { x: group.x + 2, y: group.y + GROUP.header + 2 }
  dispatchPointerDown(wrapper, bodyPoint)

  assert.deepEqual(wrapper.emitted('select')[0][0], [group.id])
  wrapper.destroy()
})

test('a small movement after pressing on an item does not trigger reorder', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const heap = graph.nodes.get('heap-1')
  const childrenBefore = [...heap.children]

  const itemPoint = firstItemCenter(group)
  dispatchPointerDown(wrapper, itemPoint)
  dispatchPointerMove(wrapper, { x: itemPoint.x + 2, y: itemPoint.y + 2 })
  dispatchPointerUp(wrapper, { x: itemPoint.x + 2, y: itemPoint.y + 2 })

  assert.deepEqual(wrapper.emitted('select')[0][0], ['cluster-1'])
  assert.equal(wrapper.emitted('group-reorder'), undefined)
  assert.deepEqual(heap.children, childrenBefore)
  wrapper.destroy()
})

test('dragging an item past the threshold reorders the group children in the graph', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const heap = graph.nodes.get('heap-1')

  const firstItemPoint = firstItemCenter(group)
  const targetPoint = { x: firstItemPoint.x, y: firstItemPoint.y + 2 * (GROUP.itemH + GROUP.itemGap) }

  dispatchPointerDown(wrapper, firstItemPoint)
  dispatchPointerMove(wrapper, targetPoint)
  dispatchPointerUp(wrapper, targetPoint)
  finishPendingAnimation()

  assert.equal(heap.children[4], 'cluster-1')
  assert.equal(heap.children.length, 24)
  assert.equal(new Set(heap.children).size, 24)
  assert.equal(wrapper.emitted('group-reorder').length, 1)
  assert.equal(wrapper.emitted('change').length, 1)
  wrapper.destroy()
})

test('dragging near the bottom edge of an overflowing group auto-scrolls it', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  assert.equal(group.overflowY, true)
  const wrapper = mount(Minimap, { propsData: { graph } })
  const ctx = contexts.at(-1)

  const firstItemPoint = firstItemCenter(group)
  dispatchPointerDown(wrapper, firstItemPoint)
  const bottomEdge = { x: firstItemPoint.x, y: group.y + group.height - 1 }
  dispatchPointerMove(wrapper, bottomEdge)

  for (let i = 0; i < 20; i++) frames.runNext(i * 16)

  const labelsAfter = callsSinceLastClear(ctx)
    .filter((c) => c.method === 'fillText')
    .map((c) => c.args[0])
  assert.equal(labelsAfter.includes('cluster-1'), false)
  wrapper.destroy()
})

test('scrolling the wheel inside an overflowing group shifts the visible window and emits group-state-change', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })
  const ctx = contexts.at(-1)

  const insidePoint = { x: group.x + group.width / 2, y: group.y + group.height / 2 }
  dispatchWheel(wrapper, insidePoint, 200)

  const labels = callsSinceLastClear(ctx)
    .filter((c) => c.method === 'fillText')
    .map((c) => c.args[0])
  assert.equal(labels.includes('cluster-1'), false)

  const stateChange = wrapper.emitted('group-state-change')
  assert.ok(stateChange.length > 0)
  assert.equal(stateChange.at(-1)[0][group.id].scrollTop, 200)
  wrapper.destroy()
})

test('groupStates prop puts the component in controlled mode', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, {
    propsData: { graph, groupStates: { [group.id]: { expanded: false } } },
  })

  const headerPoint = { x: group.x + group.width / 2, y: group.y + GROUP.header / 2 }
  dispatchPointerDown(wrapper, headerPoint)
  assert.deepEqual(wrapper.emitted('group-state-change')[0][0], { [group.id]: { expanded: true } })

  // 受控模式：prop 没变，组件内部不应该自己持久化 expanded=true。
  dispatchPointerDown(wrapper, headerPoint)
  assert.deepEqual(wrapper.emitted('group-state-change')[1][0], { [group.id]: { expanded: true } })
  wrapper.destroy()
})

test('options.groupThreshold is passed through to the layout engine', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, options: { groupThreshold: 2 } } })
  const ctx = contexts.at(-1)

  const labels = ctx.methodsOf('fillText').map((c) => c.args[0])
  // grid-tie 下只有 3 个叶子兄弟 feeder-1..3；默认阈值 5 不会合并；阈值降到 2 后应该
  // 合并成分组框，出现 grid-tie 的分组 header 文案。
  const headerLabel = labels.find((l) => typeof l === 'string' && l.includes('grid-tie'))
  assert.ok(headerLabel)
  wrapper.destroy()
})

test('dropping a resource onto a selected child inside a group splits it out of the group', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const itemPoint = firstItemCenter(group)
  dispatchPointerDown(wrapper, itemPoint)
  dispatchPointerUp(wrapper, itemPoint)
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['cluster-1'])

  dispatchDrop(wrapper, { id: 'sensor', label: 'Sensor' }, itemPoint)
  finishPendingAnimation()

  const clusterOne = graph.nodes.get('cluster-1')
  assert.equal(clusterOne.children.length, 1)

  const nextLayout = computeLayout(graph, LAYOUT_OPTS)
  const stillInAGroup = nextLayout.groups.some((g) => g.children.includes('cluster-1'))
  assert.equal(stillInAGroup, false)
  wrapper.destroy()
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm test`
Expected: 新文件里的全部测试失败（`groupStates`/`options` props 不存在，点击分组永远走旧的 `setSelected([hit.id])` 用 `parentId`，没有 `group-state-change`/`group-reorder` 事件，没有 `wheel` 监听）。

- [ ] **Step 3: 完整替换 `src/minimap/Minimap.vue` 的 `<script setup>` 块**

把 `<script setup>` 到 `</script>` 之间的全部内容替换为：

```js
<script setup>
// Phase 1 Vue 组件壳骨架：挂载真实 canvas、DPR 适配、ResizeObserver 驱动的按需重渲染。
// 分组框命中检测细分、框内拖拽换位、滚轮滚动、展开折叠点击见 Phase 2 切片3。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
// 和 docs/superpowers/specs/2026-06-19-phase-2-vue-interaction.md
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { computeLayout, keepAnchorStable, GROUP, clampGroupScroll } from './layout.js'
import {
  createLayoutTransition,
  layoutAt,
  resolveAnchorCenter,
} from './layout-transition.js'
import { renderScene, worldRectToScreen } from './renderer.js'
import { defaultTheme } from './theme.js'
import { screenToWorld } from './coords.js'
import {
  hitTest,
  findInsertionIndex,
  groupGridIndexAt,
  exceedsDragThreshold,
  groupAutoScrollSpeed,
  groupInsertIndexToParentIndex,
} from './interaction.js'
import { reorderGroupChild } from './graph.js'
import ResourceTree from './ResourceTree.vue'

const ANIMATION_DURATION_MS = 200

const props = defineProps({
  graph: { type: Object, required: true },
  resources: { type: Array, default: () => [] },
  layoutDirection: { type: String, default: 'horizontal' },
  selectedIds: { type: Array, default: null },
  groupStates: { type: Object, default: null },
  options: { type: Object, default: null },
  theme: { type: Object, default: null },
  nodeRenderer: { type: Function, default: null },
  groupRenderer: { type: Function, default: null },
  edgeRenderer: { type: Function, default: null },
})

const emit = defineEmits(['select', 'node-drop', 'change', 'group-state-change', 'group-reorder'])

const containerRef = ref(null)
const canvasRef = ref(null)

let ctx = null
let resizeObserver = null
let layout = null
let cssWidth = 0
let cssHeight = 0
let internalSelectedId = null
let internalGroupStates = {}
let dragState = null

// Phase 1 固定视口，平移/缩放是第三阶段才做；那时改这里要联动下面的 pointFromEvent。
let viewport = { x: 0, y: 0, scale: 1 }
let settledLayout = null
let animationFrameId = null
let activeTransition = null
let lastRenderedLayout = null
let lastRenderedViewport = viewport

function currentSelectedIds() {
  if (props.selectedIds !== null) return props.selectedIds
  return internalSelectedId ? [internalSelectedId] : []
}

function currentGroupStates() {
  return props.groupStates !== null ? props.groupStates : internalGroupStates
}

function updateGroupState(groupId, patch) {
  const current = currentGroupStates()
  const next = { ...current, [groupId]: { ...current[groupId], ...patch } }
  if (props.groupStates === null) internalGroupStates = next
  emit('group-state-change', next)
}

function dragRenderContext() {
  if (!dragState || !dragState.dragging || !layout) return null
  const group = layout.groups.find((g) => g.id === dragState.groupId)
  if (!group) return null
  const order = group.children.filter((id) => id !== dragState.childId)
  order.splice(dragState.insertIndex, 0, dragState.childId)
  return { groupId: group.id, order, draggingChildId: dragState.childId, ghostRect: dragState.ghostScreenRect }
}

function renderCurrent(currentLayout = layout, currentViewport = viewport) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...currentViewport }
  renderScene(ctx, {
    layout: currentLayout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport: currentViewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: { selectedIds: new Set(currentSelectedIds()), groupDrag: dragRenderContext() },
    renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
  })
}

function cancelAnimation() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  activeTransition = null
}

function settleAnimation() {
  if (!activeTransition) return
  const { nextLayout, nextViewport } = activeTransition
  cancelAnimation()
  finishLayout(nextLayout, nextViewport)
}

function chooseAnchorId(startLayout, nextLayout) {
  const selected = currentSelectedIds()[0]
  if (selected && resolveAnchorCenter(startLayout, selected) && resolveAnchorCenter(nextLayout, selected)) return selected
  const root = props.graph.rootIds[0]
  if (root && resolveAnchorCenter(startLayout, root) && resolveAnchorCenter(nextLayout, root)) return root
  return null
}

function targetViewportFor(startLayout, nextLayout, preserveAnchor) {
  if (!preserveAnchor || !startLayout) return viewport
  const anchorId = chooseAnchorId(startLayout, nextLayout)
  if (!anchorId) return viewport
  const before = resolveAnchorCenter(startLayout, anchorId)
  const after = resolveAnchorCenter(nextLayout, anchorId)
  return keepAnchorStable(viewport, before, after)
}

function finishLayout(nextLayout, nextViewport) {
  layout = nextLayout
  settledLayout = nextLayout
  viewport = { ...nextViewport }
  renderCurrent(layout, viewport)
}

function startAnimation(startLayout, nextLayout, startViewport, nextViewport) {
  const transition = createLayoutTransition({
    fromLayout: startLayout,
    toLayout: nextLayout,
    fromViewport: startViewport,
    toViewport: nextViewport,
    durationMs: ANIMATION_DURATION_MS,
  })
  activeTransition = { transition, startedAt: null, nextLayout, nextViewport }

  const tick = (time) => {
    if (!activeTransition) return
    if (activeTransition.startedAt === null) activeTransition.startedAt = time
    const elapsed = time - activeTransition.startedAt
    const progress = elapsed / activeTransition.transition.durationMs
    const frame = layoutAt(activeTransition.transition, progress)
    layout = frame.layout
    viewport = { ...frame.viewport }
    renderCurrent(layout, viewport)

    if (progress >= 1) {
      animationFrameId = null
      const finished = activeTransition
      activeTransition = null
      finishLayout(finished.nextLayout, finished.nextViewport)
      return
    }

    animationFrameId = requestAnimationFrame(tick)
  }

  animationFrameId = requestAnimationFrame(tick)
}

function updateLayout({ animate = true, preserveAnchor = true } = {}) {
  if (!ctx) return
  const nextLayout = computeLayout(props.graph, {
    direction: props.layoutDirection,
    viewportWidth: cssWidth,
    viewportHeight: cssHeight,
    groupThreshold: props.options?.groupThreshold,
    groupStates: new Map(Object.entries(currentGroupStates())),
  })

  const startLayout = lastRenderedLayout || settledLayout || layout
  const startViewport = lastRenderedViewport || viewport
  const nextViewport = targetViewportFor(startLayout, nextLayout, preserveAnchor)
  const canAnimate =
    animate &&
    typeof requestAnimationFrame === 'function' &&
    typeof cancelAnimationFrame === 'function'

  cancelAnimation()

  if (!startLayout || !canAnimate || ANIMATION_DURATION_MS <= 0) {
    finishLayout(nextLayout, nextViewport)
    return
  }

  viewport = { ...startViewport }
  startAnimation(startLayout, nextLayout, startViewport, nextViewport)
}

function setSelected(ids) {
  if (props.selectedIds === null) internalSelectedId = ids[0] ?? null
  emit('select', ids)
  renderCurrent()
}

function pointFromEvent(event) {
  const rect = canvasRef.value.getBoundingClientRect()
  return screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport)
}

function ghostRectForPoint(worldPoint) {
  const worldRect = {
    x: worldPoint.x - GROUP.itemW / 2,
    y: worldPoint.y - GROUP.itemH / 2,
    width: GROUP.itemW,
    height: GROUP.itemH,
  }
  return worldRectToScreen(worldRect, viewport)
}

function cancelAutoScrollLoop() {
  if (dragState && dragState.scrollRafId !== null) {
    cancelAnimationFrame(dragState.scrollRafId)
    dragState.scrollRafId = null
  }
}

function startAutoScrollLoop() {
  const tick = () => {
    if (!dragState || !dragState.dragging) return
    const group = layout.groups.find((g) => g.id === dragState.groupId)
    if (group && dragState.ghostWorldPoint) {
      const delta = groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y)
      if (delta !== 0) {
        group.scrollTop = clampGroupScroll(group, group.scrollTop + delta)
        renderCurrent()
      }
    }
    dragState.scrollRafId = requestAnimationFrame(tick)
  }
  dragState.scrollRafId = requestAnimationFrame(tick)
}

function handlePointerDown(event) {
  if (!layout) return
  const point = pointFromEvent(event)
  const hit = hitTest(layout, point)

  if (hit?.type === 'group' && hit.zone === 'header') {
    const group = layout.groups.find((g) => g.id === hit.id)
    updateGroupState(hit.id, { expanded: !group.expanded })
    updateLayout()
    return
  }

  if (hit?.type === 'group' && hit.zone === 'item') {
    canvasRef.value.setPointerCapture?.(event.pointerId)
    dragState = {
      groupId: hit.id,
      childId: hit.childId,
      startScreen: { x: event.clientX, y: event.clientY },
      dragging: false,
      insertIndex: 0,
      ghostWorldPoint: null,
      ghostScreenRect: null,
      scrollRafId: null,
    }
    return
  }

  setSelected(hit ? [hit.id] : [])
}

function handlePointerMove(event) {
  if (!dragState) return
  const screenPoint = { x: event.clientX, y: event.clientY }

  if (!dragState.dragging) {
    if (!exceedsDragThreshold(dragState.startScreen, screenPoint)) return
    dragState.dragging = true
    startAutoScrollLoop()
  }

  const group = layout.groups.find((g) => g.id === dragState.groupId)
  if (!group) return
  const worldPoint = pointFromEvent(event)
  const restGroup = { ...group, children: group.children.filter((id) => id !== dragState.childId) }
  dragState.insertIndex = groupGridIndexAt(restGroup, worldPoint)
  dragState.ghostWorldPoint = worldPoint
  dragState.ghostScreenRect = ghostRectForPoint(worldPoint)
  renderCurrent()
}

function handlePointerUp() {
  if (!dragState) return

  if (dragState.dragging) {
    cancelAutoScrollLoop()
    const group = layout.groups.find((g) => g.id === dragState.groupId)
    if (group) {
      const parent = props.graph.nodes.get(group.parentId)
      const index = groupInsertIndexToParentIndex(parent, group, dragState.childId, dragState.insertIndex)
      reorderGroupChild(props.graph, group.parentId, dragState.childId, index)
      updateGroupState(group.id, { scrollTop: group.scrollTop })
      updateLayout()
      emit('group-reorder', { groupId: group.id, childId: dragState.childId, index })
      emit('change', props.graph)
    }
  } else {
    setSelected([dragState.childId])
  }

  dragState = null
}

function handleWheel(event) {
  if (!layout) return
  const point = pointFromEvent(event)
  const hit = hitTest(layout, point)
  if (hit?.type !== 'group') return
  const group = layout.groups.find((g) => g.id === hit.id)
  if (!group || !group.overflowY) return

  event.preventDefault()
  group.scrollTop = clampGroupScroll(group, group.scrollTop + event.deltaY)
  updateGroupState(group.id, { scrollTop: group.scrollTop })
  renderCurrent()
}

function handleDragOver(event) {
  event.preventDefault()
}

function handleDrop(event) {
  event.preventDefault()
  settleAnimation()
  if (!layout) return
  const raw = event.dataTransfer.getData('application/json')
  if (!raw) return
  const resource = JSON.parse(raw)

  const point = pointFromEvent(event)
  const selected = currentSelectedIds()
  const parentId = selected[0] ?? props.graph.rootIds[0]
  const parent = props.graph.nodes.get(parentId)
  if (!parent) return

  const index = findInsertionIndex(props.graph, layout, parentId, point, props.layoutDirection)
  const id = `res-${resource.id}-${Date.now()}`
  props.graph.nodes.set(id, { id, label: resource.label, parentId, children: [] })
  parent.children.splice(index, 0, id)

  updateLayout()
  emit('node-drop', { resource, parentId, index })
  emit('change', props.graph)
}

function syncCanvasSize() {
  const container = containerRef.value
  const canvas = canvasRef.value
  if (!container || !canvas) return
  cssWidth = container.clientWidth
  cssHeight = container.clientHeight
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas.height = Math.max(1, Math.round(cssHeight * dpr))
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  // setTransform 而不是 scale：避免每次 resize 后缩放重复叠加。
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

onMounted(() => {
  ctx = canvasRef.value.getContext('2d')
  syncCanvasSize()
  resizeObserver = new ResizeObserver(() => {
    syncCanvasSize()
    updateLayout({ animate: false, preserveAnchor: false })
  })
  resizeObserver.observe(containerRef.value)
  canvasRef.value.addEventListener('pointerdown', handlePointerDown)
  canvasRef.value.addEventListener('pointermove', handlePointerMove)
  canvasRef.value.addEventListener('pointerup', handlePointerUp)
  canvasRef.value.addEventListener('wheel', handleWheel, { passive: false })
  canvasRef.value.addEventListener('dragover', handleDragOver)
  canvasRef.value.addEventListener('drop', handleDrop)
  updateLayout({ animate: false, preserveAnchor: false })
})

onUnmounted(() => {
  cancelAnimation()
  cancelAutoScrollLoop()
  if (resizeObserver) resizeObserver.disconnect()
})

watch(() => props.layoutDirection, () => updateLayout())
watch(() => props.graph, () => updateLayout())
watch(() => props.selectedIds, () => renderCurrent())
</script>
```

`<template>`/`<style scoped>` 块不变，照原样保留在文件里。

- [ ] **Step 4: 运行测试，确认通过**

Run: `npm test`
Expected: 全部测试通过，包含新文件、`minimap-select.test.js`、`minimap-drop.test.js`、`minimap-shell.test.js` 等既有文件（回归）。

- [ ] **Step 5: 提交**

```bash
git add src/minimap/Minimap.vue test/minimap-group-interaction.test.js
git commit -m "feat: wire groupStates/options props and full group interaction state machine

Minimap.vue now supports expand/collapse via header click, selecting an
individual child inside a group, drag-to-reorder within a group (with
auto-scroll near the edges), and wheel scrolling for overflowing groups.
groupStates/options follow the same controlled/uncontrolled contract as
selectedIds."
```

---

### Task 4: 回归校验 + 进度文档同步

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/superpowers/plans/2026-06-19-phase-2-vue-interaction.md`（本文件，勾选「进度」）

**Interfaces:**
- Consumes：Task 1-3 全部改动。
- Produces：无新代码契约，只更新文档。

- [ ] **Step 1: 跑完整测试与构建**

Run: `npm test`
Expected: 全部测试通过（应为之前 101 条基础上新增 Task 1-3 的用例，全绿）。

Run: `npm run build`
Expected: 构建成功，无报错。

- [ ] **Step 2: 更新 `ROADMAP.md`**

把「路线图进度」里的：

```markdown
- [ ] 第二阶段：分组框能力
```

改成：

```markdown
- [x] 第二阶段：分组框能力
```

把「当前进度」块改成（保留已有「已完成切片」列表，只新增一行并更新「当前阶段」「当前阶段计划」「下一步」「待办切片」）：

```markdown
- **当前阶段**：第二阶段（分组框能力）—— 已完成
- **当前阶段计划**：[分组逻辑](docs/superpowers/plans/2026-06-19-phase-2-group-logic.md)、[Canvas 渲染器](docs/superpowers/plans/2026-06-19-phase-2-canvas-renderer.md)、[Vue 交互](docs/superpowers/plans/2026-06-19-phase-2-vue-interaction.md)
- **已完成切片**：
  -（保留原有各行不变）
  - Vue 交互 `interaction.js` 命中检测细分 + `Minimap.vue` 拖拽换位/滚轮/展开折叠 + 测试（[plan](docs/superpowers/plans/2026-06-19-phase-2-vue-interaction.md)，`npm test` 全过，`npm run build` 通过）
- **下一步**：第二阶段「分组框能力」已完成，按 brainstorm → spec → plan → implement 推进第三阶段「视图和选择能力」。
- **待办切片**：无（第三阶段尚未开始 brainstorm）。
```

（把"全过"替换成 Step 1 实际看到的测试总数。）

- [ ] **Step 3: 在本计划文件追加「进度」勾选**

把本文件开头的「进度」checklist 全部打勾：

```markdown
## 进度

- [x] Task 1：`interaction.js`——命中检测细分 + `findInsertionIndex` 修复 + 拖拽几何纯函数
- [x] Task 2：`theme.js` + `renderer.js`——空位提示/ghost 绘制 + 分组选中身份修复
- [x] Task 3：`Minimap.vue`——`groupStates`/`options` props + 完整指针状态机 + 滚轮
- [x] Task 4：回归校验 + 进度文档同步（`npm test` <实际数量> 全过，`npm run build` 通过）
```

- [ ] **Step 4: 提交**

```bash
git add ROADMAP.md docs/superpowers/plans/2026-06-19-phase-2-vue-interaction.md
git commit -m "docs: close out Phase 2 after the Vue interaction slice lands"
```
