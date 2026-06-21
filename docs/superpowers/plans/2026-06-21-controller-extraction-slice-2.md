# Controller 抽取切片 2：selection + edit + search + context-menu Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `Minimap.vue` 里选中态、编辑操作（撤销/重做/剪贴板/复制/粘贴/删除/导入导出）、搜索、右键菜单这四块逻辑迁到四个新的框架无关 controller 模块，`Minimap.vue` 对外行为完全不变。

**Architecture:** 四个工厂函数 `createSelectionController`/`createEditController`/`createSearchController`/`createContextMenuController`，deps 全部是只读 getter 或回调（同切片 1 约定）。根 `minimap-controller.js` 组装这四个加上已有的 `core-controller`：先建 `selection`（它的 `renderCurrent` 依赖通过闭包延迟引用还没创建的 `core`），再建 `core`（把它的 `getSelectedIds` 依赖从 Vue 本地桩换成 `selection.getSelectedIds`），再建 `edit`/`search`/`contextMenu`（它们互相引用已经建好的 `selection`/`core`/`edit`）。详见 [docs/superpowers/specs/2026-06-21-controller-extraction-slice-2-design.md](../specs/2026-06-21-controller-extraction-slice-2-design.md)。

**Tech Stack:** Vue 2.7 `<script setup>`，Node 内置 `node --test`，沿用 `test/helpers/dom-env.js`（本切片四个新 controller 都不摸 DOM，不需要 jsdom，可以直接用 plain Node 测试，除了 context-menu-controller 需要 `document.addEventListener`，要用 `installDomEnv()`）。

## Global Constraints

- 不引入新的运行时第三方依赖。
- 四个新 controller 不直接持有 Vue ref 或 Vue 组件实例，只通过 deps 里的回调跟外部交互。
- `Minimap.vue` 对外 props/emits/`defineExpose` 方法名和参数形状必须保持不变。
- 每个任务完成后跑一次相关测试；最后一个任务跑全量 `npm test` + `npm run build`。

---

## File Structure

- Create `src/minimap/selection-controller.js`
- Create `src/minimap/edit-controller.js`
- Create `src/minimap/search-controller.js`
- Create `src/minimap/context-menu-controller.js`
- Create `test/minimap-selection-controller.test.js`
- Create `test/minimap-edit-controller.test.js`
- Create `test/minimap-search-controller.test.js`
- Create `test/minimap-context-menu-controller.test.js`
- Modify `src/minimap/minimap-controller.js` —— 组装四个新 controller，转发新方法，`contextmenu` 监听改接 `contextMenu.open`。
- Modify `src/minimap/Minimap.vue` —— 删除已迁出的本地实现，接入新方法。
- Modify `ROADMAP.md` —— 勾选切片 2。

---

## Task 1: selection-controller.js

**Files:**
- Create: `src/minimap/selection-controller.js`
- Create: `test/minimap-selection-controller.test.js`

**Interfaces:**
- Produces：
  ```js
  createSelectionController({
    getSelectedIdsProp,  // () => props.selectedIds（null 表示非受控）
    emitSelect,          // (ids) => void
    renderCurrent,       // () => void
  }) -> {
    getSelectedIds(),
    setSelected(ids),
    select(ids, mode = 'replace'),
    clearSelection(),
  }
  ```

- [ ] **Step 1: 写失败测试**

Create `test/minimap-selection-controller.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSelectionController } from '../src/minimap/selection-controller.js'

function createDeps(overrides = {}) {
  const emitted = []
  const renders = []
  return {
    emitted,
    renders,
    deps: {
      getSelectedIdsProp: () => null,
      emitSelect: (ids) => emitted.push(ids),
      renderCurrent: () => renders.push(true),
      ...overrides,
    },
  }
}

test('getSelectedIds defaults to an empty array when uncontrolled', () => {
  const { deps } = createDeps()
  const controller = createSelectionController(deps)
  assert.deepEqual(controller.getSelectedIds(), [])
})

test('setSelected stores ids internally when uncontrolled, emits, and renders', () => {
  const { deps, emitted, renders } = createDeps()
  const controller = createSelectionController(deps)

  controller.setSelected(['a', 'b'])

  assert.deepEqual(controller.getSelectedIds(), ['a', 'b'])
  assert.deepEqual(emitted, [['a', 'b']])
  assert.equal(renders.length, 1)
})

test('setSelected does not mutate getSelectedIds when controlled, but still emits and renders', () => {
  const controlledIds = ['x']
  const { deps, emitted, renders } = createDeps({ getSelectedIdsProp: () => controlledIds })
  const controller = createSelectionController(deps)

  controller.setSelected(['y', 'z'])

  assert.deepEqual(controller.getSelectedIds(), ['x'])
  assert.deepEqual(emitted, [['y', 'z']])
  assert.equal(renders.length, 1)
})

test('select with mode "add" unions with the current selection', () => {
  const { deps } = createDeps()
  const controller = createSelectionController(deps)
  controller.setSelected(['a'])

  controller.select(['b', 'a'], 'add')

  assert.deepEqual(controller.getSelectedIds(), ['a', 'b'])
})

test('select with default mode "replace" overwrites the current selection', () => {
  const { deps } = createDeps()
  const controller = createSelectionController(deps)
  controller.setSelected(['a'])

  controller.select(['b'])

  assert.deepEqual(controller.getSelectedIds(), ['b'])
})

test('clearSelection empties the selection', () => {
  const { deps } = createDeps()
  const controller = createSelectionController(deps)
  controller.setSelected(['a'])

  controller.clearSelection()

  assert.deepEqual(controller.getSelectedIds(), [])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-selection-controller.test.js`
Expected: 失败，因为 `src/minimap/selection-controller.js` 不存在。

- [ ] **Step 3: 实现**

Create `src/minimap/selection-controller.js`:

```js
import { applySelectionSet } from './selection.js'

export function createSelectionController(deps) {
  let internalSelectedIds = []

  function getSelectedIds() {
    return deps.getSelectedIdsProp() ?? internalSelectedIds
  }

  function setSelected(ids) {
    const nextIds = [...ids]
    if (deps.getSelectedIdsProp() == null) internalSelectedIds = nextIds
    deps.emitSelect(nextIds)
    deps.renderCurrent()
  }

  function select(ids, mode = 'replace') {
    setSelected(applySelectionSet(getSelectedIds(), ids, mode))
  }

  function clearSelection() {
    setSelected([])
  }

  return { getSelectedIds, setSelected, select, clearSelection }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-selection-controller.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/selection-controller.js test/minimap-selection-controller.test.js
git commit -m "feat: add selection-controller"
```

---

## Task 2: edit-controller.js

**Files:**
- Create: `src/minimap/edit-controller.js`
- Create: `test/minimap-edit-controller.test.js`

**Interfaces:**
- Produces：
  ```js
  createEditController({
    getGraph,                      // () => props.graph
    getLayout,                     // () => core.getLayout()
    getSelectedIds, setSelected,   // selection-controller 的方法
    getReadonly,                   // () => effectiveReadonly.value
    updateLayout,                  // (opts) => core.updateLayout(opts)
    getBeforeDelete, getBeforeCopy, getBeforeImport, getBeforePaste,  // () => props.beforeXxx
    emitDelete, emitCopy, emitPaste, emitImport, emitExport, emitChange,  // (payload) => emit('xxx', payload)
  }) -> {
    undo(), redo(), canUndo(), canRedo(),
    deleteSelection(), copySelection(), paste(), pasteInto(targetParentId),
    exportGraph(), importGraph(data),
    applyOperation(operation, { before } = {}),  // 给切片 3 drag-controller 用，readonly 内部自动取 getReadonly()
    onGraphReplaced(),  // props.graph 变化时调用，重建撤销栈
  }
  ```
- 注意：spec 文档列的 deps 少了 `emitExport`（`exportGraph()` 要 emit `'export'` 事件），本任务补上。

- [ ] **Step 1: 写失败测试**

Create `test/minimap-edit-controller.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph.js'
import { clearClipboard, getClipboard } from '../src/minimap/clipboard.js'
import { createEditController } from '../src/minimap/edit-controller.js'

function createDeps(graph, overrides = {}) {
  const emitted = { delete: [], copy: [], paste: [], import: [], export: [], change: [] }
  let selectedIds = []
  let layout = null
  const layoutCalls = []
  const deps = {
    getGraph: () => graph,
    getLayout: () => layout,
    getSelectedIds: () => selectedIds,
    setSelected: (ids) => { selectedIds = ids },
    getReadonly: () => false,
    updateLayout: (opts) => layoutCalls.push(opts),
    getBeforeDelete: () => null,
    getBeforeCopy: () => null,
    getBeforeImport: () => null,
    getBeforePaste: () => null,
    emitDelete: (p) => emitted.delete.push(p),
    emitCopy: (p) => emitted.copy.push(p),
    emitPaste: (p) => emitted.paste.push(p),
    emitImport: (p) => emitted.import.push(p),
    emitExport: (p) => emitted.export.push(p),
    emitChange: (p) => emitted.change.push(p),
    ...overrides,
  }
  return {
    deps,
    emitted,
    layoutCalls,
    setSelectedIds: (ids) => { selectedIds = ids },
    setLayout: (l) => { layout = l },
  }
}

test('copySelection expands a selected collapsed-group id into its real child ids via getLayout', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps, setLayout, emitted } = createDeps(graph, { getSelectedIds: () => ['heap-1::g0'] })
  // heap-1 在 createDemoGraph() 里有 24 个叶子子节点，真实代码会把它折叠成一个分组；
  // 这里直接构造 layout 形状（group 的 id 跟 parentId 不同，children 是真实节点 id），
  // 不依赖 computeLayout，专测 selectedRealNodeIds 的展开逻辑。
  setLayout({ groups: [{ id: 'heap-1::g0', parentId: 'heap-1', children: ['cluster-1', 'cluster-2'] }] })
  const controller = createEditController(deps)

  const result = controller.copySelection()

  assert.equal(result.applied, true)
  assert.deepEqual(result.operation.payload.expandedIds, ['cluster-1', 'cluster-2'])
  assert.deepEqual(emitted.copy[0].capturedIds.sort(), ['cluster-1', 'cluster-2'].sort())
})

test('deleteSelection blocked by readonly leaves the graph untouched', () => {
  const graph = createDemoGraph()
  const { deps, layoutCalls } = createDeps(graph, { getReadonly: () => true, getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)

  const result = controller.deleteSelection()

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'readonly')
  assert.equal(layoutCalls.length, 0)
  assert.ok(graph.nodes.has('feeder-1'))
})

test('deleteSelection blocked by beforeDelete returning false leaves the graph untouched', () => {
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, {
    getSelectedIds: () => ['feeder-1'],
    getBeforeDelete: () => () => false,
  })
  const controller = createEditController(deps)

  const result = controller.deleteSelection()

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'blocked')
  assert.ok(graph.nodes.has('feeder-1'))
})

test('deleteSelection removes the node, updates layout, clears selection, emits delete and change', () => {
  const graph = createDemoGraph()
  const { deps, emitted, layoutCalls } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)

  const result = controller.deleteSelection()

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.has('feeder-1'), false)
  assert.deepEqual(layoutCalls, [{ animate: false }])
  assert.equal(emitted.delete.length, 1)
  assert.equal(emitted.change.length, 1)
  assert.deepEqual(deps.getSelectedIds(), [])
})

test('undo restores a deleted node and redo re-removes it; canUndo/canRedo reflect history', () => {
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)
  assert.equal(controller.canUndo(), false)

  controller.deleteSelection()
  assert.equal(controller.canUndo(), true)
  assert.equal(controller.canRedo(), false)

  controller.undo()
  assert.ok(graph.nodes.has('feeder-1'))
  assert.equal(controller.canRedo(), true)

  controller.redo()
  assert.equal(graph.nodes.has('feeder-1'), false)
})

test('onGraphReplaced resets the undo/redo history', () => {
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)
  controller.deleteSelection()
  assert.equal(controller.canUndo(), true)

  controller.onGraphReplaced()

  assert.equal(controller.canUndo(), false)
})

test('copySelection with no selection returns an unapplied "empty" result and does not touch the clipboard', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, { getSelectedIds: () => [] })
  const controller = createEditController(deps)

  const result = controller.copySelection()

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'empty')
  assert.equal(getClipboard(), null)
})

test('copySelection blocked by beforeCopy returning false does not touch the clipboard', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, {
    getSelectedIds: () => ['feeder-1'],
    getBeforeCopy: () => () => false,
  })
  const controller = createEditController(deps)

  const result = controller.copySelection()

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'blocked')
  assert.equal(getClipboard(), null)
})

test('copySelection writes a snapshot to the clipboard and emits copy', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps, emitted } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)

  const result = controller.copySelection()

  assert.equal(result.applied, true)
  assert.ok(getClipboard())
  assert.equal(emitted.copy.length, 1)
  assert.deepEqual(emitted.copy[0].ids, ['feeder-1'])
})

test('pasteInto inserts the clipboard snapshot under the target parent, updates layout, emits paste and change', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps: copyDeps } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  createEditController(copyDeps).copySelection()

  const { deps, emitted, layoutCalls } = createDeps(graph, { getSelectedIds: () => ['grid-tie'] })
  const controller = createEditController(deps)

  const result = controller.pasteInto('grid-tie')

  assert.equal(result.applied, true)
  assert.ok(layoutCalls.length > 0)
  assert.equal(emitted.paste.length, 1)
  assert.equal(emitted.change.length, 1)
  const pastedId = result.operation.payload.pastedIds[0]
  assert.ok(graph.nodes.get('grid-tie').children.includes(pastedId))
})

test('paste() defaults the target to the parent of the first selected id', () => {
  clearClipboard()
  const graph = createDemoGraph()
  const { deps: copyDeps } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  createEditController(copyDeps).copySelection()

  const { deps } = createDeps(graph, { getSelectedIds: () => ['feeder-2'] })
  const controller = createEditController(deps)

  const result = controller.paste()

  assert.equal(result.applied, true)
  assert.equal(result.operation.payload.targetParentId, 'grid-tie')
})

test('exportGraph serializes the graph and emits export', () => {
  const graph = createDemoGraph()
  const { deps, emitted } = createDeps(graph)
  const controller = createEditController(deps)

  const exported = controller.exportGraph()

  assert.equal(exported.version, graph.version)
  assert.equal(emitted.export.length, 1)
})

test('importGraph blocked by readonly never parses the data and leaves the graph untouched', () => {
  const graph = createDemoGraph()
  const { deps } = createDeps(graph, { getReadonly: () => true })
  const controller = createEditController(deps)

  const result = controller.importGraph('not even json')

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'readonly')
})

test('importGraph replaces the graph contents, clears selection, updates layout, emits import and change', () => {
  const graph = createDemoGraph()
  const { deps, emitted, layoutCalls } = createDeps(graph, { getSelectedIds: () => ['feeder-1'] })
  const controller = createEditController(deps)
  const replacement = {
    version: graph.version,
    nodes: [{ id: 'solo', label: 'Solo', parentId: null, children: [] }],
    rootIds: ['solo'],
    edges: [],
  }

  const result = controller.importGraph(replacement)

  assert.equal(result.applied, true)
  assert.deepEqual(deps.getSelectedIds(), [])
  assert.deepEqual(layoutCalls, [{ animate: false }])
  assert.equal(emitted.import.length, 1)
  assert.equal(emitted.change.length, 1)
})

test('applyOperation is exposed for cross-controller use (e.g. drag-controller in a later slice)', () => {
  const graph = createDemoGraph()
  const { deps } = createDeps(graph)
  const controller = createEditController(deps)
  const beforeCalls = []

  const blocked = controller.applyOperation(
    { type: 'delete-nodes', payload: { ids: ['feeder-1'], expandedIds: ['feeder-1'] } },
    { before: (payload) => { beforeCalls.push(payload); return false } },
  )

  assert.equal(blocked.applied, false)
  assert.equal(blocked.reason, 'blocked')
  assert.equal(beforeCalls.length, 1)
  assert.ok(graph.nodes.has('feeder-1'))
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-edit-controller.test.js`
Expected: 失败，因为 `src/minimap/edit-controller.js` 不存在。

- [ ] **Step 3: 实现**

Create `src/minimap/edit-controller.js`:

```js
import { createGraphOperationManager, captureSubtreeSnapshot } from './graph-operations.js'
import { getClipboard, setClipboard } from './clipboard.js'
import { deserializeGraph, serializeGraph } from './graph-serialization.js'

export function createEditController(deps) {
  let operationManager = createGraphOperationManager(deps.getGraph())

  function onGraphReplaced() {
    operationManager = createGraphOperationManager(deps.getGraph())
  }

  function applyOperation(operation, { before } = {}) {
    return operationManager.apply(operation, { readonly: deps.getReadonly(), before })
  }

  function emitChangeIfApplied(result) {
    if (!result.applied) return
    deps.emitChange({
      type: result.type,
      operation: result.operation,
      previousGraph: result.previousGraph,
      nextGraph: result.nextGraph,
      reason: result.reason,
    })
  }

  function undo() {
    const result = operationManager.undo()
    if (result.applied) {
      deps.updateLayout()
      emitChangeIfApplied(result)
    }
    return result
  }

  function redo() {
    const result = operationManager.redo()
    if (result.applied) {
      deps.updateLayout()
      emitChangeIfApplied(result)
    }
    return result
  }

  function canUndo() {
    return operationManager.canUndo()
  }

  function canRedo() {
    return operationManager.canRedo()
  }

  function selectedRealNodeIds() {
    const layout = deps.getLayout()
    if (!layout) return deps.getSelectedIds()
    const groupsById = new Map(layout.groups.map((group) => [group.id, group]))
    const ids = []
    for (const id of deps.getSelectedIds()) {
      const group = groupsById.get(id)
      if (group) ids.push(...group.children)
      else ids.push(id)
    }
    return [...new Set(ids)]
  }

  function selectionAfterDeleting(deletedIds) {
    const deleted = new Set(deletedIds)
    return deps.getSelectedIds().filter((id) => !deleted.has(id))
  }

  function deleteSelection() {
    const ids = deps.getSelectedIds()
    const expandedIds = selectedRealNodeIds()
    const operation = { type: 'delete-nodes', payload: { ids, expandedIds } }
    const result = applyOperation(operation, { before: deps.getBeforeDelete() })
    if (!result.applied) return result

    deps.updateLayout({ animate: false })
    deps.setSelected(selectionAfterDeleting(result.operation.payload.deletedIds || []))
    deps.emitDelete({ ids, deletedIds: result.operation.payload.deletedIds || [] })
    emitChangeIfApplied(result)
    return result
  }

  function copySelection() {
    const graph = deps.getGraph()
    const ids = deps.getSelectedIds()
    const expandedIds = selectedRealNodeIds()
    const payload = { ids, expandedIds }
    const unapplied = (reason) => ({
      applied: false,
      type: 'copy-selection',
      operation: { type: 'copy-selection', payload },
      inverse: null,
      previousGraph: graph,
      nextGraph: graph,
      reason,
    })

    if (expandedIds.length === 0) return unapplied('empty')
    const beforeCopy = deps.getBeforeCopy()
    if (beforeCopy && beforeCopy(payload) === false) return unapplied('blocked')

    const snapshot = captureSubtreeSnapshot(graph, expandedIds)
    setClipboard(snapshot)
    const capturedPayload = { ids, capturedIds: snapshot.nodes.map((node) => node.id) }
    deps.emitCopy(capturedPayload)
    return {
      applied: true,
      type: 'copy-selection',
      operation: { type: 'copy-selection', payload: capturedPayload },
      inverse: null,
      previousGraph: graph,
      nextGraph: graph,
      reason: null,
    }
  }

  function pasteTargetId() {
    const id = deps.getSelectedIds()[0] ?? null
    const layout = deps.getLayout()
    if (!id || !layout) return id
    const groupsById = new Map(layout.groups.map((group) => [group.id, group]))
    const group = groupsById.get(id)
    return group ? group.parentId : id
  }

  function nextPasteId(sourceId, usedIds) {
    let index = 1
    let id = `paste-${sourceId}-${index}`
    while (usedIds.has(id)) {
      index += 1
      id = `paste-${sourceId}-${index}`
    }
    usedIds.add(id)
    return id
  }

  function createPasteIdMap(snapshot) {
    const usedIds = new Set(deps.getGraph().nodes.keys())
    const idMap = {}
    for (const node of snapshot.nodes) idMap[node.id] = nextPasteId(node.id, usedIds)
    return idMap
  }

  function pasteInto(targetParentId = pasteTargetId()) {
    const snapshot = getClipboard() ?? { rootIds: [], nodes: [] }
    const idMap = createPasteIdMap(snapshot)
    const operation = { type: 'paste-nodes', payload: { targetParentId, snapshot, idMap } }
    const result = applyOperation(operation, { before: deps.getBeforePaste() })
    if (!result.applied) return result

    deps.updateLayout()
    deps.emitPaste({
      targetParentId,
      pastedIds: result.operation.payload.pastedIds || [],
      idMap,
    })
    emitChangeIfApplied(result)
    return result
  }

  function paste() {
    return pasteInto()
  }

  function exportGraph() {
    const graph = serializeGraph(deps.getGraph())
    deps.emitExport({ graph })
    return graph
  }

  function importGraph(data) {
    if (deps.getReadonly()) {
      const graph = deps.getGraph()
      return {
        applied: false,
        type: 'replace-graph',
        operation: { type: 'replace-graph', payload: { data } },
        inverse: null,
        previousGraph: graph,
        nextGraph: graph,
        reason: 'readonly',
      }
    }
    const parsed = deserializeGraph(data)
    if (!parsed.valid) {
      const graph = deps.getGraph()
      return {
        applied: false,
        type: 'replace-graph',
        operation: { type: 'replace-graph', payload: { data } },
        inverse: null,
        previousGraph: graph,
        nextGraph: graph,
        reason: parsed.reason,
      }
    }
    const operation = { type: 'replace-graph', payload: { graph: parsed.graph } }
    const result = applyOperation(operation, { before: deps.getBeforeImport() })
    if (!result.applied) return result

    deps.updateLayout({ animate: false })
    deps.setSelected([])
    deps.emitImport({ graph: deps.getGraph() })
    emitChangeIfApplied(result)
    return result
  }

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    deleteSelection,
    copySelection,
    paste,
    pasteInto,
    exportGraph,
    importGraph,
    applyOperation,
    onGraphReplaced,
  }
}
```

> `importGraph` 故意每次都重新调用 `deps.getGraph()` 而不是在函数顶部缓存一个 `graph` 变量——原版 `Minimap.vue` 的 `emit('import', { graph: props.graph })` 读的是 operation 应用**之后**的 `props.graph`（图被就地修改，引用不变但内容变了）。如果在函数顶部缓存 `const graph = deps.getGraph()` 并在成功分支复用它，`emitImport` 拿到的就是修改前的快照引用语义上没问题（同一个对象），但为了跟原版"每次都读 props.graph"的写法保持字面一致、避免以后有人误以为这里需要快照旧值，按上面这样每个分支各自取一次。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-edit-controller.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/edit-controller.js test/minimap-edit-controller.test.js
git commit -m "feat: add edit-controller"
```

---

## Task 3: search-controller.js

**Files:**
- Create: `src/minimap/search-controller.js`
- Create: `test/minimap-search-controller.test.js`

**Interfaces:**
- Consumes：无跨任务依赖（deps 全部 mock）。
- Produces：
  ```js
  createSearchController({
    getGraph,             // () => props.graph
    centerOnNode,          // (id) => void，注入 Vue 本地相机包装函数
    select,                // (ids) => selectionController.select(ids)
    emitSearch,            // (payload) => emit('search', payload)
    onSearchStateChange,   // ({ keyword, matches, currentIndex }) => 写回 Vue 的三个模板绑定 ref
  }) -> {
    search(keyword), searchNext(), searchPrevious(),
  }
  ```

- [ ] **Step 1: 写失败测试**

Create `test/minimap-search-controller.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph.js'
import { createSearchController } from '../src/minimap/search-controller.js'

function createDeps(graph) {
  const centeredIds = []
  const selectedCalls = []
  const emitted = []
  const states = []
  const deps = {
    getGraph: () => graph,
    centerOnNode: (id) => centeredIds.push(id),
    select: (ids) => selectedCalls.push(ids),
    emitSearch: (payload) => emitted.push(payload),
    onSearchStateChange: (state) => states.push(state),
  }
  return { deps, centeredIds, selectedCalls, emitted, states }
}

test('search with matches publishes state, jumps to the first match, and emits the payload', () => {
  const graph = createDemoGraph()
  const { deps, centeredIds, selectedCalls, emitted, states } = createDeps(graph)
  const controller = createSearchController(deps)

  const payload = controller.search('feeder')

  assert.deepEqual(payload.matches, ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.equal(payload.current, 'feeder-1')
  assert.deepEqual(states.at(-1), { keyword: 'feeder', matches: ['feeder-1', 'feeder-2', 'feeder-3'], currentIndex: 0 })
  assert.deepEqual(centeredIds, ['feeder-1'])
  assert.deepEqual(selectedCalls, [['feeder-1']])
  assert.deepEqual(emitted, [payload])
})

test('search with no matches publishes empty state and does not jump', () => {
  const graph = createDemoGraph()
  const { deps, centeredIds, selectedCalls, states } = createDeps(graph)
  const controller = createSearchController(deps)

  const payload = controller.search('does-not-exist')

  assert.deepEqual(payload.matches, [])
  assert.equal(payload.current, null)
  assert.deepEqual(states.at(-1), { keyword: 'does-not-exist', matches: [], currentIndex: -1 })
  assert.deepEqual(centeredIds, [])
  assert.deepEqual(selectedCalls, [])
})

test('searchNext cycles forward through matches and wraps around', () => {
  const graph = createDemoGraph()
  const { deps, centeredIds, emitted } = createDeps(graph)
  const controller = createSearchController(deps)
  controller.search('feeder')

  controller.searchNext()
  controller.searchNext()
  controller.searchNext()

  assert.deepEqual(centeredIds, ['feeder-1', 'feeder-2', 'feeder-3', 'feeder-1'])
  assert.equal(emitted.at(-1).current, 'feeder-1')
})

test('searchPrevious cycles backward through matches and wraps around', () => {
  const graph = createDemoGraph()
  const { deps, centeredIds } = createDeps(graph)
  const controller = createSearchController(deps)
  controller.search('feeder')

  controller.searchPrevious()

  assert.deepEqual(centeredIds, ['feeder-1', 'feeder-3'])
})

test('searchNext and searchPrevious are no-ops when there are no matches', () => {
  const graph = createDemoGraph()
  const { deps, centeredIds, emitted } = createDeps(graph)
  const controller = createSearchController(deps)
  controller.search('does-not-exist')

  controller.searchNext()
  controller.searchPrevious()

  assert.deepEqual(centeredIds, [])
  assert.equal(emitted.length, 1) // only the initial search() emit, no extra emits from next/previous
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-search-controller.test.js`
Expected: 失败，因为 `src/minimap/search-controller.js` 不存在。

- [ ] **Step 3: 实现**

Create `src/minimap/search-controller.js`:

```js
import { searchNodes } from './search.js'

export function createSearchController(deps) {
  let keyword = ''
  let matches = []
  let currentIndex = -1

  function publish() {
    deps.onSearchStateChange({ keyword, matches, currentIndex })
  }

  function jumpTo(id) {
    deps.centerOnNode(id)
    deps.select([id])
  }

  function search(nextKeyword) {
    keyword = nextKeyword
    matches = searchNodes(deps.getGraph(), nextKeyword)
    currentIndex = matches.length > 0 ? 0 : -1
    publish()
    if (matches.length > 0) jumpTo(matches[0])
    const payload = { keyword, matches, current: matches[0] ?? null }
    deps.emitSearch(payload)
    return payload
  }

  function searchNext() {
    if (matches.length === 0) return
    currentIndex = (currentIndex + 1) % matches.length
    const id = matches[currentIndex]
    publish()
    jumpTo(id)
    deps.emitSearch({ keyword, matches, current: id })
  }

  function searchPrevious() {
    if (matches.length === 0) return
    currentIndex = (currentIndex - 1 + matches.length) % matches.length
    const id = matches[currentIndex]
    publish()
    jumpTo(id)
    deps.emitSearch({ keyword, matches, current: id })
  }

  return { search, searchNext, searchPrevious }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-search-controller.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/search-controller.js test/minimap-search-controller.test.js
git commit -m "feat: add search-controller"
```

---

## Task 4: context-menu-controller.js

**Files:**
- Create: `src/minimap/context-menu-controller.js`
- Create: `test/minimap-context-menu-controller.test.js`

**Interfaces:**
- Produces：
  ```js
  createContextMenuController({
    getGraph, getLayout,                                // core
    screenPointFromClient, pointFromClient,              // core
    getCssSize,                                          // core
    setGroupExpanded,                                    // core
    getSelectedIds, setSelected,                         // selection
    getReadonly, getOptions,                              // Vue
    canUndo, canRedo,                                     // edit
    copySelection, deleteSelection, pasteInto, paste,     // edit
    fitToScreen, centerOnSelection, centerOnNode,         // 注入 Vue 本地相机包装函数
    cancelPointerInteractions,                            // 注入 Vue 本地实现
    emitConfigChange,                                     // Vue 既有函数
    emitContextMenuAction,                                // (payload) => emit('context-menu-action', payload)
    getContextMenuItemsProp,                              // () => props.contextMenuItems
    getCanvasEl,                                          // () => 根 controller 自己的 canvasEl 闭包变量（不是 Vue 传的）
    getMenuEl,                                            // () => contextMenuRef.value（菜单自身 DOM，Vue 传）
    onMenuStateChange,                                    // (state | null) => 写回 Vue 的 contextMenuState ref
  }) -> {
    open(event), close(), runItem(item),
  }
  ```
- `canPaste` 不在 deps 里——直接 `import { hasClipboard } from './clipboard.js'`，模块级纯函数判断，不必经过任何 controller 转发。
- `open(event)` 是单参数函数（之前设计文档草稿写的是 `open(event, canvasEl)`，这里改成更准确的形式）：`canvasEl` 通过 `getCanvasEl()` 这个 dep 拿，因为根 controller 挂载/卸载 canvas 监听时本来就持有 `canvasEl` 这个闭包变量（见 Task 5），不需要 Vue 再传一份。`getMenuEl` 不一样——右键菜单自己的 DOM 节点是 Vue 模板渲染出来的（`v-if="contextMenuState"` 才存在），根 controller 不知道它，必须由 Vue 注入。

- [ ] **Step 1: 写失败测试**

Create `test/minimap-context-menu-controller.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv } from './helpers/dom-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'
import { clearClipboard, setClipboard } from '../src/minimap/clipboard.js'
import { createContextMenuController } from '../src/minimap/context-menu-controller.js'

installDomEnv()

function demoLayout() {
  return computeLayout(createDemoGraph(), { viewportWidth: 1200, viewportHeight: 760 })
}

function demoGraph() {
  // 独立调用一次 createDemoGraph()——确定性的同构图，id 跟 demoLayout() 算出来的布局完全对得上，
  // 不需要跟 demoLayout() 共享同一个对象引用（这些测试里 getGraph() 只读节点/children，不做变更）。
  return createDemoGraph()
}

function fakeCanvasEl() {
  const calls = { focus: 0 }
  return { el: { focus: () => { calls.focus += 1 } }, calls }
}

function fakeMenuEl(containsTarget = false) {
  return { contains: () => containsTarget }
}

function createDeps(layout, overrides = {}) {
  const calls = {
    cancelPointerInteractions: 0,
    setGroupExpanded: [],
    fitToScreen: 0,
    centerOnSelection: 0,
    centerOnNode: [],
    copySelection: 0,
    deleteSelection: 0,
    pasteInto: [],
    paste: 0,
    emitConfigChange: [],
    emitContextMenuAction: [],
    states: [],
  }
  let selectedIds = []
  const canvas = fakeCanvasEl()
  const deps = {
    getGraph: () => demoGraph(),
    getLayout: () => layout,
    screenPointFromClient: (x, y) => ({ x, y }),
    pointFromClient: (x, y) => ({ x, y }),
    getCssSize: () => ({ width: 1200, height: 760 }),
    setGroupExpanded: (id, expanded) => calls.setGroupExpanded.push({ id, expanded }),
    getSelectedIds: () => selectedIds,
    setSelected: (ids) => { selectedIds = ids },
    getReadonly: () => false,
    getOptions: () => ({ enableSearch: true, showGrid: true, showPerformance: false, hideTextDuringInteraction: false }),
    canUndo: () => false,
    canRedo: () => false,
    copySelection: () => { calls.copySelection += 1; return { applied: true } },
    deleteSelection: () => { calls.deleteSelection += 1; return { applied: true } },
    pasteInto: (targetId) => { calls.pasteInto.push(targetId); return { applied: true } },
    paste: () => { calls.paste += 1; return { applied: true } },
    fitToScreen: () => { calls.fitToScreen += 1 },
    centerOnSelection: () => { calls.centerOnSelection += 1 },
    centerOnNode: (id) => calls.centerOnNode.push(id),
    cancelPointerInteractions: () => { calls.cancelPointerInteractions += 1 },
    emitConfigChange: (key, value, context) => calls.emitConfigChange.push({ key, value, context }),
    emitContextMenuAction: (payload) => calls.emitContextMenuAction.push(payload),
    getContextMenuItemsProp: () => null,
    getCanvasEl: () => canvas.el,
    getMenuEl: () => fakeMenuEl(false),
    onMenuStateChange: (state) => calls.states.push(state),
    ...overrides,
  }
  return { deps, calls, canvas, setSelectedIds: (ids) => { selectedIds = ids } }
}

function rectCenter(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

test('open on a node builds a node context, focuses the canvas, cancels pointer interactions, and publishes state', () => {
  const layout = demoLayout()
  const { deps, calls, canvas } = createDeps(layout)
  const controller = createContextMenuController(deps)
  const center = rectCenter(layout.nodes.get('feeder-1'))
  const event = { clientX: center.x, clientY: center.y, preventDefault: () => {}, stopPropagation: () => {} }

  controller.open(event)

  assert.equal(canvas.calls.focus, 1)
  assert.equal(calls.cancelPointerInteractions, 1)
  const state = calls.states.at(-1)
  assert.equal(state.context.targetType, 'node')
  assert.equal(state.context.targetId, 'feeder-1')
  assert.ok(state.items.length > 0)
})

test('open on blank canvas builds a canvas context', () => {
  const layout = demoLayout()
  const { deps, calls } = createDeps(layout)
  const controller = createContextMenuController(deps)
  const event = { clientX: -500, clientY: -500, preventDefault: () => {}, stopPropagation: () => {} }

  controller.open(event)

  assert.equal(calls.states.at(-1).context.targetType, 'canvas')
})

test('context.canPaste reflects the module-level clipboard, not an injected dep', () => {
  const layout = demoLayout()
  const { deps, calls } = createDeps(layout)
  const controller = createContextMenuController(deps)
  const event = () => ({ clientX: -500, clientY: -500, preventDefault: () => {}, stopPropagation: () => {} })

  clearClipboard()
  controller.open(event())
  assert.equal(calls.states.at(-1).context.canPaste, false)

  setClipboard({ rootIds: ['solo'], nodes: [{ id: 'solo', label: 'Solo', parentId: null, children: [] }] })
  controller.open(event())
  assert.equal(calls.states.at(-1).context.canPaste, true)

  clearClipboard()
})

test('open on a collapsed group header builds a group context', () => {
  const layout = demoLayout()
  const group = layout.groups[0]
  const { deps, calls } = createDeps(layout)
  const controller = createContextMenuController(deps)
  const event = {
    clientX: group.x + group.width / 2,
    clientY: group.y + 5, // 表头窄条
    preventDefault: () => {},
    stopPropagation: () => {},
  }

  controller.open(event)

  assert.equal(calls.states.at(-1).context.targetType, 'group')
  assert.equal(calls.states.at(-1).context.groupId, group.id)
})

test('close publishes null state and removes the outside-click listener', () => {
  const layout = demoLayout()
  const { deps, calls } = createDeps(layout)
  const controller = createContextMenuController(deps)
  controller.open({ clientX: -500, clientY: -500, preventDefault: () => {}, stopPropagation: () => {} })

  controller.close()

  assert.equal(calls.states.at(-1), null)
})

test('a document pointerdown outside the menu closes it; inside the menu does not', () => {
  const layout = demoLayout()
  const { deps, calls } = createDeps(layout, { getMenuEl: () => fakeMenuEl(false) })
  const controller = createContextMenuController(deps)
  controller.open({ clientX: -500, clientY: -500, preventDefault: () => {}, stopPropagation: () => {} })
  const statesBefore = calls.states.length

  document.dispatchEvent(new Event('pointerdown', { bubbles: true }))

  assert.equal(calls.states.length, statesBefore + 1)
  assert.equal(calls.states.at(-1), null)
})

test('a document pointerdown inside the menu element does not close it', () => {
  const layout = demoLayout()
  const { deps, calls } = createDeps(layout, { getMenuEl: () => fakeMenuEl(true) })
  const controller = createContextMenuController(deps)
  controller.open({ clientX: -500, clientY: -500, preventDefault: () => {}, stopPropagation: () => {} })
  const statesBefore = calls.states.length

  document.dispatchEvent(new Event('pointerdown', { bubbles: true }))

  assert.equal(calls.states.length, statesBefore)
})

test('runItem on a disabled item does nothing', () => {
  const layout = demoLayout()
  const { deps, calls } = createDeps(layout)
  const controller = createContextMenuController(deps)
  controller.open({ clientX: -500, clientY: -500, preventDefault: () => {}, stopPropagation: () => {} })
  const item = { id: 'paste', action: 'paste', disabled: true }

  controller.runItem(item)

  assert.equal(calls.emitContextMenuAction.length, 0)
  assert.notEqual(calls.states.at(-1), null)
})

test('runItem on "fit-to-screen" calls the injected camera wrapper, emits the action, and closes the menu', () => {
  const layout = demoLayout()
  const { deps, calls } = createDeps(layout)
  const controller = createContextMenuController(deps)
  controller.open({ clientX: -500, clientY: -500, preventDefault: () => {}, stopPropagation: () => {} })
  const context = calls.states.at(-1).context
  const item = { id: 'fit-to-screen', action: 'fit-to-screen', disabled: false }

  controller.runItem(item)

  assert.equal(calls.fitToScreen, 1)
  assert.deepEqual(calls.emitContextMenuAction, [{ action: 'fit-to-screen', item, context }])
  assert.equal(calls.states.at(-1), null)
})

test('runItem on "copy" temporarily swaps the selection to the right-clicked target and restores it after', () => {
  const layout = demoLayout()
  const { deps, calls, setSelectedIds } = createDeps(layout)
  setSelectedIds(['cluster-1'])
  const controller = createContextMenuController(deps)
  const center = rectCenter(layout.nodes.get('feeder-1'))
  controller.open({ clientX: center.x, clientY: center.y, preventDefault: () => {}, stopPropagation: () => {} })
  const item = { id: 'copy', action: 'copy', disabled: false }

  controller.runItem(item)

  assert.equal(calls.copySelection, 1)
  assert.deepEqual(deps.getSelectedIds(), ['cluster-1'])
})

test('runItem on "toggle-group" calls setGroupExpanded with the inverted expanded flag', () => {
  const layout = demoLayout()
  const group = layout.groups[0]
  group.expanded = false
  const { deps, calls } = createDeps(layout)
  const controller = createContextMenuController(deps)
  controller.open({ clientX: group.x + group.width / 2, clientY: group.y + 5, preventDefault: () => {}, stopPropagation: () => {} })
  const context = calls.states.at(-1).context
  const item = { id: 'toggle-group', action: 'toggle-group', disabled: false }

  controller.runItem(item)

  assert.deepEqual(calls.setGroupExpanded, [{ id: context.groupId, expanded: true }])
})

test('runItem on "toggle-grid" calls emitConfigChange with the inverted option value', () => {
  const layout = demoLayout()
  const { deps, calls } = createDeps(layout)
  const controller = createContextMenuController(deps)
  controller.open({ clientX: -500, clientY: -500, preventDefault: () => {}, stopPropagation: () => {} })
  const context = calls.states.at(-1).context
  const item = { id: 'toggle-grid', action: 'toggle-grid', disabled: false }

  controller.runItem(item)

  assert.deepEqual(calls.emitConfigChange, [{ key: 'showGrid', value: false, context }])
})

test('contextMenuItems prop override is passed through to mergeContextMenuItems', () => {
  const layout = demoLayout()
  const customItems = [{ id: 'custom-action', label: 'Custom' }]
  const { deps, calls } = createDeps(layout, { getContextMenuItemsProp: () => customItems })
  const controller = createContextMenuController(deps)

  controller.open({ clientX: -500, clientY: -500, preventDefault: () => {}, stopPropagation: () => {} })

  assert.ok(calls.states.at(-1).items.some((item) => item.id === 'custom-action'))
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-context-menu-controller.test.js`
Expected: 失败，因为 `src/minimap/context-menu-controller.js` 不存在。

- [ ] **Step 3: 实现**

Create `src/minimap/context-menu-controller.js`:

```js
import { hitTest } from './interaction.js'
import { hasClipboard } from './clipboard.js'
import { BUILT_IN_CONTEXT_MENU_ACTIONS, buildContextMenuItems, mergeContextMenuItems } from './context-menu.js'

const CONTEXT_MENU_WIDTH = 190
const CONTEXT_MENU_MAX_HEIGHT = 360

export function createContextMenuController(deps) {
  let state = null
  let documentListener = null

  function groupForHit(hit) {
    const layout = deps.getLayout()
    if (!hit || hit.type !== 'group' || !layout) return null
    return layout.groups.find((group) => group.id === hit.id) ?? null
  }

  function contextFromHit(hit, event) {
    const screenPoint = deps.screenPointFromClient(event.clientX, event.clientY)
    const worldPoint = deps.pointFromClient(event.clientX, event.clientY)
    const base = {
      screenPoint,
      worldPoint,
      selectedIds: deps.getSelectedIds(),
      readonly: deps.getReadonly(),
      canPaste: hasClipboard(),
      canUndo: deps.canUndo(),
      canRedo: deps.canRedo(),
      options: deps.getOptions(),
    }
    if (hit?.type === 'node') {
      const node = deps.getGraph().nodes.get(hit.id)
      return { ...base, targetType: 'node', targetId: hit.id, groupId: null, hasToggleableGroup: !!node?.children?.length }
    }
    if (hit?.type === 'group') {
      const group = groupForHit(hit)
      return {
        ...base,
        targetType: 'group',
        targetId: group?.parentId ?? hit.childId ?? null,
        groupId: hit.id,
        hasToggleableGroup: !!group,
      }
    }
    return { ...base, targetType: 'canvas', targetId: null, groupId: null, hasToggleableGroup: false }
  }

  function clampPosition(screenPoint, items) {
    const itemCount = items.filter((item) => item.type !== 'separator').length
    const separatorCount = items.filter((item) => item.type === 'separator').length
    const estimatedHeight = Math.min(CONTEXT_MENU_MAX_HEIGHT, 16 + itemCount * 30 + separatorCount * 8)
    const { width: cssWidth, height: cssHeight } = deps.getCssSize()
    return {
      x: Math.max(8, Math.min(screenPoint.x, cssWidth - CONTEXT_MENU_WIDTH - 8)),
      y: Math.max(8, Math.min(screenPoint.y, cssHeight - estimatedHeight - 8)),
    }
  }

  function publish() {
    deps.onMenuStateChange(state)
  }

  function close() {
    state = null
    publish()
    if (documentListener) {
      document.removeEventListener('pointerdown', documentListener, true)
      documentListener = null
    }
  }

  function open(event) {
    const layout = deps.getLayout()
    if (!layout) return
    event.preventDefault()
    event.stopPropagation()
    close()
    deps.cancelPointerInteractions()
    deps.getCanvasEl()?.focus?.()
    const hit = hitTest(layout, deps.pointFromClient(event.clientX, event.clientY))
    const context = contextFromHit(hit, event)
    const defaults = buildContextMenuItems(context)
    const items = mergeContextMenuItems(context, defaults, deps.getContextMenuItemsProp())
    state = { context, items, position: clampPosition(context.screenPoint, items) }
    publish()
    if (!documentListener) {
      documentListener = (event) => {
        const menuEl = deps.getMenuEl()
        if (menuEl && menuEl.contains(event.target)) return
        close()
      }
      document.addEventListener('pointerdown', documentListener, true)
    }
  }

  function targetIdsForContext(context) {
    if (!context) return []
    const targetId = context.targetType === 'group' ? context.groupId : context.targetId
    if (!targetId) return []
    const selected = deps.getSelectedIds()
    return selected.includes(targetId) ? selected : [targetId]
  }

  function runWithTemporarySelection(ids, command) {
    const previous = deps.getSelectedIds()
    const shouldSwap = ids.length > 0 && !ids.every((id) => previous.includes(id))
    if (shouldSwap) deps.setSelected(ids)
    const result = command()
    if (shouldSwap) deps.setSelected(previous)
    return result
  }

  function executeAction(action, context) {
    if (action === 'copy') return runWithTemporarySelection(targetIdsForContext(context), deps.copySelection)
    if (action === 'delete') return runWithTemporarySelection(targetIdsForContext(context), deps.deleteSelection)
    if (action === 'paste-into-target') return deps.pasteInto(context.targetType === 'group' ? context.targetId : context.targetId)
    if (action === 'paste') return deps.paste()
    if (action === 'fit-to-screen') return deps.fitToScreen()
    if (action === 'center-selection') return deps.centerOnSelection()
    if (action === 'center-target' && context.targetId) return deps.centerOnNode(context.targetId)
    if (action === 'toggle-group' && context.groupId) {
      const group = deps.getLayout()?.groups.find((item) => item.id === context.groupId)
      if (!group) return
      deps.setGroupExpanded(context.groupId, !group.expanded)
      return
    }
    if (action === 'toggle-search') return deps.emitConfigChange('enableSearch', !deps.getOptions().enableSearch, context)
    if (action === 'toggle-grid') return deps.emitConfigChange('showGrid', !deps.getOptions().showGrid, context)
    if (action === 'toggle-performance') return deps.emitConfigChange('showPerformance', !deps.getOptions().showPerformance, context)
    if (action === 'toggle-hide-text-during-interaction') {
      return deps.emitConfigChange('hideTextDuringInteraction', !deps.getOptions().hideTextDuringInteraction, context)
    }
    if (action === 'toggle-readonly') return deps.emitConfigChange('readonly', !deps.getReadonly(), context)
  }

  function runItem(item) {
    if (!state || item.disabled) return
    const context = state.context
    deps.emitContextMenuAction({ action: item.action, item, context })
    if (BUILT_IN_CONTEXT_MENU_ACTIONS.has(item.action)) executeAction(item.action, context)
    close()
  }

  return { open, close, runItem }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-context-menu-controller.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/context-menu-controller.js test/minimap-context-menu-controller.test.js
git commit -m "feat: add context-menu-controller"
```

---

## Task 5: 把四个新 controller 接进根 `minimap-controller.js`

**Files:**
- Modify: `src/minimap/minimap-controller.js`
- Modify: `test/minimap-root-controller.test.js`

**Interfaces:**
- Consumes：Task 1-4 的四个 `createXxxController`。
- Produces（追加到根 controller 现有返回对象上）：`getSelectedIds`、`setSelected`、`select`、`clearSelection`、`undo`、`redo`、`canUndo`、`canRedo`、`deleteSelection`、`copySelection`、`paste`、`exportGraph`、`importGraph`、`onGraphReplaced`、`applyOperation`、`search`、`searchNext`、`searchPrevious`、`closeContextMenu`、`runContextMenuItem`。
- **不**追加 `pasteInto`/`openContextMenu`——`pasteInto` 现在只被 context-menu-controller 内部调用（原来 Vue 的 `executeContextMenuAction` 整个搬进了 context-menu-controller，Vue 自己不再需要单独调 `pasteInto`）；`openContextMenu` 现在只通过 canvas 的 `contextmenu` DOM 事件触发，不再是一个独立可调用的方法。
- `applyOperation` **要**追加，而且这一切片就要用：原来 Vue 本地的 `operationManager`/`graphOperations()` 单例整个搬进了 edit-controller，但 `Minimap.vue` 里拖拽换位/跨父级移动/资源拖入（`handlePointerUp`/`handleDrop`，切片 3 才迁移）目前还是直接调 `graphOperations().apply(...)`——这一切片要把这些调用点改成 `controller.applyOperation(operation, { before })`，所以必须先把它转发出来。配套地，Vue 本地的 `emitChange(result)` 函数本切片**不删**（Task 6 详述），因为 `applyOperation` 本身不自动 emit `change`，拖拽的这几个调用点还要自己触发。

**`createMinimapController(deps)` 的 `deps` 形状变化**（相对切片 1 结束时的样子）：

- 删除：`getSelectedIds`（核心 core 用的这个字段，以前由 Vue 的 `currentSelectedIds` 占位，现在改接 `selection.getSelectedIds`，Vue 不用再传）；`onContextMenu`（`contextmenu` 事件不再经过 `deps` 转发，根 controller 直接调 `contextMenu.open`）。
- 新增：`getSelectedIdsProp`（`() => props.selectedIds`，给 selection-controller 用，跟旧的 `getSelectedIds` 不是一回事——这个是受控判断用的原始 prop，不是"当前选中态"取值器）、`emitSelect`、`getReadonly`、`getBeforeDelete`/`getBeforeCopy`/`getBeforeImport`/`getBeforePaste`、`emitDelete`/`emitCopy`/`emitPaste`/`emitImport`/`emitExport`/`emitChange`、`centerOnNode`/`fitToScreen`/`centerOnSelection`（Vue 本地相机包装函数——注意这三个名字跟根 controller **返回对象**里同名的 `fitToScreen`/`centerOnNode`/`centerOnSelection` 不是一回事：返回对象里的那三个继续直接转发 `core.fitToScreen` 等，给 Vue 本地相机包装函数自己调用；`deps` 里的这三个是 Vue 那三个包装函数本身，给 search/context-menu controller 当依赖用，两边只是恰好同名，分别活在 `deps` 和 root 返回对象两个不同的命名空间里，不会互相覆盖）、`emitSearch`/`onSearchStateChange`、`cancelPointerInteractions`、`emitConfigChange`/`emitContextMenuAction`/`getContextMenuItemsProp`/`getMenuEl`/`onMenuStateChange`。

- [ ] **Step 1: 写失败测试**

Modify `test/minimap-root-controller.test.js`：把 `createDeps()` 的默认值改成新形状，删掉 `'contextmenu'` 这一项从 `POINTER_EVENTS` 表（它不再经过 `deps` 转发），新增几个测试覆盖新转发方法和 `contextmenu` 事件改走 `contextMenu.open` 之后的行为。完整替换后的文件：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver, stubAnimationFrame } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { createMinimapController } from '../src/minimap/minimap-controller.js'
import { defaultTheme } from '../src/minimap/theme.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()
stubAnimationFrame()

function createElements() {
  const canvas = document.createElement('canvas')
  const container = document.createElement('div')
  container.appendChild(canvas)
  return { canvas, container }
}

function createDeps(overrides = {}) {
  // 缓存单个 graph 实例并始终返回同一个引用——跟真实 Vue 用法里 props.graph 是同一个稳定
  // 引用的语义一致。如果这里改成每次调用都 new 一个 createDemoGraph()，core/edit/search/
  // contextMenu 几个 controller 各自拿到的 getGraph() 就会是不同的对象实例：edit-controller
  // 内部 graph-operations.js 的撤销栈是在 edit 构造时绑定的某一个实例上做就地修改，
  // 如果 core 的 layout 是从另一个实例算出来的，两边会静默失配。
  const graph = createDemoGraph()
  return {
    getGraph: () => graph,
    getLayoutDirection: () => 'horizontal',
    getOptions: () => ({}),
    getTheme: () => defaultTheme,
    getRenderers: () => ({}),
    getViewportProp: () => null,
    getGroupStatesProp: () => null,
    getSelectedIdsProp: () => null,
    emitSelect: () => {},
    getReadonly: () => false,
    getBeforeDelete: () => null,
    getBeforeCopy: () => null,
    getBeforeImport: () => null,
    getBeforePaste: () => null,
    emitDelete: () => {},
    emitCopy: () => {},
    emitPaste: () => {},
    emitImport: () => {},
    emitExport: () => {},
    emitChange: () => {},
    centerOnNode: () => {},
    fitToScreen: () => {},
    centerOnSelection: () => {},
    emitSearch: () => {},
    onSearchStateChange: () => {},
    cancelPointerInteractions: () => {},
    emitConfigChange: () => {},
    emitContextMenuAction: () => {},
    getContextMenuItemsProp: () => null,
    getMenuEl: () => null,
    onMenuStateChange: () => {},
    getInteractionRenderState: () => ({
      dragging: false,
      interacting: false,
      groupDrag: null,
      selectionRect: null,
      groupScrollbarHoverId: null,
      attachPreview: null,
    }),
    emitViewportChange: () => {},
    emitGroupStateChange: () => {},
    onRenderStats: () => {},
    onOverviewRender: () => {},
    onPointerDown: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
    onPointerLeave: () => {},
    onPointerCancel: () => {},
    onLostPointerCapture: () => {},
    onKeyDown: () => {},
    onWheel: () => {},
    onDragOver: () => {},
    onDrop: () => {},
    ...overrides,
  }
}

const POINTER_EVENTS = [
  ['pointerdown', 'onPointerDown'],
  ['pointermove', 'onPointerMove'],
  ['pointerup', 'onPointerUp'],
  ['pointerleave', 'onPointerLeave'],
  ['pointercancel', 'onPointerCancel'],
  ['lostpointercapture', 'onLostPointerCapture'],
  ['keydown', 'onKeyDown'],
  ['wheel', 'onWheel'],
  ['dragover', 'onDragOver'],
  ['drop', 'onDrop'],
]

test('mount attaches every canvas DOM listener and forwards events to the injected handlers', () => {
  const received = {}
  const overrides = {}
  for (const [, depName] of POINTER_EVENTS) {
    overrides[depName] = (event) => {
      received[depName] = event
    }
  }
  const controller = createMinimapController(createDeps(overrides))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  for (const [eventName, depName] of POINTER_EVENTS) {
    const EventCtor = eventName === 'wheel' ? MouseEvent : Event
    canvas.dispatchEvent(new EventCtor(eventName, { bubbles: true, cancelable: true }))
    assert.ok(received[depName], `expected ${depName} to be called for ${eventName}`)
  }

  controller.destroy()
})

test('destroy removes every canvas DOM listener', () => {
  let calls = 0
  const controller = createMinimapController(createDeps({ onPointerDown: () => { calls += 1 } }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.destroy()

  canvas.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
  assert.equal(calls, 0)
})

test('camera and layout methods forward to the underlying core-controller', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  assert.deepEqual(controller.getViewport(), { x: 0, y: 0, scale: 1 })
  assert.ok(controller.getLayout())
  controller.applyViewport({ x: 1, y: 1, scale: 1 }, { render: false })
  assert.deepEqual(controller.getViewport(), { x: 1, y: 1, scale: 1 })

  controller.destroy()
})

test('selection methods forward to the real selection-controller and core renders use it', () => {
  const selected = []
  const controller = createMinimapController(createDeps({ emitSelect: (ids) => selected.push(ids) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  controller.setSelected(['feeder-1'])

  assert.deepEqual(controller.getSelectedIds(), ['feeder-1'])
  assert.deepEqual(selected, [['feeder-1']])

  controller.destroy()
})

test('edit methods forward to the real edit-controller sharing the same selection-controller', () => {
  const deleted = []
  const controller = createMinimapController(createDeps({ emitDelete: (p) => deleted.push(p) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.setSelected(['feeder-1'])

  const result = controller.deleteSelection()

  assert.equal(result.applied, true)
  assert.equal(deleted.length, 1)
  assert.equal(controller.canUndo(), true)

  controller.undo()
  assert.equal(controller.canUndo(), false)

  controller.destroy()
})

test('onGraphReplaced resets the edit-controller history', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)
  controller.setSelected(['feeder-1'])
  controller.deleteSelection()
  assert.equal(controller.canUndo(), true)

  controller.onGraphReplaced()

  assert.equal(controller.canUndo(), false)

  controller.destroy()
})

test('applyOperation forwards to the real edit-controller, sharing its undo history with the named edit methods', () => {
  const controller = createMinimapController(createDeps())
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  const result = controller.applyOperation({
    type: 'reorder-group-child',
    payload: { groupId: null, parentId: 'grid-tie', childId: 'feeder-1', index: 1 },
  })

  assert.equal(result.applied, true)
  assert.equal(controller.canUndo(), true)
  controller.undo()
  assert.equal(controller.canUndo(), false)

  controller.destroy()
})

test('search methods forward to the real search-controller and jump using the injected camera wrapper', () => {
  const centered = []
  const controller = createMinimapController(createDeps({ centerOnNode: (id) => centered.push(id) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  const payload = controller.search('feeder')

  assert.deepEqual(payload.matches, ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.deepEqual(centered, ['feeder-1'])
  assert.deepEqual(controller.getSelectedIds(), ['feeder-1'])

  controller.destroy()
})

test('the canvas contextmenu DOM event dispatches directly to the context-menu-controller, not through deps', () => {
  const menuStates = []
  const controller = createMinimapController(createDeps({ onMenuStateChange: (state) => menuStates.push(state) }))
  const { canvas, container } = createElements()
  controller.mount(canvas, container)

  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: -500, clientY: -500 })
  canvas.dispatchEvent(event)

  assert.ok(menuStates.at(-1))
  assert.equal(menuStates.at(-1).context.targetType, 'canvas')

  controller.runContextMenuItem({ id: 'fit-to-screen', action: 'fit-to-screen', disabled: false })
  assert.equal(menuStates.at(-1), null)

  controller.destroy()
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- test/minimap-root-controller.test.js`
Expected: 新增的几个测试失败（`controller.setSelected`/`getSelectedIds`/`undo`/`canUndo`/`deleteSelection`/`search`/`runContextMenuItem`/`onGraphReplaced` 都还不存在）；已有的三个测试应该继续通过（如果 `'contextmenu'` 还留在 `POINTER_EVENTS` 里会失败，确认改完表之后这三个测试不受影响）。

- [ ] **Step 3: 实现**

Replace `src/minimap/minimap-controller.js` in full:

```js
import { createCoreController } from './core-controller.js'
import { createSelectionController } from './selection-controller.js'
import { createEditController } from './edit-controller.js'
import { createSearchController } from './search-controller.js'
import { createContextMenuController } from './context-menu-controller.js'

const POINTER_EVENT_BINDINGS = [
  ['pointerdown', 'onPointerDown'],
  ['pointermove', 'onPointerMove'],
  ['pointerup', 'onPointerUp'],
  ['pointerleave', 'onPointerLeave'],
  ['pointercancel', 'onPointerCancel'],
  ['lostpointercapture', 'onLostPointerCapture'],
  ['keydown', 'onKeyDown'],
  ['dragover', 'onDragOver'],
  ['drop', 'onDrop'],
]

export function createMinimapController(deps) {
  // selection 的 renderCurrent 依赖通过闭包延迟引用 core——此时 core 还没创建，
  // 但 renderCurrent 这个箭头函数只在 selection.setSelected() 真正被调用时才执行
  // （那一定发生在 createMinimapController() 整个跑完、core 已经赋值之后），
  // 所以这里直接引用下面才声明的 `core` 变量是安全的，不会触发 TDZ 报错。
  const selection = createSelectionController({
    getSelectedIdsProp: deps.getSelectedIdsProp,
    emitSelect: deps.emitSelect,
    renderCurrent: () => core.renderCurrent(),
  })

  const core = createCoreController({
    ...deps,
    getSelectedIds: selection.getSelectedIds,
  })

  const edit = createEditController({
    getGraph: deps.getGraph,
    getLayout: core.getLayout,
    getSelectedIds: selection.getSelectedIds,
    setSelected: selection.setSelected,
    getReadonly: deps.getReadonly,
    updateLayout: core.updateLayout,
    getBeforeDelete: deps.getBeforeDelete,
    getBeforeCopy: deps.getBeforeCopy,
    getBeforeImport: deps.getBeforeImport,
    getBeforePaste: deps.getBeforePaste,
    emitDelete: deps.emitDelete,
    emitCopy: deps.emitCopy,
    emitPaste: deps.emitPaste,
    emitImport: deps.emitImport,
    emitExport: deps.emitExport,
    emitChange: deps.emitChange,
  })

  const search = createSearchController({
    getGraph: deps.getGraph,
    centerOnNode: deps.centerOnNode,
    select: selection.select,
    emitSearch: deps.emitSearch,
    onSearchStateChange: deps.onSearchStateChange,
  })

  let canvasEl = null

  const contextMenu = createContextMenuController({
    getGraph: deps.getGraph,
    getLayout: core.getLayout,
    screenPointFromClient: core.screenPointFromClient,
    pointFromClient: core.pointFromClient,
    getCssSize: core.getCssSize,
    setGroupExpanded: core.setGroupExpanded,
    getSelectedIds: selection.getSelectedIds,
    setSelected: selection.setSelected,
    getReadonly: deps.getReadonly,
    getOptions: deps.getOptions,
    canUndo: edit.canUndo,
    canRedo: edit.canRedo,
    copySelection: edit.copySelection,
    deleteSelection: edit.deleteSelection,
    pasteInto: edit.pasteInto,
    paste: edit.paste,
    fitToScreen: deps.fitToScreen,
    centerOnSelection: deps.centerOnSelection,
    centerOnNode: deps.centerOnNode,
    cancelPointerInteractions: deps.cancelPointerInteractions,
    emitConfigChange: deps.emitConfigChange,
    emitContextMenuAction: deps.emitContextMenuAction,
    getContextMenuItemsProp: deps.getContextMenuItemsProp,
    getCanvasEl: () => canvasEl,
    getMenuEl: deps.getMenuEl,
    onMenuStateChange: deps.onMenuStateChange,
  })

  const listeners = []

  function addListener(eventName, handler, options) {
    listeners.push({ eventName, handler, options })
  }

  function handleWheel(event) {
    deps.onWheel(event)
  }

  function handleContextMenu(event) {
    contextMenu.open(event)
  }

  function mount(canvas, container) {
    canvasEl = canvas
    core.mount(canvas, container)
    if (!canvasEl) return

    for (const [eventName, depName] of POINTER_EVENT_BINDINGS) {
      const handler = (event) => deps[depName](event)
      addListener(eventName, handler)
      canvasEl.addEventListener(eventName, handler)
    }
    addListener('wheel', handleWheel, { passive: false })
    canvasEl.addEventListener('wheel', handleWheel, { passive: false })
    addListener('contextmenu', handleContextMenu)
    canvasEl.addEventListener('contextmenu', handleContextMenu)
  }

  function destroy() {
    if (canvasEl) {
      for (const { eventName, handler, options } of listeners) {
        canvasEl.removeEventListener(eventName, handler, options)
      }
    }
    listeners.length = 0
    canvasEl = null
    core.destroy()
  }

  return {
    mount,
    destroy,
    getCssSize: core.getCssSize,
    screenPointFromClient: core.screenPointFromClient,
    pointFromClient: core.pointFromClient,
    getLayout: core.getLayout,
    updateLayout: core.updateLayout,
    scrollGroup: core.scrollGroup,
    setGroupExpanded: core.setGroupExpanded,
    resolveTargetRect: core.resolveTargetRect,
    resolveCenterTarget: core.resolveCenterTarget,
    getViewport: core.getViewport,
    applyViewport: core.applyViewport,
    zoomAt: core.zoomAt,
    panBy: core.panBy,
    fitToScreen: core.fitToScreen,
    centerOnNode: core.centerOnNode,
    centerOnSelection: core.centerOnSelection,
    zoomTo: core.zoomTo,
    setViewport: core.setViewport,
    cancelViewportTween: core.cancelViewportTween,
    settleAnimation: core.settleAnimation,
    cancelAnimation: core.cancelAnimation,
    renderCurrent: core.renderCurrent,
    scheduleRender: core.scheduleRender,
    flushScheduledRender: core.flushScheduledRender,
    cancelScheduledRender: core.cancelScheduledRender,
    getSelectedIds: selection.getSelectedIds,
    setSelected: selection.setSelected,
    select: selection.select,
    clearSelection: selection.clearSelection,
    undo: edit.undo,
    redo: edit.redo,
    canUndo: edit.canUndo,
    canRedo: edit.canRedo,
    deleteSelection: edit.deleteSelection,
    copySelection: edit.copySelection,
    paste: edit.paste,
    exportGraph: edit.exportGraph,
    importGraph: edit.importGraph,
    onGraphReplaced: edit.onGraphReplaced,
    applyOperation: edit.applyOperation,
    search: search.search,
    searchNext: search.searchNext,
    searchPrevious: search.searchPrevious,
    closeContextMenu: contextMenu.close,
    runContextMenuItem: contextMenu.runItem,
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- test/minimap-root-controller.test.js`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/minimap/minimap-controller.js test/minimap-root-controller.test.js
git commit -m "feat: wire selection/edit/search/context-menu controllers into the root controller"
```

---

## Task 6: `Minimap.vue` 接入四个新 controller，删除已迁出的本地实现

**Files:**
- Modify: `src/minimap/Minimap.vue`

**Interfaces:**
- Consumes：Task 5 的根 `createMinimapController`。
- 不新增测试文件，靠现有全部测试回归（同切片 1 Task 4 的验证方式）。

- [ ] **Step 1: 确认基线——现有全部测试先跑一遍**

Run: `npm test`
Expected: 全部通过（记录当前测试数量，Task 结束后再跑一遍对比）。

- [ ] **Step 2: 精简 import**

删除：

```js
import {
  applySelectionClick,
  applySelectionSet,
  idsInSelectionRect,
  normalizeRect,
} from './selection.js'
```

改成（`applySelectionSet` 迁进了 selection-controller 内部用，不用再在 Vue 里导入；`applySelectionClick`/`idsInSelectionRect`/`normalizeRect` 都还留着——`applySelectionClick` 给拖拽点击分支用，`idsInSelectionRect` 给框选释放用，`normalizeRect` 给 `interactionRenderState()` 的 `marqueeState` 分支用，这三个都不属于本切片范围）：

```js
import { applySelectionClick, idsInSelectionRect, normalizeRect } from './selection.js'
```

删除：

```js
import { createGraphOperationManager, captureSubtreeSnapshot } from './graph-operations.js'
import { deserializeGraph, serializeGraph } from './graph-serialization.js'
```

（两个都整个迁进 edit-controller，`Minimap.vue` 不再直接用。）

删除：

```js
import {
  BUILT_IN_CONTEXT_MENU_ACTIONS,
  buildContextMenuItems,
  mergeContextMenuItems,
} from './context-menu.js'
import { getClipboard, hasClipboard, setClipboard } from './clipboard.js'
```

（整个迁进 context-menu-controller/edit-controller。）

删除：

```js
import { searchNodes } from './search.js'
```

（迁进 search-controller。）

- [ ] **Step 3: 删除已迁出的本地状态和函数**

删除状态声明：`internalSelectedIds`、`operationManager`、`contextMenuDocumentListener`、`CONTEXT_MENU_WIDTH`、`CONTEXT_MENU_MAX_HEIGHT`。

保留状态声明（模板还要绑定，或者拖拽/资源拖放还要用）：`searchKeyword`/`searchMatches`/`searchCurrentIndex`/`contextMenuRef`/`contextMenuState`（赋值方式变了，见下）、`dragState`/`scrollbarDragState`/`panState`/`marqueeState`/`hoveredScrollbarGroupId`（切片 3 范围，不动）。

删除整段函数：`currentSelectedIds`、`setSelected`、`select`、`clearSelection`、`graphOperations`、`undo`、`redo`、`canUndo`、`canRedo`、`selectedRealNodeIds`、`selectionAfterDeleting`、`deleteSelection`、`copySelection`、`pasteTargetId`、`nextPasteId`、`createPasteIdMap`、`pasteInto`、`paste`、`exportGraph`、`importGraph`、`jumpToSearchResult`、`search`、`searchNext`、`searchPrevious`、`clampContextMenuPosition`、`closeContextMenu`、`handleContextMenuDocumentPointerDown`、`canPaste`、`groupForHit`、`contextFromHit`、`openContextMenu`、`targetIdsForContext`、`runWithTemporarySelection`、`executeContextMenuAction`、`runContextMenuItem`。

**保留 `emitChange`（不删）**：

```js
function emitChange(result) {
  if (!result.applied) return
  emit('change', {
    type: result.type,
    operation: result.operation,
    previousGraph: result.previousGraph,
    nextGraph: result.nextGraph,
    reason: result.reason,
  })
}
```

原因：`operationManager`/`graphOperations()` 整个迁进了 edit-controller 之后，`Minimap.vue` 里还没迁移的拖拽换位/跨父级移动（`handlePointerUp`）和资源拖入（`handleDrop`）——这些是切片 3 的范围，本切片不动它们的业务逻辑——现在要改成调用 `controller.applyOperation(operation, { before })`（edit-controller 暴露出来的方法，内部自动处理 `readonly`）。但 `applyOperation` 本身不会自动 emit `change`（只有 edit-controller 自己的 `undo`/`redo`/`deleteSelection`/`pasteInto`/`importGraph` 内部才会调它们自己那份 `emitChangeIfApplied`），所以这三处拖拽相关的调用点还要自己调 `emitChange(result)`，因此这个本地函数本切片保留，等切片 3 把拖拽状态机整个迁进 `drag-controller` 时再一起删掉。

**保留 `cancelPointerInteractions`、`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`（不删，函数体不变）**——它们现在除了 `defineExpose` 自己用，还要作为 deps 注入 search-controller 和 context-menu-controller（见 Step 4）。

- [ ] **Step 4: 给 `createInteractionController()` 的 deps 加上四个新 controller 需要的字段**

在 `createInteractionController()` 函数里，删除这一行（`getSelectedIds` 这个 core 专用字段不用 Vue 传了，根 controller 内部直接接 `selection.getSelectedIds`）：

```js
    getSelectedIds: () => currentSelectedIds(),
```

删除这一行（`contextmenu` 不再经过 `deps` 转发）：

```js
    onContextMenu: openContextMenu,
```

在 `getInteractionRenderState: () => interactionRenderState(),` 之后插入：

```js
    getSelectedIdsProp: () => props.selectedIds,
    emitSelect: (ids) => emit('select', ids),
    getReadonly: () => effectiveReadonly.value,
    getBeforeDelete: () => props.beforeDelete,
    getBeforeCopy: () => props.beforeCopy,
    getBeforeImport: () => props.beforeImport,
    getBeforePaste: () => props.beforePaste,
    emitDelete: (payload) => emit('delete', payload),
    emitCopy: (payload) => emit('copy', payload),
    emitPaste: (payload) => emit('paste', payload),
    emitImport: (payload) => emit('import', payload),
    emitExport: (payload) => emit('export', payload),
    emitChange: (payload) => emit('change', payload),
    centerOnNode: (id) => centerOnNode(id),
    fitToScreen: () => fitToScreen(),
    centerOnSelection: () => centerOnSelection(),
    emitSearch: (payload) => emit('search', payload),
    onSearchStateChange: ({ keyword, matches, currentIndex }) => {
      searchKeyword.value = keyword
      searchMatches.value = matches
      searchCurrentIndex.value = currentIndex
    },
    cancelPointerInteractions: () => cancelPointerInteractions(),
    emitConfigChange,
    emitContextMenuAction: (payload) => emit('context-menu-action', payload),
    getContextMenuItemsProp: () => props.contextMenuItems,
    getMenuEl: () => contextMenuRef.value,
    onMenuStateChange: (state) => { contextMenuState.value = state },
```

> 这一段 deps 里的 `emitChange: (payload) => emit('change', payload)` 是给 edit-controller 自己用的（它内部 `emitChangeIfApplied` 调用这个），跟 Step 3 里保留在 Vue 本地的 `emitChange(result)` 函数是两个不同的东西——本地那个是给拖拽/资源拖放的调用点用的薄包装，自己算好 payload 形状再 emit；这里传给 controller 的是裸的 `emit` 转发，edit-controller 自己组装 payload。两边凑巧都叫 `emitChange` 但不是同一个函数，不会互相覆盖（一个是 `deps.emitChange`，一个是 Vue 脚本顶层的 `emitChange` 函数）。

- [ ] **Step 5: 改写拖拽相关调用点，引用新 controller**

`handlePointerDown` 顶部 `closeContextMenu()` 改成 `controller.closeContextMenu()`。

`handlePointerDown` 里 `setSelected([])`（空白点击清空选中，紧跟在 marquee 分支之后）改成 `controller.setSelected([])`。

`handlePointerDown` 函数最后一行 `setSelected(applySelectionClick(currentSelectedIds(), hit.id, { additive: isAdditiveSelection(event) }))` 改成：

```js
controller.setSelected(applySelectionClick(controller.getSelectedIds(), hit.id, { additive: isAdditiveSelection(event) }))
```

`handlePointerUp` 里 marquee 释放分支的 `setSelected(ids)` 改成 `controller.setSelected(ids)`。

`handlePointerUp` 里非拖拽点击释放分支的 `setSelected(applySelectionClick(currentSelectedIds(), dragState.nodeId, { additive: dragState.additive }))` 改成：

```js
controller.setSelected(applySelectionClick(controller.getSelectedIds(), dragState.nodeId, { additive: dragState.additive }))
```

`handlePointerUp` 拖拽落地分支里两处 `graphOperations().apply(operation, { readonly: effectiveReadonly.value, before: props.beforeGroupReorder })` / `{ readonly: effectiveReadonly.value, before: props.beforeNodeMove }` 改成：

```js
const result = controller.applyOperation(operation, { before: props.beforeGroupReorder })
```

```js
const result = controller.applyOperation(operation, { before: props.beforeNodeMove })
```

（去掉 `readonly: effectiveReadonly.value`——`applyOperation` 内部自己取 `getReadonly()`。）

`handleWheel` 顶部 `closeContextMenu()` 改成 `controller.closeContextMenu()`。

`handleKeyDown`：

```js
function handleKeyDown(event) {
  if (event.key === 'Escape') {
    if (contextMenuState.value) {
      event.preventDefault()
      controller.closeContextMenu()
      return
    }
    if (controller.getSelectedIds().length === 0) return
    event.preventDefault()
    controller.setSelected([])
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    controller.deleteSelection()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    controller.copySelection()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
    event.preventDefault()
    controller.paste()
  }
}
```

`resolveResourceDropTarget` 里 `const selected = currentSelectedIds()` 改成 `const selected = controller.getSelectedIds()`。

`handleDrop` 里 `graphOperations().apply(operation, { readonly: effectiveReadonly.value, before: props.beforeNodeDrop })` 改成 `controller.applyOperation(operation, { before: props.beforeNodeDrop })`（`emit('node-drop', ...)`/`emitChange(result)` 两行不变，还是调本地 `emitChange`）。

- [ ] **Step 6: `defineExpose`**

```js
defineExpose({
  fitToScreen: () => fitToScreen(),
  centerOnNode: (id) => centerOnNode(id),
  centerOnSelection: () => centerOnSelection(),
  zoomTo: (scale, center) => zoomTo(scale, center),
  setViewport: (viewport) => controller.setViewport(viewport),
  getViewport: () => controller.getViewport(),
  select: (ids, mode) => controller.select(ids, mode),
  clearSelection: () => controller.clearSelection(),
  search: (keyword) => controller.search(keyword),
  searchNext: () => controller.searchNext(),
  searchPrevious: () => controller.searchPrevious(),
  undo: () => controller.undo(),
  redo: () => controller.redo(),
  canUndo: () => controller.canUndo(),
  canRedo: () => controller.canRedo(),
  deleteSelection: () => controller.deleteSelection(),
  copySelection: () => controller.copySelection(),
  paste: () => controller.paste(),
  exportGraph: () => controller.exportGraph(),
  importGraph: (data) => controller.importGraph(data),
})
```

- [ ] **Step 7: watcher**

```js
watch(
  () => props.graph,
  () => {
    controller.closeContextMenu()
    controller.onGraphReplaced()
    controller.updateLayout()
  },
)
```

```js
watch(() => props.options, () => {
  syncConfigFromProps()
  controller.closeContextMenu()
  controller.updateLayout()
})
```

```js
watch(() => props.contextMenuItems, () => controller.closeContextMenu())
```

其余 watcher（`layoutDirection`/`selectedIds`/`groupStates`/`viewport`/`readonly`）不变。

- [ ] **Step 8: 改模板里引用已删除本地函数的地方**

工具栏按钮（`@click="undo"` 等 5 处）改成调用 `controller`：

```html
<button class="minimap-toolbar-button" type="button" aria-label="撤销" @click="controller.undo">↶</button>
<button class="minimap-toolbar-button" type="button" aria-label="重做" @click="controller.redo">↷</button>
```

```html
<button class="minimap-toolbar-button" type="button" aria-label="复制" @click="controller.copySelection">⌘</button>
<button class="minimap-toolbar-button" type="button" aria-label="粘贴" @click="controller.paste">⎘</button>
<button class="minimap-toolbar-button" type="button" aria-label="删除" @click="controller.deleteSelection">⌫</button>
```

搜索框（`@input`/`@keydown.enter`/两个按钮）：

```html
<input
  :value="searchKeyword"
  class="minimap-search-input"
  placeholder="搜索节点..."
  @input="controller.search($event.target.value)"
  @keydown.enter="controller.searchNext"
/>
<span class="minimap-search-count">{{ searchMatches.length ? `${searchCurrentIndex + 1}/${searchMatches.length}` : '0/0' }}</span>
<button
  class="minimap-search-btn minimap-search-prev"
  :disabled="searchMatches.length === 0"
  @click="controller.searchPrevious"
>
  ‹
</button>
<button
  class="minimap-search-btn minimap-search-next"
  :disabled="searchMatches.length === 0"
  @click="controller.searchNext"
>
  ›
</button>
```

右键菜单条目：

```html
<button
  v-else
  class="minimap-context-menu-item"
  :class="{ 'is-danger': item.danger, 'is-checked': item.checked }"
  type="button"
  role="menuitem"
  :data-menu-id="item.id"
  :aria-disabled="item.disabled ? 'true' : 'false'"
  :disabled="item.disabled"
  @click="controller.runContextMenuItem(item)"
>
```

> `controller` 在 `onMounted` 之前是 `null`，模板初次渲染时这些 `@click`/`@input` 表达式不会立刻执行（只在用户真正交互时才调用），实际触发时 `controller` 早已被 `onMounted` 赋值，跟切片 1 `defineExpose` 里已经在用的同一种安全性一样，不是新风险。

- [ ] **Step 9: 运行完整测试套件**

Run: `npm test`
Expected: 全部通过，且测试总数跟 Step 1 记录的基线一致（这一切片在 `Minimap.vue` 之外新增了四个 controller 文件的测试，但既有 Vue 集成测试数量不变）。

- [ ] **Step 10: 跑 build**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 11: Commit**

```bash
git add src/minimap/Minimap.vue
git commit -m "refactor: wire Minimap.vue to selection/edit/search/context-menu controllers"
```

---

## Task 7: 全量验证与 ROADMAP 收尾

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: 跑全量测试**

Run: `npm test`
Expected: 全部通过。

- [ ] **Step 2: 跑 build**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 3: 手动验收（开发服务器）**

Run: `npm run dev`，在浏览器打开示例图，依次验证：

- 右键点击节点/分组/空白画布，弹出对应菜单，菜单项跟 readonly/选中态/撤销重做状态联动正确。
- 点击"撤销"/"重做"工具栏按钮，点击"复制"/"粘贴"/"删除"工具栏按钮，行为正确。
- 键盘快捷键：`Delete`/`Backspace` 删除选中、`Cmd/Ctrl+C` 复制、`Cmd/Ctrl+V` 粘贴、`Escape` 先关右键菜单再清空选中。
- 搜索框输入关键字、按 Enter、点击上一个/下一个，跳转和高亮正确，且会自动展开/滚动到分组里的子节点。
- 拖拽节点跨父级移动、分组内换位，行为跟切片前一致（这两个操作本切片改成走 `controller.applyOperation`，需要确认没有退化）。
- 资源树拖入新节点，行为跟切片前一致。

- [ ] **Step 4: 更新 ROADMAP.md**

把 `ROADMAP.md` 里：

```md
  - [ ] 切片 2：selection-controller + edit-controller + search-controller + context-menu-controller（受控选中态/撤销重做剪贴板/搜索/右键菜单，四个文件一起做）
```

改成：

```md
  - [x] 切片 2：selection-controller + edit-controller + search-controller + context-menu-controller（受控选中态/撤销重做剪贴板/搜索/右键菜单，四个文件一起做；`edit-controller` 拥有 `operationManager` 单例并暴露 `applyOperation`/供切片 3 drag-controller 复用同一条撤销栈，本切片里 `Minimap.vue` 尚未迁移的拖拽换位/跨父级移动/资源拖入也改接这个方法；`context-menu-controller` 自己管理菜单开关时的 document 外部点击监听；[design](docs/superpowers/specs/2026-06-21-controller-extraction-slice-2-design.md)，[plan](docs/superpowers/plans/2026-06-21-controller-extraction-slice-2.md)，`npm test` 全过，`npm run build` 通过）
```

把"当前阶段"那几行改成指向切片 3：

```md
- **当前阶段**：Controller 抽取切片 3 —— drag-controller（第五阶段切片 5/6 暂缓，等 controller 抽取完成后再回来做）
- **当前阶段 Spec**：待头脑风暴产出后补充
- **当前阶段计划**：待头脑风暴产出后补充
```

把"下一步"改成：

```md
- **下一步**：推进 Controller 抽取切片 3（drag-controller，节点拖拽/滚动条拖拽/框选/空白平移/自动滚动/边缘平移/拖拽让位动画/资源拖放提交；完成后 `Minimap.vue` 里不再有任何指针事件处理逻辑，`emitChange` 本地函数也可以删掉，根 controller 的 DOM 回调全部指向真实 controller）；全部完成后再回到第五阶段切片 5/6，或继续性能优化后续切片（空间索引 / 静态层缓存 / 拖拽动态层合帧）。
```

- [ ] **Step 5: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: mark controller extraction slice 2 done"
```

## Self-Review

- **Spec coverage**：spec 文档列的四个 controller 边界、`operationManager` 归属决策（edit-controller 拥有，暴露 `applyOperation`/`emitChange` 给切片 3 复用）、`canPaste` 直接走 `hasClipboard()` 不经 deps、context-menu-controller 自己管理 document 监听、两个跨切片临时依赖（相机包装函数、`cancelPointerInteractions`）——全部在 Task 1-6 落地。spec 文档遗漏的 `emitExport` dep 已经在 Task 2 里补上并标注。
- **Placeholder 扫描**：写计划过程中发现并修掉了三处问题，没有留在最终版本里：edit-controller 测试里两处错误的 `assert.equal(..., undefined)` 断言、一个没被任何测试用到的 `groupLayout` 死代码、context-menu-controller 测试里 `layout.__graph` 这种不存在的字段访问。修完之后这些测试文件里不再有占位或矛盾。
- **类型一致性**：四个新 controller 的方法名在 Task 1-6 之间保持一致（`selection.getSelectedIds`/`setSelected`/`select`/`clearSelection`；`edit.undo`/`redo`/`canUndo`/`canRedo`/`deleteSelection`/`copySelection`/`paste`/`pasteInto`/`exportGraph`/`importGraph`/`applyOperation`/`onGraphReplaced`；`search.search`/`searchNext`/`searchPrevious`；`contextMenu.open`/`close`/`runItem`），Task 5 组装时用的字段名跟 Task 1-4 各自文件导出的字段名逐一对应。`deps` 里两组同名但不同含义的字段（`deps.fitToScreen`/`centerOnNode`/`centerOnSelection` 这三个 Vue 本地相机包装函数 vs 根 controller 返回对象里同名的、直接转发 `core` 的方法；`deps.emitChange` vs Vue 脚本顶层保留的 `emitChange` 本地函数）都在对应任务里写明了区别，避免实现时搞混。
- **跨任务一致性**：Task 5 最初漏掉了 `applyOperation` 的转发（写 Task 6 时发现 `Minimap.vue` 里还没迁移的拖拽/资源拖放代码这一切片就要用它），已经回头补上，Task 5 的测试也补了一个覆盖 `applyOperation` 转发的用例。
