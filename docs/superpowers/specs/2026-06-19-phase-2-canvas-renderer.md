# Phase 2 Canvas 渲染器 Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第二阶段：分组框能力。
> 本 spec 覆盖第二阶段的**第二个切片：Canvas 渲染器**（分组框 chrome + 子节点虚拟绘制 + 滚动条视觉 + 多分组适配），不含 Vue 交互（滚轮、拖拽换位、展开/折叠点击）。
> 依赖 [分组逻辑 spec](2026-06-19-phase-2-group-logic.md) 的 `Group` 数据契约、`visibleGroupChildren`、`clampGroupScroll`；依赖 [Phase 1 Canvas 渲染器 spec](2026-06-18-phase-1-canvas-renderer.md) 的 `renderScene`/`resolveEdges`/`drawNode` 既有结构。

## 头脑风暴决策记录

- **现状缺口**：`drawGroup`（`src/minimap/renderer.js`）目前只画分组框的背景、边框和一行 header 文字（`${parentId} · ${count}`），从来没有画过框内的子节点，也没有滚动条视觉。`resolveEdges`、`inferDirectionFromLayout`（`renderer.js`）和 `layout-transition.js` 的 `itemKey` 都假设"一个 `parentId` 最多一个分组"（用 `groupByParent: Map<parentId, group>` 或 `` `group:${parentId}` `` 做 key），分组逻辑切片已经支持一个父节点产生多个分组框，这几处在那种场景下会取错分组（Map key 碰撞、`.find` 拿到错的那个）。
- **渲染分层**：分组框的"外框视觉"（chrome：背景/边框/header/滚动条）和"内部子节点视觉"分开。Chrome 层走 `groupRenderer`（自定义时完全接管，跟现状契约一致）或默认 `drawGroup`；子节点层永远走 `nodeRenderer ?? drawNode`，不受 `groupRenderer` 是否自定义影响——这样自定义节点视觉在分组框内外保持一致，业务方不需要为框内节点单独写绘制逻辑。
- **修复范围**：本切片只修 `renderer.js` 和 `layout-transition.js` 里按 `parentId` 查分组的 4 处之中的 3 处（`resolveEdges` 的 `groupByParent`、`renderScene` 绘制循环的 `.find`、`inferDirectionFromLayout` 的 `groupByParent`，都在 `renderer.js`；加上 `layout-transition.js` 的 `itemKey`）。`interaction.js` 的 `hitTest`/`findInsertionIndex`（命中检测、拖入下标计算）留给切片 3（Vue 交互），因为它们属于交互层而不是渲染层，且现有 demo 图没有"一个父节点同时有分组和未分组子节点"的场景，这个缺口暂时不会被触发。
- **统计口径不变**：`renderScene` 返回的 `{ total, drawn, culled, durationMs }` 只统计顶层 `visibleItems`（节点/分组框），分组框内部子节点的绘制不计入。性能状态面板是第五阶段的功能，这次不提前改这个跨阶段共用的统计契约。
- **两处现有断言需要更新（不是测试被改坏，是契约真的变了）**：
  - `test/minimap-renderer.test.js` 的 `custom nodeRenderer replaces default node drawing`：现在 `calls`（自定义 `nodeRenderer` 被调用次数）只数顶层节点；以后框内可见子节点也会调用同一个 `nodeRenderer`，断言要改成 `顶层节点数 + 所有分组当前可见子节点数之和`（用 `visibleGroupChildren` 算，不要硬编码数字，因为它依赖 `GROUP` 网格常量和视口尺寸）。
  - 同文件的 `resolveEdges builds tree edges and routes folded endpoints to the group`：树边 id 格式从 `` `tree:${parentId}:group` `` 改成 `` `tree:group:${group.id}` ``（多分组场景下 `:group` 后缀不再唯一），断言里的字符串字面量要跟着改。
- **小的导出补充**：`layout.js` 里现有的 `GROUP` 网格常量（`padding`/`header`/`itemW`/`itemH`/`itemGap`）加上 `export`，供渲染器算 header 高度、滚动条几何区域使用（纯常量导出，不改变任何行为，不算"修改分组逻辑文件的业务逻辑"）。
- **测试基础设施补丁**：`test/helpers/mock-ctx.js` 的方法白名单加 `'clip'`（裁剪子节点绘制区域要用 `ctx.clip()`，现在 mock 上没有这个方法，调用会直接报错）。

## 范围

### 目标（本切片交付）

- `src/minimap/renderer.js`：
  - `drawGroup` 改成只画 chrome：背景、边框、header（`▾`/`▸` + label + 数量）、滚动条视觉（`overflowY` 为真时）。
  - 新增内部函数绘制分组框内可见子节点：对 `visibleGroupChildren(group)` 返回的每一项，裁剪到分组框范围内，调用 `nodeRenderer ?? drawNode`。
  - `resolveEdges` 改用 `groupByChildId: Map<childId, group>`，`resolveEndpoint` 直接查它；父子树连线生成按 `node.children` 顺序遍历并对分组去重（镜像分组逻辑切片 `itemOf` 的方式）；树边 id 格式改为 `` `tree:group:${group.id}` ``。
  - `renderScene` 绘制循环里按 `item.id` 查找对应分组（`Map<id, group>`），不再用 `.find(g => g.parentId === item.parentId)`。
  - `inferDirectionFromLayout` 改成按子节点遍历并对分组去重收集目标框，不再假设一个父节点只有一个分组。
- `src/minimap/layout-transition.js`：`itemKey` 的 group 分支从 `` `group:${item.parentId}` `` 改成 `` `group:${item.id}` ``；`layoutAt` 里重建 `groups` 时同步改用 `group.id` 查 `rectByKey`。
- `src/minimap/theme.js`：`group` 主题新增 `scrollbar: { track, thumb }` 两个颜色字段。
- `src/minimap/layout.js`：给已有的 `GROUP` 常量加 `export`（纯导出，不改逻辑）。
- `test/helpers/mock-ctx.js`：`METHODS` 列表加 `'clip'`。
- 测试：`test/minimap-renderer.test.js` 新增分组子节点绘制、裁剪、滚动条、多分组场景的用例；更新上面提到的 2 处现有断言；`test/minimap-layout-transition.test.js` 新增/更新多分组动画 key 的用例。`npm test`、`npm run build` 通过。

### 非目标（后续切片）

- 命中检测细分（header/item/body 区域）、滚轮滚动、拖拽换位、展开/折叠点击触发——切片 3（Vue 交互）。
- `interaction.js` 的 `hitTest`/`findInsertionIndex` 多分组适配——切片 3。
- `groupStates`/`options` 等 Vue 组件 props 接线——切片 3。
- 渲染性能状态面板（`total`/`drawn` 之外的更细统计）——第五阶段。

## 模块 API 契约

### `src/minimap/renderer.js`

```js
// chrome 层：背景/边框/header(含 ▾/▸)/滚动条视觉。不画子节点。
function drawGroup(ctx, group, rect, theme) { /* ... */ }

// 子节点层：裁剪到 rect 范围内，对 visibleGroupChildren(group) 的每一项
// 调用 renderers.node ?? drawNode，state 用 makeState(childId, selectedIds)。
// rect 是分组框的屏幕坐标（screen space），子节点格子用 worldRectToScreen 转换。
function drawGroupChildren(ctx, graph, group, rect, viewport, theme, renderers, selectedIds) { /* ... */ }

// resolveEdges 内部：
// const groupByChildId = new Map(layout.groups.flatMap(g => g.children.map(id => [id, g])))
// resolveEndpoint(id) 直接查 layout.nodes.get(id) 或 groupByChildId.get(id)，不再经过 node.parentId。
// 树边 id：单个子节点 `tree:${parentId}:${childId}`（不变）；分组 `tree:group:${group.id}`（新）。
export function resolveEdges(graph, layout) { /* ... */ }
```

`drawGroupChildren` 的裁剪区域就是传入的 `rect`（分组框的屏幕坐标包围盒，跟 `drawGroup` 用的是同一个矩形）：`visibleGroupChildren` 返回的子节点格子在世界坐标里永远落在 header+padding 之后、不会侵入 header 区域，所以裁剪到整个分组框矩形已经足够防止首尾行越界露白，不需要单独算"内容区"矩形。

### `src/minimap/layout-transition.js`

```js
function itemKey(item) {
  return item.type === 'group' ? `group:${item.id}` : `node:${item.id}`
}
```

`layoutAt` 里 `groups` 重建的 `rectByKey.get(...)` 同步改成 `` `group:${group.id}` ``。

### `src/minimap/theme.js`

```js
group: {
  fill: '#16202b',
  stroke: '#3a4f66',
  header: '#9fb6cc',
  font: '12px sans-serif',
  scrollbar: { track: '#10161d', thumb: '#4a6280' }, // 新增；特意跟其它已用颜色不同，避免颜色断言碰撞
},
```

### `src/minimap/layout.js`

```js
export const GROUP = { padding: 12, header: 28, itemW: 120, itemH: 40, itemGap: 10 } // 加 export，不改值
```

## 滚动条几何

- 仅当 `group.overflowY === true` 时绘制；轨道宽度固定 6px，贴分组框右侧内边，纵向跨度 = 分组框内容区高度（`rect.height - GROUP.header * viewport.scale`，因为 chrome 用的 `rect` 已经是屏幕坐标）。
- 滑块高度 = `(group.height / group.contentHeight) * 轨道高度`，滑块顶部偏移 = `(group.scrollTop / (group.contentHeight - group.height)) * (轨道高度 - 滑块高度)`。
- 颜色取 `theme.group.scrollbar.track` / `theme.group.scrollbar.thumb`；纯视觉，不响应任何指针事件（滚动条交互是切片 3 的事）。

## 验收标准

- 分组框内当前可见的子节点被实际绘制出来（默认绘制或 `nodeRenderer`），不再是空白矩形。
- 子节点绘制裁剪在分组框范围内，滚动窗口的首尾半行不会画出框外。
- `overflowY` 为真的分组框右侧出现滚动条轨道 + 滑块，滑块位置/高度随 `group.scrollTop`/`group.height`/`group.contentHeight` 正确变化；不溢出的分组框不画滚动条。
- 一个父节点有多个分组框时（`group.id` 不同、`parentId` 相同），每个分组框各自正确显示自己的子节点、自己的连线、独立的动画插值，不会互相覆盖或取错。
- `resolveEdges` 对折叠到分组里的业务关系线（`graph.edges`）端点路由依然正确（不依赖 `node.parentId`，直接按子节点 id 查）。
- 现有单分组场景（demo 图 `heap-1`/`cluster-25`、压力图）渲染行为不回归：连线、方向推断、动画过渡跟切片前一致。
- `npm test`、`npm run build` 通过。

## 测试清单

- `drawGroupChildren`/分组子节点绘制：用 mock ctx 验证默认绘制和自定义 `nodeRenderer` 都会对 `visibleGroupChildren` 返回的每一项调用一次；裁剪用的 `ctx.save`/`ctx.clip`/`ctx.restore` 顺序被调用。
- 滚动条：`overflowY: true` 的分组画出滚动条（轨道+滑块两次 `fillRect`，颜色匹配主题）；`overflowY: false` 的分组不画滚动条相关调用。
- 多分组：构造一个父节点下有两个独立分组的图（复用分组逻辑切片测试里的 `graphWithChildren`/`leaves` 风格 fixture），验证 `renderScene` 给两个分组各自绘制了正确的子节点集合，没有互相覆盖。
- `resolveEdges` 多分组：业务关系线端点落在"被两个分组中的某一个"折叠的子节点上时，路由到对应那个分组（不是另一个）。
- `layout-transition.js`：两个分组的动画插值用各自的 `group.id` 对齐起止矩形，不会因为共享 `parentId` 而互相干扰。
- 更新现有断言：`custom nodeRenderer replaces default node drawing` 的调用次数公式、`tree:heap-1:group` 改成新格式后的断言。
- 回归：现有单分组场景测试（demo 图连线、方向推断、压力图 `drawn` 远小于节点数）保持通过。
