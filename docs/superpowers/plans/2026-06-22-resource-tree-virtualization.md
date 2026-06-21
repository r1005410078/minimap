# Resource Tree Virtualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the left resource tree handle 10000 resource items with nested folders, virtual scrolling, multi-select, batch drag-to-canvas, and used-resource disabling.

**Architecture:** Keep the public `resources` prop compatible while adding pure resource-tree helpers for model flattening, selection, and virtual window math. `ResourceTree.vue` becomes a virtualized DOM tree with fixed-height rows; batch drops enter the existing edit history through a new `drop-nodes` graph operation.

**Tech Stack:** Vue 2.7 Options API, native drag and drop, fixed-height DOM virtualization, Node test runner, existing jsdom and canvas mocks.

---

## File Structure

- Create `src/minimap/resource-tree/model.js`
  - Normalize existing category data and nested folder/resource data.
  - Flatten expanded/search-filtered nodes into visible rows.
  - Apply `usedResourceIds` disabled state.
- Create `src/minimap/resource-tree/virtual-window.js`
  - Convert `scrollTop`, viewport height, row height, and scroll velocity into a rendered row window.
- Create `src/minimap/resource-tree/selection.js`
  - Own resource-row selection, focus, anchor, range selection, and disabled-row exclusion.
- Modify `src/minimap/components/ResourceTree.vue`
  - Replace full DOM loops with virtual rows.
  - Add search input, nested expand/collapse, keyboard focus, multi-select, disabled states, and batch drag payloads.
- Modify `src/minimap/components/Minimap.vue`
  - Pass `usedResourceIds` into `ResourceTree`.
  - Document `options.disableUsedResources`.
- Modify `src/minimap/graph/graph-operations.js`
  - Add `drop-nodes` and inverse support.
  - Preserve `drop-node` for existing callers.
- Modify `src/minimap/controllers/drag-controller.js`
  - Parse `{ resources: [...] }` payloads.
  - Use `drop-nodes` for resource drops.
  - Emit compatible `node-drop` events with batch metadata.
- Modify tests:
  - Create `test/minimap-resource-tree-model.test.js`.
  - Create `test/minimap-resource-tree-virtual-window.test.js`.
  - Create `test/minimap-resource-tree-selection.test.js`.
  - Extend `test/minimap-resource-tree.test.js`.
  - Extend `test/minimap-graph-operations.test.js`.
  - Extend `test/minimap-drop.test.js` or `test/minimap-drag-controller.test.js`.
  - Extend `test/minimap-shell.test.js` for `disableUsedResources`.
- Modify `ROADMAP.md`
  - Mark plan link and later track slice checkboxes as tasks complete.

## Task 1: Resource Tree Model and Virtual Window

**Files:**
- Create: `src/minimap/resource-tree/model.js`
- Create: `src/minimap/resource-tree/virtual-window.js`
- Create: `test/minimap-resource-tree-model.test.js`
- Create: `test/minimap-resource-tree-virtual-window.test.js`

- [ ] **Step 1: Write failing model tests**

Create `test/minimap-resource-tree-model.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  flattenResourceRows,
  normalizeResourceTree,
  resourceMatchesSearch,
} from '../src/minimap/resource-tree/model.js'

const categoryResources = [
  {
    category: '储能设备',
    expanded: true,
    items: [
      { id: 'site', label: '站点' },
      { id: 'pcs', label: 'PCS', kind: 'device', data: { icon: 'bolt' } },
    ],
  },
  {
    category: '光伏设备',
    expanded: false,
    items: [{ id: 'pv-array', label: 'PV Array' }],
  },
]

const nestedResources = [
  {
    id: 'storage',
    label: 'Storage',
    type: 'folder',
    expanded: true,
    children: [
      {
        id: 'bms',
        label: 'BMS',
        type: 'folder',
        expanded: true,
        children: [
          { id: 'stack', label: 'BMS Stack', type: 'resource' },
          { id: 'cluster', label: 'BMS Cluster', type: 'resource' },
        ],
      },
      { id: 'meter', label: 'Meter', type: 'resource' },
    ],
  },
]

test('normalizeResourceTree keeps existing category resources compatible', () => {
  const roots = normalizeResourceTree(categoryResources)

  assert.equal(roots[0].id, '储能设备')
  assert.equal(roots[0].label, '储能设备')
  assert.equal(roots[0].type, 'folder')
  assert.equal(roots[0].expanded, true)
  assert.equal(roots[0].children[1].id, 'pcs')
  assert.equal(roots[0].children[1].type, 'resource')
  assert.deepEqual(roots[0].children[1].resource, { id: 'pcs', label: 'PCS', kind: 'device', data: { icon: 'bolt' } })
})

test('flattenResourceRows supports nested folders and path-based stable keys', () => {
  const rows = flattenResourceRows(nestedResources, {
    expandedKeys: new Set(['folder:storage', 'folder:storage/bms']),
  })

  assert.deepEqual(rows.map((row) => [row.key, row.type, row.depth, row.label]), [
    ['folder:storage', 'folder', 0, 'Storage'],
    ['folder:storage/bms', 'folder', 1, 'BMS'],
    ['resource:storage/bms/stack', 'resource', 2, 'BMS Stack'],
    ['resource:storage/bms/cluster', 'resource', 2, 'BMS Cluster'],
    ['resource:storage/meter', 'resource', 1, 'Meter'],
  ])
})

test('flattenResourceRows respects collapsed folders outside search mode', () => {
  const rows = flattenResourceRows(nestedResources, {
    expandedKeys: new Set(['folder:storage']),
  })

  assert.deepEqual(rows.map((row) => row.key), [
    'folder:storage',
    'folder:storage/bms',
    'resource:storage/meter',
  ])
})

test('search keeps matching descendants and ancestor folders visible', () => {
  const rows = flattenResourceRows(nestedResources, {
    expandedKeys: new Set(),
    searchKeyword: 'cluster',
  })

  assert.deepEqual(rows.map((row) => row.key), [
    'folder:storage',
    'folder:storage/bms',
    'resource:storage/bms/cluster',
  ])
})

test('usedResourceIds disables matching resources but not folders', () => {
  const rows = flattenResourceRows(nestedResources, {
    expandedKeys: new Set(['folder:storage', 'folder:storage/bms']),
    usedResourceIds: new Set(['cluster']),
  })

  const folder = rows.find((row) => row.key === 'folder:storage/bms')
  const cluster = rows.find((row) => row.key === 'resource:storage/bms/cluster')
  assert.equal(folder.disabled, false)
  assert.equal(cluster.disabled, true)
})

test('resourceMatchesSearch matches id and label case-insensitively', () => {
  assert.equal(resourceMatchesSearch({ id: 'pcs-device', label: 'PCS Device' }, 'pcs'), true)
  assert.equal(resourceMatchesSearch({ id: 'meter', label: '电能计量' }, '计量'), true)
  assert.equal(resourceMatchesSearch({ id: 'meter', label: 'Meter' }, 'bms'), false)
})
```

- [ ] **Step 2: Write failing virtual window tests**

Create `test/minimap-resource-tree-virtual-window.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveVirtualWindow } from '../src/minimap/resource-tree/virtual-window.js'

test('resolveVirtualWindow renders the top window with normal overscan', () => {
  assert.deepEqual(resolveVirtualWindow({
    rowCount: 1000,
    rowHeight: 28,
    viewportHeight: 280,
    scrollTop: 0,
  }), {
    start: 0,
    end: 30,
    offsetY: 0,
    totalHeight: 28000,
    overscan: 20,
  })
})

test('resolveVirtualWindow computes a middle window in O(1) fixed-row math', () => {
  assert.deepEqual(resolveVirtualWindow({
    rowCount: 1000,
    rowHeight: 28,
    viewportHeight: 280,
    scrollTop: 2800,
  }), {
    start: 80,
    end: 130,
    offsetY: 2240,
    totalHeight: 28000,
    overscan: 20,
  })
})

test('resolveVirtualWindow clamps near the bottom', () => {
  const window = resolveVirtualWindow({
    rowCount: 100,
    rowHeight: 30,
    viewportHeight: 300,
    scrollTop: 99999,
  })

  assert.equal(window.start, 70)
  assert.equal(window.end, 100)
  assert.equal(window.offsetY, 2100)
})

test('resolveVirtualWindow expands overscan for large scroll jumps', () => {
  const window = resolveVirtualWindow({
    rowCount: 10000,
    rowHeight: 28,
    viewportHeight: 280,
    scrollTop: 140000,
    previousScrollTop: 0,
  })

  assert.equal(window.overscan, 100)
  assert.equal(window.start, 4900)
  assert.equal(window.end, 5110)
})

test('resolveVirtualWindow returns an empty stable window for no rows', () => {
  assert.deepEqual(resolveVirtualWindow({
    rowCount: 0,
    rowHeight: 28,
    viewportHeight: 280,
    scrollTop: 100,
  }), {
    start: 0,
    end: 0,
    offsetY: 0,
    totalHeight: 0,
    overscan: 20,
  })
})
```

- [ ] **Step 3: Run model/window tests to verify failure**

Run:

```bash
npm test -- test/minimap-resource-tree-model.test.js test/minimap-resource-tree-virtual-window.test.js
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 4: Implement `model.js`**

Create `src/minimap/resource-tree/model.js`:

```js
function normalizeNode(node, fallbackId) {
  const id = String(node.id ?? node.category ?? fallbackId)
  const label = String(node.label ?? node.category ?? id)
  const rawChildren = Array.isArray(node.children)
    ? node.children
    : Array.isArray(node.items)
      ? node.items
      : null
  const type = node.type || (rawChildren ? 'folder' : 'resource')

  if (type === 'folder') {
    return {
      id,
      label,
      type: 'folder',
      expanded: node.expanded,
      children: (rawChildren || []).map((child, index) => normalizeNode(child, `${id}-${index}`)),
      resource: node,
    }
  }

  return {
    id,
    label,
    type: 'resource',
    resource: node,
  }
}

function rowKey(type, path) {
  return `${type}:${path.join('/')}`
}

export function normalizeResourceTree(resources = []) {
  return resources.map((item, index) => normalizeNode(item, `resource-${index}`))
}

export function resourceMatchesSearch(resource, keyword) {
  const query = String(keyword || '').trim().toLowerCase()
  if (!query) return true
  return String(resource.id ?? '').toLowerCase().includes(query) ||
    String(resource.label ?? '').toLowerCase().includes(query)
}

function includesSearchMatch(node, keyword) {
  if (!keyword) return true
  if (resourceMatchesSearch(node, keyword)) return true
  return (node.children || []).some((child) => includesSearchMatch(child, keyword))
}

function flattenNode(node, context, rows) {
  const { path, depth, expandedKeys, searchKeyword, usedResourceIds } = context
  if (searchKeyword && !includesSearchMatch(node, searchKeyword)) return

  const nextPath = [...path, node.id]
  const key = rowKey(node.type, nextPath)
  const isFolder = node.type === 'folder'
  const expanded = searchKeyword ? true : expandedKeys.has(key) || node.expanded === true
  const disabled = node.type === 'resource' && usedResourceIds.has(node.id)

  rows.push({
    key,
    id: node.id,
    label: node.label,
    type: node.type,
    depth,
    expanded,
    disabled,
    item: node.resource,
  })

  if (!isFolder || !expanded) return
  for (const child of node.children || []) {
    flattenNode(child, { ...context, path: nextPath, depth: depth + 1 }, rows)
  }
}

export function flattenResourceRows(resources = [], {
  expandedKeys = new Set(),
  searchKeyword = '',
  usedResourceIds = new Set(),
} = {}) {
  const roots = normalizeResourceTree(resources)
  const rows = []
  for (const root of roots) {
    flattenNode(root, {
      path: [],
      depth: 0,
      expandedKeys,
      searchKeyword: String(searchKeyword || '').trim(),
      usedResourceIds,
    }, rows)
  }
  return rows
}
```

- [ ] **Step 5: Implement `virtual-window.js`**

Create `src/minimap/resource-tree/virtual-window.js`:

```js
const DEFAULT_OVERSCAN = 20
const FAST_OVERSCAN = 100

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function resolveVirtualWindow({
  rowCount,
  rowHeight,
  viewportHeight,
  scrollTop,
  previousScrollTop = scrollTop,
  overscan = DEFAULT_OVERSCAN,
  fastOverscan = FAST_OVERSCAN,
  fastScrollThreshold = viewportHeight * 2,
}) {
  const totalHeight = Math.max(0, rowCount) * rowHeight
  const effectiveOverscan = Math.abs(scrollTop - previousScrollTop) > fastScrollThreshold ? fastOverscan : overscan
  if (rowCount <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { start: 0, end: 0, offsetY: 0, totalHeight: 0, overscan: effectiveOverscan }
  }

  const maxScrollTop = Math.max(0, totalHeight - viewportHeight)
  const clampedScrollTop = clamp(scrollTop, 0, maxScrollTop)
  const firstVisible = Math.floor(clampedScrollTop / rowHeight)
  const visibleCount = Math.ceil(viewportHeight / rowHeight)
  const start = clamp(firstVisible - effectiveOverscan, 0, rowCount)
  const end = clamp(firstVisible + visibleCount + effectiveOverscan, start, rowCount)
  return {
    start,
    end,
    offsetY: start * rowHeight,
    totalHeight,
    overscan: effectiveOverscan,
  }
}
```

- [ ] **Step 6: Run model/window tests to verify pass**

Run:

```bash
npm test -- test/minimap-resource-tree-model.test.js test/minimap-resource-tree-virtual-window.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/minimap/resource-tree/model.js src/minimap/resource-tree/virtual-window.js test/minimap-resource-tree-model.test.js test/minimap-resource-tree-virtual-window.test.js
git commit -m "feat: add resource tree model and virtual window"
```

## Task 2: Resource Tree Selection Model

**Files:**
- Create: `src/minimap/resource-tree/selection.js`
- Create: `test/minimap-resource-tree-selection.test.js`

- [ ] **Step 1: Write failing selection tests**

Create `test/minimap-resource-tree-selection.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyResourceRowClick,
  moveResourceFocus,
  toggleFocusedResource,
} from '../src/minimap/resource-tree/selection.js'

const rows = [
  { key: 'folder:root', type: 'folder', disabled: false },
  { key: 'resource:root/a', type: 'resource', disabled: false },
  { key: 'resource:root/b', type: 'resource', disabled: false },
  { key: 'resource:root/c', type: 'resource', disabled: true },
  { key: 'resource:root/d', type: 'resource', disabled: false },
]

test('plain click selects one enabled resource and sets focus and anchor', () => {
  assert.deepEqual(applyResourceRowClick({
    rows,
    selectedKeys: new Set(['resource:root/a']),
    focusedKey: 'resource:root/a',
    anchorKey: 'resource:root/a',
    key: 'resource:root/b',
  }), {
    selectedKeys: new Set(['resource:root/b']),
    focusedKey: 'resource:root/b',
    anchorKey: 'resource:root/b',
  })
})

test('Cmd/Ctrl click toggles an enabled resource', () => {
  assert.deepEqual(applyResourceRowClick({
    rows,
    selectedKeys: new Set(['resource:root/a']),
    focusedKey: 'resource:root/a',
    anchorKey: 'resource:root/a',
    key: 'resource:root/b',
    additive: true,
  }).selectedKeys, new Set(['resource:root/a', 'resource:root/b']))
})

test('Shift click selects enabled resources between anchor and target', () => {
  const next = applyResourceRowClick({
    rows,
    selectedKeys: new Set(['resource:root/a']),
    focusedKey: 'resource:root/a',
    anchorKey: 'resource:root/a',
    key: 'resource:root/d',
    range: true,
  })

  assert.deepEqual(next.selectedKeys, new Set(['resource:root/a', 'resource:root/b', 'resource:root/d']))
  assert.equal(next.focusedKey, 'resource:root/d')
  assert.equal(next.anchorKey, 'resource:root/a')
})

test('clicking folders or disabled rows only moves focus', () => {
  const next = applyResourceRowClick({
    rows,
    selectedKeys: new Set(['resource:root/a']),
    focusedKey: 'resource:root/a',
    anchorKey: 'resource:root/a',
    key: 'resource:root/c',
  })

  assert.deepEqual(next.selectedKeys, new Set(['resource:root/a']))
  assert.equal(next.focusedKey, 'resource:root/c')
  assert.equal(next.anchorKey, 'resource:root/a')
})

test('moveResourceFocus walks visible rows and clamps at edges', () => {
  assert.equal(moveResourceFocus(rows, 'folder:root', 1), 'resource:root/a')
  assert.equal(moveResourceFocus(rows, 'resource:root/d', 1), 'resource:root/d')
  assert.equal(moveResourceFocus(rows, null, 1), 'folder:root')
})

test('toggleFocusedResource toggles only enabled resource rows', () => {
  assert.deepEqual(toggleFocusedResource({
    rows,
    selectedKeys: new Set(),
    focusedKey: 'resource:root/a',
  }).selectedKeys, new Set(['resource:root/a']))
  assert.deepEqual(toggleFocusedResource({
    rows,
    selectedKeys: new Set(['resource:root/a']),
    focusedKey: 'folder:root',
  }).selectedKeys, new Set(['resource:root/a']))
})
```

- [ ] **Step 2: Run selection tests to verify failure**

Run:

```bash
npm test -- test/minimap-resource-tree-selection.test.js
```

Expected: FAIL because `selection.js` does not exist.

- [ ] **Step 3: Implement `selection.js`**

Create `src/minimap/resource-tree/selection.js`:

```js
function rowByKey(rows, key) {
  return rows.find((row) => row.key === key) || null
}

function selectable(row) {
  return row?.type === 'resource' && row.disabled !== true
}

function rangeKeys(rows, anchorKey, targetKey) {
  const anchorIndex = rows.findIndex((row) => row.key === anchorKey)
  const targetIndex = rows.findIndex((row) => row.key === targetKey)
  if (anchorIndex === -1 || targetIndex === -1) return []
  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return rows.slice(start, end + 1).filter(selectable).map((row) => row.key)
}

export function applyResourceRowClick({
  rows,
  selectedKeys,
  focusedKey,
  anchorKey,
  key,
  additive = false,
  range = false,
}) {
  const row = rowByKey(rows, key)
  if (!row) return { selectedKeys, focusedKey, anchorKey }
  if (!selectable(row)) return { selectedKeys, focusedKey: key, anchorKey }

  if (range) {
    const selected = new Set(rangeKeys(rows, anchorKey || key, key))
    return { selectedKeys: selected, focusedKey: key, anchorKey: anchorKey || key }
  }

  if (additive) {
    const selected = new Set(selectedKeys)
    if (selected.has(key)) selected.delete(key)
    else selected.add(key)
    return { selectedKeys: selected, focusedKey: key, anchorKey: key }
  }

  return { selectedKeys: new Set([key]), focusedKey: key, anchorKey: key }
}

export function moveResourceFocus(rows, focusedKey, delta) {
  if (rows.length === 0) return null
  const currentIndex = focusedKey ? rows.findIndex((row) => row.key === focusedKey) : -1
  const nextIndex = Math.max(0, Math.min(rows.length - 1, currentIndex === -1 ? 0 : currentIndex + delta))
  return rows[nextIndex]?.key ?? null
}

export function toggleFocusedResource({ rows, selectedKeys, focusedKey }) {
  const row = rowByKey(rows, focusedKey)
  if (!selectable(row)) return { selectedKeys, focusedKey, anchorKey: focusedKey }
  const selected = new Set(selectedKeys)
  if (selected.has(focusedKey)) selected.delete(focusedKey)
  else selected.add(focusedKey)
  return { selectedKeys: selected, focusedKey, anchorKey: focusedKey }
}
```

- [ ] **Step 4: Run selection tests to verify pass**

Run:

```bash
npm test -- test/minimap-resource-tree-selection.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add src/minimap/resource-tree/selection.js test/minimap-resource-tree-selection.test.js
git commit -m "feat: add resource tree selection model"
```

## Task 3: Virtualized ResourceTree Component

**Files:**
- Modify: `src/minimap/components/ResourceTree.vue`
- Modify: `test/minimap-resource-tree.test.js`

- [ ] **Step 1: Extend component tests for virtualization, nesting, search, selection, and drag payloads**

Append tests to `test/minimap-resource-tree.test.js`:

```js
function makeLargeResources(count = 10000) {
  return [{
    category: '大量资源',
    expanded: true,
    items: Array.from({ length: count }, (_, index) => ({
      id: `res-${index}`,
      label: `Resource ${index}`,
    })),
  }]
}

test('virtualized tree renders a small row count for 10000 resources', async () => {
  const wrapper = mount(ResourceTree, {
    propsData: { resources: makeLargeResources() },
    attachTo: document.body,
  })

  await wrapper.vm.$nextTick()
  const rows = wrapper.findAll('.resource-row')
  assert.ok(rows.length > 0)
  assert.ok(rows.length < 160)
  assert.equal(wrapper.find('[data-resource-id="res-9999"]').exists(), false)
  wrapper.destroy()
})

test('jumping scrollTop near the bottom immediately renders bottom rows', async () => {
  const wrapper = mount(ResourceTree, {
    propsData: { resources: makeLargeResources() },
    attachTo: document.body,
  })
  Object.defineProperty(wrapper.vm.$refs.scroller, 'clientHeight', { value: 280, configurable: true })

  wrapper.vm.$refs.scroller.scrollTop = 280000
  await wrapper.find('.resource-tree-scroll').trigger('scroll')
  await wrapper.vm.$nextTick()

  assert.equal(wrapper.text().includes('Resource 999'), true)
  assert.ok(wrapper.findAll('.resource-row').length > 0)
  wrapper.destroy()
})

test('nested folders expand and collapse without rendering hidden descendants', async () => {
  const wrapper = mount(ResourceTree, {
    propsData: {
      resources: [{
        id: 'root',
        label: 'Root',
        type: 'folder',
        expanded: true,
        children: [{
          id: 'folder',
          label: 'Folder',
          type: 'folder',
          children: [{ id: 'leaf', label: 'Leaf', type: 'resource' }],
        }],
      }],
    },
  })

  assert.equal(wrapper.text().includes('Leaf'), false)
  await wrapper.find('[data-row-key="folder:root/folder"]').trigger('click')
  assert.equal(wrapper.text().includes('Leaf'), true)
  wrapper.destroy()
})

test('search filters after debounce and keeps matching ancestors visible', async () => {
  const wrapper = mount(ResourceTree, {
    propsData: {
      searchDelay: 1,
      resources: [{
        id: 'root',
        label: 'Root',
        type: 'folder',
        children: [{ id: 'leaf', label: 'Target Leaf', type: 'resource' }],
      }],
    },
  })

  await wrapper.find('.resource-search-input').setValue('target')
  await new Promise((resolve) => setTimeout(resolve, 5))
  await wrapper.vm.$nextTick()

  assert.equal(wrapper.text().includes('Root'), true)
  assert.equal(wrapper.text().includes('Target Leaf'), true)
  wrapper.destroy()
})

test('multi-select drag serializes selected resources in visible order', async () => {
  const wrapper = mount(ResourceTree, { propsData: { resources: makeLargeResources(5) } })

  await wrapper.find('[data-resource-id="res-1"]').trigger('click')
  await wrapper.find('[data-resource-id="res-3"]').trigger('click', { shiftKey: true })

  const fakeDataTransfer = {
    data: {},
    setData(type, value) { this.data[type] = value },
    effectAllowed: null,
  }
  const evt = new Event('dragstart', { bubbles: true })
  Object.defineProperty(evt, 'dataTransfer', { value: fakeDataTransfer })
  wrapper.find('[data-resource-id="res-2"]').element.dispatchEvent(evt)

  assert.deepEqual(JSON.parse(fakeDataTransfer.data['application/json']).resources.map((item) => item.id), [
    'res-1',
    'res-2',
    'res-3',
  ])
  wrapper.destroy()
})

test('disabled used resources cannot be selected or dragged', async () => {
  const wrapper = mount(ResourceTree, {
    propsData: {
      resources: makeLargeResources(3),
      usedResourceIds: new Set(['res-1']),
    },
  })

  const disabled = wrapper.find('[data-resource-id="res-1"]')
  assert.equal(disabled.classes().includes('is-disabled'), true)
  await disabled.trigger('click')
  assert.equal(disabled.classes().includes('is-selected'), false)
  assert.equal(disabled.attributes('draggable'), undefined)
  wrapper.destroy()
})
```

- [ ] **Step 2: Run component tests to verify failure**

Run:

```bash
npm test -- test/minimap-resource-tree.test.js
```

Expected: FAIL because ResourceTree is still full-rendered and has no virtual/search/multi-select behavior.

- [ ] **Step 3: Refactor `ResourceTree.vue` template**

Replace the template with a virtualized structure:

```vue
<template>
  <aside class="resource-tree">
    <div class="resource-tree-header">
      <h2 class="resource-tree-title">资源树</h2>
      <button class="resource-tree-hint" type="button" disabled>拖至画布</button>
    </div>
    <label class="resource-search">
      <span class="resource-search-icon" aria-hidden="true">⌕</span>
      <input
        class="resource-search-input"
        :value="searchInput"
        placeholder="搜索节点..."
        @input="onSearchInput"
      />
    </label>
    <div
      ref="scroller"
      class="resource-tree-scroll"
      tabindex="0"
      role="tree"
      @scroll="onScroll"
      @keydown="onKeyDown"
    >
      <div class="resource-tree-spacer" :style="{ height: `${virtualWindow.totalHeight}px` }">
        <div class="resource-tree-window" :style="{ transform: `translateY(${virtualWindow.offsetY}px)` }">
          <div
            v-for="row in renderedRows"
            :key="row.key"
            class="resource-row"
            :class="rowClasses(row)"
            :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
            :data-row-key="row.key"
            :data-resource-id="row.type === 'resource' ? row.id : null"
            :draggable="row.type === 'resource' && !row.disabled ? 'true' : null"
            role="treeitem"
            :aria-expanded="row.type === 'folder' ? String(row.expanded) : null"
            :aria-selected="row.type === 'resource' ? String(selectedKeys.has(row.key)) : null"
            :aria-disabled="row.disabled ? 'true' : null"
            @click="onRowClick(row, $event)"
            @dragstart="onDragStart(row, $event)"
          >
            <span v-if="row.type === 'folder'" class="resource-category-caret" aria-hidden="true"></span>
            <span v-else class="resource-item-dot" aria-hidden="true"></span>
            <span class="resource-item-label">{{ row.label }}</span>
            <span v-if="row.type === 'resource'" class="resource-item-handle" aria-hidden="true">⌘</span>
            <span v-else class="resource-category-count">{{ row.count }}</span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
```

- [ ] **Step 4: Implement ResourceTree script**

Use the pure helpers from Tasks 1 and 2. Add a `searchDelay` prop for tests and keep it defaulted to 120ms.

```js
import { flattenResourceRows } from '../resource-tree/model.js'
import { resolveVirtualWindow } from '../resource-tree/virtual-window.js'
import {
  applyResourceRowClick,
  moveResourceFocus,
  toggleFocusedResource,
} from '../resource-tree/selection.js'

const ROW_HEIGHT = 34

export default {
  props: {
    resources: { type: Array, default: () => [] },
    usedResourceIds: { type: Object, default: () => new Set() },
    searchDelay: { type: Number, default: 120 },
  },
  data() {
    return {
      expandedKeys: new Set(),
      selectedKeys: new Set(),
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
    visibleRows() {
      return flattenResourceRows(this.resources, {
        expandedKeys: this.expandedKeys,
        searchKeyword: this.searchKeyword,
        usedResourceIds: this.usedResourceIds || new Set(),
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
        'resource-category-row': row.type === 'folder',
        'resource-item': row.type === 'resource',
        'is-collapsed': row.type === 'folder' && !row.expanded,
        'is-selected': this.selectedKeys.has(row.key),
        'is-focused': this.focusedKey === row.key,
        'is-disabled': row.disabled,
      }
    },
    onRowClick(row, event) {
      this.focusedKey = row.key
      if (row.type === 'folder') {
        this.toggleFolder(row.key)
        return
      }
      const next = applyResourceRowClick({
        rows: this.visibleRows,
        selectedKeys: this.selectedKeys,
        focusedKey: this.focusedKey,
        anchorKey: this.anchorKey,
        key: row.key,
        additive: event.metaKey || event.ctrlKey,
        range: event.shiftKey,
      })
      this.selectedKeys = next.selectedKeys
      this.focusedKey = next.focusedKey
      this.anchorKey = next.anchorKey
    },
    toggleFolder(key) {
      const expanded = new Set(this.expandedKeys)
      if (expanded.has(key)) expanded.delete(key)
      else expanded.add(key)
      this.expandedKeys = expanded
    },
    onKeyDown(event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        this.focusedKey = moveResourceFocus(this.visibleRows, this.focusedKey, event.key === 'ArrowDown' ? 1 : -1)
      } else if (event.key === ' ' && this.focusedKey) {
        event.preventDefault()
        const next = toggleFocusedResource({ rows: this.visibleRows, selectedKeys: this.selectedKeys, focusedKey: this.focusedKey })
        this.selectedKeys = next.selectedKeys
        this.anchorKey = next.anchorKey
      } else if (event.key === 'Enter' && this.focusedKey) {
        const row = this.visibleRows.find((item) => item.key === this.focusedKey)
        if (row?.type === 'folder') this.toggleFolder(row.key)
      }
    },
    selectedDragResources(row) {
      const keys = this.selectedKeys.has(row.key) ? this.selectedKeys : new Set([row.key])
      return this.visibleRows
        .filter((item) => keys.has(item.key) && item.type === 'resource' && !item.disabled)
        .map((item) => item.item)
    },
    onDragStart(row, event) {
      if (row.type !== 'resource' || row.disabled) {
        event.preventDefault()
        return
      }
      const resources = this.selectedDragResources(row)
      const payload = resources.length === 1 ? { ...resources[0], resources } : { resources }
      event.dataTransfer.setData('application/json', JSON.stringify(payload))
      event.dataTransfer.effectAllowed = 'copy'
    },
  },
}
```

- [ ] **Step 5: Replace ResourceTree styles**

Keep the existing colors and add stable row dimensions:

```css
.resource-tree {
  height: 100%;
  padding: 14px 10px;
  color: #cfd6df;
  background: #101418;
  border: 1px solid #252a32;
  border-radius: 10px;
  font-size: 13px;
}
.resource-tree-scroll {
  position: relative;
  height: calc(100% - 68px);
  overflow: auto;
  outline: none;
}
.resource-tree-spacer {
  position: relative;
  min-height: 100%;
}
.resource-tree-window {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}
.resource-row {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 8px;
  height: 34px;
  border-radius: 5px;
  user-select: none;
}
.resource-row.is-selected {
  background: #26313b;
  color: #f4f7fb;
}
.resource-row.is-focused {
  outline: 1px solid #4b8cff;
  outline-offset: -1px;
}
.resource-row.is-disabled {
  color: #535b65;
  cursor: default;
  opacity: 0.58;
}
.resource-search-input {
  width: 100%;
  min-width: 0;
  color: inherit;
  background: transparent;
  border: 0;
  outline: none;
  font: inherit;
}
```

- [ ] **Step 6: Run component tests to verify pass**

Run:

```bash
npm test -- test/minimap-resource-tree.test.js test/minimap-resource-tree-model.test.js test/minimap-resource-tree-virtual-window.test.js test/minimap-resource-tree-selection.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add src/minimap/components/ResourceTree.vue test/minimap-resource-tree.test.js
git commit -m "feat: virtualize resource tree"
```

## Task 4: Batch Drop Graph Operation

**Files:**
- Modify: `src/minimap/graph/graph-operations.js`
- Modify: `test/minimap-graph-operations.test.js`

- [ ] **Step 1: Write failing graph operation tests**

Append tests to `test/minimap-graph-operations.test.js`:

```js
test('drop-nodes inserts consecutive resource nodes with data.resourceId and can undo redo', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  const result = manager.apply({
    type: 'drop-nodes',
    payload: {
      parentId: 'energy-root',
      index: 1,
      nodes: [
        { id: 'res-a-1', resource: { id: 'a', label: 'A', kind: 'device', data: { color: 'red' } } },
        { id: 'res-b-1', resource: { id: 'b', label: 'B' } },
      ],
    },
  })

  assert.equal(result.applied, true)
  assert.deepEqual(result.operation.payload.insertedIds, ['res-a-1', 'res-b-1'])
  assert.deepEqual(graph.nodes.get('energy-root').children.slice(1, 3), ['res-a-1', 'res-b-1'])
  assert.deepEqual(graph.nodes.get('res-a-1'), {
    id: 'res-a-1',
    label: 'A',
    parentId: 'energy-root',
    children: [],
    kind: 'device',
    data: { color: 'red', resourceId: 'a' },
  })

  assert.equal(manager.undo().applied, true)
  assert.equal(graph.nodes.has('res-a-1'), false)
  assert.equal(graph.nodes.has('res-b-1'), false)

  assert.equal(manager.redo().applied, true)
  assert.deepEqual(graph.nodes.get('energy-root').children.slice(1, 3), ['res-a-1', 'res-b-1'])
})

test('drop-nodes rejects missing parent empty nodes and id collisions', () => {
  const graph = createDemoGraph()
  const manager = createGraphOperationManager(graph)

  assert.equal(manager.apply({ type: 'drop-nodes', payload: { parentId: 'missing', index: 0, nodes: [{ id: 'x', resource: { id: 'x', label: 'X' } }] } }).applied, false)
  assert.equal(manager.apply({ type: 'drop-nodes', payload: { parentId: 'energy-root', index: 0, nodes: [] } }).applied, false)
  assert.equal(manager.apply({ type: 'drop-nodes', payload: { parentId: 'energy-root', index: 0, nodes: [{ id: 'grid-tie', resource: { id: 'x', label: 'X' } }] } }).applied, false)
})
```

- [ ] **Step 2: Run graph operation tests to verify failure**

Run:

```bash
npm test -- test/minimap-graph-operations.test.js
```

Expected: FAIL because `drop-nodes` is not implemented.

- [ ] **Step 3: Implement `drop-nodes`**

In `src/minimap/graph/graph-operations.js`, add:

```js
function graphNodeFromResource({ id, resource, parentId }) {
  const data = { ...(resource.data || {}), resourceId: resource.id }
  return {
    id,
    label: resource.label,
    parentId,
    children: [],
    ...(resource.kind ? { kind: resource.kind } : {}),
    data,
  }
}

function applyDropNodes(graph, operation) {
  const { parentId, index, nodes } = operation.payload
  const parent = graph.nodes.get(parentId)
  if (!parent || !Array.isArray(nodes) || nodes.length === 0) return blockedResult(graph, operation, 'invalid')
  for (const item of nodes) {
    if (!item?.id || !item.resource?.id || !item.resource?.label || graph.nodes.has(item.id)) {
      return blockedResult(graph, operation, 'invalid')
    }
  }

  const before = cloneGraphData(graph)
  const insertIndex = clampIndex(index, parent.children.length)
  const insertedIds = []
  for (const item of nodes) {
    const node = graphNodeFromResource({ id: item.id, resource: item.resource, parentId })
    graph.nodes.set(node.id, node)
    insertedIds.push(node.id)
  }
  parent.children.splice(insertIndex, 0, ...insertedIds)

  return result({
    applied: true,
    type: operation.type,
    operation: { ...operation, payload: { ...operation.payload, index: insertIndex, insertedIds } },
    inverse: { type: 'replace-graph', payload: { graph: before } },
    graph,
  })
}
```

Update `applyDropNode` so it also stores `kind` and `data.resourceId` by delegating node construction:

```js
const node = graphNodeFromResource({ id, resource, parentId })
```

Update the operation dispatch in `applyOperation`:

```js
if (operation.type === 'drop-nodes') return applyDropNodes(graph, operation)
```

- [ ] **Step 4: Run graph operation tests to verify pass**

Run:

```bash
npm test -- test/minimap-graph-operations.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/minimap/graph/graph-operations.js test/minimap-graph-operations.test.js
git commit -m "feat: add batch resource drop operation"
```

## Task 5: Minimap and Drag Controller Integration

**Files:**
- Modify: `src/minimap/components/Minimap.vue`
- Modify: `src/minimap/controllers/drag-controller.js`
- Modify: `test/minimap-drop.test.js`
- Modify: `test/minimap-shell.test.js`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Write failing integration tests**

Add to `test/minimap-drop.test.js`:

```js
test('dropping multiple resources onto a node creates consecutive children and emits node-drop batch metadata', () => {
  const { wrapper, graph } = mountMinimap()
  const calls = []
  wrapper.vm.$on('node-drop', (payload) => calls.push(payload))

  const canvas = wrapper.find('canvas').element
  const target = wrapper.vm.controller.getLayout().items.find((item) => item.id === 'grid-tie')
  const evt = new DragEvent('drop', {
    bubbles: true,
    clientX: target.x + 10,
    clientY: target.y + 10,
  })
  Object.defineProperty(evt, 'dataTransfer', {
    value: {
      getData: () => JSON.stringify({
        resources: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      }),
    },
  })

  canvas.dispatchEvent(evt)

  const children = graph.nodes.get('grid-tie').children
  const added = children.slice(-2)
  assert.equal(graph.nodes.get(added[0]).data.resourceId, 'a')
  assert.equal(graph.nodes.get(added[1]).data.resourceId, 'b')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].batchSize, 2)
  assert.equal(calls[1].batchIndex, 1)
  wrapper.destroy()
})
```

Add to `test/minimap-shell.test.js`:

```js
test('options.disableUsedResources disables resources whose ids exist in graph node data.resourceId', async () => {
  const graph = createDemoGraph()
  graph.nodes.get('grid-tie').data = { resourceId: 'site' }
  const wrapper = mount(Minimap, {
    propsData: {
      graph,
      options: { disableUsedResources: true },
      resources: [{ category: '储能设备', expanded: true, items: [{ id: 'site', label: '站点' }] }],
    },
  })

  await wrapper.vm.$nextTick()
  const row = wrapper.find('[data-resource-id="site"]')
  assert.equal(row.classes().includes('is-disabled'), true)
  wrapper.destroy()
})
```

- [ ] **Step 2: Run integration tests to verify failure**

Run:

```bash
npm test -- test/minimap-drop.test.js test/minimap-shell.test.js
```

Expected: FAIL because batch drop parsing and `usedResourceIds` are not wired.

- [ ] **Step 3: Add used resource derivation in `Minimap.vue`**

Add a computed value:

```js
usedResourceIds() {
  if (this.effectiveOptions.disableUsedResources !== true) return new Set()
  const ids = new Set()
  for (const node of this.graph.nodes.values()) {
    if (node.data?.resourceId) ids.add(node.data.resourceId)
  }
  return ids
}
```

Update the template:

```vue
<ResourceTree
  class="minimap-resources"
  :resources="resources"
  :used-resource-ids="usedResourceIds"
/>
```

Update the `MinimapOptions` typedef with:

```js
 * @property {boolean} [disableUsedResources=false] 禁用已在画布中出现的资源项，匹配 `node.data.resourceId`。
```

- [ ] **Step 4: Update `drag-controller` payload parsing and drop operation**

Add helpers near `handleDrop`:

```js
function parseResourcePayload(raw) {
  const payload = JSON.parse(raw)
  if (Array.isArray(payload.resources) && payload.resources.length > 0) return payload.resources
  return [payload]
}

function resourceNodeId(resource, index) {
  return `res-${resource.id}-${Date.now()}-${index}`
}
```

Replace the single-resource logic in `handleDrop` with:

```js
const resources = parseResourcePayload(raw).filter((resource) => resource?.id && resource?.label)
if (resources.length === 0) return

const point = deps.pointFromClient(event.clientX, event.clientY)
const target = resolveResourceDropTarget(point)
if (!target) return
const { parentId, index } = target
const operation = {
  type: 'drop-nodes',
  payload: {
    parentId,
    index,
    nodes: resources.map((resource, resourceIndex) => ({
      id: resourceNodeId(resource, resourceIndex),
      resource,
    })),
  },
}
const result = deps.applyOperation(operation, { before: deps.getBeforeNodeDrop() })
if (!result.applied) return

deps.updateLayout()
const batchId = `drop-${Date.now()}`
resources.forEach((resource, batchIndex) => {
  deps.emitNodeDrop({
    resource,
    parentId,
    index: result.operation.payload.index + batchIndex,
    batchId,
    batchIndex,
    batchSize: resources.length,
  })
})
deps.emitChangeIfApplied(result)
```

- [ ] **Step 5: Run integration tests to verify pass**

Run:

```bash
npm test -- test/minimap-drop.test.js test/minimap-shell.test.js test/minimap-graph-operations.test.js test/minimap-resource-tree.test.js
```

Expected: PASS.

- [ ] **Step 6: Update ROADMAP progress for completed slices**

As each implementation slice is completed, mark the matching checkbox under `资源树虚拟化切片` in `ROADMAP.md`.

After all five tasks pass, update current progress:

```markdown
- **当前阶段**：资源树虚拟化与批量拖入已完成；下一步回到第五阶段切片 5/6 或性能优化后续切片。
- **当前阶段计划**：[Resource Tree Virtualization Implementation Plan](docs/superpowers/plans/2026-06-22-resource-tree-virtualization.md)
```

- [ ] **Step 7: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add src/minimap/components/Minimap.vue src/minimap/controllers/drag-controller.js test/minimap-drop.test.js test/minimap-shell.test.js ROADMAP.md
git commit -m "feat: integrate virtual resource tree batch drops"
```

## Self-Review Checklist

- Spec coverage:
  - 10000 resource rows: Task 1 virtual window plus Task 3 component tests.
  - Fast scrollbar dragging without blanking: Task 1 `fastOverscan` and Task 3 scroll jump test.
  - Nested folders: Task 1 model and Task 3 component tests.
  - Multi-select: Task 2 selection model and Task 3 drag payload test.
  - Batch drag-to-canvas: Task 4 operation and Task 5 integration.
  - `disableUsedResources`: Task 1 disabled rows and Task 5 Minimap integration.
  - Backward compatibility: Task 1 category normalization and Task 3 single-resource payload compatibility.
- Placeholder scan: no `TBD`, `TODO`, or intentionally vague implementation steps remain.
- Type consistency:
  - Flattened rows use `key`, `id`, `label`, `type`, `depth`, `expanded`, `disabled`, and `item`.
  - Selection identity uses row `key`.
  - Batch drag payload uses `{ resources: [...] }`.
  - Graph operation uses `drop-nodes` with `payload.nodes: [{ id, resource }]`.
