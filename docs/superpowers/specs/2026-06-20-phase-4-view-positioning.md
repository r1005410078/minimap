# Phase 4 视图定位方法 Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第四阶段：导航和查找能力。
> 第四阶段拆成 3 个切片：**视图定位方法**（本 spec）→ 搜索节点 → Overview 小地图导航。本 spec 覆盖第一个切片：`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport`/`select`/`clearSelection` 八个方法首次通过 `defineExpose` 对外暴露，以及支撑它们的视口补动、分组子节点定位等纯函数。
> 依赖 [Phase 3 视口平移缩放 spec](2026-06-19-phase-3-viewport-pan-zoom.md) 的 `viewport.js` 契约、[Phase 3 选择高亮 spec](2026-06-19-phase-3-view-selection.md) 的 `selection.js` 契约、[Phase 2 分组逻辑 spec](2026-06-19-phase-2-group-logic.md) 的 `Group` 数据契约。

## 头脑风暴决策记录

- **第四阶段拆分**：导航和查找能力包含 4 个子能力（适配视图、定位选中、搜索节点、overview 导航），其中 overview 是独立的 mini canvas 子组件，跟另外三个（视口数学 + `defineExpose` 方法）性质不同。参考第二、三阶段按切片拆分 spec/plan 的做法，拆成 3 个切片：视图定位方法（本切片）→ 搜索节点 → Overview 小地图导航，因为后两者都会复用本切片的 `centerOnNode`/视口补动能力。
- **动画方式**：`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo` 调用后视口平滑过渡，而不是瞬间跳转。现有 `layout-transition.js` 的视口插值把 `scale` 写死不动（`interpolateViewport` 永远返回 `from.scale`，因为它只服务于布局切换时的锚点错位补偿），并且每帧会重新插值全部 `visibleItems`，对大图有性能代价。新动画需要 `scale` 一起过渡且布局本身不变，所以新建一个独立、轻量的 viewport-only 补动函数（`tweenViewport`），不复用 `createLayoutTransition`/`layoutAt` 路径，跟布局动画完全解耦。
- **`centerOnNode` 对分组子节点的处理**：`visibleGroupChildren` 的可见窗口只由 `group.scrollTop` 决定，跟 `group.expanded`（展开/折叠开关）无关——折叠态下 `scrollTop` 一样能滚到任意行；`expanded` 只是把分组框整体撑高到不需要滚动。因此目标子节点被滚出可见区或位于折叠分组里时，只需要调整 `scrollTop` 让它进入可见窗口，不需要顺带把 `expanded` 改成 `true`。这样副作用更小，不会因为一次定位调用就意外撑大一个用户特意折叠的分组框。
- **`centerOnSelection` 的缩放策略**：多选且分布分散时，只平移视口让选中内容包围盒中心对齐屏幕中心，保持当前 `scale` 不变，不自动缩放去装下所有选中内容——跟 ROADMAP 措辞"移动到视口中心附近"一致，行为可预测，不会因选中范围大小意外改变缩放。
- **`zoomTo(scale, center)` 的 `center` 语义**：`center` 是世界坐标点，不传时默认取当前视口中心点对应的世界坐标。语义上跟滚轮缩放的 `zoomViewportAt`（"某个世界点保持在屏幕位置不变"）保持一致，而不是引入"屏幕坐标点"这个新概念。
- **`setViewport` 不动画**：`setViewport` 是原始 setter，常用于恢复外部保存的视口状态、受控模式同步等场景，这些场景下动画反而是干扰；跟 `applyViewport` 现有的"立即生效"行为一致。
- **顺带暴露 `select`/`clearSelection`**：`defineExpose` 是这个切片才引入的机制，索性把 ROADMAP Methods 契约里现有的、实现简单的 `select(ids, mode)`/`clearSelection()` 一起暴露，避免后面再为这两个小方法单独开一个切片。`select` 新增 `mode` 参数（`'replace'`/`'add'`/`'remove'`/`'toggle'`），包装已有的 `setSelected`。
- **受控模式下的 `viewport-change` 时机**：补动结束时只发一次最终值；受控视口（`props.viewport !== null`）下立即发一次（不做逐帧动画），因为组件不拥有渲染时机——跟布局动画里"受控视口跳过逐帧锚点补偿"的既有简化保持一致，不是本切片新引入的限制。
- **分组滚动的受控/非受控分支**：`centerOnNode`/`centerOnSelection` 内部需要把目标子节点滚动到可见区时，复用 `handleWheel` 现有的分组滚动模式——非受控时直接改 `group.scrollTop`（快路径，不必整次重新计算布局）；受控时 `updateGroupState` emit 后调 `updateLayout()` 重新计算（依赖父级监听器同步更新 `groupStates`，这跟现有滚轮滚动受控分支的假设完全一致）。

## 范围

### 目标（本切片交付）

- `src/minimap/viewport.js` 新增：
  - `tweenViewport(from, to, progress)`：对 `x`/`y`/`scale` 做 `easeOutCubic` 缓动插值（复用 `layout-transition.js` 导出的 `easeOutCubic`，跟 `drag-transition.js` 现有的引用方式一致）。
  - `fitViewportToBounds(bounds, viewportWidth, viewportHeight, options, padding = 40)`：按屏幕像素 `padding` 留白，算出能装下整块世界坐标 `bounds` 的目标 `{x,y,scale}`；`scale` 经 `clampScale` 夹紧；`bounds` 退化（`maxX < minX`，空图）时返回 `DEFAULT_VIEWPORT`。
  - `centerViewportOn(worldPoint, viewport, viewportWidth, viewportHeight)`：只平移、保持 `viewport.scale` 不变，让 `worldPoint` 落到屏幕中心。
- `src/minimap/layout.js` 新增（并把 `visibleGroupChildren` 里算单个格子矩形的逻辑拆成私有 `childRectAt(group, index)`，两处复用，不改变 `visibleGroupChildren` 现有行为）：
  - `locateChildGroup(layout, childId)`：在 `layout.groups` 里查 `childId` 属于哪个分组、在第几位，返回 `{ group, index }` 或 `null`。
  - `childRectInGroup(group, childId)`：按当前 `scrollTop` 算出某个子节点（不要求当前在可见窗口内）的世界坐标矩形；找不到返回 `null`。
  - `scrollTopToReveal(group, index)`：算出能让第 `index` 个子节点在可见窗口里居中的 `scrollTop`，经 `clampGroupScroll` 夹紧；不改 `expanded`。
- `src/minimap/selection.js` 新增：
  - `applySelectionSet(currentIds, ids, mode = 'replace')`：`mode` 取 `'replace'`（整体替换）/`'add'`（并集）/`'remove'`（差集）/`'toggle'`（逐个取反，默认 `'replace'`）。
- `src/minimap/Minimap.vue`：
  - 新增模块级状态 `activeViewportTween`/`viewportTweenFrameId`，跟现有 `activeTransition`/`animationFrameId` 平级、互不干扰。
  - 新增 `runViewportTween(toViewport, { durationMs = 200 })`：先 `settleAnimation()` 结算正在跑的布局动画、`cancelViewportTween()` 取消上一次未完成的视口补动、`cancelPointerInteractions()` 避免和拖拽/平移/框选冲突；非受控模式下跑 `requestAnimationFrame` 缓动，受控模式下立即 `emit('viewport-change', next)`；`sameViewport` 时直接跳过。
  - 新增 `defineExpose({ fitToScreen, centerOnNode, centerOnSelection, zoomTo, setViewport, getViewport, select, clearSelection })`。
  - `onUnmounted` 补 `cancelViewportTween()`。
- 测试：`test/minimap-viewport.test.js`（或现有视口测试文件）新增 `tweenViewport`/`fitViewportToBounds`/`centerViewportOn` 用例；`test/minimap-layout.test.js` 新增 `locateChildGroup`/`childRectInGroup`/`scrollTopToReveal` 用例；`test/minimap-select.test.js` 新增 `applySelectionSet` 用例；新建或扩展 Vue 组件测试覆盖 8 个 `defineExpose` 方法。`npm test`、`npm run build` 通过。

### 非目标（后续切片）

- 搜索节点（按 `id`/`label` 搜索、结果列表、跳转）——切片 2，会复用本切片的 `centerOnNode`。
- Overview 小地图子组件（缩略图渲染、视口框拖拽导航）——切片 3。
- `options.fitPadding` 等可配置化扩展——本切片用固定默认值 `40`，YAGNI，等真实需求出现再加配置项。

## 模块 API 契约

### `src/minimap/viewport.js`

```js
// 缓动插值 x/y/scale 三个数字；progress ∈ [0,1]。
export function tweenViewport(from, to, progress) { /* ... */ }

// bounds: { minX, maxX, minY, maxY }（世界坐标，来自 layout.bounds）。
// 退化 bounds（maxX < minX）时返回 DEFAULT_VIEWPORT。
export function fitViewportToBounds(bounds, viewportWidth, viewportHeight, options, padding = 40) { /* ... */ }

// 只平移，scale 取自传入的 viewport，不变。
export function centerViewportOn(worldPoint, viewport, viewportWidth, viewportHeight) { /* ... */ }
```

### `src/minimap/layout.js`

```js
// 在 layout.groups 里查 childId 属于哪个分组、第几位；查不到返回 null。
export function locateChildGroup(layout, childId) { /* { group, index } | null */ }

// 按 group.scrollTop 算某个子节点的世界坐标矩形，不要求当前可见；查不到返回 null。
export function childRectInGroup(group, childId) { /* rect | null */ }

// 算出能让第 index 个子节点居中可见的 scrollTop，经 clampGroupScroll 夹紧；不改 expanded。
export function scrollTopToReveal(group, index) { /* number */ }
```

### `src/minimap/selection.js`

```js
// mode: 'replace'（默认） | 'add' | 'remove' | 'toggle'
export function applySelectionSet(currentIds, ids, mode = 'replace') { /* string[] */ }
```

### `src/minimap/Minimap.vue`（`defineExpose`）

```js
fitToScreen()              // 让 layout.bounds 全部进入视口，留白 40px，平滑过渡
centerOnNode(id)           // 把指定节点/分组/分组内子节点移到视口中心附近，平滑过渡；id 不存在则 no-op
centerOnSelection()        // 把当前选中内容包围盒中心移到视口中心，保持 scale 不变；选中为空则 no-op
zoomTo(scale, center)      // center 为世界坐标点，默认当前视口中心对应的世界坐标；scale 经 clampScale 夹紧
setViewport(viewport)      // 立即生效，不动画
getViewport()              // 返回 currentViewport()
select(ids, mode)          // mode 见 applySelectionSet；默认 'replace'
clearSelection()           // 等价于 select([], 'replace')
```

## 验收标准

- 调用 `fitToScreen()` 后，示例图和压力图的全部内容（`layout.bounds`）都落入可见视口范围内，且有平滑过渡而非瞬间跳转。
- `centerOnNode(id)` 对普通节点、分组框本体、已折叠分组里被滚出可见区的子节点都能正确把目标移到视口中心附近；后一种情况下只有 `groupStates[groupId].scrollTop` 变化，`expanded` 不变。
- `centerOnSelection()` 对多选且分布分散的选中集只平移、不改变 `scale`。
- `zoomTo(scale)`（不传 `center`）让当前视口中心对应的世界点缩放后仍停在屏幕中心；`zoomTo(scale, worldPoint)` 让指定世界点缩放后停在原屏幕位置；超出 `minScale`/`maxScale` 被夹紧。
- `setViewport`/`getViewport` 立即生效，往返一致，不触发动画。
- `select(ids, mode)` 四种 `mode` 行为符合 `applySelectionSet` 定义；`clearSelection()` 清空选中。
- 受控 `viewport`/`groupStates` 模式下，以上方法只 `emit` 对应事件、不直接改组件内部状态；非受控模式下内部状态正确更新。
- 在布局动画或拖拽/平移/框选进行中调用任一方法，不产生冲突或视口撕裂（先结算/取消再执行）。
- `npm test`、`npm run build` 通过。

## 测试清单

- `viewport.js`：`tweenViewport` 在 progress = 0/0.5/1 的插值结果；`fitViewportToBounds` 正常内容、空内容退化、目标 scale 超出 min/max 被夹紧三种场景；`centerViewportOn` 平移正确且 `scale` 不变。
- `layout.js`：`locateChildGroup` 命中/不命中两种情况；`childRectInGroup` 跟重构前 `visibleGroupChildren` 在同一 `index` 算出的矩形一致（防止重构改变行为的回归点）；`scrollTopToReveal` 居中计算结果，以及目标行已在可见区/分组不溢出两种场景下被 `clampGroupScroll` 夹到合法范围。
- `selection.js`：`applySelectionSet` 四种 `mode` 各自的合并/差集/取反结果，包含对已选中 id 的 `'toggle'` 往返。
- `Minimap.vue`：
  - `fitToScreen` 让 demo 图、压力图的全部内容落入视口（断言 `getViewport()` 推导出的可视世界范围覆盖 `layout.bounds`）。
  - `centerOnNode` 命中普通节点、分组框本体、折叠分组里滚出可见区的子节点三种场景；最后一种验证 `scrollTop` 改变、`expanded` 不变。
  - `centerOnSelection` 多选分散时 `scale` 不变。
  - `zoomTo` 默认中心点和指定世界坐标中心点两种调用都保持该世界点屏幕位置不变。
  - `setViewport`/`getViewport` 往返一致、无动画痕迹（调用后立即等于目标值，不需要等 raf）。
  - `select`/`clearSelection` 四种 `mode` 的行为，以及调用后正确 `emit('select', ...)`。
  - 受控 `viewport` 模式下调用 `fitToScreen`/`centerOnNode`/`zoomTo` 只 `emit('viewport-change', ...)`、不改内部 `internalViewport`。
  - 受控 `groupStates` 模式下 `centerOnNode` 滚动分组子节点的行为只 `emit('group-state-change', ...)`。
  - 方法调用前有进行中的布局动画或拖拽/平移/框选时，调用后不报错、状态被正确结算/取消。
- 回归：现有 `viewport.js`/`layout.js`/`selection.js`/`Minimap.vue` 测试保持通过（`visibleGroupChildren` 重构后的回归覆盖）。
