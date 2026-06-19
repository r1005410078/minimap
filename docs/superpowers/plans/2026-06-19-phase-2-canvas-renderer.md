# Phase 2 Canvas 渲染器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让分组框真正画出框内可见子节点（而不是空白矩形），加上展开/折叠图标和滚动条视觉，并修掉 `renderer.js`/`layout-transition.js` 里"一个父节点最多一个分组"的过时假设，使一个父节点产生多个分组框时渲染、连线、动画都正确。

**Architecture:** 全部改动落在渲染/动画纯逻辑文件 `src/minimap/renderer.js`、`src/minimap/layout-transition.js`，加上 `src/minimap/theme.js`（新增滚动条配色）和 `src/minimap/layout.js`（给已有常量加 `export`，零行为变化）。分组框绘制拆成 chrome 层（`drawGroup`：背景/边框/header/滚动条）和子节点层（新函数 `drawGroupChildren`：裁剪后对 `visibleGroupChildren` 返回的每一项调用 `nodeRenderer ?? drawNode`），两层独立、互不依赖谁先变。多分组适配统一用"按 `node.children` 顺序遍历、对分组按 `group.id` 去重"的方式，跟分组逻辑切片 `itemOf` 的写法保持一致。

**Tech Stack:** 纯 JavaScript（Canvas 2D API，ctx 由外部传入），Node 内置 `node:test` + `node:assert/strict`，`test/helpers/mock-ctx.js` 假 ctx 记录调用。无新依赖。

## Global Constraints

- 不引入新的第三方运行时或开发依赖。
- 本切片只改 `src/minimap/renderer.js`、`src/minimap/layout-transition.js`、`src/minimap/theme.js`、`src/minimap/layout.js`（仅加 `export`）、`test/helpers/mock-ctx.js`、`test/minimap-renderer.test.js`、`test/minimap-layout-transition.test.js`。不碰 `src/minimap/interaction.js`、`src/minimap/Minimap.vue`、`src/minimap/graph.js`（那些是切片 3 的范围）。
- `renderScene` 返回的 `{ total, drawn, culled, durationMs }` 含义不变：只统计顶层 `visibleItems`，分组框内部子节点的绘制不计入。
- 两处现有断言允许（且需要）更新，其余既有用例必须原样通过：
  - `custom nodeRenderer replaces default node drawing`：调用次数要加上分组框内可见子节点数。
  - `resolveEdges builds tree edges and routes folded endpoints to the group`：树边 id 格式从 `tree:${parentId}:group` 改成 `tree:group:${group.id}`。
  - `layoutAt interpolates matching group rectangles by parentId`：改名为"by id"，fixture 加 `id` 字段，按 `group.id` 断言。
- 每个任务完成后必须跑 `npm test`，最后一个任务跑 `npm run build`，确认通过才能提交。
- 字段/函数命名以 [spec](../specs/2026-06-19-phase-2-canvas-renderer.md) 为准。

---

## 文件落点

- 修改：`src/minimap/renderer.js`——`resolveEdges`/`renderScene` 绘制循环/`inferDirectionFromLayout` 多分组适配；`drawGroup` 改成 chrome-only + 滚动条；新增 `drawGroupChildren`。
- 修改：`src/minimap/layout-transition.js`——`itemKey`、`layoutAt` 的 `groups` 重建改用 `group.id`。
- 修改：`src/minimap/theme.js`——`group.scrollbar` 新增配色。
- 修改：`src/minimap/layout.js`——`GROUP` 常量加 `export`（唯一一行改动，不碰分组逻辑）。
- 修改：`test/helpers/mock-ctx.js`——`METHODS` 加 `'clip'`。
- 修改：`test/minimap-renderer.test.js`——新增多分组/滚动条/子节点绘制用例；更新 2 处现有断言。
- 修改：`test/minimap-layout-transition.test.js`——更新 1 处现有用例，新增多分组动画用例。

---

### Task 1: 多分组适配（`resolveEdges` / `renderScene` 绘制循环 / `inferDirectionFromLayout`）

**Files:**
- Modify: `src/minimap/renderer.js`
- Test: `test/minimap-renderer.test.js`

**Interfaces:**
- Consumes：`layout.groups`（每个 `group` 带 `id`/`parentId`/`children`，来自分组逻辑切片）、`layout.visibleItems` 的 group 项已带 `id`（分组逻辑切片已做）。
- Produces：
  - `resolveEdges(graph, layout)` 行为不变的对外契约（输入输出结构不变），内部不再假设一个父节点最多一个分组；树边 id 格式变为 `` `tree:group:${group.id}` ``（单个未分组子节点的树边 id 不变：`` `tree:${parentId}:${childId}` ``）。
  - 新增模块内部辅助 `groupByChildId(layout)`，返回 `Map<childId, group>`，供 `resolveEdges` 和 `inferDirectionFromLayout` 共用。
  - `renderScene` 内部按 `item.id` 查找对应 `group`（不再用 `.find(g => g.parentId === item.parentId)`），后续 Task 2/3 会在同一个循环体里继续加绘制调用。

- [ ] **Step 1: 写失败的测试**

把 `test/minimap-renderer.test.js` 顶部追加一个多分组图的测试辅助函数（放在 `demoGraphWithRelationEdges` 函数之后）：

```js
// root -> p -> [a0..a5, mid(带子节点,不参与合并), b0..b5]
// a0..a5、b0..b5 各自超过默认阈值(5)，各自独立折叠成一个分组；mid 是普通节点。
function multiGroupGraph(edges = []) {
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
  return { version: 1, nodes, rootIds: ['root'], edges }
}
```

然后追加四个测试：

```js
test('resolveEdges creates one tree edge per group when a parent has multiple groups', () => {
  const graph = multiGroupGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const edges = resolveEdges(graph, layout)

  const groupTreeEdges = edges.filter((edge) => edge.kind === 'tree' && edge.id.startsWith('tree:group:'))
  assert.equal(groupTreeEdges.length, 2)
  assert.equal(new Set(groupTreeEdges.map((edge) => edge.toBox)).size, 2)

  const midEdge = edges.find((edge) => edge.id === 'tree:p:mid')
  assert.ok(midEdge)
  assert.deepEqual(midEdge.toBox, layout.nodes.get('mid'))
})

test('resolveEdges routes a business edge to the specific group that owns the endpoint', () => {
  const graph = multiGroupGraph([{ id: 'rel-1', source: 'a0', target: 'b0', kind: 'relation' }])
  const layout = computeLayout(graph, VIEWPORT)
  const edges = resolveEdges(graph, layout)

  const groupA = layout.groups.find((group) => group.children.includes('a0'))
  const groupB = layout.groups.find((group) => group.children.includes('b0'))
  const rel = edges.find((edge) => edge.id === 'rel-1')

  assert.notEqual(groupA.id, groupB.id)
  assert.deepEqual(rel.fromBox, groupA)
  assert.deepEqual(rel.toBox, groupB)
})

test('renderScene draws each group exactly once with its own group object', () => {
  const ctx = createMockCtx()
  const graph = multiGroupGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const seen = []
  renderScene(ctx, {
    graph,
    layout,
    viewport: { x: 0, y: 0, scale: 1 },
    width: 2400,
    height: 1600,
    layoutDirection: 'horizontal',
    renderers: { group: (_ctx, { group }) => seen.push(group.id), node: () => {} },
  })
  assert.deepEqual(seen.sort(), layout.groups.map((g) => g.id).sort())
})

test('inferDirectionFromLayout still infers correctly when a parent has multiple groups', () => {
  const ctx = createMockCtx()
  const graph = multiGroupGraph()
  const layout = computeLayout(graph, { direction: 'vertical', viewportWidth: 1200, viewportHeight: 760 })
  const scene = {
    graph,
    layout,
    viewport: { x: 100, y: 100, scale: 1 },
    width: 2400,
    height: 1600,
    theme: { ...defaultTheme, grid: { ...defaultTheme.grid, size: 1 } },
    renderers: { group: () => {}, node: () => {} },
  }
  const edges = resolveEdges(graph, layout)

  renderScene(ctx, scene) // 不传 layoutDirection/direction，强制走 inferDirectionFromLayout

  const firstEdgePoints = linePoints(edgeStrokeSegments(ctx, 0))
  const expectedPath = orthogonalPath(edges[0].fromBox, edges[0].toBox, 'y').map((point) => ({
    x: point.x + scene.viewport.x,
    y: point.y + scene.viewport.y,
  }))
  assert.deepEqual(firstEdgePoints, [
    { ...expectedPath[0], method: 'moveTo' },
    { ...expectedPath[1], method: 'lineTo' },
    { ...expectedPath[2], method: 'lineTo' },
    { ...expectedPath[3], method: 'lineTo' },
  ])
})
```

再把现有测试 `resolveEdges builds tree edges and routes folded endpoints to the group` 里这一行：

```js
  const groupedTree = edges.find((edge) => edge.id === 'tree:heap-1:group')
```

改成：

```js
  const groupedTree = edges.find((edge) => edge.id === `tree:group:${heapGroup.id}`)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-renderer.test.js`
Expected: 新增 4 条用例 FAIL（多分组场景下 `.find(g => g.parentId === ...)` 拿到错的分组，或 `groupByParent` 把两个分组互相覆盖）；改过字符串的那条也 FAIL（旧代码仍然产出 `tree:heap-1:group`，不是新格式）。

- [ ] **Step 3: 实现多分组适配**

把 `src/minimap/renderer.js` 里的 `resolveEdges` 整个替换成：

```js
// childId -> 它所属的分组（一个父节点下的每个分组各自的 children 互不重叠）。
function groupByChildId(layout) {
  return new Map(layout.groups.flatMap((group) => group.children.map((id) => [id, group])))
}

// 父子树默认连线 + graph.edges 业务线；端点为世界坐标中心，
// 端点落在被折叠子节点上时路由到其所在分组框（按 childId 直接查，不经过 node.parentId）。
export function resolveEdges(graph, layout) {
  const edges = []
  const byChildId = groupByChildId(layout)

  const resolveEndpoint = (id) => {
    const box = layout.nodes.get(id)
    if (box) return { box, point: centerOfBox(box) }
    const group = byChildId.get(id)
    return group ? { box: group, point: centerOfBox(group) } : null
  }

  for (const item of layout.visibleItems) {
    if (item.type !== 'node') continue
    const node = graph.nodes.get(item.id)
    if (!node || !node.children || node.children.length === 0) continue
    const parentCenter = centerOfBox(item)
    const parentBox = layout.nodes.get(item.id)
    const consumedGroups = new Set()

    for (const childId of node.children) {
      const group = byChildId.get(childId)
      if (group) {
        if (consumedGroups.has(group.id)) continue
        consumedGroups.add(group.id)
        edges.push({
          id: `tree:group:${group.id}`,
          kind: 'tree',
          from: parentCenter,
          to: centerOfBox(group),
          fromBox: parentBox,
          toBox: group,
        })
      } else {
        const childBox = layout.nodes.get(childId)
        if (childBox) {
          edges.push({
            id: `tree:${item.id}:${childId}`,
            kind: 'tree',
            from: parentCenter,
            to: centerOfBox(childBox),
            fromBox: parentBox,
            toBox: childBox,
          })
        }
      }
    }
  }

  for (const edge of graph.edges || []) {
    const from = resolveEndpoint(edge.source)
    const to = resolveEndpoint(edge.target)
    if (from && to) {
      edges.push({
        id: edge.id,
        kind: edge.kind || 'relation',
        from: from.point,
        to: to.point,
        fromBox: from.box,
        toBox: to.box,
      })
    }
  }

  return edges
}
```

把 `inferDirectionFromLayout` 里的这一段：

```js
  const groupByParent = new Map(layout.groups.map((group) => [group.parentId, group]))
  for (const node of graph.nodes.values()) {
    const parentBox = layout.nodes.get(node.id)
    if (!parentBox || !node.children || node.children.length === 0) continue

    const targets = groupByParent.has(node.id)
      ? [groupByParent.get(node.id)]
      : node.children.map((childId) => layout.nodes.get(childId)).filter(Boolean)
    if (targets.length === 0) continue
```

改成：

```js
  const byChildId = groupByChildId(layout)
  for (const node of graph.nodes.values()) {
    const parentBox = layout.nodes.get(node.id)
    if (!parentBox || !node.children || node.children.length === 0) continue

    const targets = []
    const consumedGroups = new Set()
    for (const childId of node.children) {
      const group = byChildId.get(childId)
      if (group) {
        if (consumedGroups.has(group.id)) continue
        consumedGroups.add(group.id)
        targets.push(group)
      } else {
        const childBox = layout.nodes.get(childId)
        if (childBox) targets.push(childBox)
      }
    }
    if (targets.length === 0) continue
```

（函数剩余部分——`parentCenter`/`avgTarget`/`dx`/`dy` 的计算——不变。）

最后把 `renderScene` 里这一段：

```js
  for (const { item, screen } of items) {
    if (item.type !== 'group') continue
    const group = layout.groups.find((g) => g.parentId === item.parentId)
    const itemState = makeState(item.parentId, selectedIds)
    if (renderers.group) renderers.group(ctx, { group, rect: screen, state: itemState, theme, viewport })
    else drawGroup(ctx, group, screen, theme)
    drawn++
  }
```

改成：

```js
  const groupById = new Map(layout.groups.map((group) => [group.id, group]))
  for (const { item, screen } of items) {
    if (item.type !== 'group') continue
    const group = groupById.get(item.id)
    const itemState = makeState(item.parentId, selectedIds)
    if (renderers.group) renderers.group(ctx, { group, rect: screen, state: itemState, theme, viewport })
    else drawGroup(ctx, group, screen, theme)
    drawn++
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-renderer.test.js`
Expected: 全部 PASS（21 条：既有 17 条 + 新增 4 条）。

Run: `npm test`
Expected: `pass 96`、`fail 0`（92 基线 + 本任务新增 4 条）。

- [ ] **Step 5: 提交**

```bash
git add src/minimap/renderer.js test/minimap-renderer.test.js
git commit -m "$(cat <<'EOF'
fix(renderer): resolve groups by id instead of parentId

A parent can now own multiple group boxes (leaf-run segmentation from
the group-logic slice). resolveEdges, renderScene's draw loop, and
inferDirectionFromLayout all assumed one group per parent via a
parentId-keyed map, which silently dropped or misrouted edges/draws
for the second group under the same parent.
EOF
)"
```

---

### Task 2: 分组框 chrome——展开/折叠图标 + 滚动条视觉

**Files:**
- Modify: `src/minimap/renderer.js`
- Modify: `src/minimap/theme.js`
- Modify: `src/minimap/layout.js`
- Test: `test/minimap-renderer.test.js`

**Interfaces:**
- Consumes：`group.expanded`/`group.overflowY`/`group.scrollTop`/`group.height`/`group.contentHeight`（分组逻辑切片已产出）；`layout.js` 的 `GROUP` 网格常量（本任务加 `export`）。
- Produces：`drawGroup(ctx, group, rect, theme)` 签名不变，内部新增滚动条绘制；`theme.group.scrollbar: { track, thumb }` 新主题字段。

- [ ] **Step 1: 写失败的测试**

把 `test/minimap-renderer.test.js` 顶部的 import 加上 `defaultTheme`（如果还没有——已经有了，不用改这行），追加两个测试：

```js
test('drawGroup shows an expand/collapse chevron with label and count in the header', () => {
  const ctx = createMockCtx()
  const scene = demoScene({ renderers: { node: () => {} } })
  renderScene(ctx, scene)

  const headerTexts = ctx.methodsOf('fillText').map((c) => c.args[0])
  assert.ok(headerTexts.includes('▸ heap-1 · 24'))
  assert.ok(headerTexts.includes('▸ cluster-25 · 10'))
})

test('drawGroup draws a scrollbar track and thumb only for overflowing groups', () => {
  const ctx = createMockCtx()
  const scene = demoScene({ renderers: { node: () => {} } })
  renderScene(ctx, scene)

  // 滚动条轨道/滑块都是固定 6px 宽的 fillRect；分组背景、节点背景都比 6 宽得多，
  // 用宽度筛选不会跟其它绘制混在一起。heap-1 溢出（1 条轨道 + 1 个滑块），cluster-25 不溢出（0）。
  const scrollbarRects = ctx.methodsOf('fillRect').filter((call) => call.args[2] === 6)
  assert.equal(scrollbarRects.length, 2)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-renderer.test.js`
Expected: 两条新用例 FAIL（header 文字还是旧格式 `heap-1 · 24`，没有 `▸`；滚动条相关的 `fillRect` 调用不存在）。

- [ ] **Step 3: 实现 chrome 改动**

`src/minimap/layout.js`：把这一行：

```js
const GROUP = { padding: 12, header: 28, itemW: 120, itemH: 40, itemGap: 10 }
```

改成：

```js
export const GROUP = { padding: 12, header: 28, itemW: 120, itemH: 40, itemGap: 10 }
```

`src/minimap/theme.js`：把 `group` 字段改成：

```js
  group: {
    fill: '#16202b',
    stroke: '#3a4f66',
    header: '#9fb6cc',
    font: '12px sans-serif',
    scrollbar: { track: '#10161d', thumb: '#4a6280' },
  },
```

`src/minimap/renderer.js`：在 `import { defaultTheme } from './theme.js'` 之后加一行：

```js
import { GROUP } from './layout.js'
```

在文件里给 `drawGroup` 之前加一个常量和一个新函数：

```js
const SCROLLBAR_WIDTH = 6
```

把 `drawGroup` 整个替换成：

```js
function drawGroup(ctx, group, rect, theme) {
  ctx.fillStyle = theme.group.fill
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeStyle = theme.group.stroke
  ctx.lineWidth = 1
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  ctx.fillStyle = theme.group.header
  ctx.font = theme.group.font
  const chevron = group.expanded ? '▾' : '▸'
  ctx.fillText(`${chevron} ${group.parentId} · ${group.children.length}`, rect.x + 8, rect.y + 16)
  if (group.overflowY) drawGroupScrollbar(ctx, group, rect, theme)
}

// 滚动条是纯视觉提示（轨道 + 按比例定位/取尺寸的滑块），不响应任何指针事件。
function drawGroupScrollbar(ctx, group, rect, theme) {
  const scrollbar = { ...defaultTheme.group.scrollbar, ...(theme.group.scrollbar || {}) }
  const scale = rect.height / group.height
  const headerHeight = GROUP.header * scale
  const trackX = rect.x + rect.width - SCROLLBAR_WIDTH
  const trackY = rect.y + headerHeight
  const trackHeight = rect.height - headerHeight

  ctx.fillStyle = scrollbar.track
  ctx.fillRect(trackX, trackY, SCROLLBAR_WIDTH, trackHeight)

  const thumbHeight = (group.height / group.contentHeight) * trackHeight
  const maxScroll = group.contentHeight - group.height
  const thumbOffset = maxScroll > 0 ? (group.scrollTop / maxScroll) * (trackHeight - thumbHeight) : 0
  ctx.fillStyle = scrollbar.thumb
  ctx.fillRect(trackX, trackY + thumbOffset, SCROLLBAR_WIDTH, thumbHeight)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-renderer.test.js`
Expected: 全部 PASS（23 条）。

Run: `npm test`
Expected: `pass 98`、`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add src/minimap/renderer.js src/minimap/theme.js src/minimap/layout.js test/minimap-renderer.test.js
git commit -m "$(cat <<'EOF'
feat(renderer): draw group expand/collapse chevron and scrollbar

Header text now shows expanded/collapsed state; overflowing groups
get a non-interactive scrollbar track+thumb sized/positioned from
group.height/contentHeight/scrollTop. Scroll interaction itself is
slice 3's job — this is visual only.
EOF
)"
```

---

### Task 3: 分组框内部子节点虚拟绘制 + 裁剪

**Files:**
- Modify: `src/minimap/renderer.js`
- Modify: `test/helpers/mock-ctx.js`
- Test: `test/minimap-renderer.test.js`

**Interfaces:**
- Consumes：`visibleGroupChildren(group)`（分组逻辑切片导出，返回 `{ id, index, rect }[]`，世界坐标）。
- Produces：分组框内当前可见子节点会被实际绘制（默认 `drawNode` 或自定义 `nodeRenderer`），裁剪在分组框范围内。

- [ ] **Step 1: 写失败的测试**

`test/helpers/mock-ctx.js` 的 `METHODS` 数组里加 `'clip'`：

```js
const METHODS = [
  'clearRect',
  'fillRect',
  'strokeRect',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'stroke',
  'fill',
  'fillText',
  'strokeText',
  'save',
  'restore',
  'rect',
  'arc',
  'roundRect',
  'setLineDash',
  'translate',
  'scale',
  'setTransform',
  'clip',
]
```

`test/minimap-renderer.test.js` 顶部已有这一行：

```js
import { computeLayout } from '../src/minimap/layout.js'
```

改成：

```js
import { computeLayout, visibleGroupChildren } from '../src/minimap/layout.js'
```

追加两个新测试：

```js
test('default drawing renders each visible group child with its own label', () => {
  const ctx = createMockCtx()
  const scene = demoScene()
  renderScene(ctx, scene)

  const texts = ctx.methodsOf('fillText').map((c) => c.args[0])
  assert.ok(texts.includes('cluster-1')) // heap-1 分组里的子节点
  assert.ok(texts.includes('leaf-1')) // cluster-25 分组里的子节点
})

test('group children are clipped to the group box before drawing', () => {
  const ctx = createMockCtx()
  const scene = demoScene({ renderers: { node: () => {} } })
  renderScene(ctx, scene)

  assert.equal(ctx.methodsOf('save').length, scene.layout.groups.length)
  assert.equal(ctx.methodsOf('clip').length, scene.layout.groups.length)
  assert.equal(ctx.methodsOf('restore').length, scene.layout.groups.length)
})
```

再把现有测试 `custom nodeRenderer replaces default node drawing` 整个替换成：

```js
test('custom nodeRenderer replaces default node drawing', () => {
  const ctx = createMockCtx()
  let calls = 0
  const scene = demoScene({ renderers: { node: () => { calls++ } } })
  const stats = renderScene(ctx, scene)
  const nodeCount = scene.layout.visibleItems.filter((item) => item.type === 'node').length
  const groupChildCount = scene.layout.groups.reduce((sum, group) => sum + visibleGroupChildren(group).length, 0)
  assert.equal(calls, nodeCount + groupChildCount)
  // 默认节点绘制不再发出（节点 label 不会被 fillText）
  assert.equal(ctx.methodsOf('fillText').some((c) => c.args[0] === 'Energy Root'), false)
  assert.equal(stats.drawn, stats.total - stats.culled)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-renderer.test.js`
Expected: 新增 2 条 FAIL（分组框内没有任何 `fillText`/`save`/`clip`/`restore` 调用）；改过的 `custom nodeRenderer` 用例也 FAIL（`calls` 只等于 `nodeCount`，没加上 `groupChildCount`）。

- [ ] **Step 3: 实现子节点绘制**

在 `import { GROUP } from './layout.js'` 这一行改成：

```js
import { GROUP, visibleGroupChildren } from './layout.js'
```

在 `drawGroup`/`drawGroupScrollbar` 之后、`drawNode` 之后，加一个新函数：

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

把 `renderScene` 里画分组的循环（Task 1 已经把 `.find` 改成 `groupById.get(item.id)`）整个替换成下面这样——只是在 `drawGroup`/`renderers.group` 调用之后多加一行 `drawGroupChildren(...)`，其余不变：

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

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-renderer.test.js`
Expected: 全部 PASS（25 条）。

Run: `npm test`
Expected: `pass 100`、`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add src/minimap/renderer.js test/helpers/mock-ctx.js test/minimap-renderer.test.js
git commit -m "$(cat <<'EOF'
feat(renderer): draw visible group children, clipped to the box

Group boxes were chrome-only (background + header text), never
drawing their folded children. drawGroupChildren reuses the same
nodeRenderer/drawNode path as top-level nodes for each row
visibleGroupChildren currently exposes, clipped to the group rect so
partial top/bottom rows on scroll don't bleed outside the box.
EOF
)"
```

---

### Task 4: 多分组动画插值（`layout-transition.js`）

**Files:**
- Modify: `src/minimap/layout-transition.js`
- Test: `test/minimap-layout-transition.test.js`

**Interfaces:**
- Consumes：`layout.groups`/`layout.visibleItems` 的 group 项都带 `id`（分组逻辑切片产出）。
- Produces：`itemKey`/`layoutAt` 按 `group.id` 对齐动画起止矩形，不再按 `parentId`。

- [ ] **Step 1: 写失败的测试**

把现有测试 `layoutAt interpolates matching group rectangles by parentId` 整个替换成：

```js
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
```

再追加一个新测试：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout-transition.test.js`
Expected: 改过的用例 FAIL（fixture 现在带 `id` 字段，但 `itemKey` 还在用 `parentId`，断言 `group.id === 'heap::g0'` 会因为 `group` 对象虽然有 `id` 字段但插值结果错乱而失败，或者直接因为 `rectByKey.get('group:heap')` 命中导致数值不对）；新增的多分组用例 FAIL（`g0`/`g1` 共享 `group:p` 这个 key，其中一个的起始矩形被覆盖，`g0.y` 不等于 0 或 `g1.y` 超出 [200,500] 范围）。

- [ ] **Step 3: 实现按 id 对齐**

把 `src/minimap/layout-transition.js` 里的 `itemKey` 函数：

```js
function itemKey(item) {
  return item.type === 'group' ? `group:${item.parentId}` : `node:${item.id}`
}
```

改成：

```js
function itemKey(item) {
  return item.type === 'group' ? `group:${item.id}` : `node:${item.id}`
}
```

把 `layoutAt` 里这一段：

```js
  const groups = transition.toLayout.groups.map((group) => ({
    ...group,
    ...(rectByKey.get(`group:${group.parentId}`) || rectOf(group)),
  }))
```

改成：

```js
  const groups = transition.toLayout.groups.map((group) => ({
    ...group,
    ...(rectByKey.get(`group:${group.id}`) || rectOf(group)),
  }))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-layout-transition.test.js`
Expected: 全部 PASS（7 条：既有 5 条不变 + 1 条改名后的 + 1 条新增）。

Run: `npm test`
Expected: `pass 101`、`fail 0`。

- [ ] **Step 5: 提交**

```bash
git add src/minimap/layout-transition.js test/minimap-layout-transition.test.js
git commit -m "$(cat <<'EOF'
fix(layout-transition): key group animation by id, not parentId

Two groups under the same parent shared one `group:${parentId}` key,
so the second group's start rect silently overwrote the first's in
the from-items map, corrupting one of the two animations.
EOF
)"
```

---

### Task 5: 回归校验 + 进度文档同步

**Files:**
- Test: 全量 `npm test`、`npm run build`
- Modify: `ROADMAP.md`、`docs/superpowers/plans/2026-06-19-phase-2-canvas-renderer.md`（本文件的"进度"小节）

**Interfaces:**
- 无新代码接口；本任务只做验证 + 文档收口。

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: `pass 101`、`fail 0`（92 基线 + 本切片新增 9 条：4 条多分组适配 + 2 条 chrome/滚动条 + 2 条子节点绘制/裁剪 + 1 条多分组动画）。

- [ ] **Step 2: 构建校验**

Run: `npm run build`
Expected: 构建成功，无报错。

- [ ] **Step 3: 浏览器手动复核（可选但推荐）**

跑 `npm run dev`，打开页面，确认：`heap-1`/`cluster-25` 两个分组框内能看到子节点格子（不再是空白）；`heap-1` 右侧有滚动条；header 文字带 `▸`/`▾` 图标。截图或简单描述观察结果，写进报告。

- [ ] **Step 4: 在本文件追加"进度"小节**

在本文件最顶部 Goal/Architecture/Tech Stack 之后插入：

```markdown
## 进度

- [x] Task 1：多分组适配（resolveEdges / renderScene 绘制循环 / inferDirectionFromLayout）
- [x] Task 2：分组框 chrome——展开/折叠图标 + 滚动条视觉
- [x] Task 3：分组框内部子节点虚拟绘制 + 裁剪
- [x] Task 4：多分组动画插值（layout-transition.js）
- [x] Task 5：回归校验 + 进度文档同步（`npm test` 101 全过、`npm run build` 通过）
```

- [ ] **Step 5: 更新 `ROADMAP.md` 当前进度**

在「已完成切片」列表最后追加一行：

```markdown
  - Canvas 渲染器 `renderer.js` 分组框子节点虚拟绘制 + 滚动条视觉 + 多分组动画适配 + 测试（[plan](docs/superpowers/plans/2026-06-19-phase-2-canvas-renderer.md)，`npm test` 101 全过，`npm run build` 通过）
```

把「当前阶段计划」行加上这个 plan 链接；「下一步」改成指向切片 3（Vue 交互：`groupStates`/`options` props、命中检测细分、滚轮、拖拽换位、展开折叠点击，以及 `interaction.js` 的多分组适配）。

- [ ] **Step 6: 提交文档更新**

```bash
git add ROADMAP.md docs/superpowers/plans/2026-06-19-phase-2-canvas-renderer.md
git commit -m "$(cat <<'EOF'
docs: track phase 2 canvas-renderer slice completion
EOF
)"
```

---

## 完成定义

- 分组框内当前可见的子节点被实际绘制（默认或自定义渲染器），裁剪在框内。
- 溢出的分组框显示滚动条视觉（轨道+滑块），不溢出的不显示。
- 一个父节点有多个分组框时，渲染、连线、动画都各自独立正确，不互相覆盖。
- `resolveEdges`/`renderScene`/`inferDirectionFromLayout`/`layout-transition.js` 不再假设"一个父节点最多一个分组"。
- `npm test`（101 全过）、`npm run build` 均通过。
- 未触碰 `interaction.js`/`Minimap.vue`/`graph.js`，未引入新依赖。
- ROADMAP.md 与本 plan 的进度小节已同步更新并提交。

## 风险与取舍

- `interaction.js` 的 `hitTest`/`findInsertionIndex` 仍然假设一个父节点最多一个分组，本切片不修——现有 demo 图没有"一个父节点同时有分组和未分组子节点"的场景，这个缺口不会被当前功能触发，留给切片 3（Vue 交互）统一处理，因为修复它需要交互层的命中区域设计（header/item/body），提前在渲染器切片里改容易跟切片 3 的设计冲突。
- 滚动条目前是纯视觉（没有拖拽滑块、没有滚轮响应），滚动状态完全由 `group.scrollTop`（来自 `groupStates`）决定；交互留给切片 3。
- `theme.group.scrollbar` 的默认配色（`#10161d`/`#4a6280`）特意选得跟现有主题色（`#0f1419`/`#3a4f66`/`#16202b`/`#9fb6cc`/`#1e2a38`/`#cfe3f7`/`#1b2530`/`#5aa9ff`）都不同，避免未来如果有人用颜色而不是几何尺寸去断言滚动条，撞上其它绘制调用的颜色。
