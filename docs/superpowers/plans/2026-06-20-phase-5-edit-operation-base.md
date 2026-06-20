# Phase 5 Edit Operation Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 5 slice 1 editing foundation: a shared graph operation/history layer used by existing node drop and group reorder mutations, with readonly, before hooks, undo/redo, canUndo/canRedo, and standardized change payloads.

**Architecture:** Add a pure JS operation module beside `graph.js`, then integrate it into `Minimap.vue` without changing layout, rendering, selection, search, or overview behavior. Existing mutations stay in-place for this slice, but all write paths go through an operation manager so later Phase 5 slices can reuse the same contract.

**Tech Stack:** Vue 2.7 SFC, Canvas 2D, existing graph/layout modules, `node:test`, Vue Test Utils, jsdom canvas mocks, Vite build.

---

## File Map

- Create: `src/minimap/graph-operations.js`
  - Owns operation execution, inverse operation generation, history stacks, readonly/before hook handling, and change payload creation.
- Create: `test/minimap-graph-operations.test.js`
  - Pure unit tests for drop-node, reorder-group-child, undo, redo, blocked, readonly, invalid, and redo clearing.
- Modify: `src/minimap/Minimap.vue`
  - Add `readonly`, `beforeNodeDrop`, `beforeGroupReorder` props.
  - Replace direct drop/reorder mutations with operation manager calls.
  - Expose `undo`, `redo`, `canUndo`, `canRedo`.
  - Emit standardized `change` payloads.
- Modify: `test/minimap-drop.test.js`
  - Update `change` assertions.
  - Add readonly and before hook coverage for drop.
  - Add undo/redo drop coverage if not covered in shell tests.
- Modify: `test/minimap-group-interaction.test.js`
  - Update `change` assertions.
  - Add readonly and before hook coverage for group reorder.
- Modify: `test/minimap-shell.test.js`
  - Add focused component method tests for `canUndo`, `canRedo`, `undo`, and `redo`.
- Modify: `ROADMAP.md`
  - After implementation and verification, mark Phase 5 slice 1 complete and set next step to slice 2.

---

### Task 1: Pure Graph Operation And History Layer

**Files:**
- Create: `src/minimap/graph-operations.js`
- Create: `test/minimap-graph-operations.test.js`

- [ ] **Step 1: Write failing operation tests**

Create `test/minimap-graph-operations.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph.js'
import { createGraphOperationManager } from '../src/minimap/graph-operations.js'

function labels(graph, parentId) {
  return graph.nodes.get(parentId).children.slice()
}

test('drop-node inserts a new node and can undo and redo it', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const beforeSize = graph.nodes.size

  const result = manager.apply({
    type: 'drop-node',
    payload: {
      resource: { id: 'solar-array', label: 'Solar Array' },
      parentId: 'energy-root',
      index: 1,
      id: 'res-solar-array-1',
    },
  })

  assert.equal(result.applied, true)
  assert.equal(result.type, 'drop-node')
  assert.equal(graph.nodes.size, beforeSize + 1)
  assert.equal(graph.nodes.get('res-solar-array-1').label, 'Solar Array')
  assert.equal(graph.nodes.get('energy-root').children[1], 'res-solar-array-1')
  assert.equal(manager.canUndo(), true)
  assert.equal(manager.canRedo(), false)

  const undo = manager.undo()
  assert.equal(undo.applied, true)
  assert.equal(undo.type, 'undo')
  assert.equal(graph.nodes.has('res-solar-array-1'), false)
  assert.equal(graph.nodes.size, beforeSize)
  assert.equal(manager.canUndo(), false)
  assert.equal(manager.canRedo(), true)

  const redo = manager.redo()
  assert.equal(redo.applied, true)
  assert.equal(redo.type, 'redo')
  assert.equal(graph.nodes.has('res-solar-array-1'), true)
  assert.equal(graph.nodes.get('energy-root').children[1], 'res-solar-array-1')
})

test('reorder-group-child moves a child and can undo and redo it', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const before = labels(graph, 'heap-1')

  const result = manager.apply({
    type: 'reorder-group-child',
    payload: { groupId: 'heap-1::g0', parentId: 'heap-1', childId: 'cluster-8', index: 0 },
  })

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.get('heap-1').children[0], 'cluster-8')
  assert.equal(new Set(graph.nodes.get('heap-1').children).size, 24)

  manager.undo()
  assert.deepEqual(labels(graph, 'heap-1'), before)

  manager.redo()
  assert.equal(graph.nodes.get('heap-1').children[0], 'cluster-8')
})

test('new operation clears the redo stack', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  manager.apply({
    type: 'drop-node',
    payload: {
      resource: { id: 'a', label: 'A' },
      parentId: 'energy-root',
      index: 0,
      id: 'res-a-1',
    },
  })
  manager.undo()
  assert.equal(manager.canRedo(), true)

  manager.apply({
    type: 'drop-node',
    payload: {
      resource: { id: 'b', label: 'B' },
      parentId: 'energy-root',
      index: 0,
      id: 'res-b-1',
    },
  })

  assert.equal(manager.canRedo(), false)
})

test('readonly and before hooks block operations without mutating graph', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const before = labels(graph, 'energy-root')

  const readonlyResult = manager.apply(
    {
      type: 'drop-node',
      payload: {
        resource: { id: 'blocked', label: 'Blocked' },
        parentId: 'energy-root',
        index: 0,
        id: 'res-blocked-1',
      },
    },
    { readonly: true },
  )
  assert.equal(readonlyResult.applied, false)
  assert.equal(readonlyResult.reason, 'readonly')

  const hookResult = manager.apply(
    {
      type: 'drop-node',
      payload: {
        resource: { id: 'blocked-hook', label: 'Blocked Hook' },
        parentId: 'energy-root',
        index: 0,
        id: 'res-blocked-hook-1',
      },
    },
    { before: () => false },
  )
  assert.equal(hookResult.applied, false)
  assert.equal(hookResult.reason, 'blocked')
  assert.deepEqual(labels(graph, 'energy-root'), before)
  assert.equal(manager.canUndo(), false)
})

test('invalid operations return invalid and do not throw', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  assert.equal(
    manager.apply({
      type: 'drop-node',
      payload: {
        resource: { id: 'x', label: 'X' },
        parentId: 'missing',
        index: 0,
        id: 'res-x-1',
      },
    }).reason,
    'invalid',
  )
  assert.equal(
    manager.apply({
      type: 'drop-node',
      payload: {
        resource: { id: 'x', label: 'X' },
        parentId: 'energy-root',
        index: 0,
        id: 'energy-root',
      },
    }).reason,
    'invalid',
  )
  assert.equal(
    manager.apply({
      type: 'reorder-group-child',
      payload: { groupId: 'heap-1::g0', parentId: 'heap-1', childId: 'not-a-child', index: 0 },
    }).reason,
    'invalid',
  )
  assert.equal(manager.undo().reason, 'empty')
  assert.equal(manager.redo().reason, 'empty')
})
```

- [ ] **Step 2: Run the operation test and verify it fails**

Run:

```bash
npm test -- test/minimap-graph-operations.test.js
```

Expected: FAIL with module not found for `src/minimap/graph-operations.js`.

- [ ] **Step 3: Implement `graph-operations.js`**

Create `src/minimap/graph-operations.js`:

```js
function result({ applied, type, operation, inverse = null, graph, reason = null }) {
  return {
    applied,
    type,
    operation,
    inverse,
    previousGraph: graph,
    nextGraph: graph,
    reason,
  }
}

function blockedResult(graph, operation, reason) {
  return result({ applied: false, type: operation?.type, operation, graph, reason })
}

function clampIndex(index, length) {
  return Math.max(0, Math.min(index, length))
}

function applyDropNode(graph, operation) {
  const { resource, parentId, index, id } = operation.payload
  const parent = graph.nodes.get(parentId)
  if (!parent || !id || graph.nodes.has(id)) return blockedResult(graph, operation, 'invalid')

  const insertIndex = clampIndex(index, parent.children.length)
  const node = { id, label: resource.label, parentId, children: [] }
  graph.nodes.set(id, node)
  parent.children.splice(insertIndex, 0, id)

  return result({
    applied: true,
    type: operation.type,
    operation: { ...operation, payload: { ...operation.payload, index: insertIndex } },
    inverse: {
      type: 'remove-dropped-node',
      payload: { parentId, childId: id, index: insertIndex, node },
    },
    graph,
  })
}

function applyRemoveDroppedNode(graph, operation) {
  const { parentId, childId, index, node } = operation.payload
  const parent = graph.nodes.get(parentId)
  if (!parent || !graph.nodes.has(childId)) return blockedResult(graph, operation, 'invalid')

  parent.children = parent.children.filter((id) => id !== childId)
  graph.nodes.delete(childId)

  return result({
    applied: true,
    type: operation.type,
    operation,
    inverse: {
      type: 'drop-node',
      payload: {
        resource: { id: node.id, label: node.label },
        parentId,
        index,
        id: childId,
      },
    },
    graph,
  })
}

function applyReorderGroupChild(graph, operation) {
  const { parentId, childId, index } = operation.payload
  const parent = graph.nodes.get(parentId)
  const currentIndex = parent?.children.indexOf(childId) ?? -1
  if (!parent || currentIndex === -1) return blockedResult(graph, operation, 'invalid')

  const children = parent.children.filter((id) => id !== childId)
  const insertIndex = clampIndex(index, children.length)
  children.splice(insertIndex, 0, childId)
  parent.children = children

  return result({
    applied: true,
    type: operation.type,
    operation: { ...operation, payload: { ...operation.payload, index: insertIndex } },
    inverse: {
      type: 'reorder-group-child',
      payload: { ...operation.payload, index: currentIndex },
    },
    graph,
  })
}

function applyOperation(graph, operation) {
  if (operation.type === 'drop-node') return applyDropNode(graph, operation)
  if (operation.type === 'remove-dropped-node') return applyRemoveDroppedNode(graph, operation)
  if (operation.type === 'reorder-group-child') return applyReorderGroupChild(graph, operation)
  return blockedResult(graph, operation, 'invalid')
}

export function createGraphOperationManager(graph) {
  const undoStack = []
  const redoStack = []

  const apply = (operation, options = {}) => {
    if (options.readonly) return blockedResult(graph, operation, 'readonly')
    if (options.before && options.before(operation.payload) === false) {
      return blockedResult(graph, operation, 'blocked')
    }

    const applied = applyOperation(graph, operation)
    if (!applied.applied) return applied

    undoStack.push({ operation: applied.operation, inverse: applied.inverse })
    redoStack.length = 0
    return applied
  }

  const undo = () => {
    const entry = undoStack.pop()
    if (!entry) return blockedResult(graph, { type: 'undo', payload: {} }, 'empty')
    const applied = applyOperation(graph, entry.inverse)
    if (applied.applied) {
      redoStack.push(entry)
      return { ...applied, type: 'undo', operation: entry.operation, inverse: entry.inverse }
    }
    undoStack.push(entry)
    return applied
  }

  const redo = () => {
    const entry = redoStack.pop()
    if (!entry) return blockedResult(graph, { type: 'redo', payload: {} }, 'empty')
    const applied = applyOperation(graph, entry.operation)
    if (applied.applied) {
      undoStack.push({ operation: applied.operation, inverse: applied.inverse })
      return { ...applied, type: 'redo', operation: applied.operation, inverse: applied.inverse }
    }
    redoStack.push(entry)
    return applied
  }

  return {
    apply,
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  }
}
```

- [ ] **Step 4: Run operation tests**

Run:

```bash
npm test -- test/minimap-graph-operations.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/graph-operations.js test/minimap-graph-operations.test.js
git commit -m "feat: add graph operation history"
```

---

### Task 2: Migrate Node Drop To Operation Layer

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-drop.test.js`

- [ ] **Step 1: Update drop integration tests**

In `test/minimap-drop.test.js`, update the first test's `change` assertions:

```js
const change = wrapper.emitted('change')[0][0]
assert.equal(change.type, 'drop-node')
assert.equal(change.operation.type, 'drop-node')
assert.equal(change.operation.payload.parentId, 'energy-root')
assert.equal(change.operation.payload.index, 0)
assert.equal(change.nextGraph, graph)
assert.equal(change.reason, null)
```

Append two tests:

```js
test('readonly prevents dropping a resource into the graph', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, readonly: true } })
  const beforeSize = graph.nodes.size
  const beforeChildren = graph.nodes.get('energy-root').children.slice()

  dispatchDrop(wrapper, { id: 'blocked', label: 'Blocked' }, { x: 0, y: 0 })

  assert.equal(graph.nodes.size, beforeSize)
  assert.deepEqual(graph.nodes.get('energy-root').children, beforeChildren)
  assert.equal(wrapper.emitted('node-drop'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('beforeNodeDrop can block the default drop mutation', () => {
  const graph = createDemoGraph()
  const calls = []
  const wrapper = mount(Minimap, {
    propsData: {
      graph,
      beforeNodeDrop(payload) {
        calls.push(payload)
        return false
      },
    },
  })
  const beforeSize = graph.nodes.size

  dispatchDrop(wrapper, { id: 'blocked-hook', label: 'Blocked Hook' }, { x: 0, y: 0 })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].parentId, 'energy-root')
  assert.equal(calls[0].resource.label, 'Blocked Hook')
  assert.equal(graph.nodes.size, beforeSize)
  assert.equal(wrapper.emitted('node-drop'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})
```

- [ ] **Step 2: Run drop tests and verify they fail**

Run:

```bash
npm test -- test/minimap-drop.test.js
```

Expected: FAIL because `readonly` and `beforeNodeDrop` props do not exist and `change` still emits `graph`.

- [ ] **Step 3: Integrate operation manager into `Minimap.vue` for drops**

In `src/minimap/Minimap.vue`, replace:

```js
import { reorderGroupChild } from './graph.js'
```

with:

```js
import { createGraphOperationManager } from './graph-operations.js'
```

Add props:

```js
readonly: { type: Boolean, default: false },
beforeNodeDrop: { type: Function, default: null },
beforeGroupReorder: { type: Function, default: null },
```

Add manager state near other module-level state:

```js
let operationManager = null
```

Add helpers before `handleDrop`:

```js
function graphOperations() {
  if (!operationManager) operationManager = createGraphOperationManager(props.graph)
  return operationManager
}

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

Replace the mutation block in `handleDrop` with:

```js
const id = `res-${resource.id}-${Date.now()}`
const operation = {
  type: 'drop-node',
  payload: { resource, parentId, index, id },
}
const result = graphOperations().apply(operation, {
  readonly: props.readonly,
  before: props.beforeNodeDrop,
})
if (!result.applied) return

updateLayout()
emit('node-drop', { resource, parentId, index: result.operation.payload.index })
emitChange(result)
```

Remove the old direct writes:

```js
props.graph.nodes.set(id, { id, label: resource.label, parentId, children: [] })
parent.children.splice(index, 0, id)
emit('change', props.graph)
```

Add a watcher so graph replacement resets the manager:

```js
watch(
  () => props.graph,
  () => {
    operationManager = createGraphOperationManager(props.graph)
    updateLayout()
  },
)
```

Replace the existing single-line graph watcher:

```js
watch(() => props.graph, () => updateLayout())
```

- [ ] **Step 4: Run drop tests**

Run:

```bash
npm test -- test/minimap-drop.test.js
```

Expected: PASS.

- [ ] **Step 5: Run focused existing shell tests**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: PASS. If a test still asserts `change` emits raw `graph`, update it to the standardized payload only when the emission came from a graph mutation.

- [ ] **Step 6: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-drop.test.js test/minimap-shell.test.js
git commit -m "feat: route node drops through operations"
```

---

### Task 3: Migrate Group Reorder To Operation Layer

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-group-interaction.test.js`

- [ ] **Step 1: Update reorder integration tests**

In `test/minimap-group-interaction.test.js`, update the reorder test after `assert.equal(wrapper.emitted('change').length, 1)`:

```js
const change = wrapper.emitted('change')[0][0]
assert.equal(change.type, 'reorder-group-child')
assert.equal(change.operation.type, 'reorder-group-child')
assert.equal(change.operation.payload.parentId, 'heap-1')
assert.equal(change.operation.payload.childId, 'cluster-1')
assert.equal(change.nextGraph, graph)
```

Append readonly and before hook tests:

```js
test('readonly prevents dragging a group item from reordering graph children', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph, readonly: true } })
  const heap = graph.nodes.get('heap-1')
  const before = heap.children.slice()

  const firstItemPoint = firstItemCenter(group)
  const targetPoint = { x: firstItemPoint.x, y: firstItemPoint.y + 2 * (GROUP.itemH + GROUP.itemGap) }

  dispatchPointerDown(wrapper, firstItemPoint)
  dispatchPointerMove(wrapper, targetPoint)
  dispatchPointerUp(wrapper, targetPoint)
  finishPendingAnimation()

  assert.deepEqual(heap.children, before)
  assert.equal(wrapper.emitted('group-reorder'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('beforeGroupReorder can block group item reordering', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const calls = []
  const wrapper = mount(Minimap, {
    propsData: {
      graph,
      beforeGroupReorder(payload) {
        calls.push(payload)
        return false
      },
    },
  })
  const heap = graph.nodes.get('heap-1')
  const before = heap.children.slice()

  const firstItemPoint = firstItemCenter(group)
  const targetPoint = { x: firstItemPoint.x, y: firstItemPoint.y + 2 * (GROUP.itemH + GROUP.itemGap) }

  dispatchPointerDown(wrapper, firstItemPoint)
  dispatchPointerMove(wrapper, targetPoint)
  dispatchPointerUp(wrapper, targetPoint)
  finishPendingAnimation()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].parentId, 'heap-1')
  assert.equal(calls[0].childId, 'cluster-1')
  assert.deepEqual(heap.children, before)
  assert.equal(wrapper.emitted('group-reorder'), undefined)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})
```

- [ ] **Step 2: Run group interaction tests and verify they fail**

Run:

```bash
npm test -- test/minimap-group-interaction.test.js
```

Expected: FAIL because reorder still writes directly through `reorderGroupChild` and `change` payload is not standardized.

- [ ] **Step 3: Replace reorder mutation in `Minimap.vue`**

In `handlePointerUp`, replace:

```js
reorderGroupChild(props.graph, group.parentId, dragState.childId, index)
updateGroupState(group.id, { scrollTop: group.scrollTop })
updateLayout()
emit('group-reorder', { groupId: group.id, childId: dragState.childId, index })
emit('change', props.graph)
```

with:

```js
const operation = {
  type: 'reorder-group-child',
  payload: { groupId: group.id, parentId: group.parentId, childId: dragState.childId, index },
}
const result = graphOperations().apply(operation, {
  readonly: props.readonly,
  before: props.beforeGroupReorder,
})
if (result.applied) {
  updateGroupState(group.id, { scrollTop: group.scrollTop })
  updateLayout()
  emit('group-reorder', {
    groupId: group.id,
    childId: dragState.childId,
    index: result.operation.payload.index,
  })
  emitChange(result)
} else {
  renderCurrent()
}
```

Keep `dragState = null` after the block so pointer state is always cleaned.

- [ ] **Step 4: Run group interaction tests**

Run:

```bash
npm test -- test/minimap-group-interaction.test.js
```

Expected: PASS.

- [ ] **Step 5: Run operation and drop tests together**

Run:

```bash
npm test -- test/minimap-graph-operations.test.js test/minimap-drop.test.js test/minimap-group-interaction.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-group-interaction.test.js
git commit -m "feat: route group reorder through operations"
```

---

### Task 4: Expose Undo/Redo Methods And Finalize Phase Slice

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-shell.test.js`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Add component method tests**

Append to `test/minimap-shell.test.js`:

```js
test('undo and redo exposed methods restore a dropped node', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const beforeSize = graph.nodes.size

  const canvasEl = wrapper.find('canvas').element
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'dataTransfer', {
    value: { getData: () => JSON.stringify({ id: 'undoable', label: 'Undoable' }) },
  })
  Object.defineProperty(evt, 'clientX', { value: 0, configurable: true })
  Object.defineProperty(evt, 'clientY', { value: 0, configurable: true })
  canvasEl.dispatchEvent(evt)

  const insertedId = graph.nodes.get('energy-root').children.find((id) => id.startsWith('res-undoable-'))
  assert.ok(insertedId)
  assert.equal(wrapper.vm.canUndo(), true)
  assert.equal(wrapper.vm.canRedo(), false)

  const undo = wrapper.vm.undo()
  assert.equal(undo.applied, true)
  assert.equal(undo.type, 'undo')
  assert.equal(graph.nodes.has(insertedId), false)
  assert.equal(graph.nodes.size, beforeSize)
  assert.equal(wrapper.vm.canUndo(), false)
  assert.equal(wrapper.vm.canRedo(), true)

  const redo = wrapper.vm.redo()
  assert.equal(redo.applied, true)
  assert.equal(redo.type, 'redo')
  assert.equal(graph.nodes.has(insertedId), true)
  assert.equal(wrapper.vm.canUndo(), true)
  assert.equal(wrapper.vm.canRedo(), false)

  const changes = wrapper.emitted('change').map((entry) => entry[0].type)
  assert.deepEqual(changes, ['drop-node', 'undo', 'redo'])
  wrapper.destroy()
})

test('undo and redo are empty no-ops when history stacks are empty', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  assert.equal(wrapper.vm.canUndo(), false)
  assert.equal(wrapper.vm.canRedo(), false)
  assert.equal(wrapper.vm.undo().reason, 'empty')
  assert.equal(wrapper.vm.redo().reason, 'empty')
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})
```

- [ ] **Step 2: Run shell tests and verify they fail**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: FAIL because `undo`, `redo`, `canUndo`, and `canRedo` are not exposed.

- [ ] **Step 3: Implement exposed methods**

In `src/minimap/Minimap.vue`, add:

```js
function undo() {
  const result = graphOperations().undo()
  if (result.applied) {
    updateLayout()
    emitChange(result)
  }
  return result
}

function redo() {
  const result = graphOperations().redo()
  if (result.applied) {
    updateLayout()
    emitChange(result)
  }
  return result
}

function canUndo() {
  return graphOperations().canUndo()
}

function canRedo() {
  return graphOperations().canRedo()
}
```

Add them to `defineExpose`:

```js
undo,
redo,
canUndo,
canRedo,
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- test/minimap-shell.test.js test/minimap-drop.test.js test/minimap-group-interaction.test.js test/minimap-graph-operations.test.js
```

Expected: PASS.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
```

Expected: PASS.

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Update roadmap**

In `ROADMAP.md`:

- Add the plan link to the current phase plan.
- Mark Phase 5 slice 1 checked.
- Set current phase to Phase 5 slice 2.
- Set next step to creating Phase 5 slice 2 spec.

Use wording:

```md
- **当前阶段**：第五阶段切片 2 —— 删除、复制、导入导出
- **当前阶段 Spec**：待创建；基于切片 1 的 operation/history 合同继续扩展删除、复制、导入导出
- **当前阶段计划**：待创建；spec 确认后写第五阶段切片 2 implementation plan
```

Update slice 1:

```md
- [x] 切片 1：编辑操作底座（新增 `graph-operations`/history 层，统一节点拖入和分组内换位的 mutation 入口；支持 `readonly`、before hooks、`undo`/`redo`、`canUndo`/`canRedo`、`change` payload 规范；[spec](docs/superpowers/specs/2026-06-20-phase-5-edit-operation-base.md)，[plan](docs/superpowers/plans/2026-06-20-phase-5-edit-operation-base.md)，`npm test` 与 `npm run build` 通过）
```

- [ ] **Step 7: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-shell.test.js ROADMAP.md
git commit -m "feat: expose edit history controls"
```

---

## Self-Review Checklist

- Spec coverage:
  - `graph-operations` / history layer: Task 1.
  - Existing drop migration: Task 2.
  - Existing group reorder migration: Task 3.
  - readonly and before hooks: Tasks 1-3.
  - undo/redo/canUndo/canRedo: Tasks 1 and 4.
  - standardized `change` payload: Tasks 2-4.
- Scope guard:
  - No delete/copy/import/export implementation.
  - No cross-parent drag implementation.
  - No loading/error/aria/performance state implementation.
  - No toolbar button behavior implementation.
- Verification:
  - Focused tests after each task.
  - Full `npm test` and `npm run build` before marking the slice complete.
