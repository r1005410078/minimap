# Phase 2 分组逻辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `src/minimap/layout.js` 里"父节点子节点数 > 5 就把全部子节点折成一个分组框"的简化分组逻辑，替换成 ROADMAP 第二阶段要求的"连续叶子兄弟分段折叠、带子节点的兄弟截断分段、一个父节点可产生多个分组框、阈值可配置、可展开/折叠、滚动窗口可虚拟绘制"的完整分组逻辑。

**Architecture:** 全部改动落在纯逻辑文件 `src/minimap/layout.js`，不碰 Canvas / Vue。`computeLayout` 内部新增一个"分段"步骤（按叶子兄弟连续段 + 阈值判断哪些段折叠成分组），每个分组有独立的 `id`；原有的自底向上/自顶向下定位算法（`crossSizeOf`/`place`）不变，只是消费的 `group` 对象字段更丰富。新增两个独立的纯函数 `clampGroupScroll`/`visibleGroupChildren`，供后续切片（Canvas 渲染器、Vue 交互）在切片 2/3 中使用。

**Tech Stack:** 纯 JavaScript（ES Modules），Node 内置 `node:test` + `node:assert/strict` 测试运行器，无新依赖。

## 进度

- [x] Task 1：叶子兄弟分段 + 多分组身份 + groupThreshold 覆盖
- [x] Task 2：分组框最小尺寸下限保护
- [x] Task 3：options.groupStates 注入展开态 + clampGroupScroll
- [x] Task 4：visibleGroupChildren 虚拟绘制窗口
- [x] Task 5：回归校验 + 进度文档同步（`npm test` 92 全过、`npm run build` 通过）

## Global Constraints

- 不引入新的第三方运行时或开发依赖（[docs/project-conventions.md](../../project-conventions.md)）。
- 本切片只改 `src/minimap/layout.js` 和它的测试；不碰 `graph.js`/`renderer.js`/`layout-transition.js`/`interaction.js`/`Minimap.vue`（那些是切片 2/3 的范围）。
- 现有 `test/minimap-layout.test.js`、`test/minimap-graph.test.js` 里的全部既有用例必须原样通过，不能修改其断言。
- 每个任务完成后必须跑 `npm test` 和（最后一个任务）`npm run build`，确认通过才能提交（[docs/project-conventions.md](../../project-conventions.md) Testing Rules）。
- 字段/函数命名以 [spec](../specs/2026-06-19-phase-2-group-logic.md) 的"Group 数据契约"与"模块 API 契约"为准。

---

## 文件落点

- 修改：`src/minimap/layout.js`——分段算法、多分组 `id`、最小尺寸、`groupThreshold`/`groupStates` 透传、新增导出 `clampGroupScroll`/`visibleGroupChildren`。
- 修改：`test/minimap-layout.test.js`——新增分段/多分组/阈值/最小尺寸/展开态/滚动窗口测试；现有 7 条用例不改。
- 不修改：`test/minimap-graph.test.js`——其现有"folds only when the run is larger than the threshold"用例用的是纯叶子 fixture，新算法下行为不变，已在 spec 里验证过等价性。

---

### Task 1: 叶子兄弟分段 + 多分组身份 + `groupThreshold` 覆盖

**Files:**
- Modify: `src/minimap/layout.js`
- Test: `test/minimap-layout.test.js`

**Interfaces:**
- Consumes：无新依赖；复用现有 `GROUP`/`GROUP_MAX_W_RATIO`/`GROUP_MAX_H_RATIO`/`NODE`/`LEVEL_GAP`/`SIBLING_GAP` 模块内常量。
- Produces：
  - `computeLayout(graph, { direction, viewportWidth, viewportHeight, groupThreshold? })` —— 新增 `groupThreshold` 选项，默认 `GROUP_THRESHOLD`（5）。
  - `Group` 对象新增字段 `id: string`（格式 `${parentId}::g${segmentIndex}`），其余字段（`parentId`/`children`/`columns`/`rows`/`width`/`height`/`overflowY`/`x`/`y`）保持现有命名不变。
  - 一个父节点下 `layout.groups` 可以包含 0、1 或多个属于它的分组（用 `parentId` 区分）。
  - Task 2 会继续修改本任务新建的 `buildGroup` 函数体（不改签名）；Task 3 会再给它新增一个 `state` 参数。`buildGroup` 本身始终不导出，只在模块内部使用。

- [ ] **Step 1: 写失败的测试**

在 `test/minimap-layout.test.js` 顶部（`import` 语句之后，第一个 `test(...)` 之前）新增两个测试辅助函数，以及三个新测试：

```js
// 在已有 import 之后追加：
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
```

然后追加三个测试：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout.test.js`
Expected: 这三个新用例 FAIL（第一个会因为 `layout.groups.length` 实际是 1 而不是 2 报错；其余既有用例仍然 PASS）。

- [ ] **Step 3: 实现分段算法**

把 `src/minimap/layout.js` 里旧的 `buildGroup` 函数和 `computeLayout` 第 1/2 步替换成：

```js
function isLeaf(node) {
  return !node.children || node.children.length === 0
}

// 把 parentNode.children 按"连续叶子兄弟"分段；遇到带子节点的兄弟就结束当前段
// （这个兄弟自己永远不参与合并）。只返回长度超过 groupThreshold 的段，按出现顺序排列。
function collectGroupSegments(parentNode, graph, groupThreshold) {
  const segments = []
  let current = null
  for (const childId of parentNode.children || []) {
    const child = graph.nodes.get(childId)
    if (child && isLeaf(child)) {
      if (!current) {
        current = []
        segments.push(current)
      }
      current.push(childId)
    } else {
      current = null
    }
  }
  return segments.filter((segment) => segment.length > groupThreshold)
}

// 把一个分组的子节点列表折叠成分组框，按内部网格推导尺寸，同时受视口比例约束。
function buildGroup(groupId, parentId, children, viewportWidth, viewportHeight) {
  const maxW = viewportWidth * GROUP_MAX_W_RATIO
  const maxH = viewportHeight * GROUP_MAX_H_RATIO

  const columns = Math.max(
    1,
    Math.floor((maxW - 2 * GROUP.padding + GROUP.itemGap) / (GROUP.itemW + GROUP.itemGap)),
  )
  const rows = Math.ceil(children.length / columns)
  const contentWidth = 2 * GROUP.padding + columns * GROUP.itemW + (columns - 1) * GROUP.itemGap
  const contentHeight =
    GROUP.header + 2 * GROUP.padding + rows * GROUP.itemH + Math.max(0, rows - 1) * GROUP.itemGap

  return {
    id: groupId,
    parentId,
    children,
    columns,
    rows,
    width: Math.min(contentWidth, maxW),
    height: Math.min(contentHeight, maxH),
    overflowY: contentHeight > maxH,
    x: 0,
    y: 0,
  }
}
```

并把 `computeLayout` 开头的部分改成：

```js
export function computeLayout(graph, options = {}) {
  const direction = options.direction === 'vertical' ? 'vertical' : 'horizontal'
  const viewportWidth = options.viewportWidth ?? 1200
  const viewportHeight = options.viewportHeight ?? 760
  const groupThreshold = options.groupThreshold ?? GROUP_THRESHOLD

  // 1. 按"连续叶子兄弟分段"规则折叠；一个父节点下可能产生 0、1 或多个分组。
  const groups = []
  const groupOf = new Map() // childId -> group，供下面的 itemOf 跳过已消费的子节点
  for (const node of graph.nodes.values()) {
    const segments = collectGroupSegments(node, graph, groupThreshold)
    segments.forEach((segmentChildren, segmentIndex) => {
      const groupId = `${node.id}::g${segmentIndex}`
      const group = buildGroup(groupId, node.id, segmentChildren, viewportWidth, viewportHeight)
      groups.push(group)
      for (const childId of segmentChildren) groupOf.set(childId, group)
    })
  }

  // 2. 构建布局项树：命中分组子节点时，只在该分组第一次出现的位置插入一个 group 项。
  const itemOf = (nodeId) => {
    const node = graph.nodes.get(nodeId)
    const childItems = []
    const consumedGroups = new Set()
    for (const childId of node.children || []) {
      const group = groupOf.get(childId)
      if (group) {
        if (consumedGroups.has(group.id)) continue
        consumedGroups.add(group.id)
        childItems.push({ type: 'group', group })
      } else {
        childItems.push(itemOf(childId))
      }
    }
    return { type: 'node', node, childItems }
  }
```

（`mainExtentOf`/`crossExtentOf`/`crossSizeOf`/`place`/末尾的 `bounds` 计算保持原样不动，它们已经是通过 `item.group.width`/`item.group.height` 这类字段名访问，不依赖具体是不是只有一个分组。）

最后在 `place` 函数里把 group 分支的 `visibleItems.push` 改成带上 `id`（其余不变）：

```js
      visibleItems.push({ type: 'group', id: item.group.id, parentId: item.group.parentId, x, y, width, height })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout.test.js`
Expected: 全部 PASS（既有 7 条 + 新增 3 条）。

再跑一次全量，确认没有破坏其它文件：

Run: `npm test`
Expected: `pass 88`、`fail 0`（85 基线 + 本任务新增 3 条）。

- [ ] **Step 5: 提交**

```bash
git add src/minimap/layout.js test/minimap-layout.test.js
git commit -m "$(cat <<'EOF'
feat(layout): segment leaf siblings into independent groups

Replace the "any parent with >5 children folds entirely" rule with
per-run leaf-sibling segmentation: a sibling with children truncates
the run into independent segments, each judged against groupThreshold
on its own. A parent can now own multiple group boxes.
EOF
)"
```

---

### Task 2: 分组框最小尺寸下限保护

**Files:**
- Modify: `src/minimap/layout.js`
- Test: `test/minimap-layout.test.js`

**Interfaces:**
- Consumes：Task 1 的 `buildGroup(groupId, parentId, children, viewportWidth, viewportHeight)`。
- Produces：`buildGroup` 返回的 `width`/`height`/`overflowY` 永远满足 `width >= GROUP_MIN_WIDTH`、`height >= GROUP_MIN_HEIGHT`；`GROUP_MIN_WIDTH`/`GROUP_MIN_HEIGHT` 是模块内部常量（不导出），值由 `GROUP` 网格常量推导。

- [ ] **Step 1: 写失败的测试**

在 `test/minimap-layout.test.js` 里追加：

```js
test('group size never shrinks below the minimum usable grid', () => {
  const graph = graphWithChildren(leaves('d', 6))
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 10, viewportHeight: 10 })

  assert.equal(layout.groups[0].width, 144) // 2*12(padding) + 120(itemW)
  assert.equal(layout.groups[0].height, 92) // 28(header) + 2*12(padding) + 40(itemH)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout.test.js`
Expected: 新用例 FAIL（极小视口下 `width`/`height` 目前会被压缩到远小于 144/92）。

- [ ] **Step 3: 实现最小尺寸下限**

在 `src/minimap/layout.js` 的 `GROUP_MAX_W_RATIO`/`GROUP_MAX_H_RATIO` 常量定义之后新增：

```js
const GROUP_MIN_WIDTH = 2 * GROUP.padding + GROUP.itemW
const GROUP_MIN_HEIGHT = GROUP.header + 2 * GROUP.padding + GROUP.itemH
```

把 `buildGroup` 里的返回值改成：

```js
  const width = Math.max(GROUP_MIN_WIDTH, Math.min(contentWidth, maxW))
  const height = Math.max(GROUP_MIN_HEIGHT, Math.min(contentHeight, maxH))
  const overflowY = height < contentHeight

  return {
    id: groupId,
    parentId,
    children,
    columns,
    rows,
    width,
    height,
    overflowY,
    x: 0,
    y: 0,
  }
```

（注意 `overflowY` 改成跟最终 `height` 比较，而不是直接拿 `contentHeight > maxH`——这样在极小视口触发下限保护、`height` 被抬高到 `GROUP_MIN_HEIGHT` 时，如果这恰好已经能容纳全部内容，就不会被误判为需要滚动。）

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout.test.js`
Expected: 全部 PASS（11 条）。

Run: `npm test`
Expected: `pass 89`、`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add src/minimap/layout.js test/minimap-layout.test.js
git commit -m "$(cat <<'EOF'
feat(layout): floor group size at a minimum usable grid

A viewport small enough to push the ratio-based max below one column/
row would otherwise crush the group box unreadably small.
EOF
)"
```

---

### Task 3: `options.groupStates` 注入展开态 + `clampGroupScroll`

**Files:**
- Modify: `src/minimap/layout.js`
- Test: `test/minimap-layout.test.js`

**Interfaces:**
- Consumes：Task 1/2 的 `buildGroup(groupId, parentId, children, viewportWidth, viewportHeight)`，`GROUP_MIN_HEIGHT`。
- Produces：
  - `computeLayout(graph, { ..., groupStates? })` —— `groupStates: Map<groupId, { expanded?: boolean, scrollTop?: number }>`，默认空 `Map`。
  - `Group` 新增字段：`contentHeight: number`（不受最大高度限制的真实内容高度）、`expanded: boolean`、`scrollTop: number`（已夹紧）。
  - 新增导出 `clampGroupScroll(group, scrollTop)`：`group` 只需具备 `height`/`contentHeight`/`overflowY` 三个字段；返回夹紧后的 `scrollTop`，`overflowY` 为 `false` 时恒返回 `0`。这个函数会被 Task 4 的 `visibleGroupChildren` 间接依赖（通过已经夹紧好的 `group.scrollTop`），也会被切片 3（Vue 交互）的滚轮事件处理直接调用。

- [ ] **Step 1: 写失败的测试**

在 `test/minimap-layout.test.js` 顶部的 import 里加上 `clampGroupScroll`：

```js
import {
  GROUP_THRESHOLD,
  computeLayout,
  keepAnchorStable,
  clampGroupScroll,
} from '../src/minimap/layout.js'
```

追加两个测试：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout.test.js`
Expected: 两个新用例 FAIL（`clampGroupScroll` 还没定义；`expanded`/`contentHeight` 字段还不存在）。

- [ ] **Step 3: 实现 `clampGroupScroll` 与展开态**

在 `buildGroup` 之前新增导出函数：

```js
// 把任意 scrollTop 夹到合法范围；不溢出的分组恒为 0。
export function clampGroupScroll(group, scrollTop) {
  if (!group.overflowY) return 0
  const maxScroll = Math.max(0, group.contentHeight - group.height)
  return Math.max(0, Math.min(scrollTop, maxScroll))
}
```

把 `buildGroup` 改成接收 `state` 参数，并按 `expanded` 决定是否夹最大高度：

```js
function buildGroup(groupId, parentId, children, state, viewportWidth, viewportHeight) {
  const maxW = viewportWidth * GROUP_MAX_W_RATIO
  const maxH = viewportHeight * GROUP_MAX_H_RATIO

  const columns = Math.max(
    1,
    Math.floor((maxW - 2 * GROUP.padding + GROUP.itemGap) / (GROUP.itemW + GROUP.itemGap)),
  )
  const rows = Math.ceil(children.length / columns)
  const contentWidth = 2 * GROUP.padding + columns * GROUP.itemW + (columns - 1) * GROUP.itemGap
  const contentHeight =
    GROUP.header + 2 * GROUP.padding + rows * GROUP.itemH + Math.max(0, rows - 1) * GROUP.itemGap

  const expanded = state.expanded === true
  const width = Math.max(GROUP_MIN_WIDTH, Math.min(contentWidth, maxW))
  const height = expanded
    ? Math.max(GROUP_MIN_HEIGHT, contentHeight)
    : Math.max(GROUP_MIN_HEIGHT, Math.min(contentHeight, maxH))
  const overflowY = height < contentHeight

  return {
    id: groupId,
    parentId,
    children,
    columns,
    rows,
    width,
    height,
    contentHeight,
    overflowY,
    expanded,
    scrollTop: clampGroupScroll({ height, contentHeight, overflowY }, state.scrollTop ?? 0),
    x: 0,
    y: 0,
  }
}
```

在 `computeLayout` 里读取 `groupStates` 并传给 `buildGroup`：

```js
  const groupThreshold = options.groupThreshold ?? GROUP_THRESHOLD
  const groupStates = options.groupStates ?? new Map()

  const groups = []
  const groupOf = new Map()
  for (const node of graph.nodes.values()) {
    const segments = collectGroupSegments(node, graph, groupThreshold)
    segments.forEach((segmentChildren, segmentIndex) => {
      const groupId = `${node.id}::g${segmentIndex}`
      const state = groupStates.get(groupId) ?? {}
      const group = buildGroup(groupId, node.id, segmentChildren, state, viewportWidth, viewportHeight)
      groups.push(group)
      for (const childId of segmentChildren) groupOf.set(childId, group)
    })
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout.test.js`
Expected: 全部 PASS（13 条）。

Run: `npm test`
Expected: `pass 91`、`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add src/minimap/layout.js test/minimap-layout.test.js
git commit -m "$(cat <<'EOF'
feat(layout): expand/collapse groups via options.groupStates

expanded groups grow to their full contentHeight instead of being
clamped to the viewport-ratio max height; clampGroupScroll keeps
scrollTop within bounds for collapsed, overflowing groups.
EOF
)"
```

---

### Task 4: `visibleGroupChildren` 虚拟绘制窗口

**Files:**
- Modify: `src/minimap/layout.js`
- Test: `test/minimap-layout.test.js`

**Interfaces:**
- Consumes：Task 3 的 `Group` 形状（`width`/`height`/`rows`/`columns`/`children`/`scrollTop`/`x`/`y`）。
- Produces：`visibleGroupChildren(group)` → `Array<{ id: string, index: number, rect: { x, y, width, height } }>`（世界坐标）。这是切片 2（Canvas 渲染器，绘制可见子节点格子）和切片 3（命中检测、拖拽换位下标计算）都会直接调用的函数，签名/返回结构不会再变。

- [ ] **Step 1: 写失败的测试**

把 `test/minimap-layout.test.js` 顶部的 import 改成：

```js
import {
  GROUP_THRESHOLD,
  computeLayout,
  keepAnchorStable,
  clampGroupScroll,
  visibleGroupChildren,
} from '../src/minimap/layout.js'
```

并追加测试：

```js
test('visibleGroupChildren returns only the rows within the current scroll window', () => {
  const children = Array.from({ length: 10 }, (_, i) => `c${i}`)
  const group = {
    id: 'p::g0',
    parentId: 'p',
    children,
    columns: 2,
    rows: 5,
    width: 274,
    height: 142,
    contentHeight: 278,
    overflowY: true,
    expanded: false,
    scrollTop: 0,
    x: 0,
    y: 0,
  }

  const atTop = visibleGroupChildren(group).map((item) => item.id)
  assert.deepEqual(atTop, ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'])

  const scrolled = visibleGroupChildren({ ...group, scrollTop: 50 }).map((item) => item.id)
  assert.deepEqual(scrolled, ['c2', 'c3', 'c4', 'c5', 'c6', 'c7'])

  const first = visibleGroupChildren(group)[0]
  assert.deepEqual(first.rect, { x: 12, y: 40, width: 120, height: 40 })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout.test.js`
Expected: FAIL（`visibleGroupChildren is not a function`）。

- [ ] **Step 3: 实现 `visibleGroupChildren`**

在 `clampGroupScroll` 之后新增导出函数：

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

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout.test.js`
Expected: 全部 PASS（14 条）。

Run: `npm test`
Expected: `pass 92`、`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add src/minimap/layout.js test/minimap-layout.test.js
git commit -m "$(cat <<'EOF'
feat(layout): add visibleGroupChildren virtualization window

Pure function exposing which group children are currently within the
scrolled viewport, with world-space cell rects, for slice 2/3 to
render and hit-test without recomputing the grid math.
EOF
)"
```

---

### Task 5: 回归校验 + 进度文档同步

**Files:**
- Test: 全量 `npm test`、`npm run build`
- Modify: `ROADMAP.md`、`docs/superpowers/plans/2026-06-19-phase-2-group-logic.md`（本文件的"进度"小节）

**Interfaces:**
- 无新代码接口；本任务只做验证 + 文档收口。

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: `pass 92`、`fail 0`（85 基线 + 本切片新增 7 条：3 条分段/多分组/阈值 + 1 条最小尺寸 + 2 条 clampGroupScroll/展开态 + 1 条 visibleGroupChildren）。

- [ ] **Step 2: 构建校验**

Run: `npm run build`
Expected: 构建成功，无报错（纯逻辑层改动不应影响 Vite 构建产物）。

- [ ] **Step 3: 在本文件追加"进度"小节**

在本文件最顶部 Goal/Architecture 之后插入：

```markdown
## 进度

- [x] Task 1：叶子兄弟分段 + 多分组身份 + groupThreshold 覆盖
- [x] Task 2：分组框最小尺寸下限保护
- [x] Task 3：options.groupStates 注入展开态 + clampGroupScroll
- [x] Task 4：visibleGroupChildren 虚拟绘制窗口
- [x] Task 5：回归校验 + 进度文档同步（`npm test` 92 全过、`npm run build` 通过）
```

- [ ] **Step 4: 更新 `ROADMAP.md` 当前进度**

把 ROADMAP.md「当前进度」块里的"当前阶段计划"行和"已完成切片"列表，加上本切片的链接和一行总结（紧跟在现有"已完成切片"列表最后一项之后）：

```markdown
  - 分组逻辑 `layout.js` 叶子兄弟分段 + 多分组身份 + 最小尺寸 + 展开态 + 滚动窗口 + 测试（[plan](docs/superpowers/plans/2026-06-19-phase-2-group-logic.md)，`npm test` 92 全过，`npm run build` 通过）
```

并把"当前阶段计划"行追加这个 plan 链接，"下一步"改成指向切片 2（Canvas 渲染器）。

- [ ] **Step 5: 提交文档更新**

```bash
git add ROADMAP.md docs/superpowers/plans/2026-06-19-phase-2-group-logic.md
git commit -m "$(cat <<'EOF'
docs: track phase 2 group-logic slice completion
EOF
)"
```

---

## 完成定义

- `src/minimap/layout.js` 实现叶子兄弟分段、多分组身份、最小尺寸下限、`groupThreshold`/`groupStates` 透传、`clampGroupScroll`、`visibleGroupChildren`。
- `test/minimap-layout.test.js` 现有 7 条用例原样通过；新增 7 条覆盖分段截断、阈值覆盖、最小尺寸、展开态、滚动夹紧、虚拟绘制窗口。
- `test/minimap-graph.test.js` 不需要修改，其现有分组测试在新算法下行为不变。
- `npm test`（92 全过）、`npm run build` 均通过。
- 未触碰 `graph.js`/`renderer.js`/`layout-transition.js`/`interaction.js`/`Minimap.vue`，未引入新依赖。
- ROADMAP.md 与本 plan 的进度小节已同步更新并提交。

## 风险与取舍

- `group.id` 用 `${parentId}::g${segmentIndex}` 派生，`segmentIndex` 按该父节点下"够资格折叠的分段"出现顺序编号；框内换位不会跨越分段边界，所以正常操作下 `segmentIndex` 稳定。只有树结构变化（带子节点的兄弟被增删、改变分段方式）才会让 `segmentIndex` 变化，届时外部持有的旧 `groupId`（连同它的展开/滚动状态）失效是预期行为，不是 bug。
- `visibleItems` 里 group 项新增了 `id` 字段，这是为切片 2/3 预留的最小改动；本切片不消费它，也不会影响现有依赖 `parentId`/`x`/`y`/`width`/`height` 的下游代码。
- `renderer.js`/`layout-transition.js`/`interaction.js` 目前仍假设"一个 `parentId` 最多一个分组"，对现有 demo/压力图 fixture 仍然成立（它们没有"叶子兄弟被截断"的场景），所以本切片不会让它们的测试变红；真正适配多分组是切片 2/3 的工作，已经在 spec 的"非目标"里写明。
