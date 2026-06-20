# Phase 5 Delete Copy Import Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 5 slice 2 editing commands: delete selection, copy selection, graph export/import, keyboard shortcuts, and toolbar buttons, all backed by the existing operation/history layer.

**Architecture:** Extend the pure graph layer first with JSON-safe serialization and new operations, then integrate those operations through `Minimap.vue` methods, keyboard handlers, and toolbar buttons. Keep current in-place graph mutation semantics and standard `change` payloads from slice 1.

**Tech Stack:** Vue 2.7 SFC, Canvas 2D, pure JS graph helpers, `node:test`, Vue Test Utils, jsdom canvas mocks, Vite build.

---

## File Map

- Create: `src/minimap/graph-serialization.js`
  - Converts internal graph objects with `Map` nodes to JSON-safe data and back.
  - Validates current graph `version`.
- Modify: `src/minimap/graph-operations.js`
  - Add `delete-nodes`, `copy-nodes`, `remove-copied-nodes`, and `replace-graph` operations.
  - Export helpers for resolving selected ids into real node ids.
- Modify: `src/minimap/Minimap.vue`
  - Add `beforeDelete`, `beforeCopy`, `beforeImport` props.
  - Add `delete`, `copy`, `import`, `export` events.
  - Expose `deleteSelection`, `copySelection`, `exportGraph`, `importGraph`.
  - Add `Delete` / `Backspace` and `Cmd/Ctrl+C` keyboard shortcuts.
  - Wire toolbar undo, redo, delete, and copy buttons.
- Modify: `test/minimap-graph-operations.test.js`
  - Add operation tests for delete, copy, replace graph, undo/redo, readonly, hooks, and invalid states.
- Create: `test/minimap-graph-serialization.test.js`
  - Covers JSON-safe export/import and version validation.
- Modify: `test/minimap-shell.test.js`
  - Add Vue integration tests for methods, keyboard shortcuts, toolbar buttons, readonly, hooks, and events.
- Modify: `ROADMAP.md`
  - After verification, mark Phase 5 slice 2 complete and set current phase to slice 3.

---

### Task 1: Graph Serialization Helpers

**Files:**
- Create: `src/minimap/graph-serialization.js`
- Create: `test/minimap-graph-serialization.test.js`

- [ ] **Step 1: Write failing serialization tests**

Create `test/minimap-graph-serialization.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph.js'
import {
  deserializeGraph,
  serializeGraph,
  validateGraphVersion,
} from '../src/minimap/graph-serialization.js'

test('serializeGraph returns JSON-safe graph data with array nodes', () => {
  const graph = createDemoGraph()
  graph.edges.push({ id: 'e1', source: 'grid-tie', target: 'cluster-25', kind: 'link' })

  const data = serializeGraph(graph)

  assert.equal(data.version, 1)
  assert.equal(Array.isArray(data.nodes), true)
  assert.equal(data.nodes.some((node) => node.id === 'energy-root'), true)
  assert.deepEqual(data.rootIds, ['energy-root'])
  assert.deepEqual(data.edges, [{ id: 'e1', source: 'grid-tie', target: 'cluster-25', kind: 'link' }])
  assert.equal(JSON.parse(JSON.stringify(data)).nodes.length, graph.nodes.size)
})

test('deserializeGraph converts JSON-safe graph data back to the internal Map shape', () => {
  const graph = createDemoGraph()
  const data = serializeGraph(graph)
  const parsed = deserializeGraph(JSON.stringify(data))

  assert.equal(parsed.valid, true)
  assert.equal(parsed.graph.version, 1)
  assert.equal(parsed.graph.nodes instanceof Map, true)
  assert.deepEqual(parsed.graph.nodes.get('energy-root').children, ['grid-tie', 'heap-1', 'cluster-25'])
  assert.deepEqual(parsed.graph.rootIds, ['energy-root'])
  assert.deepEqual(parsed.graph.edges, [])
})

test('deserializeGraph accepts missing edges and children defaults', () => {
  const parsed = deserializeGraph({
    version: 1,
    nodes: [{ id: 'root', label: 'Root', parentId: null }],
    rootIds: ['root'],
  })

  assert.equal(parsed.valid, true)
  assert.deepEqual(parsed.graph.nodes.get('root').children, [])
  assert.deepEqual(parsed.graph.edges, [])
})

test('validateGraphVersion rejects unsupported versions', () => {
  assert.deepEqual(validateGraphVersion({ version: 999 }), { valid: false, reason: 'invalid-version' })
  assert.deepEqual(validateGraphVersion({ version: 1 }), { valid: true, reason: null })
})

test('deserializeGraph rejects invalid shapes without throwing', () => {
  assert.deepEqual(deserializeGraph('{bad json'), { valid: false, reason: 'invalid', graph: null })
  assert.deepEqual(deserializeGraph({ version: 999, nodes: [], rootIds: [] }), {
    valid: false,
    reason: 'invalid-version',
    graph: null,
  })
  assert.deepEqual(deserializeGraph({ version: 1, nodes: 'bad', rootIds: [] }), {
    valid: false,
    reason: 'invalid',
    graph: null,
  })
})
```

- [ ] **Step 2: Run serialization test and verify it fails**

Run:

```bash
npm test -- test/minimap-graph-serialization.test.js
```

Expected: FAIL with module not found for `src/minimap/graph-serialization.js`.

- [ ] **Step 3: Implement graph serialization**

Create `src/minimap/graph-serialization.js`:

```js
export const GRAPH_VERSION = 1

function cloneNode(node) {
  return {
    ...node,
    children: [...(node.children || [])],
  }
}

export function serializeGraph(graph) {
  return {
    version: graph.version ?? GRAPH_VERSION,
    nodes: [...graph.nodes.values()].map(cloneNode),
    rootIds: [...(graph.rootIds || [])],
    edges: [...(graph.edges || [])].map((edge) => ({ ...edge })),
  }
}

export function validateGraphVersion(data) {
  if (!data || data.version !== GRAPH_VERSION) return { valid: false, reason: 'invalid-version' }
  return { valid: true, reason: null }
}

export function deserializeGraph(input) {
  let data
  try {
    data = typeof input === 'string' ? JSON.parse(input) : input
  } catch {
    return { valid: false, reason: 'invalid', graph: null }
  }

  const version = validateGraphVersion(data)
  if (!version.valid) return { valid: false, reason: version.reason, graph: null }
  if (!Array.isArray(data.nodes) || !Array.isArray(data.rootIds)) {
    return { valid: false, reason: 'invalid', graph: null }
  }

  const nodes = new Map()
  for (const rawNode of data.nodes) {
    if (!rawNode || typeof rawNode.id !== 'string') {
      return { valid: false, reason: 'invalid', graph: null }
    }
    nodes.set(rawNode.id, {
      ...rawNode,
      children: Array.isArray(rawNode.children) ? [...rawNode.children] : [],
    })
  }

  return {
    valid: true,
    reason: null,
    graph: {
      version: data.version,
      nodes,
      rootIds: [...data.rootIds],
      edges: Array.isArray(data.edges) ? data.edges.map((edge) => ({ ...edge })) : [],
    },
  }
}
```

- [ ] **Step 4: Run serialization tests**

Run:

```bash
npm test -- test/minimap-graph-serialization.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/graph-serialization.js test/minimap-graph-serialization.test.js
git commit -m "feat: add graph serialization helpers"
```

---

### Task 2: Delete, Copy, And Replace Graph Operations

**Files:**
- Modify: `src/minimap/graph-operations.js`
- Modify: `test/minimap-graph-operations.test.js`

- [ ] **Step 1: Add failing operation tests**

Append to `test/minimap-graph-operations.test.js`:

```js
test('delete-nodes removes selected subtrees, root ids, and related edges with undo redo', () => {
  const graph = createDemoGraph()
  graph.rootIds.push('standalone')
  graph.nodes.set('standalone', { id: 'standalone', label: 'Standalone', parentId: null, children: [] })
  graph.edges.push({ id: 'edge-a', source: 'grid-tie', target: 'feeder-1' })
  graph.edges.push({ id: 'edge-b', source: 'heap-1', target: 'standalone' })
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'delete-nodes',
    payload: { ids: ['grid-tie', 'feeder-1', 'standalone'], expandedIds: ['grid-tie', 'feeder-1', 'standalone'] },
  })

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.has('grid-tie'), false)
  assert.equal(graph.nodes.has('feeder-1'), false)
  assert.equal(graph.nodes.has('standalone'), false)
  assert.deepEqual(graph.nodes.get('energy-root').children, ['heap-1', 'cluster-25'])
  assert.deepEqual(graph.rootIds, ['energy-root'])
  assert.deepEqual(graph.edges, [])

  manager.undo()
  assert.equal(graph.nodes.has('grid-tie'), true)
  assert.equal(graph.nodes.has('feeder-1'), true)
  assert.equal(graph.nodes.has('standalone'), true)
  assert.deepEqual(graph.nodes.get('energy-root').children, ['grid-tie', 'heap-1', 'cluster-25'])
  assert.deepEqual(graph.rootIds, ['energy-root', 'standalone'])
  assert.equal(graph.edges.length, 2)

  manager.redo()
  assert.equal(graph.nodes.has('grid-tie'), false)
  assert.deepEqual(graph.edges, [])
})

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

test('replace-graph swaps graph contents and can undo redo', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)
  const next = {
    version: 1,
    nodes: new Map([['new-root', { id: 'new-root', label: 'New Root', parentId: null, children: [] }]]),
    rootIds: ['new-root'],
    edges: [],
  }

  const result = manager.apply({ type: 'replace-graph', payload: { graph: next } })

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.has('energy-root'), false)
  assert.equal(graph.nodes.has('new-root'), true)
  assert.deepEqual(graph.rootIds, ['new-root'])

  manager.undo()
  assert.equal(graph.nodes.has('energy-root'), true)
  assert.equal(graph.nodes.has('new-root'), false)

  manager.redo()
  assert.equal(graph.nodes.has('new-root'), true)
})

test('delete copy and import operations respect readonly and before hooks', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

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
        type: 'copy-nodes',
        payload: { ids: ['grid-tie'], expandedIds: ['grid-tie'], idMap: { 'grid-tie': 'copy-grid-tie-1' } },
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

test('delete and copy return empty or invalid for unusable payloads', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  assert.equal(manager.apply({ type: 'delete-nodes', payload: { ids: [], expandedIds: [] } }).reason, 'empty')
  assert.equal(manager.apply({ type: 'copy-nodes', payload: { ids: [], expandedIds: [], idMap: {} } }).reason, 'empty')
  assert.equal(
    manager.apply({
      type: 'copy-nodes',
      payload: { ids: ['grid-tie'], expandedIds: ['grid-tie'], idMap: {} },
    }).reason,
    'invalid',
  )
})
```

- [ ] **Step 2: Run operation tests and verify they fail**

Run:

```bash
npm test -- test/minimap-graph-operations.test.js
```

Expected: FAIL because `delete-nodes`, `copy-nodes`, and `replace-graph` are not implemented.

- [ ] **Step 3: Implement operation helpers**

In `src/minimap/graph-operations.js`, import serialization:

```js
import { serializeGraph } from './graph-serialization.js'
```

Add helper functions above `applyOperation`:

```js
function cloneGraphData(graph) {
  const data = serializeGraph(graph)
  return {
    version: data.version,
    nodes: new Map(data.nodes.map((node) => [node.id, { ...node, children: [...(node.children || [])] }])),
    rootIds: [...data.rootIds],
    edges: data.edges.map((edge) => ({ ...edge })),
  }
}

function replaceGraphContents(target, source) {
  target.version = source.version
  target.nodes.clear()
  for (const [id, node] of source.nodes) target.nodes.set(id, { ...node, children: [...(node.children || [])] })
  target.rootIds = [...source.rootIds]
  target.edges = source.edges.map((edge) => ({ ...edge }))
}

function collectDescendants(graph, id, result = new Set()) {
  if (result.has(id)) return result
  const node = graph.nodes.get(id)
  if (!node) return result
  result.add(id)
  for (const childId of node.children || []) collectDescendants(graph, childId, result)
  return result
}

function highestExistingIds(graph, ids) {
  const unique = [...new Set(ids)].filter((id) => graph.nodes.has(id))
  const selected = new Set(unique)
  return unique.filter((id) => {
    let parentId = graph.nodes.get(id)?.parentId
    while (parentId) {
      if (selected.has(parentId)) return false
      parentId = graph.nodes.get(parentId)?.parentId
    }
    return true
  })
}

function applyDeleteNodes(graph, operation) {
  const ids = highestExistingIds(graph, operation.payload.expandedIds || operation.payload.ids || [])
  if (ids.length === 0) return blockedResult(graph, operation, 'empty')
  const before = cloneGraphData(graph)
  const deleted = new Set()
  for (const id of ids) collectDescendants(graph, id, deleted)
  if (deleted.size === 0) return blockedResult(graph, operation, 'empty')

  for (const node of graph.nodes.values()) {
    node.children = (node.children || []).filter((id) => !deleted.has(id))
  }
  for (const id of deleted) graph.nodes.delete(id)
  graph.rootIds = graph.rootIds.filter((id) => !deleted.has(id))
  graph.edges = (graph.edges || []).filter((edge) => !deleted.has(edge.source) && !deleted.has(edge.target))

  return result({
    applied: true,
    type: operation.type,
    operation: { ...operation, payload: { ...operation.payload, deletedIds: [...deleted] } },
    inverse: { type: 'replace-graph', payload: { graph: before } },
    graph,
  })
}

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

function applyReplaceGraph(graph, operation) {
  const nextGraph = operation.payload.graph
  if (!nextGraph?.nodes || !(nextGraph.nodes instanceof Map) || !Array.isArray(nextGraph.rootIds)) {
    return blockedResult(graph, operation, operation.payload.reason || 'invalid')
  }
  const before = cloneGraphData(graph)
  replaceGraphContents(graph, nextGraph)
  return result({
    applied: true,
    type: operation.type,
    operation,
    inverse: { type: 'replace-graph', payload: { graph: before } },
    graph,
  })
}
```

Extend `applyOperation`:

```js
if (operation.type === 'delete-nodes') return applyDeleteNodes(graph, operation)
if (operation.type === 'copy-nodes') return applyCopyNodes(graph, operation)
if (operation.type === 'replace-graph') return applyReplaceGraph(graph, operation)
```

- [ ] **Step 4: Run operation tests**

Run:

```bash
npm test -- test/minimap-graph-operations.test.js
```

Expected: PASS.

- [ ] **Step 5: Run serialization and operation tests together**

Run:

```bash
npm test -- test/minimap-graph-serialization.test.js test/minimap-graph-operations.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/minimap/graph-operations.js test/minimap-graph-operations.test.js
git commit -m "feat: add edit graph operations"
```

---

### Task 3: Vue Methods, Keyboard Shortcuts, And Events

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-shell.test.js`

- [ ] **Step 1: Add failing Vue method and keyboard tests**

Append to `test/minimap-shell.test.js`:

```js
function dispatchKey(wrapper, key, options = {}) {
  wrapper.find('canvas').element.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }),
  )
}

test('deleteSelection deletes selected nodes, emits events, and supports undo', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['grid-tie'])
  const result = wrapper.vm.deleteSelection()

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.has('grid-tie'), false)
  assert.equal(graph.nodes.has('feeder-1'), false)
  assert.deepEqual(wrapper.emitted('delete')[0][0].deletedIds.sort(), ['feeder-1', 'feeder-2', 'feeder-3', 'grid-tie'])
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'delete-nodes')
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], [])

  wrapper.vm.undo()
  assert.equal(graph.nodes.has('grid-tie'), true)
  wrapper.destroy()
})

test('copySelection duplicates selected nodes and emits events', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['grid-tie'])
  const result = wrapper.vm.copySelection()

  assert.equal(result.applied, true)
  const copiedId = wrapper.emitted('copy')[0][0].idMap['grid-tie']
  assert.equal(graph.nodes.has(copiedId), true)
  assert.equal(graph.nodes.get(copiedId).children.length, 3)
  assert.deepEqual(graph.nodes.get('energy-root').children.slice(0, 2), ['grid-tie', copiedId])
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'copy-nodes')
  wrapper.destroy()
})

test('exportGraph returns JSON-safe data and does not enter history', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  const exported = wrapper.vm.exportGraph()

  assert.equal(Array.isArray(exported.nodes), true)
  assert.equal(exported.nodes.some((node) => node.id === 'energy-root'), true)
  assert.equal(wrapper.vm.canUndo(), false)
  assert.equal(wrapper.emitted('export')[0][0].graph, exported)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('importGraph replaces graph contents and supports undo', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const data = {
    version: 1,
    nodes: [{ id: 'new-root', label: 'New Root', parentId: null, children: [] }],
    rootIds: ['new-root'],
    edges: [],
  }

  const result = wrapper.vm.importGraph(data)

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.has('energy-root'), false)
  assert.equal(graph.nodes.has('new-root'), true)
  assert.equal(wrapper.emitted('import')[0][0].graph, graph)
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'replace-graph')

  wrapper.vm.undo()
  assert.equal(graph.nodes.has('energy-root'), true)
  wrapper.destroy()
})

test('invalid importGraph returns a failed result without emitting change', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  const result = wrapper.vm.importGraph({ version: 999, nodes: [], rootIds: [] })

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'invalid-version')
  assert.equal(graph.nodes.has('energy-root'), true)
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('readonly and before hooks block delete copy and import methods', () => {
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
  assert.equal(wrapper.vm.copySelection().reason, 'readonly')
  assert.equal(wrapper.vm.importGraph({ version: 1, nodes: [], rootIds: [] }).reason, 'readonly')
  assert.equal(graph.nodes.has('grid-tie'), true)
  wrapper.destroy()

  const blockedGraph = createDemoGraph()
  const blocked = mount(Minimap, {
    propsData: {
      graph: blockedGraph,
      beforeDelete: () => false,
      beforeCopy: () => false,
      beforeImport: () => false,
    },
  })
  blocked.vm.select(['grid-tie'])

  assert.equal(blocked.vm.deleteSelection().reason, 'blocked')
  assert.equal(blocked.vm.copySelection().reason, 'blocked')
  assert.equal(blocked.vm.importGraph({ version: 1, nodes: [], rootIds: [] }).reason, 'blocked')
  assert.equal(blockedGraph.nodes.has('grid-tie'), true)
  blocked.destroy()
})

test('keyboard Delete Backspace and Cmd/Ctrl+C trigger edit commands', () => {
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
  wrapper.vm.select(['grid-tie'])
  dispatchKey(wrapper, 'c', { metaKey: true })
  assert.equal(wrapper.emitted('copy').length, 1)

  wrapper.destroy()
})
```

- [ ] **Step 2: Run shell tests and verify they fail**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: FAIL because new methods, props, events, and keyboard shortcuts are not implemented.

- [ ] **Step 3: Implement Vue props/events/imports**

In `src/minimap/Minimap.vue`, import serialization:

```js
import { deserializeGraph, serializeGraph } from './graph-serialization.js'
```

Add props:

```js
beforeDelete: { type: Function, default: null },
beforeCopy: { type: Function, default: null },
beforeImport: { type: Function, default: null },
```

Add events:

```js
'delete',
'copy',
'import',
'export',
```

- [ ] **Step 4: Implement selection expansion and id generation helpers**

Add before exposed methods:

```js
function selectedRealNodeIds() {
  if (!layout) return currentSelectedIds()
  const groupsById = new Map(layout.groups.map((group) => [group.id, group]))
  const ids = []
  for (const id of currentSelectedIds()) {
    const group = groupsById.get(id)
    if (group) ids.push(...group.children)
    else ids.push(id)
  }
  return [...new Set(ids)]
}

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

function selectionAfterDeleting(deletedIds) {
  const deleted = new Set(deletedIds)
  return currentSelectedIds().filter((id) => !deleted.has(id))
}
```

- [ ] **Step 5: Implement methods**

Add methods before `defineExpose`:

```js
function deleteSelection() {
  const ids = currentSelectedIds()
  const expandedIds = selectedRealNodeIds()
  const operation = { type: 'delete-nodes', payload: { ids, expandedIds } }
  const result = graphOperations().apply(operation, {
    readonly: props.readonly,
    before: props.beforeDelete,
  })
  if (!result.applied) return result

  updateLayout()
  setSelected(selectionAfterDeleting(result.operation.payload.deletedIds || []))
  emit('delete', { ids, deletedIds: result.operation.payload.deletedIds || [] })
  emitChange(result)
  return result
}

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

function exportGraph() {
  const graph = serializeGraph(props.graph)
  emit('export', { graph })
  return graph
}

function importGraph(data) {
  if (props.readonly) {
    return {
      applied: false,
      type: 'replace-graph',
      operation: { type: 'replace-graph', payload: { data } },
      inverse: null,
      previousGraph: props.graph,
      nextGraph: props.graph,
      reason: 'readonly',
    }
  }
  const parsed = deserializeGraph(data)
  if (!parsed.valid) {
    return {
      applied: false,
      type: 'replace-graph',
      operation: { type: 'replace-graph', payload: { data } },
      inverse: null,
      previousGraph: props.graph,
      nextGraph: props.graph,
      reason: parsed.reason,
    }
  }
  const operation = { type: 'replace-graph', payload: { graph: parsed.graph } }
  const result = graphOperations().apply(operation, {
    before: props.beforeImport,
  })
  if (!result.applied) return result

  updateLayout()
  setSelected([])
  emit('import', { graph: props.graph })
  emitChange(result)
  return result
}
```

Add them to `defineExpose`:

```js
deleteSelection,
copySelection,
exportGraph,
importGraph,
```

- [ ] **Step 6: Update keyboard handler**

Replace `handleKeyDown` with:

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

- [ ] **Step 7: Run shell tests**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: PASS.

- [ ] **Step 8: Run operation, serialization, and shell tests together**

Run:

```bash
npm test -- test/minimap-graph-serialization.test.js test/minimap-graph-operations.test.js test/minimap-shell.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-shell.test.js
git commit -m "feat: expose delete copy import export commands"
```

---

### Task 4: Toolbar Wiring And Slice Verification

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-shell.test.js`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Add failing toolbar tests**

Append to `test/minimap-shell.test.js`:

```js
function toolbarButton(wrapper, label) {
  return wrapper.find(`.minimap-toolbar-button[aria-label="${label}"]`)
}

test('toolbar undo redo delete and copy buttons call real edit commands', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.select(['grid-tie'])
  await toolbarButton(wrapper, '删除').trigger('click')
  assert.equal(graph.nodes.has('grid-tie'), false)

  await toolbarButton(wrapper, '撤销').trigger('click')
  assert.equal(graph.nodes.has('grid-tie'), true)

  await toolbarButton(wrapper, '重做').trigger('click')
  assert.equal(graph.nodes.has('grid-tie'), false)

  await toolbarButton(wrapper, '撤销').trigger('click')
  wrapper.vm.select(['grid-tie'])
  await toolbarButton(wrapper, '复制').trigger('click')
  assert.equal(wrapper.emitted('copy').length, 1)

  wrapper.destroy()
})
```

- [ ] **Step 2: Run shell test and verify it fails**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: FAIL because toolbar buttons are still disabled or not wired.

- [ ] **Step 3: Wire toolbar buttons**

In `src/minimap/Minimap.vue` template, replace the undo/redo buttons:

```vue
<button class="minimap-toolbar-button" type="button" aria-label="撤销" @click="undo">↶</button>
<button class="minimap-toolbar-button" type="button" aria-label="重做" @click="redo">↷</button>
```

Replace the disabled copy-like button with a real copy button:

```vue
<button class="minimap-toolbar-button" type="button" aria-label="复制" @click="copySelection">⌘</button>
```

Replace the existing selection or another nearby command slot with delete if needed. Keep at least one `aria-label="删除"` button:

```vue
<button class="minimap-toolbar-button" type="button" aria-label="删除" @click="deleteSelection">⌫</button>
```

Do not add import/export toolbar buttons in this slice.

- [ ] **Step 4: Run shell tests**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: PASS. If the earlier shell test expects disabled undo, update that assertion to expect the button exists and has no `disabled` attribute.

- [ ] **Step 5: Run focused edit tests**

Run:

```bash
npm test -- test/minimap-graph-serialization.test.js test/minimap-graph-operations.test.js test/minimap-shell.test.js
```

Expected: PASS.

- [ ] **Step 6: Run full verification**

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

- [ ] **Step 7: Update roadmap**

In `ROADMAP.md`:

Set current phase:

```md
- **当前阶段**：第五阶段切片 3 —— 节点跨父级拖拽移动与排序
- **当前阶段 Spec**：待创建；基于 operation/history 合同实现普通节点和分组内节点跨父级移动
- **当前阶段计划**：待创建；spec 确认后写第五阶段切片 3 implementation plan
```

Update slice 2:

```md
- [x] 切片 2：删除、复制、导入导出（基于切片 1 的 operation 机制实现 `deleteSelection`/`copySelection`/`exportGraph`/`importGraph`，补齐键盘 `Delete`、复制快捷键和 graph `version` 校验；[spec](docs/superpowers/specs/2026-06-20-phase-5-delete-copy-import-export.md)，[plan](docs/superpowers/plans/2026-06-20-phase-5-delete-copy-import-export.md)，`npm test` 与 `npm run build` 通过）
```

Set next step:

```md
- **下一步**：创建第五阶段切片 3「节点跨父级拖拽移动与排序」spec 和 plan。
```

- [ ] **Step 8: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-shell.test.js ROADMAP.md
git commit -m "feat: wire edit toolbar commands"
```

---

## Self-Review Checklist

- Spec coverage:
  - Delete selection: Tasks 2 and 3.
  - Copy selection: Tasks 2 and 3.
  - Export graph: Tasks 1 and 3.
  - Import graph: Tasks 1, 2, and 3.
  - Keyboard shortcuts: Task 3.
  - Toolbar buttons: Task 4.
  - Readonly and before hooks: Tasks 2 and 3.
  - Version validation: Task 1.
- Scope guard:
  - No cross-parent drag.
  - No file picker or download UI.
  - No paste or system clipboard integration.
  - No loading/error/aria/performance state work.
- Verification:
  - Focused tests after each task.
  - Full `npm test` and `npm run build` before marking the slice complete.
