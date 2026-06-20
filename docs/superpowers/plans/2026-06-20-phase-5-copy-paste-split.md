# Phase 5 Copy Paste Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the already-shipped `copySelection()` (which immediately duplicated nodes next to the original) into a read-only `copySelection()` that snapshots the selection into an internal clipboard, plus a new `paste()` that inserts the snapshot as children of the currently selected node, fully undoable.

**Architecture:** Remove the now-dead `copy-nodes` operation from the pure `graph-operations.js` layer and replace it with a read-only `captureSubtreeSnapshot` helper plus a new mutating `paste-nodes` operation. Wire both into `Minimap.vue`: `copySelection()` calls the helper directly (no operation, no history); `paste()` goes through the existing `graphOperations().apply()` path used by every other mutating method.

**Tech Stack:** Vue 2.7 SFC, Canvas 2D, pure JS graph helpers, `node:test`, Vue Test Utils, jsdom canvas mocks, Vite build.

## Global Constraints

- `copySelection()` must not mutate `props.graph`, must not enter undo/redo history, and must not emit `change`.
- `readonly` must NOT block `copySelection()`. `readonly` MUST block `paste()`.
- `beforeCopy(payload)` blocks copy (`reason: 'blocked'`) when it returns `false`; payload is `{ ids, expandedIds }`.
- `beforePaste(payload)` blocks paste (`reason: 'blocked'`) when it returns `false`.
- Paste target resolution: the first currently-selected id (`currentSelectedIds()[0] ?? null`); if that id is a group box id (present in `layout.groups`), resolve to that group's `.parentId` instead.
- No target selected, or clipboard empty → `paste()` returns `reason: 'empty'`, no mutation, no `change`.
- Every `paste()` call must generate a fresh id for every snapshot node, so repeated pastes never collide and each produces an independent copy.
- Pasted nodes are always appended to the end of the target's `children`.
- `paste-nodes` inverse must use the existing whole-graph-snapshot pattern (`{ type: 'replace-graph', payload: { graph: before } }`), consistent with `delete-nodes`/`replace-graph`.

---

## File Map

- Modify: `src/minimap/graph-operations.js`
  - Remove `cloneSubtree`, `applyCopyNodes`, and the `copy-nodes` dispatch branch (dead code, no callers after this plan).
  - Add exported `captureSubtreeSnapshot(graph, expandedIds)` — read-only, returns JSON-safe `{ rootIds, nodes }`.
  - Add `applyPasteNodes` and the `paste-nodes` dispatch branch.
- Modify: `test/minimap-graph-operations.test.js`
  - Remove the two `copy-nodes`-only tests; replace `copy-nodes` assertions inside the two shared edge-case tests with `paste-nodes` ones.
  - Add tests for `captureSubtreeSnapshot` and `paste-nodes`.
- Modify: `src/minimap/Minimap.vue`
  - Import `captureSubtreeSnapshot` alongside `createGraphOperationManager`.
  - Add prop `beforePaste`, add emit `'paste'`, add module-level `let clipboard = null`.
  - Rewrite `copySelection()` to be read-only; remove `collectCopyIds`/`nextCopyId`/`createCopyIdMap` (no longer used); add `nextPasteId`/`createPasteIdMap`/`pasteTargetId`/`paste()`.
  - Extend `handleKeyDown` with `Cmd/Ctrl+V` → `paste()`.
  - Add `paste` to `defineExpose`.
  - Add a "粘贴" toolbar button next to the existing "复制" button.
- Modify: `test/minimap-shell.test.js`
  - Rewrite the `copySelection` test for the new read-only behavior.
  - Add `paste()` tests: basic paste, double-paste (no id collision), group-target resolution, empty/no-selection, readonly/beforePaste blocking.
  - Update the keyboard and toolbar tests to cover `Cmd/Ctrl+V` and the new "粘贴" button.
- Modify: `ROADMAP.md`
  - Update the slice 2 bullet's description to mention the copy/paste split (no change to "当前阶段"/"下一步" — slice 3 is still next).

---

### Task 1: Graph Operations Layer — Snapshot Capture And Paste

**Files:**
- Modify: `src/minimap/graph-operations.js`
- Modify: `test/minimap-graph-operations.test.js`

**Interfaces:**
- Produces: `export function captureSubtreeSnapshot(graph, expandedIds)` → `{ rootIds: string[], nodes: Array<{id, label, parentId, children, ...}> }` (JSON-safe, no `Map`).
- Produces: operation type `'paste-nodes'` with payload `{ targetParentId, snapshot, idMap }`, applied via the existing `createGraphOperationManager(graph).apply(...)`. On success, `result.operation.payload.pastedIds` is the array of new root ids that were inserted.

- [ ] **Step 1: Update the test file — remove obsolete `copy-nodes` tests, rewrite shared edge-case tests, add new tests**

In `test/minimap-graph-operations.test.js`, change the import line at the top from:

```js
import { createGraphOperationManager } from '../src/minimap/graph-operations.js'
```

to:

```js
import { createGraphOperationManager, captureSubtreeSnapshot } from '../src/minimap/graph-operations.js'
```

Delete these two tests entirely (they test the now-removed `copy-nodes` operation):

```js
test('copy-nodes duplicates selected subtrees with stable ids and undo redo', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'copy-nodes',
    payload: {
      ids: ['grid-tie', 'feeder-1'],
      expandedIds: ['grid-tie', 'feeder-1'],
      idMap: {
        'grid-tie': 'copy-grid-tie-1',
        'feeder-1': 'copy-feeder-1-1',
        'feeder-2': 'copy-feeder-2-1',
        'feeder-3': 'copy-feeder-3-1',
      },
    },
  })

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.has('copy-grid-tie-1'), true)
  assert.deepEqual(graph.nodes.get('copy-grid-tie-1').children, [
    'copy-feeder-1-1',
    'copy-feeder-2-1',
    'copy-feeder-3-1',
  ])
  assert.equal(graph.nodes.get('copy-feeder-1-1').parentId, 'copy-grid-tie-1')
  assert.deepEqual(graph.nodes.get('energy-root').children.slice(0, 2), ['grid-tie', 'copy-grid-tie-1'])

  manager.undo()
  assert.equal(graph.nodes.has('copy-grid-tie-1'), false)

  manager.redo()
  assert.equal(graph.nodes.has('copy-grid-tie-1'), true)
})

test('copy-nodes can copy a root and insert the copied root after the original', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'copy-nodes',
    payload: {
      ids: ['energy-root'],
      expandedIds: ['energy-root'],
      idMap: Object.fromEntries([...graph.nodes.keys()].map((id) => [id, `copy-${id}-1`])),
    },
  })

  assert.equal(result.applied, true)
  assert.deepEqual(graph.rootIds, ['energy-root', 'copy-energy-root-1'])
  assert.equal(graph.nodes.get('copy-energy-root-1').parentId, null)
})
```

Replace the test `'delete copy and import operations respect readonly and before hooks'` (which currently asserts a `copy-nodes` block) with this rewritten version covering `paste-nodes` instead:

```js
test('delete paste and import operations respect readonly and before hooks', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const snapshot = captureSubtreeSnapshot(graph, ['grid-tie'])

  assert.equal(
    manager.apply(
      { type: 'delete-nodes', payload: { ids: ['grid-tie'], expandedIds: ['grid-tie'] } },
      { readonly: true },
    ).reason,
    'readonly',
  )
  assert.equal(
    manager.apply(
      {
        type: 'paste-nodes',
        payload: {
          targetParentId: 'cluster-25',
          snapshot,
          idMap: {
            'grid-tie': 'paste-grid-tie-1',
            'feeder-1': 'paste-feeder-1-1',
            'feeder-2': 'paste-feeder-2-1',
            'feeder-3': 'paste-feeder-3-1',
          },
        },
      },
      { before: () => false },
    ).reason,
    'blocked',
  )
  assert.equal(
    manager.apply(
      { type: 'replace-graph', payload: { graph: createDemoGraph() } },
      { before: () => false },
    ).reason,
    'blocked',
  )
})
```

Replace the test `'delete and copy return empty or invalid for unusable payloads'` with this rewritten version covering `paste-nodes` instead:

```js
test('delete and paste return empty or invalid for unusable payloads', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const snapshot = captureSubtreeSnapshot(graph, ['grid-tie'])

  assert.equal(manager.apply({ type: 'delete-nodes', payload: { ids: [], expandedIds: [] } }).reason, 'empty')
  assert.equal(
    manager.apply({ type: 'paste-nodes', payload: { targetParentId: null, snapshot, idMap: {} } }).reason,
    'empty',
  )
  assert.equal(
    manager.apply({
      type: 'paste-nodes',
      payload: { targetParentId: 'cluster-25', snapshot: { rootIds: [], nodes: [] }, idMap: {} },
    }).reason,
    'empty',
  )
  assert.equal(
    manager.apply({
      type: 'paste-nodes',
      payload: { targetParentId: 'cluster-25', snapshot, idMap: {} },
    }).reason,
    'invalid',
  )
})
```

Append these new tests at the end of the file:

```js
test('captureSubtreeSnapshot returns a JSON-safe snapshot decoupled from the live graph', () => {
  const graph = createDemoGraph()

  const snapshot = captureSubtreeSnapshot(graph, ['grid-tie'])

  assert.deepEqual(snapshot.rootIds, ['grid-tie'])
  assert.equal(snapshot.nodes.length, 4)
  assert.equal(snapshot.nodes.some((node) => node.id === 'grid-tie'), true)
  assert.equal(snapshot.nodes.some((node) => node.id === 'feeder-1'), true)
  assert.equal(JSON.parse(JSON.stringify(snapshot)).nodes.length, 4)

  const clonedNode = snapshot.nodes.find((node) => node.id === 'grid-tie')
  clonedNode.children.push('mutated')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-1', 'feeder-2', 'feeder-3'])
})

test('captureSubtreeSnapshot deduplicates a selected parent and its own descendant', () => {
  const graph = createDemoGraph()

  const snapshot = captureSubtreeSnapshot(graph, ['grid-tie', 'feeder-1'])

  assert.deepEqual(snapshot.rootIds, ['grid-tie'])
  assert.equal(snapshot.nodes.length, 4)
})

test('captureSubtreeSnapshot returns an empty snapshot for an empty selection', () => {
  const graph = createDemoGraph()

  assert.deepEqual(captureSubtreeSnapshot(graph, []), { rootIds: [], nodes: [] })
})

test('paste-nodes inserts a snapshot as children of the target and can undo redo', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const snapshot = captureSubtreeSnapshot(graph, ['grid-tie'])

  const result = manager.apply({
    type: 'paste-nodes',
    payload: {
      targetParentId: 'cluster-25',
      snapshot,
      idMap: {
        'grid-tie': 'paste-grid-tie-1',
        'feeder-1': 'paste-feeder-1-1',
        'feeder-2': 'paste-feeder-2-1',
        'feeder-3': 'paste-feeder-3-1',
      },
    },
  })

  assert.equal(result.applied, true)
  assert.deepEqual(result.operation.payload.pastedIds, ['paste-grid-tie-1'])
  assert.equal(graph.nodes.has('paste-grid-tie-1'), true)
  assert.deepEqual(graph.nodes.get('paste-grid-tie-1').children, [
    'paste-feeder-1-1',
    'paste-feeder-2-1',
    'paste-feeder-3-1',
  ])
  assert.equal(graph.nodes.get('paste-feeder-1-1').parentId, 'paste-grid-tie-1')
  assert.equal(graph.nodes.get('paste-grid-tie-1').parentId, 'cluster-25')
  assert.equal(graph.nodes.get('cluster-25').children.at(-1), 'paste-grid-tie-1')
  assert.equal(graph.nodes.has('grid-tie'), true)

  manager.undo()
  assert.equal(graph.nodes.has('paste-grid-tie-1'), false)
  assert.equal(graph.nodes.get('cluster-25').children.includes('paste-grid-tie-1'), false)

  manager.redo()
  assert.equal(graph.nodes.has('paste-grid-tie-1'), true)
})

test('paste-nodes can be applied twice with different idMaps without id collisions', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const snapshot = captureSubtreeSnapshot(graph, ['feeder-1'])

  manager.apply({
    type: 'paste-nodes',
    payload: { targetParentId: 'cluster-25', snapshot, idMap: { 'feeder-1': 'paste-feeder-1-1' } },
  })
  manager.apply({
    type: 'paste-nodes',
    payload: { targetParentId: 'cluster-25', snapshot, idMap: { 'feeder-1': 'paste-feeder-1-2' } },
  })

  assert.equal(graph.nodes.has('paste-feeder-1-1'), true)
  assert.equal(graph.nodes.has('paste-feeder-1-2'), true)
  assert.deepEqual(graph.nodes.get('cluster-25').children.slice(-2), ['paste-feeder-1-1', 'paste-feeder-1-2'])
})
```

- [ ] **Step 2: Run the test file and verify it fails**

Run: `npm test -- test/minimap-graph-operations.test.js`

Expected: FAIL — `captureSubtreeSnapshot` is not exported yet, and `'paste-nodes'` is not a recognized operation type yet (the `'copy-nodes'` tests that referenced the no-longer-tested behavior are gone, but `applyOperation` in the source still has the old `copy-nodes` branch at this point — that's fine, it's about to be removed in the next step).

- [ ] **Step 3: Remove `copy-nodes` and add `captureSubtreeSnapshot` + `paste-nodes` in `graph-operations.js`**

In `src/minimap/graph-operations.js`, delete the `cloneSubtree` and `applyCopyNodes` functions entirely (currently sitting between `applyDeleteNodes` and `applyReplaceGraph`):

```js
function cloneSubtree(graph, sourceId, idMap, copiedNodes) {
  const source = graph.nodes.get(sourceId)
  const copyId = idMap[sourceId]
  if (!source || !copyId || graph.nodes.has(copyId)) return false
  const childCopies = []
  for (const childId of source.children || []) {
    if (!cloneSubtree(graph, childId, idMap, copiedNodes)) return false
    childCopies.push(idMap[childId])
  }
  copiedNodes.set(copyId, {
    ...source,
    id: copyId,
    parentId: source.parentId && idMap[source.parentId] ? idMap[source.parentId] : source.parentId,
    children: childCopies,
  })
  return true
}

function applyCopyNodes(graph, operation) {
  const ids = highestExistingIds(graph, operation.payload.expandedIds || operation.payload.ids || [])
  if (ids.length === 0) return blockedResult(graph, operation, 'empty')
  const before = cloneGraphData(graph)
  const copiedNodes = new Map()
  const idMap = operation.payload.idMap || {}
  for (const id of ids) {
    if (!cloneSubtree(graph, id, idMap, copiedNodes)) return blockedResult(graph, operation, 'invalid')
  }

  for (const [id, node] of copiedNodes) graph.nodes.set(id, node)
  for (const sourceId of ids) {
    const source = graph.nodes.get(sourceId)
    const copyId = idMap[sourceId]
    if (source.parentId) {
      const parent = graph.nodes.get(source.parentId)
      const sourceIndex = parent.children.indexOf(sourceId)
      parent.children.splice(sourceIndex + 1, 0, copyId)
    } else {
      const sourceIndex = graph.rootIds.indexOf(sourceId)
      graph.rootIds.splice(sourceIndex + 1, 0, copyId)
    }
  }

  return result({
    applied: true,
    type: operation.type,
    operation: { ...operation, payload: { ...operation.payload, copiedIds: [...copiedNodes.keys()] } },
    inverse: { type: 'replace-graph', payload: { graph: before } },
    graph,
  })
}
```

In their place, add:

```js
export function captureSubtreeSnapshot(graph, expandedIds) {
  const ids = highestExistingIds(graph, expandedIds || [])
  if (ids.length === 0) return { rootIds: [], nodes: [] }
  const included = new Set()
  for (const id of ids) collectDescendants(graph, id, included)
  const nodes = [...included].map((id) => {
    const node = graph.nodes.get(id)
    return { ...node, children: [...(node.children || [])] }
  })
  return { rootIds: ids, nodes }
}

function applyPasteNodes(graph, operation) {
  const { targetParentId, snapshot, idMap } = operation.payload
  const target = targetParentId ? graph.nodes.get(targetParentId) : null
  if (!target) return blockedResult(graph, operation, 'empty')
  if (
    !snapshot ||
    !Array.isArray(snapshot.nodes) ||
    snapshot.nodes.length === 0 ||
    !Array.isArray(snapshot.rootIds) ||
    snapshot.rootIds.length === 0
  ) {
    return blockedResult(graph, operation, 'empty')
  }
  const map = idMap || {}
  for (const node of snapshot.nodes) {
    if (!map[node.id]) return blockedResult(graph, operation, 'invalid')
  }

  const before = cloneGraphData(graph)
  const snapshotIds = new Set(snapshot.nodes.map((node) => node.id))
  for (const node of snapshot.nodes) {
    const newId = map[node.id]
    const parentId = node.parentId && snapshotIds.has(node.parentId) ? map[node.parentId] : targetParentId
    graph.nodes.set(newId, {
      ...node,
      id: newId,
      parentId,
      children: (node.children || []).map((childId) => map[childId]),
    })
  }
  const pastedIds = snapshot.rootIds.map((id) => map[id])
  target.children = [...target.children, ...pastedIds]

  return result({
    applied: true,
    type: operation.type,
    operation: { ...operation, payload: { ...operation.payload, pastedIds } },
    inverse: { type: 'replace-graph', payload: { graph: before } },
    graph,
  })
}
```

Change the `applyOperation` dispatch function from:

```js
function applyOperation(graph, operation) {
  if (operation.type === 'drop-node') return applyDropNode(graph, operation)
  if (operation.type === 'remove-dropped-node') return applyRemoveDroppedNode(graph, operation)
  if (operation.type === 'reorder-group-child') return applyReorderGroupChild(graph, operation)
  if (operation.type === 'delete-nodes') return applyDeleteNodes(graph, operation)
  if (operation.type === 'copy-nodes') return applyCopyNodes(graph, operation)
  if (operation.type === 'replace-graph') return applyReplaceGraph(graph, operation)
  return blockedResult(graph, operation, 'invalid')
}
```

to:

```js
function applyOperation(graph, operation) {
  if (operation.type === 'drop-node') return applyDropNode(graph, operation)
  if (operation.type === 'remove-dropped-node') return applyRemoveDroppedNode(graph, operation)
  if (operation.type === 'reorder-group-child') return applyReorderGroupChild(graph, operation)
  if (operation.type === 'delete-nodes') return applyDeleteNodes(graph, operation)
  if (operation.type === 'paste-nodes') return applyPasteNodes(graph, operation)
  if (operation.type === 'replace-graph') return applyReplaceGraph(graph, operation)
  return blockedResult(graph, operation, 'invalid')
}
```

- [ ] **Step 4: Run the test file and verify it passes**

Run: `npm test -- test/minimap-graph-operations.test.js`

Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/graph-operations.js test/minimap-graph-operations.test.js
git commit -m "feat: replace copy-nodes operation with snapshot capture and paste-nodes"
```

---

### Task 2: Vue Methods, Keyboard, And Events — Copy/Paste Split

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-shell.test.js`

**Interfaces:**
- Consumes: `captureSubtreeSnapshot(graph, expandedIds)` and operation type `'paste-nodes'` from Task 1.
- Produces: rewritten `copySelection()` (read-only); new `paste()` method, exposed via `defineExpose`; new prop `beforePaste`; new event `'paste'`.

- [ ] **Step 1: Add failing tests to `test/minimap-shell.test.js`**

Replace the existing test `'copySelection duplicates selected nodes and emits events'` with:

```js
test('copySelection captures a clipboard snapshot without mutating the graph', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const beforeSize = graph.nodes.size

  wrapper.vm.select(['grid-tie'])
  const result = wrapper.vm.copySelection()

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.size, beforeSize)
  assert.deepEqual(wrapper.emitted('copy')[0][0].expandedIds.sort(), ['feeder-1', 'feeder-2', 'feeder-3', 'grid-tie'])
  assert.equal(wrapper.emitted('change'), undefined)
  assert.equal(wrapper.vm.canUndo(), false)
  wrapper.destroy()
})
```

Append these new tests directly after it:

```js
test('paste inserts the clipboard snapshot as a child of the selected node and supports undo', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['feeder-1'])
  wrapper.vm.copySelection()
  wrapper.vm.select(['cluster-25'])
  const result = wrapper.vm.paste()

  assert.equal(result.applied, true)
  const pastedId = result.operation.payload.pastedIds[0]
  assert.equal(graph.nodes.get('cluster-25').children.includes(pastedId), true)
  assert.equal(graph.nodes.get(pastedId).parentId, 'cluster-25')
  assert.equal(wrapper.emitted('paste')[0][0].pastedIds[0], pastedId)
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'paste-nodes')

  wrapper.vm.undo()
  assert.equal(graph.nodes.has(pastedId), false)
  wrapper.destroy()
})

test('pasting the same clipboard twice produces two independent copies', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['feeder-1'])
  wrapper.vm.copySelection()
  wrapper.vm.select(['cluster-25'])
  const first = wrapper.vm.paste()
  const second = wrapper.vm.paste()

  const firstId = first.operation.payload.pastedIds[0]
  const secondId = second.operation.payload.pastedIds[0]
  assert.notEqual(firstId, secondId)
  assert.equal(graph.nodes.has(firstId), true)
  assert.equal(graph.nodes.has(secondId), true)
  assert.deepEqual(graph.nodes.get('cluster-25').children.slice(-2), [firstId, secondId])
  wrapper.destroy()
})

test('paste targets the real parent node when the selection is a group box', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['feeder-1'])
  wrapper.vm.copySelection()
  wrapper.vm.select(['heap-1::g0'])
  const result = wrapper.vm.paste()

  assert.equal(result.applied, true)
  const pastedId = result.operation.payload.pastedIds[0]
  assert.equal(graph.nodes.get('heap-1').children.includes(pastedId), true)
  assert.equal(graph.nodes.get(pastedId).parentId, 'heap-1')
  wrapper.destroy()
})

test('paste returns empty when there is no selection or no clipboard content', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  assert.equal(wrapper.vm.paste().reason, 'empty')

  wrapper.vm.select(['cluster-25'])
  assert.equal(wrapper.vm.paste().reason, 'empty')
  wrapper.destroy()
})
```

In the test `'readonly and before hooks block delete copy and import methods'`, replace the body with this version (readonly no longer blocks `copySelection`, but still blocks `paste`; `beforeCopy` still blocks `copySelection`; add `beforePaste` coverage):

```js
test('readonly and before hooks block delete paste and import methods, but not copy', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, {
    propsData: {
      graph,
      readonly: true,
      beforeDelete: () => {
        throw new Error('readonly should short-circuit before hooks')
      },
    },
  })
  wrapper.vm.select(['grid-tie'])

  assert.equal(wrapper.vm.deleteSelection().reason, 'readonly')
  assert.equal(wrapper.vm.copySelection().applied, true)
  assert.equal(wrapper.vm.paste().reason, 'readonly')
  assert.equal(wrapper.vm.importGraph({ version: 1, nodes: [], rootIds: [] }).reason, 'readonly')
  assert.equal(graph.nodes.has('grid-tie'), true)
  wrapper.destroy()

  const blockedGraph = createDemoGraph()
  const blocked = mount(Minimap, {
    propsData: {
      graph: blockedGraph,
      beforeDelete: () => false,
      beforeCopy: () => false,
      beforePaste: () => false,
      beforeImport: () => false,
    },
  })
  blocked.vm.select(['grid-tie'])

  assert.equal(blocked.vm.deleteSelection().reason, 'blocked')
  assert.equal(blocked.vm.copySelection().reason, 'blocked')
  assert.equal(blocked.vm.paste().reason, 'blocked')
  assert.equal(blocked.vm.importGraph({ version: 1, nodes: [], rootIds: [] }).reason, 'blocked')
  assert.equal(blockedGraph.nodes.has('grid-tie'), true)
  blocked.destroy()
})
```

In the test `'keyboard Delete Backspace and Cmd/Ctrl+C trigger edit commands'`, replace the body to also cover `Cmd/Ctrl+V`:

```js
test('keyboard Delete Backspace Cmd/Ctrl+C and Cmd/Ctrl+V trigger edit commands', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['grid-tie'])
  dispatchKey(wrapper, 'Delete')
  assert.equal(graph.nodes.has('grid-tie'), false)

  wrapper.vm.undo()
  wrapper.vm.select(['grid-tie'])
  dispatchKey(wrapper, 'Backspace')
  assert.equal(graph.nodes.has('grid-tie'), false)

  wrapper.vm.undo()
  wrapper.vm.select(['feeder-1'])
  dispatchKey(wrapper, 'c', { metaKey: true })
  assert.equal(wrapper.emitted('copy').length, 1)

  wrapper.vm.select(['cluster-25'])
  dispatchKey(wrapper, 'v', { metaKey: true })
  assert.equal(wrapper.emitted('paste').length, 1)
  const pastedId = wrapper.emitted('paste')[0][0].pastedIds[0]
  assert.equal(graph.nodes.get('cluster-25').children.includes(pastedId), true)

  wrapper.destroy()
})
```

- [ ] **Step 2: Run the shell test file and verify it fails**

Run: `npm test -- test/minimap-shell.test.js`

Expected: FAIL — `wrapper.vm.paste is not a function`, plus the rewritten `copySelection`/readonly/keyboard assertions don't match current behavior yet.

- [ ] **Step 3: Update imports, props, emits, and module state in `Minimap.vue`**

Change the import line:

```js
import { createGraphOperationManager } from './graph-operations.js'
```

to:

```js
import { createGraphOperationManager, captureSubtreeSnapshot } from './graph-operations.js'
```

In `defineProps`, add `beforePaste` directly after `beforeImport`:

```js
  beforeImport: { type: Function, default: null },
  beforePaste: { type: Function, default: null },
```

In `defineEmits`, add `'paste'` after `'export'`:

```js
  'export',
  'paste',
```

Add `let clipboard = null` directly after `let operationManager = null`.

- [ ] **Step 4: Replace the copy-id helpers and `copySelection` with the new copy/paste implementation**

Delete these three functions entirely:

```js
function collectCopyIds(id, ids = new Set()) {
  const node = props.graph.nodes.get(id)
  if (!node || ids.has(id)) return ids
  ids.add(id)
  for (const childId of node.children || []) collectCopyIds(childId, ids)
  return ids
}

function nextCopyId(sourceId, usedIds) {
  let index = 1
  let id = `copy-${sourceId}-${index}`
  while (usedIds.has(id)) {
    index += 1
    id = `copy-${sourceId}-${index}`
  }
  usedIds.add(id)
  return id
}

function createCopyIdMap(ids) {
  const usedIds = new Set(props.graph.nodes.keys())
  const copyIds = new Set()
  for (const id of ids) collectCopyIds(id, copyIds)
  const idMap = {}
  for (const id of copyIds) idMap[id] = nextCopyId(id, usedIds)
  return idMap
}
```

Replace the existing `copySelection` function:

```js
function copySelection() {
  const ids = currentSelectedIds()
  const expandedIds = selectedRealNodeIds()
  const idMap = createCopyIdMap(expandedIds)
  const operation = { type: 'copy-nodes', payload: { ids, expandedIds, idMap } }
  const result = graphOperations().apply(operation, {
    readonly: props.readonly,
    before: props.beforeCopy,
  })
  if (!result.applied) return result

  updateLayout()
  emit('copy', {
    ids,
    copiedIds: result.operation.payload.copiedIds || [],
    idMap,
  })
  emitChange(result)
  return result
}
```

with:

```js
function copySelection() {
  const ids = currentSelectedIds()
  const expandedIds = selectedRealNodeIds()
  const payload = { ids, expandedIds }
  const unapplied = (reason) => ({
    applied: false,
    type: 'copy-selection',
    operation: { type: 'copy-selection', payload },
    inverse: null,
    previousGraph: props.graph,
    nextGraph: props.graph,
    reason,
  })

  if (expandedIds.length === 0) return unapplied('empty')
  if (props.beforeCopy && props.beforeCopy(payload) === false) return unapplied('blocked')

  clipboard = captureSubtreeSnapshot(props.graph, expandedIds)
  emit('copy', payload)
  return {
    applied: true,
    type: 'copy-selection',
    operation: { type: 'copy-selection', payload },
    inverse: null,
    previousGraph: props.graph,
    nextGraph: props.graph,
    reason: null,
  }
}

function pasteTargetId() {
  const id = currentSelectedIds()[0] ?? null
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
  const usedIds = new Set(props.graph.nodes.keys())
  const idMap = {}
  for (const node of snapshot.nodes) idMap[node.id] = nextPasteId(node.id, usedIds)
  return idMap
}

function paste() {
  const targetParentId = pasteTargetId()
  const snapshot = clipboard ?? { rootIds: [], nodes: [] }
  const idMap = createPasteIdMap(snapshot)
  const operation = { type: 'paste-nodes', payload: { targetParentId, snapshot, idMap } }
  const result = graphOperations().apply(operation, {
    readonly: props.readonly,
    before: props.beforePaste,
  })
  if (!result.applied) return result

  updateLayout()
  emit('paste', {
    targetParentId,
    pastedIds: result.operation.payload.pastedIds || [],
    idMap,
  })
  emitChange(result)
  return result
}
```

- [ ] **Step 5: Update the keyboard handler**

Replace `handleKeyDown`:

```js
function handleKeyDown(event) {
  if (event.key === 'Escape') {
    if (currentSelectedIds().length === 0) return
    event.preventDefault()
    setSelected([])
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelection()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    copySelection()
  }
}
```

with:

```js
function handleKeyDown(event) {
  if (event.key === 'Escape') {
    if (currentSelectedIds().length === 0) return
    event.preventDefault()
    setSelected([])
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    deleteSelection()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    copySelection()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
    event.preventDefault()
    paste()
  }
}
```

- [ ] **Step 6: Add `paste` to `defineExpose`**

In the `defineExpose({...})` call, add `paste,` directly after `copySelection,`:

```js
  deleteSelection,
  copySelection,
  paste,
  exportGraph,
  importGraph,
```

- [ ] **Step 7: Run the shell test file and verify it passes**

Run: `npm test -- test/minimap-shell.test.js`

Expected: PASS, all tests in the file green.

- [ ] **Step 8: Run operation, serialization, and shell tests together**

Run: `npm test -- test/minimap-graph-operations.test.js test/minimap-graph-serialization.test.js test/minimap-shell.test.js`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-shell.test.js
git commit -m "feat: split copySelection into read-only copy and a new paste command"
```

---

### Task 3: Toolbar Wiring, Roadmap, And Slice Verification

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-shell.test.js`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Add a failing toolbar test**

In `test/minimap-shell.test.js`, replace the test `'toolbar undo redo delete and copy buttons call real edit commands'` with:

```js
test('toolbar undo redo delete copy and paste buttons call real edit commands', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['feeder-1'])
  await toolbarButton(wrapper, '复制').trigger('click')
  assert.equal(wrapper.emitted('copy').length, 1)

  wrapper.vm.select(['cluster-25'])
  await toolbarButton(wrapper, '粘贴').trigger('click')
  assert.equal(wrapper.emitted('paste').length, 1)
  const pastedId = wrapper.emitted('paste')[0][0].pastedIds[0]
  assert.equal(graph.nodes.get('cluster-25').children.includes(pastedId), true)

  wrapper.vm.select([pastedId])
  await toolbarButton(wrapper, '删除').trigger('click')
  assert.equal(graph.nodes.has(pastedId), false)

  await toolbarButton(wrapper, '撤销').trigger('click')
  assert.equal(graph.nodes.has(pastedId), true)

  await toolbarButton(wrapper, '重做').trigger('click')
  assert.equal(graph.nodes.has(pastedId), false)

  wrapper.destroy()
})
```

- [ ] **Step 2: Run the shell test and verify it fails**

Run: `npm test -- test/minimap-shell.test.js`

Expected: FAIL — no toolbar button with `aria-label="粘贴"` exists yet.

- [ ] **Step 3: Add the toolbar button**

In `src/minimap/Minimap.vue`, the toolbar template currently has:

```vue
<button class="minimap-toolbar-button" type="button" aria-label="复制" @click="copySelection">⌘</button>
<button class="minimap-toolbar-button" type="button" aria-label="删除" @click="deleteSelection">⌫</button>
```

Insert a new "粘贴" button between them:

```vue
<button class="minimap-toolbar-button" type="button" aria-label="复制" @click="copySelection">⌘</button>
<button class="minimap-toolbar-button" type="button" aria-label="粘贴" @click="paste">⎘</button>
<button class="minimap-toolbar-button" type="button" aria-label="删除" @click="deleteSelection">⌫</button>
```

- [ ] **Step 4: Run the shell test and verify it passes**

Run: `npm test -- test/minimap-shell.test.js`

Expected: PASS.

- [ ] **Step 5: Run focused edit tests**

Run: `npm test -- test/minimap-graph-operations.test.js test/minimap-graph-serialization.test.js test/minimap-shell.test.js`

Expected: PASS.

- [ ] **Step 6: Run full verification**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Update `ROADMAP.md`**

In `ROADMAP.md`, find this line in the 第五阶段切片 list:

```md
  - [x] 切片 2：删除、复制、导入导出（基于切片 1 的 operation 机制实现 `deleteSelection`/`copySelection`/`exportGraph`/`importGraph`，补齐键盘 `Delete`、复制快捷键和 graph `version` 校验；[spec](docs/superpowers/specs/2026-06-20-phase-5-delete-copy-import-export.md)，[plan](docs/superpowers/plans/2026-06-20-phase-5-delete-copy-import-export.md)，`npm test` 与 `npm run build` 通过）
```

Replace it with:

```md
  - [x] 切片 2：删除、复制、导入导出（基于切片 1 的 operation 机制实现 `deleteSelection`/`exportGraph`/`importGraph`，补齐键盘 `Delete`、`Cmd/Ctrl+C`/`Cmd/Ctrl+V` 快捷键和 graph `version` 校验；复制/粘贴拆分为只读 `copySelection`（写入内部 clipboard，`readonly` 不拦截）+ 新增 `paste()`（插入到当前选中节点下，可重复粘贴，`readonly`/`beforePaste` 拦截）；[spec](docs/superpowers/specs/2026-06-20-phase-5-delete-copy-import-export.md)，[plan](docs/superpowers/plans/2026-06-20-phase-5-delete-copy-import-export.md)，复制/粘贴拆分 [spec](docs/superpowers/specs/2026-06-20-phase-5-copy-paste-split.md)，[plan](docs/superpowers/plans/2026-06-20-phase-5-copy-paste-split.md)，`npm test` 与 `npm run build` 通过）
```

Do not change "当前阶段"/"当前阶段 Spec"/"当前阶段计划"/"下一步" — slice 3 (节点跨父级拖拽移动与排序) is still the next planned slice; this task is a correction to the already-shipped slice 2, not a new slice.

- [ ] **Step 8: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-shell.test.js ROADMAP.md
git commit -m "feat: wire paste toolbar button and update roadmap for copy paste split"
```

---

## Self-Review Checklist

- Spec coverage:
  - `copySelection()` read-only, no mutation/history/`change`: Task 2.
  - `paste()` insert-as-child, undoable, repeatable: Task 1 (operation) + Task 2 (Vue method).
  - `readonly` blocks paste only, not copy: Task 2.
  - `beforeCopy`/`beforePaste` hooks: Task 2.
  - Group-box paste-target resolution: Task 2.
  - Empty selection/clipboard → `'empty'`: Task 1 (operation validation) + Task 2 (tests).
  - Keyboard `Cmd/Ctrl+V`: Task 2.
  - Toolbar "粘贴" button: Task 3.
  - `captureSubtreeSnapshot` JSON-safe, decoupled from live graph: Task 1.
  - Removal of dead `copy-nodes` operation: Task 1.
- Scope guard (per spec's 范围外):
  - No system clipboard integration.
  - No configurable paste insertion index — always appended at the end.
  - No cross-instance clipboard sharing.
  - No clipboard clearing on `graph` prop replacement.
- Verification:
  - Focused tests after each task.
  - Full `npm test` and `npm run build` before marking the slice complete (Task 3).
