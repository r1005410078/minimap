# Controller 抽取总体设计 + 切片 1：根 controller 与 core-controller

## 背景

`Minimap.vue` 已经超过 2000 行。虽然渲染/布局/交互的纯逻辑早就拆进了 `renderer.js`/`layout.js`/`interaction.js`/`viewport.js`/`graph-operations.js` 等近 20 个框架无关文件，但把这些模块粘起来的"编排层"——拖拽状态机、三个 rAF 循环（自动滚动/边缘平移/拖拽让位）、视口动画/补动、右键菜单、撤销重做、剪贴板、搜索——全部直接写在 `<script setup>` 里，跟 Vue 的 `ref`/`watch`/`onMounted` 强耦合。

目标：把这层编排逻辑也迁到框架无关的 controller 模块，`Minimap.vue` 只保留 props/emits 声明、模板绑定用的少量响应式 ref、生命周期挂载/卸载、prop watcher 转发、`defineExpose` 转发。这样以后想换 React 或 Vue3，只需要重写一个薄包装层，核心行为不用动。

本文档记录全部 6 个切片的总体架构（供后续切片复用约定），并详细设计第一个切片：根 controller（`minimap-controller.js`）+ core-controller（`core-controller.js`）。

## 总体架构（适用于全部切片）

### Controller 模块清单

| 文件 | 职责 | 主要依赖的现有纯模块 |
|---|---|---|
| `minimap-controller.js`（根） | 组装下面所有 controller；挂载/卸载 canvas DOM 监听；对外暴露 `mount`/`destroy`/`defineExpose` 需要的全部方法 | — |
| `core-controller.js` | canvas/ctx + resize、layout 状态、分组展开/滚动态（受控/非受控）、布局切换动画、viewport + tween、渲染调度/降级、`renderCurrent()` | `layout.js`、`layout-transition.js`、`viewport.js`、`renderer.js`、`render-scheduler.js`、`render-quality.js` |
| `selection-controller.js` | 选中态受控/非受控、`setSelected`/`select`/`clearSelection` | `selection.js` |
| `edit-controller.js` | 撤销/重做/剪贴板/复制/粘贴/删除/导入导出 | `graph-operations.js`、`clipboard.js`、`graph-serialization.js` |
| `search-controller.js` | 搜索/上一个/下一个/跳转 | `search.js` |
| `context-menu-controller.js` | 打开/关闭、命中转 context、菜单项构建/合并、动作执行、外部点击监听 | `context-menu.js` |
| `drag-controller.js` | 节点拖拽/滚动条拖拽/框选/空白平移/三个 rAF 循环/资源拖放提交 | `interaction.js`、`drag-transition.js`、`graph-operations.js` |

> 分组展开/滚动状态（`groupStates` 受控/非受控、`updateGroupState`）放进 **core-controller**，不单独拆模块：它跟 layout 重算强绑定（展开切换、滚动条拖拽结束都要触发 `updateLayout()`），拆开会两边来回传 layout 引用，不划算。

### 依赖注入约定

每个 controller 是一个工厂函数：`createXController(deps) -> { 方法... }`。`deps` 以两类形式传入：

1. **只读 getter，转发 Vue props/computed**：比如 `getGraph`、`getOptions`、`getTheme`。这些是闭包转发，不是数据快照——controller 每次要用时调用 getter 拿最新值，跟今天直接读 `props.graph`效果一样。Vue 的 prop watcher 因此不需要调用"setter"，只需要在变化时调用 controller 的动作方法（`updateLayout()`、`renderCurrent()`），跟现状的 `watch(...) => updateLayout()` 写法一致。
2. **跨 controller 契约**：比如 core-controller 需要 `getSelectedIds()`（选中态）和 `getInteractionRenderState()`（拖拽渲染态）。这两个契约从切片 1 起就是 core-controller 固定依赖的形状；只是在 selection-controller/drag-controller 还不存在之前，根 controller 把这个 getter 接到 **Vue 本地仍保留的旧闭包**上。等切片 2/6 把对应 controller 建出来，根 controller 只改"接到谁"，不改 core-controller 内部代码，也不改契约形状。

这跟现有 `beforeNodeDrop` 等回调 props 的风格一致，不引入新的 pub-sub/store 抽象。

### DOM 事件归属

canvas 的 DOM 事件监听（`pointerdown`/`pointermove`/`pointerup`/`pointerleave`/`pointercancel`/`lostpointercapture`/`keydown`/`wheel`/`contextmenu`/`dragover`/`drop`）从切片 1 起统一由**根 controller** 的 `mount()`/`destroy()` 负责挂载/卸载（机械的 DOM 接线，风险低，越早挪走越好）。监听的回调函数体在切片 1 时仍然是 Vue 本地保留的旧函数（通过 deps 注入根 controller），后续切片逐个把对应回调换成新 controller 的方法，根 controller 的挂载代码本身不用再改。这样 `Minimap.vue` 的 `onMounted`/`onUnmounted` 从切片 1 起就能瘦到位。

### 切片顺序

1. 根 controller + **core-controller**（本文档详细设计）—— 大家都依赖的地基。
2. **selection-controller** —— 体量小但到处被引用，早抽出来简化后面。
3. **edit-controller** —— 跟 DOM 耦合最少。
4. **search-controller** —— 依赖 core + selection，到这一步都已就位。
5. **context-menu-controller** —— 依赖 core/selection/edit 提供的能力标志位。
6. **drag-controller** —— 最复杂，留到最后；完成后 `Minimap.vue` 里不再有任何指针事件处理逻辑，根 controller 的 DOM 回调全部指向真实 controller。

每个切片独立 `npm test`/`npm run build` 通过；`test/minimap-shell.test.js`（挂载真实组件、派发真实 DOM 事件）作为贯穿全程的回归安全网，因为对外组件契约（props/emits/defineExpose）不变。

## 本文档范围：切片 1（根 controller + core-controller）

### 目标

把 canvas 挂载/resize、layout 状态、分组展开/滚动受控态、布局切换动画、viewport + tween、渲染调度/降级这几块迁出 `Minimap.vue`，落到新建的 `core-controller.js`；新建 `minimap-controller.js` 作为根，负责 DOM 监听挂载/卸载并组装 core。`Minimap.vue` 对外行为、props、emits、`defineExpose` 方法名和参数形状完全不变。

### 范围内

- 新建 `src/minimap/core-controller.js`，迁入：
  - canvas/ctx 初始化、DPR 适配、`ResizeObserver`（原 `syncCanvasSize`）。
  - layout 状态、布局切换动画（原 `updateLayout`/`startAnimation`/`finishLayout`/`settleAnimation`/`cancelAnimation`/`chooseAnchorId`/`targetViewportFor`/`commitViewportSilently`）。
  - 分组展开/滚动受控态（原 `currentGroupStates`/`updateGroupState`），新增 `scrollGroup`/`setGroupExpanded` 包装滚动条拖拽和表头点击两类调用方共用的逻辑。
  - viewport 状态 + tween（原 `currentViewport`/`applyViewport`/`runViewportTween`/`cancelViewportTween`/`zoomTo`/`setViewport`/`getViewport`/`fitToScreen`/`centerOnNode`/`centerOnSelection`）。
  - `resolveTargetRect`/`rectCenter`/`resolveCenterTarget`（依赖 `layout.js` 的 `locateChildGroup`/`childRectInGroup`/`scrollTopToReveal`）。
  - 渲染调度/降级 + `renderCurrent`（原 `scheduleRender`/`flushScheduledRender`/`cancelScheduledRender`/`currentRenderQuality`）。`currentRenderQuality` 需要的 `interacting` 标志位实际依赖 `panState`/`marqueeState`（属于切片 6 drag-controller 范围），切片 1 通过 `getInteractionRenderState()` 间接拿，不重新实现这两个状态。
  - 屏幕坐标转换（原 `canvasElement`/`containerElement`/`screenPointFromEvent`/`pointFromEvent`，改名为 `screenPointFromClient`/`pointFromClient`，不再需要 `document.querySelector` 兜底，因为元素由 `mount(canvas, container)` 直接传入）。
- 新建 `src/minimap/minimap-controller.js`：
  - `mount(canvas, container)`：调用 `core.mount(...)`，挂载全部 canvas DOM 监听，回调指向注入的占位函数（见下）。
  - `destroy()`：卸载监听，调用 `core.destroy()`。
  - 转发 core 的相机/布局/渲染方法（见下方方法面）。
- 修改 `src/minimap/Minimap.vue`：
  - `onMounted`/`onUnmounted` 改为创建/销毁一个 `minimap-controller` 实例并调用 `mount`/`destroy`。
  - 删除已迁出的本地变量和函数。
  - `fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport` 的 `defineExpose` 改为转发 `controller.xxx(...)`。
  - 拖拽/框选/平移/滚动条拖拽/右键菜单/搜索/撤销重做/剪贴板等函数体**原样保留在 `Minimap.vue` 里**（只是改成调用 `controller.getLayout()`/`controller.getViewport()`/`controller.scheduleRender()`/`controller.renderCurrent()`/`controller.updateLayout()`/`controller.settleAnimation()`/`controller.scrollGroup()`/`controller.setGroupExpanded()`/`controller.resolveTargetRect()`/`controller.resolveCenterTarget()` 代替本地闭包），作为 `onPointerDown` 等的注入实现传给 `minimap-controller`。
- 新建 `test/minimap-core-controller.test.js`：纯函数式覆盖 core-controller（mock canvas ctx，沿用现有 `test/minimap-renderer.test.js`/`test/minimap-render-scheduler.test.js` 的 mock 风格）。
- 更新 `ROADMAP.md`：勾选切片 1。

### 范围外（留给后续切片）

- 选中态、撤销重做/剪贴板、搜索、右键菜单、拖拽/框选/平移/滚动条拖拽的状态机本体——这些目前仍是 `Minimap.vue` 的本地函数，只是改成调用 core 的方法名，函数本身不迁移。
- `isHighFrequencyInteractionActive` 真正依赖的 `panState`/`marqueeState` 仍在 `Minimap.vue`，core 只拿到一个 `getInteractionRenderState()` getter。
- DOM 监听回调函数体的真正迁移（仍是 Vue 本地函数，只是被根 controller 挂载）。

### core-controller.js 依赖与方法面

```js
createCoreController({
  // 只读 getter，转发 props/computed，不是快照
  getGraph,             // () => props.graph
  getLayoutDirection,   // () => props.layoutDirection
  getOptions,           // () => effectiveOptions.value
  getTheme,             // () => effectiveTheme.value
  getRenderers,         // () => ({ node, group, edge })
  getViewportProp,      // () => props.viewport（null 表示非受控）
  getGroupStatesProp,   // () => props.groupStates（null 表示非受控）

  // 跨 controller 契约（切片1时由 Minimap.vue 本地闭包实现）
  getSelectedIds,             // () => string[]
  getInteractionRenderState,  // () => { dragging, interacting, groupDrag, selectionRect, groupScrollbarHoverId, attachPreview }
                               // dragging: 节点拖拽中为 true，渲染时临时清空选中关系高亮（原逻辑）
                               // interacting: pan 或框选进行中为 true，渲染降级判断用（原 isHighFrequencyInteractionActive）

  // 输出回调，core 不直接接触 Vue ref / Vue 组件实例
  emitViewportChange,    // (next) => void
  emitGroupStateChange,  // (next) => void
  onRenderStats,         // (stats) => void
  onOverviewRender,      // (sceneInput) => void
}) -> {
  mount(canvas, container),
  destroy(),

  // 相机
  getViewport(),
  setViewport(viewport),
  applyViewport(next, { emitChange, render } = {}),
  zoomAt(screenPoint, deltaY),
  panBy(delta),
  fitToScreen(),
  centerOnNode(id),
  centerOnSelection(),
  zoomTo(scale, center),
  cancelViewportTween(),

  // layout / 分组
  getLayout(),
  updateLayout({ animate, preserveAnchor } = {}),
  scrollGroup(group, rawScrollTop),
  setGroupExpanded(groupId, expanded),
  resolveTargetRect(id),
  resolveCenterTarget(id),

  // 渲染
  renderCurrent(),
  scheduleRender(reason),
  flushScheduledRender(),
  cancelScheduledRender(),
  settleAnimation(),
  cancelAnimation(),

  // 坐标
  getCssSize(),                          // { width, height }
  screenPointFromClient(clientX, clientY),
  pointFromClient(clientX, clientY),
}
```

### minimap-controller.js（根）

```js
createMinimapController({
  ...core 需要的全部 deps,
  emit,            // (event, payload) => void
  onPointerDown, onPointerMove, onPointerUp, onPointerLeave,
  onPointerCancel, onLostPointerCapture, onKeyDown, onWheel,
  onContextMenu, onDragOver, onDrop,
}) -> {
  mount(canvas, container),
  destroy(),
  // 直接转发 core 的相机/布局/渲染方法（同上）
}
```

`onPointerDown` 等在切片 1 时由 `Minimap.vue` 传入仍是本地定义的 `handlePointerDown` 等函数（函数体不变，内部改调用 `controller.xxx()`）。

### 测试策略

- `test/minimap-core-controller.test.js`：新增纯函数式用例，覆盖 viewport 受控/非受控、`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`、`updateLayout` 触发布局动画、`scrollGroup`/`setGroupExpanded` 受控/非受控、渲染调度合帧、`onRenderStats`/`onOverviewRender` 回调被正确调用。Mock 风格沿用 `test/minimap-renderer.test.js`/`test/minimap-render-scheduler.test.js`。
- `test/minimap-shell.test.js` 等现有 Vue 集成测试**不改预期行为**，只要全部保持通过，就说明迁移没有改变外部可观察行为。
- 完成后跑全量 `npm test` + `npm run build`。

### 验收标准

- `Minimap.vue` 的 `<script setup>` 不再包含 canvas 挂载/resize/布局动画/viewport 数学/渲染调度的实现代码，只保留调用 `controller.xxx()`。
- 现有全部测试（364 个，含新增 core-controller 测试）通过，`npm run build` 通过。
- 组件对外 props/emits/`defineExpose` 方法名和参数形状不变。
- 手动验收：示例图在浏览器里平移、缩放、resize、分组展开/折叠/滚动、`fitToScreen`/`centerOnNode` 等方法调用，行为跟切片前一致。
