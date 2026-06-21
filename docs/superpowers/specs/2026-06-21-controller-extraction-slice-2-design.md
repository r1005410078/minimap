# Controller 抽取切片 2：selection + edit + search + context-menu controller 设计

## 背景

切片 1（已完成，见 [总体设计](2026-06-21-controller-extraction-design.md) 和 [切片 1 计划](../plans/2026-06-21-controller-extraction-slice-1.md)）把 canvas 挂载/resize、layout 状态、viewport+tween、渲染调度迁进了 `core-controller.js` + 根 `minimap-controller.js`。`Minimap.vue` 现在剩 ~1400 行脚本，其中选中态、编辑操作（撤销重做/剪贴板/复制粘贴/删除/导入导出）、搜索、右键菜单这四块逻辑仍然直接写在组件里。这四块都没有 rAF 循环，复杂度量级接近，按总体设计文档的切片顺序合并成一个切片一起做。

本文档详细设计这四个新 controller 的边界、依赖契约，以及它们和已有的 `core-controller`/即将到来的切片 3 `drag-controller` 之间的关系。依赖注入约定（只读 getter 转发 props、跨 controller 契约用回调注入、根 controller 只换接线对象不换契约）沿用总体设计文档，不重复说明。

## 目标

新建 `src/minimap/selection-controller.js`、`src/minimap/edit-controller.js`、`src/minimap/search-controller.js`、`src/minimap/context-menu-controller.js`，把对应逻辑从 `Minimap.vue` 迁出。`Minimap.vue` 对外行为、props、emits、`defineExpose` 方法名和参数形状不变。

## 范围内

- 四个新 controller 文件 + 各自的纯函数式测试文件。
- 根 `minimap-controller.js` 增加组装这四个 controller，并把它们的方法转发出去（`select`/`clearSelection`/`undo`/`redo`/`canUndo`/`canRedo`/`deleteSelection`/`copySelection`/`paste`/`exportGraph`/`importGraph`/`search`/`searchNext`/`searchPrevious`）。
- `Minimap.vue` 删除已迁出的本地函数和状态，`defineExpose`/`onMounted` 里的 `createInteractionController()` 增加这四个 controller 需要的 deps。

## 范围外（留给切片 3 或更后）

- 拖拽状态机本体（`dragState`/`scrollbarDragState`/`panState`/`marqueeState`、三个 rAF 循环、`handlePointerDown`/`Move`/`Up`/`handleWheel`/`handleDrop`/`resolveResourceDropTarget`）——继续留在 `Minimap.vue`，只是其中引用选中态/编辑操作/`cancelPointerInteractions` 的地方改接新 controller。
- `cancelPointerInteractions`、相机方法包装函数（`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`）——继续留在 `Minimap.vue`，作为本切片新 controller 的注入依赖（见下方"跨切片临时依赖"）。

## 模块设计

### `selection-controller.js`

```js
createSelectionController({
  getSelectedIdsProp,  // () => props.selectedIds（null 表示非受控）
  emitSelect,          // (ids) => emit('select', ids)
  renderCurrent,       // () => void，选中变化后触发重绘（注入 core.renderCurrent）
}) -> {
  getSelectedIds(),
  setSelected(ids),
  select(ids, mode = 'replace'),   // 包 applySelectionSet
  clearSelection(),
}
```

非受控态（`internalSelectedIds`）由 controller 内部持有，跟 viewport/groupStates 在 core-controller 里的处理方式一致。`applySelectionClick`（点击命中/additive 选择）不进这个 controller——它只在 `Minimap.vue` 的拖拽点击分支和右键菜单分支里被直接调用（`selectionController.setSelected(applySelectionClick(selectionController.getSelectedIds(), id, {additive}))`），因为"点击产生的选择意图"由调用方（拖拽状态机、右键菜单）决定，selection-controller 只负责持有和提交结果。

### `edit-controller.js`

```js
createEditController({
  getGraph,             // () => props.graph
  getLayout,            // () => core.getLayout()，selectedRealNodeIds 展开分组要用
  getSelectedIds,       // () => selection.getSelectedIds()
  setSelected,          // (ids) => selection.setSelected(ids)
  getReadonly,          // () => effectiveReadonly.value
  updateLayout,         // (opts) => core.updateLayout(opts)
  getBeforeDelete, getBeforeCopy, getBeforeImport, getBeforePaste,  // () => props.beforeXxx
  emitDelete, emitCopy, emitPaste, emitImport, emitChange,          // (payload) => emit('xxx', payload)
}) -> {
  undo(), redo(), canUndo(), canRedo(),
  deleteSelection(), copySelection(), paste(), pasteInto(targetParentId),
  exportGraph(), importGraph(data),
  applyOperation(operation, { before } = {}),  // 内部自动用 getReadonly() 传给 operationManager.apply 的 readonly，调用方只传 before；见下，给 drag-controller 用
  onGraphReplaced(),  // graph prop 变化时调用，重建 operationManager
}
```

**`operationManager` 归属决策**：`graph-operations.js` 的撤销/重做栈是整张图唯一一份历史，节点跨父级拖拽和分组内换位（切片 3 的 drag-controller）走的也是同一个 `apply()` 入口（`move-node`/`reorder-group-child` operation），不能让 drag 另开一条历史栈。所以 `edit-controller` 拥有 `operationManager` 单例，并把 `applyOperation`/`emitChange` 作为公开方法——切片 3 时根 controller 把 drag-controller 的对应依赖接到这两个方法上，`edit-controller` 内部不用再改。`canPaste`（右键菜单要用）不经过 edit-controller：它只是 `clipboard.js` 的 `hasClipboard()`，一个模块级纯函数判断，不涉及 edit-controller 的实例状态，右键菜单直接 `import { hasClipboard } from './clipboard.js'` 自己判断即可，不必经过一层转发。

### `search-controller.js`

```js
createSearchController({
  getGraph,             // () => props.graph
  centerOnNode,         // (id) => void，注入 Vue 本地相机包装函数（见下）
  select,               // (ids) => selection.select(ids)
  emitSearch,           // (payload) => emit('search', payload)
  onSearchStateChange,  // ({ keyword, matches, currentIndex }) => 写回 Vue 的三个模板绑定 ref
}) -> {
  search(keyword), searchNext(), searchPrevious(),
}
```

`searchKeyword`/`searchMatches`/`searchCurrentIndex` 三个 ref 还是留在 `Minimap.vue`（模板直接绑定），由 `onSearchStateChange` 回调写入，跟 core 的 `onRenderStats` 是同一种"controller 算出新状态，Vue 只管往 ref 里塞"模式。

### `context-menu-controller.js`

```js
createContextMenuController({
  getGraph, getLayout,                       // core
  screenPointFromClient, pointFromClient,    // core
  getCssSize,                                 // core
  setGroupExpanded,                           // core
  getSelectedIds, setSelected,                // selection
  getReadonly,                                 // Vue effectiveReadonly
  getOptions,                                  // Vue effectiveOptions
  canUndo, canRedo,                            // edit
  copySelection, deleteSelection, pasteInto, paste,  // edit
  fitToScreen, centerOnSelection, centerOnNode,      // 注入 Vue 本地相机包装函数
  cancelPointerInteractions,                          // 注入 Vue 本地实现
  emitConfigChange,                                   // Vue 既有函数（写 internalOptions/internalReadonly + emit）
  emitContextMenuAction,                              // (payload) => emit('context-menu-action', payload)
  getContextMenuItemsProp,                            // () => props.contextMenuItems
  onMenuStateChange,                                  // (state | null) => 写回 Vue 的 contextMenuState ref
}) -> {
  open(event, canvasEl),   // 需要 canvasEl 来 focus()，对应原 canvasRef.value?.focus?.()
  close(),
  runItem(item),
}
```

打开/关闭右键菜单时挂卸的 `document` 级"外部点击关闭"监听由这个 controller 自己管理（`open()` 挂、`close()` 卸），不经过根 controller 的 canvas 监听机制——它的生命周期是"菜单开着才存在"，跟 canvas 监听"组件挂载就存在"不是一回事，混进根 controller 的挂载/卸载反而增加耦合。

`canPaste` 不在 deps 里（见上，直接 import `hasClipboard`）。`targetIdsForContext`/`runWithTemporarySelection` 是这个 controller 的内部私有函数，不对外暴露。

## 跨切片临时依赖

延续切片 1 的模式：

1. **相机方法**：`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`——`Minimap.vue` 目前是"先 `cancelPointerInteractions()` 再调 `controller.xxx()`"的本地包装函数（取消指针交互属于切片 3 的拖拽状态机）。search-controller 的跳转和 context-menu-controller 的 `fit-to-screen`/`center-*` 动作都注入这些 Vue 本地函数，不直接拿 core 的同名方法。
2. **`cancelPointerInteractions`**：`context-menu-controller.open()` 打开菜单前也要调用它。同样注入 Vue 本地实现。

切片 3 把拖拽状态机搬进 `drag-controller` 之后，根 controller 只需要把这两类注入点改接到 `drag-controller` 对应方法，search-controller/context-menu-controller 内部代码不用再改。

## Vue 集成（`Minimap.vue` 之后的样子）

删除：`internalSelectedIds`/`currentSelectedIds`/`setSelected`/`select`/`clearSelection`（迁入 selection-controller）；`operationManager`/`graphOperations`/`emitChange`/`undo`/`redo`/`canUndo`/`canRedo`/`selectedRealNodeIds`/`selectionAfterDeleting`/`deleteSelection`/`copySelection`/`pasteTargetId`/`nextPasteId`/`createPasteIdMap`/`pasteInto`/`paste`/`exportGraph`/`importGraph`（迁入 edit-controller）；`searchKeyword`/`searchMatches`/`searchCurrentIndex` 的赋值逻辑、`jumpToSearchResult`/`search`/`searchNext`/`searchPrevious`（迁入 search-controller，三个 ref 本身保留作模板绑定）；`contextMenuState`/`contextMenuRef` 的赋值逻辑、`CONTEXT_MENU_WIDTH`/`CONTEXT_MENU_MAX_HEIGHT`/`clampContextMenuPosition`/`closeContextMenu`/`handleContextMenuDocumentPointerDown`/`canPaste`/`groupForHit`/`contextFromHit`/`openContextMenu`/`targetIdsForContext`/`runWithTemporarySelection`/`executeContextMenuAction`/`runContextMenuItem`（迁入 context-menu-controller，两个 ref 本身保留作模板绑定）。

保留：`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`cancelPointerInteractions`（见上，跨切片临时依赖）；`emitConfigChange`（被 context-menu-controller 注入复用）；`isAdditiveSelection`（拖拽点击分支用，留在 `Minimap.vue`，调用 `selectionController.setSelected(applySelectionClick(...))`）；拖拽/框选/平移状态机全部（切片 3 范围）。

`watch(() => props.graph, ...)` 里原来的 `operationManager = createGraphOperationManager(props.graph)` 改成调用 `editController.onGraphReplaced()`。`defineExpose` 的 `select`/`clearSelection`/`undo`/`redo`/`canUndo`/`canRedo`/`deleteSelection`/`copySelection`/`paste`/`exportGraph`/`importGraph`/`search`/`searchNext`/`searchPrevious` 改成转发到 `controller.xxx()`（根 controller 转发对应的新 controller 方法）。

## 测试策略

四个新 controller 各自一个 `test/minimap-xxx-controller.test.js`，纯 jsdom（不用 Vue Test Utils），mock deps 用普通对象/函数，沿用切片 1 `test/minimap-core-controller.test.js` 的写法。`test/minimap-shell.test.js` 等既有 Vue 集成测试不改预期行为，保持全部通过，作为行为不变的回归证据。

## 验收标准

- `Minimap.vue` 的 `<script setup>` 不再包含选中态/编辑操作/搜索/右键菜单的实现代码，只保留调用 `controller.xxx()` 和上面列出的几个跨切片临时依赖。
- 现有全部测试 + 四个新 controller 的测试通过，`npm run build` 通过。
- 组件对外 props/emits/`defineExpose` 方法名和参数形状不变。
- 手动验收：右键菜单（节点/分组/空白画布）、撤销重做、复制粘贴、删除、搜索跳转，行为跟切片前一致。
