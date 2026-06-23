# Node Tree Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-side "节点树" mode that can replace the topology canvas for large graph browsing and editing while sharing the same graph, selection, events, and undo/redo history.

**Architecture:** Implement the risky graph operation extensions first, then build pure node-tree helpers, then `NodeTree.vue`, then wire it into `Minimap.vue` and `minimap-controller`. The left `ResourceTree` remains a resource source; the new right-side `NodeTree` edits existing graph nodes through controller APIs and never mutates graph directly.

**Tech Stack:** Vue 2.7 Options API, native Node test runner, `@vue/test-utils`, existing graph operation manager, existing virtual-window helper.

---

## File Structure

- Create `src/minimap/node-tree/model.js`: flatten graph nodes into virtual tree rows, search filtering, selected drag id normalization, drop target helpers.
- Create `src/minimap/components/NodeTree.vue`: DOM virtualized node-tree UI, search, selection, keyboard focus, node/resource drag and drop event emission.
- Modify `src/minimap/graph/graph-operations.js`: support root-level `drop-node`, `drop-nodes`, `move-node`, `move-nodes`, and `paste-nodes`.
- Modify `src/minimap/controllers/minimap-controller.js`: expose node-tree editing methods that reuse selection and edit controllers.
- Modify `src/minimap/controllers/edit-controller.js`: allow paste into `null` root target once graph operations support it.
- Modify `src/minimap/components/Minimap.vue`: add display mode prop/state, mode switch, conditional topology vs node-tree mount, node-tree event handlers, emits.
- Modify `src/style.css`: add node-tree and mode switch styles.
- Test `test/minimap-graph-operations.test.js`: root-level operation behavior.
- Test `test/minimap-node-tree-model.test.js`: pure helper behavior.
- Test `test/minimap-node-tree.test.js`: component browsing, virtualization, and drag/drop event behavior.
- Test `test/minimap-shell.test.js`: topology/node-tree mode mounting and controlled/uncontrolled mode state.
- Test `test/minimap-drop.test.js` or create `test/minimap-node-tree-integration.test.js`: node-tree resource drop and node move integration.
- Modify `README.md`: document `displayMode`, `display-mode-change`, and node-tree mode.

## Task 1: Root-Level Graph Operations

**Files:**
- Modify: `src/minimap/graph/graph-operations.js`
- Test: `test/minimap-graph-operations.test.js`

- [ ] **Step 1: Add failing root-level operation tests**

Append these tests to `test/minimap-graph-operations.test.js`:

```js
test('drop-node can create a root node with undo and redo', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'drop-node',
    payload: {
      resource: { id: 'root-resource', label: 'Root Resource' },
      parentId: null,
      index: 0,
      id: 'res-root-resource-1',
    },
  })

  assert.equal(result.applied, true)
  assert.equal(graph.rootIds[0], 'res-root-resource-1')
  assert.equal(graph.nodes.get('res-root-resource-1').parentId, null)
  assert.equal(graph.nodes.get('res-root-resource-1').label, 'Root Resource')

  manager.undo()
  assert.equal(graph.nodes.has('res-root-resource-1'), false)
  assert.deepEqual(graph.rootIds, ['energy-root'])

  manager.redo()
  assert.equal(graph.rootIds[0], 'res-root-resource-1')
})

test('drop-nodes can create multiple root nodes in order', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'drop-nodes',
    payload: {
      parentId: null,
      index: 1,
      nodes: [
        { id: 'res-a-1', resource: { id: 'a', label: 'A' } },
        { id: 'res-b-1', resource: { id: 'b', label: 'B' } },
      ],
    },
  })

  assert.equal(result.applied, true)
  assert.deepEqual(graph.rootIds, ['energy-root', 'res-a-1', 'res-b-1'])
  assert.equal(graph.nodes.get('res-a-1').parentId, null)
  assert.equal(graph.nodes.get('res-b-1').parentId, null)
})

test('move-nodes can move nodes to root level with undo and redo', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'move-nodes',
    payload: { nodeIds: ['grid-tie', 'heap-1'], toParentId: null, index: 1 },
  })

  assert.equal(result.applied, true)
  assert.deepEqual(graph.rootIds, ['energy-root', 'grid-tie', 'heap-1'])
  assert.deepEqual(graph.nodes.get('energy-root').children, ['cluster-25'])
  assert.equal(graph.nodes.get('grid-tie').parentId, null)

  manager.undo()
  assert.deepEqual(graph.rootIds, ['energy-root'])
  assert.deepEqual(graph.nodes.get('energy-root').children, ['grid-tie', 'heap-1', 'cluster-25'])

  manager.redo()
  assert.deepEqual(graph.rootIds, ['energy-root', 'grid-tie', 'heap-1'])
})

test('paste-nodes can paste copied subtrees as roots', () => {
  const graph = createDemoGraph()
  const snapshot = captureSubtreeSnapshot(graph, ['grid-tie'])
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'paste-nodes',
    payload: {
      targetParentId: null,
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
  assert.equal(graph.rootIds.at(-1), 'paste-grid-tie-1')
  assert.equal(graph.nodes.get('paste-grid-tie-1').parentId, null)
  assert.deepEqual(graph.nodes.get('paste-grid-tie-1').children, [
    'paste-feeder-1-1',
    'paste-feeder-2-1',
    'paste-feeder-3-1',
  ])
})
```

- [ ] **Step 2: Run root operation tests and verify they fail**

Run: `npm test -- test/minimap-graph-operations.test.js`

Expected: FAIL on the new root-level tests with `reason` values such as `invalid` or `empty`.

- [ ] **Step 3: Implement root parent helpers**

In `src/minimap/graph/graph-operations.js`, add these helpers near `clampIndex`:

```js
function parentChildren(graph, parentId) {
  if (parentId == null) return graph.rootIds
  return graph.nodes.get(parentId)?.children ?? null
}

function setParentChildren(graph, parentId, children) {
  if (parentId == null) {
    graph.rootIds = children
    return
  }
  graph.nodes.get(parentId).children = children
}

function parentExists(graph, parentId) {
  return parentId == null || graph.nodes.has(parentId)
}
```

Then change `graphNodeFromResource` so root-created nodes get `parentId: null`:

```js
function graphNodeFromResource({ id, resource, parentId }) {
  const data = { ...(resource.data || {}), resourceId: resource.id }
  return {
    id,
    label: resource.label,
    parentId: parentId ?? null,
    children: [],
    ...(resource.kind ? { kind: resource.kind } : {}),
    data,
  }
}
```

- [ ] **Step 4: Update drop and move operations to use root-aware children**

Replace the parent validation/child mutation in `applyDropNode`, `applyDropNodes`, `applyRemoveDroppedNode`, and `applyMoveNodes` with `parentExists`, `parentChildren`, and `setParentChildren`. The key blocks should become:

```js
// applyDropNode
if (!parentExists(graph, parentId) || !id || graph.nodes.has(id)) return blockedResult(graph, operation, 'invalid')
const children = parentChildren(graph, parentId)
const insertIndex = clampIndex(index, children.length)
const node = graphNodeFromResource({ id, resource, parentId })
graph.nodes.set(id, node)
children.splice(insertIndex, 0, id)
setParentChildren(graph, parentId, children)
```

```js
// applyDropNodes
if (!parentExists(graph, parentId) || !Array.isArray(nodes) || nodes.length === 0) return blockedResult(graph, operation, 'invalid')
const children = parentChildren(graph, parentId)
const insertIndex = clampIndex(index, children.length)
// after creating insertedIds
children.splice(insertIndex, 0, ...insertedIds)
setParentChildren(graph, parentId, children)
```

```js
// applyRemoveDroppedNode
if (!parentExists(graph, parentId) || !graph.nodes.has(childId)) return blockedResult(graph, operation, 'invalid')
setParentChildren(graph, parentId, parentChildren(graph, parentId).filter((id) => id !== childId))
graph.nodes.delete(childId)
```

```js
// applyMoveNodes target validation
if (!parentExists(graph, toParentId) || !Array.isArray(nodeIds) || nodeIds.length === 0) return blockedResult(graph, operation, 'invalid')

// remove from old parent/root
const fromChildren = parentChildren(graph, node.parentId)
setParentChildren(graph, node.parentId, fromChildren.filter((id) => id !== nodeId))

// insert into target parent/root
const targetChildren = [...parentChildren(graph, toParentId)]
const insertIndex = clampIndex(index, targetChildren.length)
targetChildren.splice(insertIndex + offset, 0, nodeId)
setParentChildren(graph, toParentId, targetChildren)
graph.nodes.get(nodeId).parentId = toParentId ?? null
```

- [ ] **Step 5: Update paste operation to allow root target**

In `applyPasteNodes`, replace target validation and insertion with:

```js
if (!parentExists(graph, targetParentId)) return blockedResult(graph, operation, 'empty')
```

When assigning pasted root parent ids:

```js
const parentId = node.parentId && snapshotIds.has(node.parentId) ? map[node.parentId] : (targetParentId ?? null)
```

When inserting pasted root ids:

```js
const pastedIds = snapshot.rootIds.map((id) => map[id])
const targetChildren = [...parentChildren(graph, targetParentId)]
setParentChildren(graph, targetParentId, [...targetChildren, ...pastedIds])
```

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- test/minimap-graph-operations.test.js`

Expected: PASS.

Commit:

```bash
git add src/minimap/graph/graph-operations.js test/minimap-graph-operations.test.js
git commit -m "feat: support root-level graph operations"
```

## Task 2: Node Tree Pure Helpers

**Files:**
- Create: `src/minimap/node-tree/model.js`
- Test: `test/minimap-node-tree-model.test.js`

- [ ] **Step 1: Write failing helper tests**

Create `test/minimap-node-tree-model.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import {
  flattenNodeTreeRows,
  resolveNodeTreeDropTarget,
  selectedTopLevelNodeIds,
  nodeTreeRowKey,
} from '../src/minimap/node-tree/model.js'

test('flattenNodeTreeRows returns roots and expanded descendants with depth metadata', () => {
  const graph = createDemoGraph()
  const rows = flattenNodeTreeRows(graph, { expandedKeys: new Set([nodeTreeRowKey('energy-root'), nodeTreeRowKey('grid-tie')]) })

  assert.deepEqual(rows.map((row) => row.id).slice(0, 5), ['energy-root', 'grid-tie', 'feeder-1', 'feeder-2', 'feeder-3'])
  assert.deepEqual(rows.map((row) => row.depth).slice(0, 5), [0, 1, 2, 2, 2])
  assert.equal(rows[0].hasChildren, true)
  assert.equal(rows[1].expanded, true)
})

test('flattenNodeTreeRows search keeps matching ancestors visible and expands matches', () => {
  const graph = createDemoGraph()
  const rows = flattenNodeTreeRows(graph, { searchKeyword: 'feeder 2' })

  assert.deepEqual(rows.map((row) => row.id), ['energy-root', 'grid-tie', 'feeder-2'])
  assert.equal(rows[0].expanded, true)
  assert.equal(rows[1].expanded, true)
})

test('selectedTopLevelNodeIds drops descendants whose ancestor is selected', () => {
  const graph = createDemoGraph()
  const rows = flattenNodeTreeRows(graph, {
    expandedKeys: new Set([nodeTreeRowKey('energy-root'), nodeTreeRowKey('grid-tie')]),
  })

  assert.deepEqual(selectedTopLevelNodeIds(graph, rows, ['grid-tie', 'feeder-1', 'heap-1']), ['grid-tie', 'heap-1'])
})

test('resolveNodeTreeDropTarget resolves before inside after and root zones', () => {
  const row = { id: 'grid-tie', parentId: 'energy-root', index: 0, depth: 1 }
  assert.deepEqual(resolveNodeTreeDropTarget({ row, offsetY: 2, rowHeight: 34 }), {
    kind: 'before',
    parentId: 'energy-root',
    index: 0,
    targetId: 'grid-tie',
  })
  assert.deepEqual(resolveNodeTreeDropTarget({ row, offsetY: 17, rowHeight: 34 }), {
    kind: 'inside',
    parentId: 'grid-tie',
    index: 0,
    targetId: 'grid-tie',
  })
  assert.deepEqual(resolveNodeTreeDropTarget({ row, offsetY: 32, rowHeight: 34 }), {
    kind: 'after',
    parentId: 'energy-root',
    index: 1,
    targetId: 'grid-tie',
  })
  assert.deepEqual(resolveNodeTreeDropTarget({ row: null, rootIndex: 1 }), {
    kind: 'root',
    parentId: null,
    index: 1,
    targetId: null,
  })
})
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run: `npm test -- test/minimap-node-tree-model.test.js`

Expected: FAIL with module-not-found for `src/minimap/node-tree/model.js`.

- [ ] **Step 3: Implement node-tree model helpers**

Create `src/minimap/node-tree/model.js`:

```js
export function nodeTreeRowKey(id) {
  return `node:${id}`
}

function nodeMatchesSearch(node, keyword) {
  const query = String(keyword || '').trim().toLowerCase()
  if (!query) return true
  return String(node.id ?? '').toLowerCase().includes(query) ||
    String(node.label ?? '').toLowerCase().includes(query)
}

function subtreeMatches(graph, id, keyword) {
  const node = graph.nodes.get(id)
  if (!node) return false
  if (nodeMatchesSearch(node, keyword)) return true
  return (node.children || []).some((childId) => subtreeMatches(graph, childId, keyword))
}

function pushNodeRows(graph, id, context, rows) {
  const node = graph.nodes.get(id)
  if (!node) return
  const { depth, expandedKeys, searchKeyword, parentId, index } = context
  if (searchKeyword && !subtreeMatches(graph, id, searchKeyword)) return

  const hasChildren = (node.children || []).length > 0
  const expanded = searchKeyword ? hasChildren : expandedKeys.has(nodeTreeRowKey(id))
  rows.push({
    key: nodeTreeRowKey(id),
    id,
    label: node.label ?? id,
    parentId: parentId ?? null,
    index,
    depth,
    expanded,
    hasChildren,
    node,
  })

  if (!hasChildren || !expanded) return
  node.children.forEach((childId, childIndex) => {
    pushNodeRows(graph, childId, {
      depth: depth + 1,
      expandedKeys,
      searchKeyword,
      parentId: id,
      index: childIndex,
    }, rows)
  })
}

export function flattenNodeTreeRows(graph, {
  expandedKeys = new Set(),
  searchKeyword = '',
} = {}) {
  const rows = []
  const query = String(searchKeyword || '').trim()
  ;(graph.rootIds || []).forEach((id, index) => {
    pushNodeRows(graph, id, {
      depth: 0,
      expandedKeys,
      searchKeyword: query,
      parentId: null,
      index,
    }, rows)
  })
  return rows
}

function isDescendantOf(graph, ancestorId, nodeId) {
  let current = graph.nodes.get(nodeId)?.parentId ?? null
  while (current) {
    if (current === ancestorId) return true
    current = graph.nodes.get(current)?.parentId ?? null
  }
  return false
}

export function selectedTopLevelNodeIds(graph, rows, selectedIds) {
  const selected = new Set(selectedIds || [])
  return rows
    .map((row) => row.id)
    .filter((id) => selected.has(id))
    .filter((id) => ![...selected].some((candidate) => candidate !== id && isDescendantOf(graph, candidate, id)))
}

export function wouldDropIntoSelfOrDescendant(graph, draggedIds, parentId) {
  if (parentId == null) return false
  return (draggedIds || []).some((id) => id === parentId || isDescendantOf(graph, id, parentId))
}

export function resolveNodeTreeDropTarget({ row, offsetY = 0, rowHeight = 34, rootIndex = 0 }) {
  if (!row) return { kind: 'root', parentId: null, index: rootIndex, targetId: null }
  const edgeSize = Math.max(6, Math.floor(rowHeight * 0.25))
  if (offsetY <= edgeSize) {
    return { kind: 'before', parentId: row.parentId ?? null, index: row.index, targetId: row.id }
  }
  if (offsetY >= rowHeight - edgeSize) {
    return { kind: 'after', parentId: row.parentId ?? null, index: row.index + 1, targetId: row.id }
  }
  return { kind: 'inside', parentId: row.id, index: 0, targetId: row.id }
}
```

- [ ] **Step 4: Run helper tests and commit**

Run: `npm test -- test/minimap-node-tree-model.test.js`

Expected: PASS.

Commit:

```bash
git add src/minimap/node-tree/model.js test/minimap-node-tree-model.test.js
git commit -m "feat: add node tree model helpers"
```

## Task 3: NodeTree Browsing Component

**Files:**
- Create: `src/minimap/components/NodeTree.vue`
- Test: `test/minimap-node-tree.test.js`

- [ ] **Step 1: Write failing component browsing tests**

Create `test/minimap-node-tree.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv } from './helpers/dom-env.js'
import { createDemoGraph } from '../src/minimap/graph/graph.js'

installDomEnv()

const { mount } = await import('@vue/test-utils')
const NodeTree = (await import('../src/minimap/components/NodeTree.vue')).default

function makeLargeGraph(count = 10000) {
  const nodes = new Map()
  const root = { id: 'root', label: 'Root', parentId: null, children: [] }
  nodes.set('root', root)
  for (let i = 0; i < count; i += 1) {
    const id = `node-${i}`
    root.children.push(id)
    nodes.set(id, { id, label: `Node ${i}`, parentId: 'root', children: [] })
  }
  return { version: 1, nodes, rootIds: ['root'], edges: [] }
}

test('renders graph rows with title and virtualized large row count', async () => {
  const wrapper = mount(NodeTree, { propsData: { graph: makeLargeGraph(), selectedIds: [] }, attachTo: document.body })
  Object.defineProperty(wrapper.vm.$refs.scroller, 'clientHeight', { value: 280, configurable: true })
  wrapper.vm.expandedKeys = new Set(['node:root'])
  await wrapper.vm.$nextTick()

  assert.equal(wrapper.find('.node-tree-title').text(), '节点树')
  const rows = wrapper.findAll('.node-tree-row')
  assert.ok(rows.length > 0)
  assert.ok(rows.length < 180)
  assert.equal(wrapper.find('[data-node-id="node-9999"]').exists(), false)
  wrapper.destroy()
})

test('clicking a folder toggles expansion and clicking a node emits select', async () => {
  const wrapper = mount(NodeTree, { propsData: { graph: createDemoGraph(), selectedIds: [] } })

  await wrapper.find('[data-node-id="energy-root"]').trigger('click')
  assert.equal(wrapper.find('[data-node-id="grid-tie"]').exists(), true)

  await wrapper.find('[data-node-id="grid-tie"]').trigger('click')
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], { ids: ['grid-tie'], mode: 'replace' })
  assert.equal(wrapper.find('[data-node-id="feeder-1"]').exists(), true)
  wrapper.destroy()
})

test('search filters graph nodes while keeping ancestors visible', async () => {
  const wrapper = mount(NodeTree, { propsData: { graph: createDemoGraph(), selectedIds: [], searchDelay: 1 } })

  await wrapper.find('.node-tree-search-input').setValue('feeder 2')
  await new Promise((resolve) => setTimeout(resolve, 5))
  await wrapper.vm.$nextTick()

  assert.equal(wrapper.find('[data-node-id="energy-root"]').exists(), true)
  assert.equal(wrapper.find('[data-node-id="grid-tie"]').exists(), true)
  assert.equal(wrapper.find('[data-node-id="feeder-2"]').exists(), true)
  assert.equal(wrapper.find('[data-node-id="heap-1"]').exists(), false)
  wrapper.destroy()
})

test('keyboard arrows move focus and Enter toggles focused folders', async () => {
  const wrapper = mount(NodeTree, { propsData: { graph: createDemoGraph(), selectedIds: [] } })
  wrapper.vm.focusedKey = 'node:energy-root'

  await wrapper.find('.node-tree-scroll').trigger('keydown', { key: 'Enter' })
  assert.equal(wrapper.find('[data-node-id="grid-tie"]').exists(), true)

  await wrapper.find('.node-tree-scroll').trigger('keydown', { key: 'ArrowDown' })
  assert.equal(wrapper.vm.focusedKey, 'node:grid-tie')
  wrapper.destroy()
})
```

- [ ] **Step 2: Run component tests and verify they fail**

Run: `npm test -- test/minimap-node-tree.test.js`

Expected: FAIL with module-not-found for `NodeTree.vue`.

- [ ] **Step 3: Implement the NodeTree template and browsing logic**

Create `src/minimap/components/NodeTree.vue` with this structure:

```vue
<template>
  <section class="node-tree">
    <div class="node-tree-header">
      <h2 class="node-tree-title">节点树</h2>
      <label class="node-tree-search">
        <span class="node-tree-search-icon" aria-hidden="true">⌕</span>
        <input
          class="node-tree-search-input"
          :value="searchInput"
          placeholder="搜索节点..."
          @input="onSearchInput"
        />
      </label>
    </div>
    <div
      ref="scroller"
      class="node-tree-scroll"
      role="tree"
      tabindex="0"
      @scroll="onScroll"
      @keydown="onKeyDown"
    >
      <div class="node-tree-spacer" :style="{ height: `${virtualWindow.totalHeight}px` }">
        <div class="node-tree-window" :style="{ transform: `translateY(${virtualWindow.offsetY}px)` }">
          <div
            v-for="row in renderedRows"
            :key="row.key"
            class="node-tree-row"
            :class="rowClasses(row)"
            :style="{ paddingLeft: `${10 + row.depth * 16}px` }"
            :data-node-id="row.id"
            :data-row-key="row.key"
            role="treeitem"
            :aria-expanded="row.hasChildren ? String(row.expanded) : null"
            :aria-selected="String(selectedSet.has(row.id))"
            @click="onRowClick(row, $event)"
          >
            <span class="node-tree-caret" aria-hidden="true">{{ row.hasChildren ? (row.expanded ? '▾' : '▸') : '' }}</span>
            <span class="node-tree-label">{{ row.label }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
<script>
import { flattenNodeTreeRows, nodeTreeRowKey } from '../node-tree/model.js'
import { resolveVirtualWindow } from '../resource-tree/virtual-window.js'

const ROW_HEIGHT = 34

export default {
  name: 'NodeTree',
  props: {
    graph: { type: Object, required: true },
    selectedIds: { type: Array, default: () => [] },
    searchDelay: { type: Number, default: 120 },
  },
  data() {
    return {
      expandedKeys: new Set(),
      focusedKey: null,
      anchorKey: null,
      searchInput: '',
      searchKeyword: '',
      scrollTop: 0,
      previousScrollTop: 0,
      viewportHeight: 320,
      searchTimer: null,
    }
  },
  computed: {
    selectedSet() {
      return new Set(this.selectedIds || [])
    },
    visibleRows() {
      return flattenNodeTreeRows(this.graph, {
        expandedKeys: this.expandedKeys,
        searchKeyword: this.searchKeyword,
      })
    },
    virtualWindow() {
      return resolveVirtualWindow({
        rowCount: this.visibleRows.length,
        rowHeight: ROW_HEIGHT,
        viewportHeight: this.viewportHeight,
        scrollTop: this.scrollTop,
        previousScrollTop: this.previousScrollTop,
      })
    },
    renderedRows() {
      return this.visibleRows.slice(this.virtualWindow.start, this.virtualWindow.end)
    },
  },
  mounted() {
    this.measureViewport()
  },
  beforeDestroy() {
    clearTimeout(this.searchTimer)
  },
  methods: {
    measureViewport() {
      this.viewportHeight = this.$refs.scroller?.clientHeight || 320
    },
    onScroll(event) {
      this.previousScrollTop = this.scrollTop
      this.scrollTop = event.target.scrollTop
      this.measureViewport()
    },
    onSearchInput(event) {
      this.searchInput = event.target.value
      clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(() => {
        this.searchKeyword = this.searchInput
        this.scrollTop = 0
        if (this.$refs.scroller) this.$refs.scroller.scrollTop = 0
      }, this.searchDelay)
    },
    rowClasses(row) {
      return {
        'is-expanded': row.expanded,
        'is-selected': this.selectedSet.has(row.id),
        'is-focused': this.focusedKey === row.key,
      }
    },
    toggleRow(row) {
      if (!row.hasChildren) return
      const next = new Set(this.expandedKeys)
      if (next.has(row.key)) next.delete(row.key)
      else next.add(row.key)
      this.expandedKeys = next
    },
    onRowClick(row, event) {
      this.focusedKey = row.key
      if (row.hasChildren) this.toggleRow(row)
      const mode = event.metaKey || event.ctrlKey ? 'toggle' : 'replace'
      this.$emit('select', { ids: [row.id], mode })
      this.anchorKey = row.key
    },
    moveFocus(delta) {
      if (this.visibleRows.length === 0) return
      const current = this.visibleRows.findIndex((row) => row.key === this.focusedKey)
      const nextIndex = Math.max(0, Math.min(this.visibleRows.length - 1, (current === -1 ? 0 : current) + delta))
      this.focusedKey = this.visibleRows[nextIndex].key
    },
    onKeyDown(event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        this.moveFocus(1)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        this.moveFocus(-1)
      } else if (event.key === 'Enter' && this.focusedKey) {
        const row = this.visibleRows.find((item) => item.key === this.focusedKey)
        if (row) this.toggleRow(row)
      } else if (event.key === 'ArrowRight' && this.focusedKey) {
        const row = this.visibleRows.find((item) => item.key === this.focusedKey)
        if (row?.hasChildren && !row.expanded) this.toggleRow(row)
      } else if (event.key === 'ArrowLeft' && this.focusedKey) {
        const row = this.visibleRows.find((item) => item.key === this.focusedKey)
        if (row?.hasChildren && row.expanded) this.toggleRow(row)
      }
    },
    expandNode(id) {
      this.expandedKeys = new Set([...this.expandedKeys, nodeTreeRowKey(id)])
    },
  },
}
</script>
```

- [ ] **Step 4: Run component tests and commit**

Run: `npm test -- test/minimap-node-tree.test.js`

Expected: PASS.

Commit:

```bash
git add src/minimap/components/NodeTree.vue test/minimap-node-tree.test.js
git commit -m "feat: add virtualized node tree browsing"
```

## Task 4: NodeTree Selection And Drag/Drop Events

**Files:**
- Modify: `src/minimap/components/NodeTree.vue`
- Modify: `src/minimap/node-tree/model.js`
- Test: `test/minimap-node-tree.test.js`

- [ ] **Step 1: Add failing selection and drag/drop tests**

Append to `test/minimap-node-tree.test.js`:

```js
test('additive and range selection emits ids in visible order', async () => {
  const wrapper = mount(NodeTree, { propsData: { graph: createDemoGraph(), selectedIds: [] } })
  wrapper.vm.expandedKeys = new Set(['node:energy-root'])
  await wrapper.vm.$nextTick()

  await wrapper.find('[data-node-id="grid-tie"]').trigger('click')
  await wrapper.setProps({ selectedIds: ['grid-tie'] })
  await wrapper.find('[data-node-id="cluster-25"]').trigger('click', { shiftKey: true })

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], {
    ids: ['grid-tie', 'heap-1', 'cluster-25'],
    mode: 'replace',
  })
  wrapper.destroy()
})

test('node dragstart serializes selected top-level node ids', async () => {
  const wrapper = mount(NodeTree, { propsData: { graph: createDemoGraph(), selectedIds: ['grid-tie', 'feeder-1', 'heap-1'] } })
  wrapper.vm.expandedKeys = new Set(['node:energy-root', 'node:grid-tie'])
  await wrapper.vm.$nextTick()

  const fakeDataTransfer = { data: {}, setData(type, value) { this.data[type] = value }, effectAllowed: null }
  const evt = new Event('dragstart', { bubbles: true })
  Object.defineProperty(evt, 'dataTransfer', { value: fakeDataTransfer })
  wrapper.find('[data-node-id="grid-tie"]').element.dispatchEvent(evt)

  assert.deepEqual(JSON.parse(fakeDataTransfer.data['application/x-minimap-node-tree']).nodeIds, ['grid-tie', 'heap-1'])
  assert.equal(fakeDataTransfer.effectAllowed, 'move')
  wrapper.destroy()
})

test('dropping node payload emits node-move with resolved target', async () => {
  const wrapper = mount(NodeTree, { propsData: { graph: createDemoGraph(), selectedIds: [] } })
  wrapper.vm.expandedKeys = new Set(['node:energy-root'])
  await wrapper.vm.$nextTick()

  const rowEl = wrapper.find('[data-node-id="heap-1"]').element
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'offsetY', { value: 17, configurable: true })
  Object.defineProperty(evt, 'dataTransfer', {
    value: { getData: (type) => type === 'application/x-minimap-node-tree' ? JSON.stringify({ nodeIds: ['grid-tie'] }) : '' },
  })
  rowEl.dispatchEvent(evt)

  assert.deepEqual(wrapper.emitted('node-move').at(-1)[0], {
    nodeIds: ['grid-tie'],
    parentId: 'heap-1',
    index: 0,
  })
  wrapper.destroy()
})

test('dropping resource payload emits resource-drop with resolved target', async () => {
  const wrapper = mount(NodeTree, { propsData: { graph: createDemoGraph(), selectedIds: [] } })
  wrapper.vm.expandedKeys = new Set(['node:energy-root'])
  await wrapper.vm.$nextTick()

  const rowEl = wrapper.find('[data-node-id="heap-1"]').element
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'offsetY', { value: 32, configurable: true })
  Object.defineProperty(evt, 'dataTransfer', {
    value: { getData: () => JSON.stringify({ id: 'meter', label: 'Meter' }) },
  })
  rowEl.dispatchEvent(evt)

  assert.deepEqual(wrapper.emitted('resource-drop').at(-1)[0], {
    payload: { id: 'meter', label: 'Meter' },
    parentId: 'energy-root',
    index: 2,
  })
  wrapper.destroy()
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- test/minimap-node-tree.test.js`

Expected: FAIL because drag/drop handlers and range selection are missing.

- [ ] **Step 3: Implement range selection and drag/drop handlers**

In `NodeTree.vue`, add `draggable="true"` and these handlers to `.node-tree-row`:

```vue
@dragstart="onNodeDragStart(row, $event)"
@dragover.prevent
@drop.prevent="onRowDrop(row, $event)"
```

Add methods:

```js
rangeIdsTo(row) {
  if (!this.anchorKey) return [row.id]
  const start = this.visibleRows.findIndex((item) => item.key === this.anchorKey)
  const end = this.visibleRows.findIndex((item) => item.key === row.key)
  if (start === -1 || end === -1) return [row.id]
  const [from, to] = start <= end ? [start, end] : [end, start]
  return this.visibleRows.slice(from, to + 1).map((item) => item.id)
},
onRowClick(row, event) {
  this.focusedKey = row.key
  if (row.hasChildren) this.toggleRow(row)
  if (event.shiftKey) {
    this.$emit('select', { ids: this.rangeIdsTo(row), mode: 'replace' })
  } else {
    const mode = event.metaKey || event.ctrlKey ? 'toggle' : 'replace'
    this.$emit('select', { ids: [row.id], mode })
    this.anchorKey = row.key
  }
},
onNodeDragStart(row, event) {
  const ids = selectedTopLevelNodeIds(this.graph, this.visibleRows, this.selectedSet.has(row.id) ? this.selectedIds : [row.id])
  event.dataTransfer.setData('application/x-minimap-node-tree', JSON.stringify({ nodeIds: ids }))
  event.dataTransfer.effectAllowed = 'move'
},
payloadFromDrop(event) {
  const nodePayload = event.dataTransfer.getData('application/x-minimap-node-tree')
  if (nodePayload) return { type: 'nodes', payload: JSON.parse(nodePayload) }
  const resourcePayload = event.dataTransfer.getData('application/json')
  if (resourcePayload) return { type: 'resources', payload: JSON.parse(resourcePayload) }
  return null
},
onRowDrop(row, event) {
  const dropped = this.payloadFromDrop(event)
  if (!dropped) return
  const target = resolveNodeTreeDropTarget({ row, offsetY: event.offsetY, rowHeight: ROW_HEIGHT })
  if (dropped.type === 'nodes') {
    if (wouldDropIntoSelfOrDescendant(this.graph, dropped.payload.nodeIds, target.parentId)) return
    this.$emit('node-move', { nodeIds: dropped.payload.nodeIds, parentId: target.parentId, index: target.index })
    return
  }
  this.$emit('resource-drop', { payload: dropped.payload, parentId: target.parentId, index: target.index })
}
```

Import the helper names:

```js
import {
  flattenNodeTreeRows,
  nodeTreeRowKey,
  resolveNodeTreeDropTarget,
  selectedTopLevelNodeIds,
  wouldDropIntoSelfOrDescendant,
} from '../node-tree/model.js'
```

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- test/minimap-node-tree.test.js`

Expected: PASS.

Commit:

```bash
git add src/minimap/components/NodeTree.vue src/minimap/node-tree/model.js test/minimap-node-tree.test.js
git commit -m "feat: add node tree drag interactions"
```

## Task 5: Controller Methods For NodeTree Editing

**Files:**
- Modify: `src/minimap/controllers/minimap-controller.js`
- Modify: `src/minimap/controllers/edit-controller.js`
- Test: `test/minimap-node-tree-integration.test.js`

- [ ] **Step 1: Add failing controller integration tests**

Create `test/minimap-node-tree-integration.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph/graph.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()

const { mountMinimap } = await import('./helpers/mount-minimap.js')

test('controller moveNodes moves nodes and emits change and node-move', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap({ propsData: { graph } })

  const result = wrapper.vm.controller.moveNodes({ nodeIds: ['grid-tie'], parentId: 'heap-1', index: 0 })

  assert.equal(result.applied, true)
  assert.equal(graph.nodes.get('grid-tie').parentId, 'heap-1')
  assert.equal(graph.nodes.get('heap-1').children[0], 'grid-tie')
  assert.equal(wrapper.emitted('node-move')[0][0].nodeId, 'grid-tie')
  assert.equal(wrapper.emitted('change')[0][0].type, 'move-nodes')
  wrapper.destroy()
})

test('controller dropResources creates multiple root nodes and emits drops', () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap({ propsData: { graph } })

  const result = wrapper.vm.controller.dropResources({
    resources: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    parentId: null,
    index: 1,
  })

  assert.equal(result.applied, true)
  assert.deepEqual(graph.rootIds.slice(1), result.operation.payload.insertedIds)
  assert.equal(wrapper.emitted('node-drop').length, 2)
  assert.equal(wrapper.emitted('change')[0][0].type, 'drop-nodes')
  wrapper.destroy()
})
```

- [ ] **Step 2: Run integration tests and verify they fail**

Run: `npm test -- test/minimap-node-tree-integration.test.js`

Expected: FAIL because `moveNodes` and `dropResources` are not exposed.

- [ ] **Step 3: Implement controller editing methods**

In `src/minimap/controllers/minimap-controller.js`, add helpers near the other command wrappers:

```js
function moveNodes({ nodeIds, parentId, index }) {
  const result = edit.applyOperation(
    { type: 'move-nodes', payload: { nodeIds, toParentId: parentId, index } },
    { before: deps.getBeforeNodeMove() },
  )
  if (!result.applied) return result
  core.updateLayout({ animate: false })
  selection.setSelected(result.operation.payload.nodeIds)
  for (const nodeId of result.operation.payload.nodeIds) {
    deps.emitNodeMove({ nodeId, toParentId: parentId, index: result.operation.payload.index })
  }
  edit.emitChangeIfApplied(result)
  return result
}

function nextResourceNodeId(resource, usedIds = new Set(deps.getGraph().nodes.keys())) {
  const base = `res-${String(resource.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`
  let index = 1
  let id = `${base}-${index}`
  while (usedIds.has(id)) {
    index += 1
    id = `${base}-${index}`
  }
  usedIds.add(id)
  return id
}

function normalizeResourceDropPayload(payload) {
  const resources = Array.isArray(payload.resources) ? payload.resources : [payload]
  return resources.filter((item) => item?.id != null && item?.label != null)
}

function dropResources({ resources, parentId, index }) {
  const usedIds = new Set(deps.getGraph().nodes.keys())
  const nodes = normalizeResourceDropPayload({ resources }).map((resource) => ({
    id: nextResourceNodeId(resource, usedIds),
    resource,
  }))
  if (nodes.length === 0) {
    return edit.applyOperation({ type: 'drop-nodes', payload: { parentId, index, nodes } })
  }
  const result = edit.applyOperation(
    { type: 'drop-nodes', payload: { parentId, index, nodes } },
    { before: deps.getBeforeNodeDrop() },
  )
  if (!result.applied) return result
  core.updateLayout({ animate: false })
  const insertedIds = result.operation.payload.insertedIds || []
  insertedIds.forEach((nodeId, batchIndex) => {
    deps.emitNodeDrop({
      resource: nodes[batchIndex].resource,
      parentId,
      index: result.operation.payload.index + batchIndex,
      id: nodeId,
      batchIndex,
      batchSize: insertedIds.length,
    })
  })
  edit.emitChangeIfApplied(result)
  return result
}
```

Return them from `createMinimapController`:

```js
moveNodes,
dropResources,
```

If the before hook signatures need to match existing single-resource payloads, wrap the hook call with payloads shaped as `{ resource, parentId, index }` for single drops and `{ resources, parentId, index }` for multi drops.

- [ ] **Step 4: Allow paste into root**

In `src/minimap/controllers/edit-controller.js`, keep `pasteInto(targetParentId = pasteTargetId())` accepting `null`. No defaulting should convert `null` to selected id. Verify the operation payload remains:

```js
const operation = { type: 'paste-nodes', payload: { targetParentId, snapshot, idMap } }
```

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- test/minimap-node-tree-integration.test.js`

Expected: PASS.

Commit:

```bash
git add src/minimap/controllers/minimap-controller.js src/minimap/controllers/edit-controller.js test/minimap-node-tree-integration.test.js
git commit -m "feat: expose node tree editing commands"
```

## Task 6: Minimap Mode Switch And NodeTree Mounting

**Files:**
- Modify: `src/minimap/components/Minimap.vue`
- Modify: `src/style.css`
- Test: `test/minimap-shell.test.js`

- [ ] **Step 1: Add failing shell tests for display mode**

Append to `test/minimap-shell.test.js`:

```js
test('display mode switch mounts topology or node tree but never both', async () => {
  const wrapper = mountMinimap({ propsData: { graph: createDemoGraph() } })

  assert.equal(wrapper.find('canvas').exists(), true)
  assert.equal(wrapper.find('.node-tree').exists(), false)

  await wrapper.find('[data-display-mode="node-tree"]').trigger('click')
  assert.equal(wrapper.find('canvas').exists(), false)
  assert.equal(wrapper.find('.minimap-overview-panel').exists(), false)
  assert.equal(wrapper.find('.node-tree').exists(), true)

  await wrapper.find('[data-display-mode="topology"]').trigger('click')
  assert.equal(wrapper.find('canvas').exists(), true)
  assert.equal(wrapper.find('.node-tree').exists(), false)
  wrapper.destroy()
})

test('controlled display mode emits change without mutating internal mode', async () => {
  const wrapper = mountMinimap({
    propsData: { graph: createDemoGraph(), displayMode: 'topology' },
  })

  await wrapper.find('[data-display-mode="node-tree"]').trigger('click')

  assert.equal(wrapper.find('canvas').exists(), true)
  assert.deepEqual(wrapper.emitted('display-mode-change').at(-1), ['node-tree'])

  await wrapper.setProps({ displayMode: 'node-tree' })
  assert.equal(wrapper.find('.node-tree').exists(), true)
  wrapper.destroy()
})

test('preview mode does not expose node tree mode switch', () => {
  const wrapper = mountMinimap({ propsData: { graph: createDemoGraph(), options: { previewMode: true } } })

  assert.equal(wrapper.find('.minimap-display-mode').exists(), false)
  assert.equal(wrapper.find('.node-tree').exists(), false)
  assert.equal(wrapper.find('canvas').exists(), true)
  wrapper.destroy()
})
```

- [ ] **Step 2: Run shell tests and verify they fail**

Run: `npm test -- test/minimap-shell.test.js`

Expected: FAIL because `displayMode` and `NodeTree` are not wired.

- [ ] **Step 3: Wire mode state, emits, and NodeTree component**

In `Minimap.vue`:

Add import and component registration:

```js
import NodeTree from './NodeTree.vue'

components: { Overview, ResourceTree, NodeTree },
```

Add prop:

```js
displayMode: { type: String, default: null },
```

Add emit:

```js
'display-mode-change',
```

Add data:

```js
internalDisplayMode: this.displayMode || 'topology',
```

Add computed:

```js
effectiveDisplayMode() {
  if (this.effectiveOptions.previewMode === true) return 'topology'
  return this.displayMode || this.internalDisplayMode
},
isTopologyMode() {
  return this.effectiveDisplayMode === 'topology'
},
isNodeTreeMode() {
  return this.effectiveDisplayMode === 'node-tree'
},
```

Add method:

```js
setDisplayMode(mode) {
  if (this.effectiveOptions.previewMode === true) return
  if (mode !== 'topology' && mode !== 'node-tree') return
  this.controller.cancelPointerInteractions()
  this.controller.closeContextMenu()
  this.$emit('display-mode-change', mode)
  if (this.displayMode == null) this.internalDisplayMode = mode
}
```

Wrap topology-only DOM with `v-if="isTopologyMode"` and add NodeTree:

```vue
<div v-if="!effectiveOptions.previewMode" class="minimap-display-mode" role="group" aria-label="右侧视图模式">
  <button class="minimap-display-mode-button" :class="{ 'is-active': isTopologyMode }" type="button" data-display-mode="topology" @click="setDisplayMode('topology')">拓扑图</button>
  <button class="minimap-display-mode-button" :class="{ 'is-active': isNodeTreeMode }" type="button" data-display-mode="node-tree" @click="setDisplayMode('node-tree')">节点树</button>
</div>
<canvas v-if="isTopologyMode" ref="canvasRef" ...></canvas>
<NodeTree
  v-if="isNodeTreeMode"
  class="minimap-node-tree"
  :graph="effectiveGraph"
  :selected-ids="controller ? controller.getSelectedIds() : []"
  @select="handleNodeTreeSelect"
  @node-move="handleNodeTreeMove"
  @resource-drop="handleNodeTreeResourceDrop"
/>
```

Keep `.minimap-overview-panel`, `.minimap-search`, zoom, performance, and canvas hover tooltip behind `isTopologyMode` where they depend on canvas rendering. Keep history controls outside topology-only blocks.

- [ ] **Step 4: Add mode switch and node-tree container styles**

In `src/style.css`, add:

```css
.minimap-display-mode {
  position: absolute;
  top: 14px;
  left: 14px;
  z-index: 8;
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  background: #151a20;
  border: 1px solid #2a3038;
  border-radius: 6px;
}
.minimap-display-mode-button {
  min-width: 64px;
  height: 28px;
  padding: 0 10px;
  color: #8e98a5;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.minimap-display-mode-button.is-active {
  color: #e7ebf0;
  background: #26313d;
}
.minimap-node-tree {
  height: 100%;
  min-width: 0;
}
```

- [ ] **Step 5: Run shell tests and commit**

Run: `npm test -- test/minimap-shell.test.js`

Expected: PASS.

Commit:

```bash
git add src/minimap/components/Minimap.vue src/style.css test/minimap-shell.test.js
git commit -m "feat: add minimap display mode switch"
```

## Task 7: Wire NodeTree Editing Through Minimap

**Files:**
- Modify: `src/minimap/components/Minimap.vue`
- Modify: `src/minimap/components/NodeTree.vue`
- Modify: `src/style.css`
- Test: `test/minimap-node-tree-integration.test.js`

- [ ] **Step 1: Add failing Minimap node-tree integration tests**

Append to `test/minimap-node-tree-integration.test.js`:

```js
test('resource drop into mounted node tree creates graph nodes and emits data-change', async () => {
  const wrapper = mountMinimap({
    propsData: {
      data: [{ id: 'root', label: 'Root', children: [{ id: 'child', label: 'Child' }] }],
      displayMode: 'node-tree',
    },
  })
  wrapper.vm.$refs.nodeTree.expandedKeys = new Set(['node:root'])
  await wrapper.vm.$nextTick()

  const rowEl = wrapper.find('[data-node-id="child"]').element
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'offsetY', { value: 17, configurable: true })
  Object.defineProperty(evt, 'dataTransfer', {
    value: { getData: () => JSON.stringify({ id: 'meter', label: 'Meter' }) },
  })
  rowEl.dispatchEvent(evt)

  const child = wrapper.vm.effectiveGraph.nodes.get('child')
  assert.equal(child.children.length, 1)
  assert.equal(wrapper.vm.effectiveGraph.nodes.get(child.children[0]).label, 'Meter')
  assert.equal(wrapper.emitted('node-drop').length, 1)
  assert.equal(wrapper.emitted('change')[0][0].type, 'drop-nodes')
  assert.equal(wrapper.emitted('data-change').length, 1)
  wrapper.destroy()
})

test('node drag inside mounted node tree moves selected graph nodes', async () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap({ propsData: { graph, displayMode: 'node-tree' } })
  wrapper.vm.$refs.nodeTree.expandedKeys = new Set(['node:energy-root'])
  await wrapper.vm.$nextTick()

  wrapper.findComponent({ name: 'NodeTree' }).vm.$emit('node-move', {
    nodeIds: ['grid-tie'],
    parentId: 'heap-1',
    index: 0,
  })
  await wrapper.vm.$nextTick()

  assert.equal(graph.nodes.get('grid-tie').parentId, 'heap-1')
  assert.equal(graph.nodes.get('heap-1').children[0], 'grid-tie')
  assert.equal(wrapper.emitted('node-move')[0][0].nodeId, 'grid-tie')
  assert.equal(wrapper.emitted('change')[0][0].type, 'move-nodes')
  wrapper.destroy()
})
```

- [ ] **Step 2: Run integration tests and verify they fail**

Run: `npm test -- test/minimap-node-tree-integration.test.js`

Expected: FAIL because Minimap handlers are not wired.

- [ ] **Step 3: Implement Minimap node-tree handlers**

In `Minimap.vue`, add `ref="nodeTree"` to the `NodeTree` mount:

```vue
<NodeTree
  ref="nodeTree"
  ...
/>
```

Add methods:

```js
handleNodeTreeSelect({ ids, mode }) {
  this.controller.select(ids, mode)
},
handleNodeTreeMove({ nodeIds, parentId, index }) {
  const result = this.controller.moveNodes({ nodeIds, parentId, index })
  this.syncChromeState()
  return result
},
handleNodeTreeResourceDrop({ payload, parentId, index }) {
  const resources = Array.isArray(payload.resources) ? payload.resources : [payload]
  const result = this.controller.dropResources({ resources, parentId, index })
  this.syncChromeState()
  return result
},
```

When `graphRevision` changes, force NodeTree computed data to update by passing it as a prop:

```vue
:revision="graphRevision"
```

Add `revision` prop in `NodeTree.vue` and reference it in `visibleRows`:

```js
revision: { type: Number, default: 0 },
visibleRows() {
  void this.revision
  return flattenNodeTreeRows(...)
}
```

- [ ] **Step 4: Run integration tests and commit**

Run: `npm test -- test/minimap-node-tree-integration.test.js`

Expected: PASS.

Commit:

```bash
git add src/minimap/components/Minimap.vue src/minimap/components/NodeTree.vue src/style.css test/minimap-node-tree-integration.test.js
git commit -m "feat: wire node tree editing into minimap"
```

## Task 8: NodeTree Editing Commands And Documentation

**Files:**
- Modify: `src/minimap/components/NodeTree.vue`
- Modify: `src/minimap/components/Minimap.vue`
- Modify: `README.md`
- Test: `test/minimap-node-tree-integration.test.js`

- [ ] **Step 1: Add failing tests for node-tree edit commands**

Append to `test/minimap-node-tree-integration.test.js`:

```js
test('delete copy paste undo redo work in node-tree mode', async () => {
  const graph = createDemoGraph()
  const wrapper = mountMinimap({ propsData: { graph, displayMode: 'node-tree' } })

  wrapper.vm.select(['grid-tie'])
  wrapper.vm.copySelection()
  wrapper.vm.select(['heap-1'])
  const paste = wrapper.vm.paste()
  assert.equal(paste.applied, true)
  assert.equal(graph.nodes.get('heap-1').children.at(-1).startsWith('paste-grid-tie-'), true)

  const deleteResult = wrapper.vm.deleteSelection()
  assert.equal(deleteResult.applied, true)

  const undo = wrapper.vm.undo()
  assert.equal(undo.applied, true)
  const redo = wrapper.vm.redo()
  assert.equal(redo.applied, true)
  wrapper.destroy()
})
```

- [ ] **Step 2: Run tests and verify current command coverage**

Run: `npm test -- test/minimap-node-tree-integration.test.js`

Expected: PASS if existing public methods already cover commands, or FAIL if selection synchronization in node-tree mode is incomplete.

- [ ] **Step 3: Add context-key command handling if needed**

If tests fail because key handling is canvas-only, add keydown forwarding to `NodeTree.vue`:

```vue
@keydown="onKeyDown"
```

Extend `onKeyDown` to emit edit command events:

```js
} else if (event.key === 'Delete' || event.key === 'Backspace') {
  event.preventDefault()
  this.$emit('command', { id: 'delete' })
} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
  event.preventDefault()
  this.$emit('command', { id: 'copy' })
} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
  event.preventDefault()
  this.$emit('command', { id: 'paste' })
} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
  event.preventDefault()
  this.$emit('command', { id: 'undo' })
} else if ((event.metaKey || event.ctrlKey) && ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y')) {
  event.preventDefault()
  this.$emit('command', { id: 'redo' })
}
```

Wire `@command="handleNodeTreeCommand"` in `Minimap.vue`:

```js
handleNodeTreeCommand({ id }) {
  if (id === 'delete') return this.deleteSelection()
  if (id === 'copy') return this.copySelection()
  if (id === 'paste') return this.paste()
  if (id === 'undo') return this.undo()
  if (id === 'redo') return this.redo()
  return null
}
```

- [ ] **Step 4: Document the new public API**

Add a README section:

```md
### Right-side display modes

`Minimap` supports two right-side editing modes:

- `topology` (default): canvas topology editor.
- `node-tree`: virtualized node tree editor for large graphs.

Use `displayMode` for controlled mode:

```vue
<Minimap
  :graph="graph"
  display-mode="node-tree"
  @display-mode-change="mode => displayMode = mode"
/>
```

When `displayMode` is omitted, the built-in segmented control owns the mode internally and still emits `display-mode-change`. The left `resources` panel remains the resource source in both modes.
```

- [ ] **Step 5: Run full test suite and commit**

Run: `npm test`

Expected: PASS.

Commit:

```bash
git add src/minimap/components/NodeTree.vue src/minimap/components/Minimap.vue README.md test/minimap-node-tree-integration.test.js
git commit -m "docs: document node tree display mode"
```

## Task 9: Final Verification

**Files:**
- Review all changed files.

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run production build**

Run: `npm run build`

Expected: PASS with Vite build output and no compile errors.

- [ ] **Step 3: Inspect git history and status**

Run: `git status --short`

Expected: only unrelated pre-existing user changes may remain. Files changed by these tasks should be committed.

Run: `git log --oneline -8`

Expected: task commits are visible in order after the plan commit.

## Self-Review

- Spec coverage: root-level graph operations are Task 1; pure flatten/drop helpers are Task 2; virtualized browsing is Task 3; drag/drop UI is Task 4; controller APIs are Task 5; display mode and one-view-at-a-time mounting are Task 6; integrated resource/node editing is Task 7; edit commands and docs are Task 8; final verification is Task 9.
- Placeholder scan: this plan contains concrete file paths, commands, expected results, and code snippets for each implementation step.
- Type consistency: the plan uses `displayMode`, `display-mode-change`, `node-tree`, `topology`, `NodeTree`, `node-move`, `resource-drop`, `moveNodes`, and `dropResources` consistently across tasks.
