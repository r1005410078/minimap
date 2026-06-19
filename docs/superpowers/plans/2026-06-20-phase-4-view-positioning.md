# Phase 4 视图定位方法 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `Minimap.vue` 加上第一批 `defineExpose` 方法——`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport`/`select`/`clearSelection`——并打好支撑它们的纯函数基础（视口补动、分组子节点定位）。

**Architecture:** 新增一个跟 `layout-transition.js` 平行、但完全独立的轻量视口补动机制（`viewport.js` 的 `tweenViewport`），不复用布局动画的逐帧 `visibleItems` 重算路径，因为这次只有 `x`/`y`/`scale` 在变、布局本身不变。`layout.js` 新增 `locateChildGroup`/`childRectInGroup`/`scrollTopToReveal` 三个纯函数，用于在调用 `centerOnNode` 时把目标在分组里的滚动位置算出来——只调 `scrollTop`，不碰 `expanded`。`Minimap.vue` 新增一套独立于现有 `activeTransition` 的视口补动状态机（`activeViewportTween`/`viewportTweenFrameId`），8 个方法都通过它统一驱动。

**Tech Stack:** 纯 JavaScript（无 DOM 依赖的几何/插值计算）+ Vue 2.7 `<script setup>`（`defineExpose`）+ Node 内置 `node:test`/`node:assert/strict` + `@vue/test-utils` v1 + 现有 `test/helpers/{dom-env,canvas-env}.js`。无新依赖。

## 进度

- [ ] Task 1：`viewport.js` 视口补动纯函数（`tweenViewport`/`fitViewportToBounds`/`centerViewportOn`）
- [ ] Task 2：`layout.js` 分组子节点定位纯函数（`locateChildGroup`/`childRectInGroup`/`scrollTopToReveal`）
- [ ] Task 3：`selection.js` 多模式选择纯函数（`applySelectionSet`）
- [ ] Task 4：`Minimap.vue` 视口补动状态机 + 8 个 `defineExpose` 方法
- [ ] Task 5：回归校验 + ROADMAP 同步

## Global Constraints

- 不引入新的第三方运行时或开发依赖。
- 本切片只改 `src/minimap/viewport.js`、`src/minimap/layout.js`、`src/minimap/selection.js`、`src/minimap/Minimap.vue`，以及对应测试文件 `test/minimap-viewport.test.js`、`test/minimap-layout.test.js`、`test/minimap-selection.test.js`，加一个新测试文件 `test/minimap-view-positioning.test.js`。不碰 `src/minimap/interaction.js`、`src/minimap/renderer.js`、`src/minimap/graph.js`、`src/minimap/layout-transition.js`（那些不在本切片范围）。
- `fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo` 调用后视口平滑过渡（默认 200ms，`easeOutCubic`）；`setViewport` 立即生效不动画。
- `centerOnNode` 对分组内子节点只调整 `scrollTop`，永远不修改 `expanded`。
- `centerOnSelection` 只平移视口，不改变 `scale`，使用选中内容的真实矩形包围盒（不是各项中心点的包围盒）。
- `zoomTo(scale, center)` 的 `center` 是世界坐标点，不传时默认取当前视口中心对应的世界坐标。
- 受控 `viewport`（`props.viewport !== null`）/`groupStates`（`props.groupStates !== null`）模式下，以上方法只 `emit` 对应事件，不直接改组件内部状态；非受控模式下内部状态需要同步更新。
- 调用任一新方法前，先结算正在进行的布局动画（`settleAnimation()`）、取消上一次未完成的视口补动、取消正在进行的拖拽/平移/框选（`cancelPointerInteractions()`）。
- 字段/函数命名以 [spec](../specs/2026-06-20-phase-4-view-positioning.md) 为准。
- 每个任务完成后必须跑 `npm test`，Task 5 额外跑 `npm run build`，确认通过才能提交。

---

## 文件落点

- 修改：`src/minimap/viewport.js`——新增 `tweenViewport`/`fitViewportToBounds`/`centerViewportOn`，新增对 `layout-transition.js` 的 `easeOutCubic` 引用（跟 `drag-transition.js` 现有的引用方式一致）。
- 修改：`src/minimap/layout.js`——把 `visibleGroupChildren` 内联的单格矩形公式拆成私有 `childRectAt`，新增导出 `locateChildGroup`/`childRectInGroup`/`scrollTopToReveal`。
- 修改：`src/minimap/selection.js`——新增 `applySelectionSet`。
- 修改：`src/minimap/Minimap.vue`——新增视口补动状态机 + 8 个 `defineExpose` 方法。
- 修改：`test/minimap-viewport.test.js`、`test/minimap-layout.test.js`、`test/minimap-selection.test.js`——各自新增对应纯函数的用例。
- 新建：`test/minimap-view-positioning.test.js`——覆盖 8 个 `defineExpose` 方法的组件级用例。
- 修改：`ROADMAP.md`——Task 5 收尾时勾选切片 1，更新「下一步」指向切片 2（搜索节点）。

---

## Task 1: `viewport.js` 视口补动纯函数

**Files:**
- Modify: `src/minimap/viewport.js`
- Test: `test/minimap-viewport.test.js`

**Interfaces:**
- Consumes: 现有 `DEFAULT_VIEWPORT`、`clampScale`（已在文件内定义）；`layout-transition.js` 导出的 `easeOutCubic(value)`。
- Produces：
  - `tweenViewport(from, to, progress)` → `{ x, y, scale }`，对三个数字做 `easeOutCubic` 缓动插值。
  - `fitViewportToBounds(bounds, viewportWidth, viewportHeight, options = null, padding = 40)` → `{ x, y, scale }`；`bounds` 退化（`minX`/`maxX`/`minY`/`maxY` 任一非 finite）时返回 `DEFAULT_VIEWPORT`。
  - `centerViewportOn(worldPoint, viewport, viewportWidth, viewportHeight)` → `{ x, y, scale }`，只平移、`scale` 取自传入 `viewport`。
  - 后续 Task 都通过这三个函数名调用，不要改名。

- [ ] **Step 1: 写失败测试**

在 `test/minimap-viewport.test.js` 顶部的 import 区，把现有的

```js
import { screenToWorld } from '../src/minimap/coords.js'
import {
  DEFAULT_VIEWPORT,
  clampScale,
  normalizeViewport,
  panViewportBy,
  sameViewport,
  viewportOptions,
  zoomViewportAt,
} from '../src/minimap/viewport.js'
```

改成

```js
import { screenToWorld } from '../src/minimap/coords.js'
import { easeOutCubic } from '../src/minimap/layout-transition.js'
import {
  DEFAULT_VIEWPORT,
  centerViewportOn,
  clampScale,
  fitViewportToBounds,
  normalizeViewport,
  panViewportBy,
  sameViewport,
  tweenViewport,
  viewportOptions,
  zoomViewportAt,
} from '../src/minimap/viewport.js'
```

在文件末尾追加：

```js
test('tweenViewport eases x/y/scale independently from progress 0 to 1', () => {
  const from = { x: 0, y: 0, scale: 1 }
  const to = { x: 100, y: 200, scale: 2 }
  assert.deepEqual(tweenViewport(from, to, 0), { x: 0, y: 0, scale: 1 })
  assert.deepEqual(tweenViewport(from, to, 1), { x: 100, y: 200, scale: 2 })
  const mid = tweenViewport(from, to, 0.5)
  const eased = easeOutCubic(0.5)
  assertApprox(mid.x, 100 * eased)
  assertApprox(mid.y, 200 * eased)
  assertApprox(mid.scale, 1 + eased)
})

test('fitViewportToBounds fits content with 40px padding and clamps scale to options', () => {
  const bounds = { minX: 0, maxX: 200, minY: 0, maxY: 100 }
  const result = fitViewportToBounds(bounds, 800, 600, { minScale: 0.25, maxScale: 3 })
  assert.deepEqual(result, { x: 100, y: 150, scale: 3 })
})

test('fitViewportToBounds keeps the natural fit scale when it is within min/max', () => {
  const bounds = { minX: 0, maxX: 480, minY: 0, maxY: 260 }
  const result = fitViewportToBounds(bounds, 800, 600, { minScale: 0.25, maxScale: 3 })
  assert.deepEqual(result, { x: 40, y: 105, scale: 1.5 })
})

test('fitViewportToBounds falls back to DEFAULT_VIEWPORT for degenerate bounds', () => {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  assert.deepEqual(fitViewportToBounds(bounds, 800, 600, null), DEFAULT_VIEWPORT)
})

test('centerViewportOn pans to put worldPoint at screen center and preserves scale', () => {
  const result = centerViewportOn({ x: 50, y: 30 }, { x: 10, y: 20, scale: 2 }, 800, 600)
  assert.deepEqual(result, { x: 300, y: 240, scale: 2 })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-viewport.test.js`
Expected: FAIL（`tweenViewport`/`fitViewportToBounds`/`centerViewportOn` 不是函数 / undefined）

- [ ] **Step 3: 实现**

在 `src/minimap/viewport.js` 顶部，把

```js
import { screenToWorld } from './coords.js'
```

改成

```js
import { screenToWorld } from './coords.js'
import { easeOutCubic } from './layout-transition.js'
```

在文件末尾追加：

```js
export function tweenViewport(from, to, progress) {
  const eased = easeOutCubic(progress)
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    scale: from.scale + (to.scale - from.scale) * eased,
  }
}

export function fitViewportToBounds(bounds, viewportWidth, viewportHeight, options = null, padding = 40) {
  const degenerate =
    !Number.isFinite(bounds?.minX) ||
    !Number.isFinite(bounds?.maxX) ||
    !Number.isFinite(bounds?.minY) ||
    !Number.isFinite(bounds?.maxY)
  if (degenerate) return DEFAULT_VIEWPORT

  const contentWidth = Math.max(1, bounds.maxX - bounds.minX)
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY)
  const availableWidth = Math.max(1, viewportWidth - 2 * padding)
  const availableHeight = Math.max(1, viewportHeight - 2 * padding)
  const rawScale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
  const scale = clampScale(rawScale, options)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return {
    x: viewportWidth / 2 - centerX * scale,
    y: viewportHeight / 2 - centerY * scale,
    scale,
  }
}

export function centerViewportOn(worldPoint, viewport, viewportWidth, viewportHeight) {
  return {
    x: viewportWidth / 2 - worldPoint.x * viewport.scale,
    y: viewportHeight / 2 - worldPoint.y * viewport.scale,
    scale: viewport.scale,
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-viewport.test.js`
Expected: PASS（全部测试通过，含原有 8 个 + 新增 5 个）

- [ ] **Step 5: 提交**

```bash
git add src/minimap/viewport.js test/minimap-viewport.test.js
git commit -m "$(cat <<'EOF'
feat: add viewport-only tween helpers

tweenViewport/fitViewportToBounds/centerViewportOn are decoupled from
layout-transition's per-frame visibleItems interpolation since
fitToScreen/centerOnNode/zoomTo only ever change x/y/scale, not layout.
EOF
)"
```

---

## Task 2: `layout.js` 分组子节点定位纯函数

**Files:**
- Modify: `src/minimap/layout.js:57-84`（`visibleGroupChildren` 函数及其上方注释）
- Test: `test/minimap-layout.test.js`

**Interfaces:**
- Consumes: 现有 `GROUP` 常量、`clampGroupScroll(group, scrollTop)`（已导出）。
- Produces：
  - `locateChildGroup(layout, childId)` → `{ group, index } | null`，在 `layout.groups` 里查 `childId` 属于哪个分组。
  - `childRectInGroup(group, childId)` → `{ x, y, width, height } | null`，按当前 `group.scrollTop` 算某个子节点的世界坐标矩形，不要求当前可见。
  - `scrollTopToReveal(group, index)` → `number`，算出能让第 `index` 个子节点在可见窗口里居中的 `scrollTop`，经 `clampGroupScroll` 夹紧；不改 `expanded`。
  - Task 4 会用这三个函数名 + `GROUP`/`clampGroupScroll` 实现 `centerOnNode` 的分组滚动逻辑，不要改名。

- [ ] **Step 1: 写失败测试**

在 `test/minimap-layout.test.js` 顶部，把

```js
import {
  GROUP_THRESHOLD,
  computeLayout,
  keepAnchorStable,
  clampGroupScroll,
  visibleGroupChildren,
} from '../src/minimap/layout.js'
```

改成

```js
import {
  GROUP,
  GROUP_THRESHOLD,
  childRectInGroup,
  clampGroupScroll,
  computeLayout,
  keepAnchorStable,
  locateChildGroup,
  scrollTopToReveal,
  visibleGroupChildren,
} from '../src/minimap/layout.js'
```

在文件末尾追加：

```js
test('locateChildGroup finds the group and index containing a grouped child', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 1200, viewportHeight: 760 })
  const group = layout.groups.find((g) => g.parentId === 'heap-1')

  const located = locateChildGroup(layout, 'cluster-24')

  assert.equal(located.group.id, group.id)
  assert.equal(located.index, group.children.indexOf('cluster-24'))
})

test('locateChildGroup returns null for ids that are not grouped children', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 1200, viewportHeight: 760 })

  assert.equal(locateChildGroup(layout, 'feeder-1'), null)
  assert.equal(locateChildGroup(layout, 'does-not-exist'), null)
})

test('childRectInGroup matches visibleGroupChildren rects and also works for hidden items', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 1200, viewportHeight: 760 })
  const group = layout.groups.find((g) => g.parentId === 'heap-1')

  for (const item of visibleGroupChildren(group)) {
    assert.deepEqual(childRectInGroup(group, item.id), item.rect)
  }

  const lastIndex = group.children.length - 1
  const lastId = group.children[lastIndex]
  const expectedRect = {
    x: group.x + GROUP.padding + (lastIndex % group.columns) * (GROUP.itemW + GROUP.itemGap),
    y:
      group.y +
      GROUP.header +
      GROUP.padding +
      Math.floor(lastIndex / group.columns) * (GROUP.itemH + GROUP.itemGap) -
      group.scrollTop,
    width: GROUP.itemW,
    height: GROUP.itemH,
  }
  assert.deepEqual(childRectInGroup(group, lastId), expectedRect)
})

test('childRectInGroup returns null for an id not in the group', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 1200, viewportHeight: 760 })
  const group = layout.groups.find((g) => g.parentId === 'heap-1')

  assert.equal(childRectInGroup(group, 'feeder-1'), null)
})

test('scrollTopToReveal centers the target row within the visible window, clamped to the valid range', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 1200, viewportHeight: 760 })
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const lastIndex = group.children.length - 1

  const scrollTop = scrollTopToReveal(group, lastIndex)
  const maxScroll = group.contentHeight - group.height
  assert.ok(scrollTop > 0 && scrollTop <= maxScroll)
  assert.equal(scrollTopToReveal(group, 0), 0)

  const revealedRect = childRectInGroup({ ...group, scrollTop }, group.children[lastIndex])
  const innerTop = group.y + GROUP.header
  const innerBottom = group.y + group.height
  assert.ok(revealedRect.y >= innerTop - 1 && revealedRect.y + revealedRect.height <= innerBottom + 1)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout.test.js`
Expected: FAIL（`locateChildGroup`/`childRectInGroup`/`scrollTopToReveal` 不是函数）

- [ ] **Step 3: 实现**

把 `src/minimap/layout.js:57-84` 这段（含上方两行注释）：

```js
// 根据 scrollTop 算出当前应该绘制的子节点窗口（世界坐标格子），
// 供渲染器/交互层虚拟绘制和命中检测复用；多取一行避免半行滚动时露白。
export function visibleGroupChildren(group) {
  const rowHeight = GROUP.itemH + GROUP.itemGap
  const innerHeight = group.height - GROUP.header - 2 * GROUP.padding
  const visibleRows = Math.max(1, Math.ceil(innerHeight / rowHeight) + 1)
  const startRow = Math.max(0, Math.floor(group.scrollTop / rowHeight))
  const endRow = Math.min(group.rows, startRow + visibleRows)

  const items = []
  for (let row = startRow; row < endRow; row++) {
    for (let col = 0; col < group.columns; col++) {
      const index = row * group.columns + col
      if (index >= group.children.length) break
      items.push({
        id: group.children[index],
        index,
        rect: {
          x: group.x + GROUP.padding + col * (GROUP.itemW + GROUP.itemGap),
          y: group.y + GROUP.header + GROUP.padding + row * rowHeight - group.scrollTop,
          width: GROUP.itemW,
          height: GROUP.itemH,
        },
      })
    }
  }
  return items
}
```

替换成：

```js
function childRectAt(group, index) {
  const rowHeight = GROUP.itemH + GROUP.itemGap
  const row = Math.floor(index / group.columns)
  const col = index % group.columns
  return {
    x: group.x + GROUP.padding + col * (GROUP.itemW + GROUP.itemGap),
    y: group.y + GROUP.header + GROUP.padding + row * rowHeight - group.scrollTop,
    width: GROUP.itemW,
    height: GROUP.itemH,
  }
}

// 根据 scrollTop 算出当前应该绘制的子节点窗口（世界坐标格子），
// 供渲染器/交互层虚拟绘制和命中检测复用；多取一行避免半行滚动时露白。
export function visibleGroupChildren(group) {
  const rowHeight = GROUP.itemH + GROUP.itemGap
  const innerHeight = group.height - GROUP.header - 2 * GROUP.padding
  const visibleRows = Math.max(1, Math.ceil(innerHeight / rowHeight) + 1)
  const startRow = Math.max(0, Math.floor(group.scrollTop / rowHeight))
  const endRow = Math.min(group.rows, startRow + visibleRows)

  const items = []
  for (let row = startRow; row < endRow; row++) {
    for (let col = 0; col < group.columns; col++) {
      const index = row * group.columns + col
      if (index >= group.children.length) break
      items.push({ id: group.children[index], index, rect: childRectAt(group, index) })
    }
  }
  return items
}

// 在 layout.groups 里查 childId 属于哪个分组、第几位；查不到返回 null。
export function locateChildGroup(layout, childId) {
  for (const group of layout.groups) {
    const index = group.children.indexOf(childId)
    if (index !== -1) return { group, index }
  }
  return null
}

// 按 group.scrollTop 算某个子节点的世界坐标矩形，不要求当前可见；查不到返回 null。
export function childRectInGroup(group, childId) {
  const index = group.children.indexOf(childId)
  if (index === -1) return null
  return childRectAt(group, index)
}

// 算出能让第 index 个子节点在可见窗口里居中的 scrollTop，经 clampGroupScroll 夹紧；不改 expanded。
export function scrollTopToReveal(group, index) {
  const rowHeight = GROUP.itemH + GROUP.itemGap
  const row = Math.floor(index / group.columns)
  const innerHeight = group.height - GROUP.header - 2 * GROUP.padding
  const rawScrollTop = row * rowHeight - innerHeight / 2 + GROUP.itemH / 2
  return clampGroupScroll(group, rawScrollTop)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout.test.js`
Expected: PASS（全部测试通过，含原有用例 + 新增 5 个）

- [ ] **Step 5: 跑全量测试确认没有破坏其它文件**

Run: `npm test`
Expected: PASS（全部测试通过；`visibleGroupChildren` 的现有调用方——`renderer.js`/`selection.js`/`Minimap.vue`——行为不变）

- [ ] **Step 6: 提交**

```bash
git add src/minimap/layout.js test/minimap-layout.test.js
git commit -m "$(cat <<'EOF'
feat: add group child locating helpers to layout.js

locateChildGroup/childRectInGroup/scrollTopToReveal let centerOnNode
find a grouped child's position and the scrollTop needed to reveal it,
without ever touching the group's expanded flag. visibleGroupChildren's
per-cell rect formula is now shared via a private childRectAt so the two
stay in sync.
EOF
)"
```

---

## Task 3: `selection.js` 多模式选择纯函数

**Files:**
- Modify: `src/minimap/selection.js`
- Test: `test/minimap-selection.test.js`

**Interfaces:**
- Consumes: 无新依赖。
- Produces：`applySelectionSet(currentIds, ids, mode = 'replace')` → `string[]`；`mode` 取 `'replace'`/`'add'`/`'remove'`/`'toggle'`。Task 4 的 `select(ids, mode)` 会直接调用这个函数。

- [ ] **Step 1: 写失败测试**

在 `test/minimap-selection.test.js` 顶部，把

```js
import {
  applySelectionClick,
  buildSelectionRelations,
  idsInSelectionRect,
  intersectsRect,
} from '../src/minimap/selection.js'
```

改成

```js
import {
  applySelectionClick,
  applySelectionSet,
  buildSelectionRelations,
  idsInSelectionRect,
  intersectsRect,
} from '../src/minimap/selection.js'
```

在文件末尾追加：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-selection.test.js`
Expected: FAIL（`applySelectionSet` 不是函数）

- [ ] **Step 3: 实现**

在 `src/minimap/selection.js` 的 `applySelectionClick` 函数后面（紧接着，在 `function visibleSelectableItems` 之前）插入：

```js
export function applySelectionSet(currentIds, ids, mode = 'replace') {
  if (mode === 'add') return [...new Set([...currentIds, ...ids])]
  if (mode === 'remove') {
    const removeSet = new Set(ids)
    return currentIds.filter((id) => !removeSet.has(id))
  }
  if (mode === 'toggle') {
    const result = [...currentIds]
    for (const id of ids) {
      const index = result.indexOf(id)
      if (index === -1) result.push(id)
      else result.splice(index, 1)
    }
    return result
  }
  return [...ids]
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-selection.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/minimap/selection.js test/minimap-selection.test.js
git commit -m "$(cat <<'EOF'
feat: add applySelectionSet for replace/add/remove/toggle modes

Backs the upcoming select(ids, mode) defineExpose method.
EOF
)"
```

---

## Task 4: `Minimap.vue` 视口补动状态机 + 8 个 `defineExpose` 方法

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Test (new): `test/minimap-view-positioning.test.js`

**Interfaces:**
- Consumes: Task 1 的 `tweenViewport`/`fitViewportToBounds`/`centerViewportOn`（加上已有的 `clampScale`）；Task 2 的 `locateChildGroup`/`childRectInGroup`/`scrollTopToReveal`；Task 3 的 `applySelectionSet`；已有的 `settleAnimation`/`cancelPointerInteractions`/`currentViewport`/`currentSelectedIds`/`setSelected`/`updateGroupState`/`updateLayout`/`applyViewport`/`screenToWorld`/`normalizeViewport`/`sameViewport`/`viewportOptions`。
- Produces: `defineExpose({ fitToScreen, centerOnNode, centerOnSelection, zoomTo, setViewport, getViewport, select, clearSelection })`，供切片 2（搜索节点）、切片 3（overview 导航）复用 `centerOnNode`/`fitToScreen` 等方法名。

- [ ] **Step 1: 写失败测试**

新建 `test/minimap-view-positioning.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubAnimationFrame, stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, childRectInGroup, scrollTopToReveal } from '../src/minimap/layout.js'
import { centerViewportOn, fitViewportToBounds } from '../src/minimap/viewport.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

function settle() {
  frames.runNext(0)
  frames.runNext(200)
}

function referenceLayout() {
  return computeLayout(createDemoGraph(), { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
}

function renderedRectForLabel(ctx, label) {
  const lastClear = ctx.calls.map((call) => call.method).lastIndexOf('clearRect')
  const calls = ctx.calls.slice(lastClear + 1)
  const labelIndex = calls.findIndex((call) => call.method === 'fillText' && call.args[0] === label)
  assert.notEqual(labelIndex, -1)
  const rectCall = calls.slice(0, labelIndex).findLast((call) => call.method === 'strokeRect')
  assert.ok(rectCall)
  const [x, y, width, height] = rectCall.args
  return { x, y, width, height }
}

test('fitToScreen fits the demo graph bounds into the viewport with padding', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.fitToScreen()
  settle()

  const expected = fitViewportToBounds(referenceLayout().bounds, 800, 600, null)
  assert.deepEqual(wrapper.vm.getViewport(), expected)
  wrapper.destroy()
})

test('fitToScreen on an empty graph is a no-op', () => {
  const graph = { version: 1, nodes: new Map(), rootIds: [], edges: [] }
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.fitToScreen()
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: 0, y: 0, scale: 1 })
  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

test('centerOnNode centers a plain node and preserves current scale', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.centerOnNode('feeder-1')
  settle()

  const rect = referenceLayout().nodes.get('feeder-1')
  const target = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  wrapper.destroy()
})

test('centerOnNode centers a group box by its chrome rect', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.centerOnNode('heap-1::g0')
  settle()

  const group = referenceLayout().groups.find((g) => g.id === 'heap-1::g0')
  const target = { x: group.x + group.width / 2, y: group.y + group.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  wrapper.destroy()
})

test('centerOnNode scrolls a collapsed group to reveal a hidden child without expanding it', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.centerOnNode('cluster-24')
  settle()

  const group = referenceLayout().groups.find((g) => g.id === 'heap-1::g0')
  const index = group.children.indexOf('cluster-24')
  const scrollTop = scrollTopToReveal(group, index)
  const rect = childRectInGroup({ ...group, scrollTop }, 'cluster-24')
  const target = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))

  const groupStates = wrapper.emitted('group-state-change').at(-1)[0]
  assert.deepEqual(groupStates['heap-1::g0'], { scrollTop })
  wrapper.destroy()
})

test('centerOnNode on an unknown id is a no-op', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.centerOnNode('does-not-exist')
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: 0, y: 0, scale: 1 })
  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

test('centerOnSelection centers the true bounding box of mixed selections and preserves scale', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  wrapper.vm.setViewport({ x: 0, y: 0, scale: 2.5 })
  wrapper.vm.select(['feeder-1', 'heap-1::g0'])

  wrapper.vm.centerOnSelection()
  settle()

  const layout = referenceLayout()
  const feeder = layout.nodes.get('feeder-1')
  const group = layout.groups.find((g) => g.id === 'heap-1::g0')
  const minX = Math.min(feeder.x, group.x)
  const maxX = Math.max(feeder.x + feeder.width, group.x + group.width)
  const minY = Math.min(feeder.y, group.y)
  const maxY = Math.max(feeder.y + feeder.height, group.y + group.height)
  const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 2.5 }, 800, 600))
  wrapper.destroy()
})

test('centerOnSelection with an empty selection is a no-op', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.centerOnSelection()
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: 0, y: 0, scale: 1 })
  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

test('zoomTo without a center keeps the current screen center fixed', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  wrapper.vm.setViewport({ x: 50, y: 20, scale: 1 })

  wrapper.vm.zoomTo(2)
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: -300, y: -260, scale: 2 })
  wrapper.destroy()
})

test('zoomTo with an explicit world point keeps that point at its current screen position', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  wrapper.vm.setViewport({ x: 50, y: 20, scale: 1 })

  wrapper.vm.zoomTo(2, { x: 10, y: 10 })
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: 40, y: 10, scale: 2 })
  wrapper.destroy()
})

test('zoomTo clamps scale to options bounds', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, options: { minScale: 0.25, maxScale: 3 } } })
  wrapper.vm.setViewport({ x: 50, y: 20, scale: 1 })

  wrapper.vm.zoomTo(10, { x: 10, y: 10 })
  settle()

  assert.deepEqual(wrapper.vm.getViewport(), { x: 30, y: 0, scale: 3 })
  wrapper.destroy()
})

test('setViewport applies immediately without scheduling an animation frame', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const scheduledBefore = frames.scheduled.length

  wrapper.vm.setViewport({ x: 12, y: 34, scale: 1.5 })

  assert.deepEqual(wrapper.vm.getViewport(), { x: 12, y: 34, scale: 1.5 })
  assert.equal(frames.scheduled.length, scheduledBefore)
  wrapper.destroy()
})

test('select supports replace/add/remove/toggle modes and clearSelection empties it', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['feeder-1'])
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])

  wrapper.vm.select(['feeder-2'], 'add')
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1', 'feeder-2'])

  wrapper.vm.select(['feeder-1'], 'remove')
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-2'])

  wrapper.vm.select(['feeder-2', 'feeder-3'], 'toggle')
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-3'])

  wrapper.vm.clearSelection()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], [])
  wrapper.destroy()
})

test('controlled viewport mode: centerOnNode only emits, never mutates the rendered scene', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, viewport: { x: 0, y: 0, scale: 1 } } })
  const ctx = contexts.at(-1)
  const before = renderedRectForLabel(ctx, 'Feeder 1')

  wrapper.vm.centerOnNode('feeder-1')
  settle()

  const after = renderedRectForLabel(ctx, 'Feeder 1')
  assert.deepEqual(after, before)
  assert.ok(wrapper.emitted('viewport-change').length > 0)
  wrapper.destroy()
})

test('controlled groupStates: centerOnNode emits the scrollTop patch but targets the unrevealed position', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, {
    propsData: { graph, groupStates: { 'heap-1::g0': { scrollTop: 0 } } },
  })

  wrapper.vm.centerOnNode('cluster-24')
  settle()

  const group = referenceLayout().groups.find((g) => g.id === 'heap-1::g0')
  const index = group.children.indexOf('cluster-24')
  const expectedScrollTop = scrollTopToReveal(group, index)
  assert.equal(wrapper.emitted('group-state-change').at(-1)[0]['heap-1::g0'].scrollTop, expectedScrollTop)

  // 父级没有真正回写 prop，组件内部不会持久化这次滚动；centerOnNode 实际算出的
  // 目标位置仍然是 group.scrollTop 维持在 0（未揭示）时 cluster-24 所在的矩形——
  // 这一点本身也证明了控制权确实交给了父级，而不是组件自己悄悄应用了这次滚动。
  const staleRect = childRectInGroup(group, 'cluster-24')
  const target = { x: staleRect.x + staleRect.width / 2, y: staleRect.y + staleRect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  wrapper.destroy()
})

test('calling a navigation method mid-pan cancels the pan interaction', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: -10000, clientY: -10000, pointerId: 1, bubbles: true }),
  )

  wrapper.vm.fitToScreen()
  settle()
  const emittedBeforeMove = wrapper.emitted('viewport-change')?.length ?? 0

  canvasEl.dispatchEvent(
    new PointerEvent('pointermove', { clientX: -9900, clientY: -10040, pointerId: 1, bubbles: true }),
  )

  assert.equal(wrapper.emitted('viewport-change')?.length ?? 0, emittedBeforeMove)
  wrapper.destroy()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-view-positioning.test.js`
Expected: FAIL（`wrapper.vm.fitToScreen`/`centerOnNode`/... 都是 `undefined`）

- [ ] **Step 3: 实现**

在 `src/minimap/Minimap.vue` 的 `<script setup>` 里做以下 6 处修改：

**3a. 三个 import 块各加几个名字。**

把

```js
import { computeLayout, keepAnchorStable, GROUP, clampGroupScroll } from './layout.js'
```

改成

```js
import {
  computeLayout,
  keepAnchorStable,
  GROUP,
  clampGroupScroll,
  childRectInGroup,
  locateChildGroup,
  scrollTopToReveal,
} from './layout.js'
```

把

```js
import {
  DEFAULT_VIEWPORT,
  normalizeViewport,
  panViewportBy,
  sameViewport,
  viewportOptions,
  zoomViewportAt,
} from './viewport.js'
```

改成

```js
import {
  DEFAULT_VIEWPORT,
  centerViewportOn,
  clampScale,
  fitViewportToBounds,
  normalizeViewport,
  panViewportBy,
  sameViewport,
  tweenViewport,
  viewportOptions,
  zoomViewportAt,
} from './viewport.js'
```

把

```js
import {
  applySelectionClick,
  buildSelectionRelations,
  idsInSelectionRect,
  normalizeRect,
} from './selection.js'
```

改成

```js
import {
  applySelectionClick,
  applySelectionSet,
  buildSelectionRelations,
  idsInSelectionRect,
  normalizeRect,
} from './selection.js'
```

**3b. 新增模块级状态。** 把

```js
let lastRenderedViewport = { ...DEFAULT_VIEWPORT }
```

改成

```js
let lastRenderedViewport = { ...DEFAULT_VIEWPORT }
let activeViewportTween = null
let viewportTweenFrameId = null
```

**3c. 新增视口补动驱动函数。** 在 `applyViewport` 函数（结尾是这几行）：

```js
function applyViewport(nextViewport, { emitChange = true } = {}) {
  const next = normalizeViewport(nextViewport, viewportOptions(props.options))
  const previous = currentViewport()
  if (sameViewport(previous, next)) return false
  if (emitChange) emit('viewport-change', next)
  if (props.viewport !== null) return true
  internalViewport = next
  renderCurrent(layout, next)
  return true
}
```

后面（在 `function updateGroupState` 之前）插入：

```js
function cancelViewportTween() {
  if (viewportTweenFrameId !== null) {
    cancelAnimationFrame(viewportTweenFrameId)
    viewportTweenFrameId = null
  }
  activeViewportTween = null
}

function runViewportTween(toViewport, { durationMs = 200 } = {}) {
  settleAnimation()
  cancelViewportTween()
  cancelPointerInteractions()

  const next = normalizeViewport(toViewport, viewportOptions(props.options))
  const fromViewport = currentViewport()
  if (sameViewport(fromViewport, next)) return

  if (props.viewport !== null) {
    emit('viewport-change', next)
    return
  }

  activeViewportTween = { fromViewport, toViewport: next, durationMs, startedAt: null }
  const tick = (time) => {
    if (!activeViewportTween) return
    if (activeViewportTween.startedAt === null) activeViewportTween.startedAt = time
    const progress = (time - activeViewportTween.startedAt) / activeViewportTween.durationMs
    if (progress >= 1) {
      viewportTweenFrameId = null
      const finalViewport = activeViewportTween.toViewport
      activeViewportTween = null
      internalViewport = finalViewport
      renderCurrent(layout, finalViewport)
      emit('viewport-change', finalViewport)
      return
    }
    internalViewport = tweenViewport(activeViewportTween.fromViewport, activeViewportTween.toViewport, progress)
    renderCurrent(layout, internalViewport)
    viewportTweenFrameId = requestAnimationFrame(tick)
  }
  viewportTweenFrameId = requestAnimationFrame(tick)
}
```

`settleAnimation`/`cancelPointerInteractions`/`currentViewport` 都已经在文件里定义，不需要新增。

**3d. 新增 8 个暴露方法 + `defineExpose`。** 在 `function handleDrop(event) { ... }` 的结尾 `}`（紧接着 `emit('change', props.graph)` 和它的收尾括号）之后、`function syncCanvasSize() {` 之前，插入：

```js
function resolveTargetRect(id) {
  if (!layout) return null
  const group = layout.groups.find((g) => g.id === id)
  if (group) return { x: group.x, y: group.y, width: group.width, height: group.height }
  const nodeRect = layout.nodes.get(id)
  if (nodeRect) return nodeRect
  const located = locateChildGroup(layout, id)
  if (!located) return null
  return childRectInGroup(located.group, id)
}

function rectCenter(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function resolveCenterTarget(id) {
  if (!layout) return null
  const located = locateChildGroup(layout, id)
  if (located) {
    const scrollTop = scrollTopToReveal(located.group, located.index)
    if (props.groupStates === null) located.group.scrollTop = scrollTop
    updateGroupState(located.group.id, { scrollTop })
    if (props.groupStates !== null) updateLayout({ animate: false, preserveAnchor: false })
  }
  const rect = resolveTargetRect(id)
  return rect ? rectCenter(rect) : null
}

function fitToScreen() {
  if (!layout) return
  runViewportTween(fitViewportToBounds(layout.bounds, cssWidth, cssHeight, props.options))
}

function centerOnNode(id) {
  const target = resolveCenterTarget(id)
  if (!target) return
  runViewportTween(centerViewportOn(target, currentViewport(), cssWidth, cssHeight))
}

function centerOnSelection() {
  const ids = currentSelectedIds()
  if (ids.length === 0) return
  const rects = ids.map(resolveTargetRect).filter(Boolean)
  if (rects.length === 0) return
  const minX = Math.min(...rects.map((r) => r.x))
  const maxX = Math.max(...rects.map((r) => r.x + r.width))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxY = Math.max(...rects.map((r) => r.y + r.height))
  const target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
  runViewportTween(centerViewportOn(target, currentViewport(), cssWidth, cssHeight))
}

function zoomTo(scale, center = null) {
  const viewport = currentViewport()
  const worldCenter = center ?? screenToWorld({ x: cssWidth / 2, y: cssHeight / 2 }, viewport)
  const nextScale = clampScale(scale, viewportOptions(props.options))
  runViewportTween({
    x: worldCenter.x * (viewport.scale - nextScale) + viewport.x,
    y: worldCenter.y * (viewport.scale - nextScale) + viewport.y,
    scale: nextScale,
  })
}

function setViewport(viewport) {
  settleAnimation()
  cancelViewportTween()
  applyViewport(viewport)
}

function getViewport() {
  return currentViewport()
}

function select(ids, mode = 'replace') {
  setSelected(applySelectionSet(currentSelectedIds(), ids, mode))
}

function clearSelection() {
  setSelected([])
}

defineExpose({
  fitToScreen,
  centerOnNode,
  centerOnSelection,
  zoomTo,
  setViewport,
  getViewport,
  select,
  clearSelection,
})
```

**3e. `onUnmounted` 补充清理。** 把

```js
onUnmounted(() => {
  const canvas = canvasRef.value
  cancelAnimation()
  cancelPointerInteractions()
```

改成

```js
onUnmounted(() => {
  const canvas = canvasRef.value
  cancelAnimation()
  cancelViewportTween()
  cancelPointerInteractions()
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-view-positioning.test.js`
Expected: PASS（全部 16 个测试通过）

- [ ] **Step 5: 跑全量测试确认没有破坏其它文件**

Run: `npm test`
Expected: PASS（全部测试通过，包括既有的 184 个 + 本任务前三个 Task 新增的用例 + 本任务新增的 16 个）

- [ ] **Step 6: 提交**

```bash
git add src/minimap/Minimap.vue test/minimap-view-positioning.test.js
git commit -m "$(cat <<'EOF'
feat: expose fitToScreen/centerOnNode/centerOnSelection/zoomTo/setViewport/getViewport/select/clearSelection

First defineExpose surface on Minimap.vue. Viewport-changing methods run
through a dedicated tween (runViewportTween) that settles any in-flight
layout animation and cancels active pointer interactions first, then
animates uncontrolled viewport state or emits once immediately when the
viewport prop is externally controlled. centerOnNode reveals grouped
children by adjusting scrollTop only, never expanded.
EOF
)"
```

---

## Task 5: 回归校验 + ROADMAP 同步

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: 无新接口。
- Produces: 无（文档收尾）。

- [ ] **Step 1: 跑全量测试**

Run: `npm test`
Expected: PASS，全部测试通过（基线 184 + Task 1~4 新增用例）。记录最终测试数到 ROADMAP。

- [ ] **Step 2: 跑构建**

Run: `npm run build`
Expected: 构建成功，无报错。

- [ ] **Step 3: 更新 ROADMAP.md**

把

```
- **第四阶段切片**（overview 是独立 mini canvas 子组件，跟前两个切片的视口数学性质不同，拆开做；后两个切片都会复用切片 1 的 `centerOnNode`/视口补动能力）：
  - [ ] 切片 1：视图定位方法（`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport`/`select`/`clearSelection` 首次通过 `defineExpose` 暴露；[spec](docs/superpowers/specs/2026-06-20-phase-4-view-positioning.md) 已完成，待写 plan）
  - [ ] 切片 2：搜索节点（按 `id`/`label` 搜索普通节点和分组框内子节点，复用切片 1 的定位能力跳转）
  - [ ] 切片 3：Overview 小地图导航（独立 mini canvas 子组件，缩略图 + 视口框拖拽导航）
- **下一步**：为第四阶段切片 1（视图定位方法）写 plan。
```

改成（`<N>` 替换成 Step 1 实际跑出来的测试总数）：

```
- **第四阶段切片**（overview 是独立 mini canvas 子组件，跟前两个切片的视口数学性质不同，拆开做；后两个切片都会复用切片 1 的 `centerOnNode`/视口补动能力）：
  - [x] 切片 1：视图定位方法（`viewport.js`/`layout.js`/`selection.js` 纯函数 + `Minimap.vue` 首次 `defineExpose`：`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport`/`select`/`clearSelection`；[plan](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md)，`npm test` <N> 全过，`npm run build` 通过）
  - [ ] 切片 2：搜索节点（按 `id`/`label` 搜索普通节点和分组框内子节点，复用切片 1 的定位能力跳转）
  - [ ] 切片 3：Overview 小地图导航（独立 mini canvas 子组件，缩略图 + 视口框拖拽导航）
- **下一步**：开始第四阶段切片 2（搜索节点）的 brainstorm 和 spec。
```

同时把「当前进度」块顶部的

```
- **当前阶段**：第四阶段（导航和查找能力）—— 切片 1 已写 spec，待写 plan
- **当前阶段 Spec**：切片 1 [视图定位方法](docs/superpowers/specs/2026-06-20-phase-4-view-positioning.md) 已完成；切片 2、3 待创建
- **当前阶段计划**：待创建
```

改成

```
- **当前阶段**：第四阶段（导航和查找能力）—— 切片 1 已完成，待规划切片 2
- **当前阶段 Spec**：切片 1 [视图定位方法](docs/superpowers/specs/2026-06-20-phase-4-view-positioning.md) 已完成；切片 2、3 待创建
- **当前阶段计划**：切片 1 [视图定位方法](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md) 已完成；切片 2、3 待创建
```

并在「已完成切片」列表末尾追加一行（紧跟在选择模型和高亮那一行后面）：

```
  - 视图定位方法 `viewport.js` 视口补动 + `layout.js` 分组子节点定位 + `selection.js` 多模式选择 + `Minimap.vue` 首次 `defineExpose`（`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport`/`select`/`clearSelection`） + 测试（[plan](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md)，`npm test` <N> 全过，`npm run build` 通过）
```

- [ ] **Step 4: 把本 plan 文件顶部的「进度」checklist 5 项全部勾上**

把文件开头的

```
- [ ] Task 1：`viewport.js` 视口补动纯函数（`tweenViewport`/`fitViewportToBounds`/`centerViewportOn`）
- [ ] Task 2：`layout.js` 分组子节点定位纯函数（`locateChildGroup`/`childRectInGroup`/`scrollTopToReveal`）
- [ ] Task 3：`selection.js` 多模式选择纯函数（`applySelectionSet`）
- [ ] Task 4：`Minimap.vue` 视口补动状态机 + 8 个 `defineExpose` 方法
- [ ] Task 5：回归校验 + ROADMAP 同步
```

改成全部 `- [x]`。

- [ ] **Step 5: 提交**

```bash
git add ROADMAP.md docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md
git commit -m "$(cat <<'EOF'
docs: mark Phase 4 slice 1 (view positioning) complete

npm test/npm run build both green; roadmap now points at slice 2
(search) as the next step.
EOF
)"
```
