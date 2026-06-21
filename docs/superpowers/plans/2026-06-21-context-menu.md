# Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in, customizable right-click menu for node, group, and blank-canvas contexts.

**Architecture:** Put menu item construction and merge rules in a pure JS module so they can be tested without Vue. `Minimap.vue` owns runtime state: opening/closing the menu, resolving canvas hits, executing built-in actions, emitting `context-menu-action` and `config-change`, and rendering one positioned menu DOM.

**Tech Stack:** Vue 2.7 `<script setup>`, Canvas 2D hit testing, Node test runner, Vue Test Utils, existing jsdom/canvas test helpers.

---

## File Structure

- Create `src/minimap/context-menu.js`
  - Builds default menu items for `node`, `group`, and `canvas` contexts.
  - Normalizes item defaults.
  - Merges `contextMenuItems` array/function overrides with defaults.
  - Exposes the set of built-in actions.
- Modify `src/minimap/Minimap.vue`
  - Add `contextMenuItems` prop.
  - Add `context-menu-action` and `config-change` emits.
  - Track `contextMenuState` with screen position, context, and final items.
  - Add `contextmenu` event listener on the canvas.
  - Render the menu and execute built-in menu actions.
  - Close menu on outside click, `Esc`, wheel, pointer start, graph/options changes, and unmount.
- Create `test/minimap-context-menu.test.js`
  - Pure unit coverage for default items, disabled states, and customization merge behavior.
- Modify `test/minimap-shell.test.js`
  - Vue integration coverage for opening menus, executing built-in actions, config-change, custom actions, and closing behavior.
- Modify `ROADMAP.md`
  - Mark the implementation plan path once this plan is created.

## Task 1: Pure Menu Model

**Files:**
- Create: `src/minimap/context-menu.js`
- Create: `test/minimap-context-menu.test.js`

- [ ] **Step 1: Write failing pure-model tests**

Create `test/minimap-context-menu.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILT_IN_CONTEXT_MENU_ACTIONS,
  buildContextMenuItems,
  mergeContextMenuItems,
} from '../src/minimap/context-menu.js'

function baseContext(overrides = {}) {
  return {
    targetType: 'canvas',
    targetId: null,
    groupId: null,
    screenPoint: { x: 10, y: 20 },
    worldPoint: { x: 10, y: 20 },
    selectedIds: [],
    readonly: false,
    canPaste: false,
    canUndo: false,
    canRedo: false,
    options: {},
    hasToggleableGroup: false,
    ...overrides,
  }
}

test('canvas context contains only common canvas actions', () => {
  const items = buildContextMenuItems(baseContext())
  assert.deepEqual(
    items.filter((item) => item.type !== 'separator').map((item) => item.id),
    [
      'paste',
      'fit-to-screen',
      'center-selection',
      'toggle-search',
      'toggle-grid',
      'toggle-performance',
      'toggle-readonly',
    ],
  )
})

test('node context prepends node actions and keeps common canvas actions', () => {
  const items = buildContextMenuItems(
    baseContext({
      targetType: 'node',
      targetId: 'heap-1',
      selectedIds: ['heap-1'],
      canPaste: true,
      hasToggleableGroup: true,
      options: { enableSearch: false, showGrid: true, showPerformance: false },
    }),
  )
  const ids = items.filter((item) => item.type !== 'separator').map((item) => item.id)
  assert.deepEqual(ids, [
    'add-child',
    'add-sibling',
    'copy',
    'paste-into-target',
    'delete',
    'center-target',
    'toggle-group',
    'paste',
    'fit-to-screen',
    'center-selection',
    'toggle-search',
    'toggle-grid',
    'toggle-performance',
    'toggle-readonly',
  ])
  assert.equal(items.find((item) => item.id === 'add-child').disabled, true)
  assert.equal(items.find((item) => item.id === 'add-sibling').disabled, true)
  assert.equal(items.find((item) => item.id === 'toggle-search').checked, false)
  assert.equal(items.find((item) => item.id === 'toggle-grid').checked, true)
})

test('disabled states follow readonly clipboard selection and group availability', () => {
  const items = buildContextMenuItems(
    baseContext({
      targetType: 'node',
      targetId: 'heap-1',
      selectedIds: [],
      readonly: true,
      canPaste: false,
      hasToggleableGroup: false,
    }),
  )
  assert.equal(items.find((item) => item.id === 'copy').disabled, false)
  assert.equal(items.find((item) => item.id === 'paste-into-target').disabled, true)
  assert.equal(items.find((item) => item.id === 'delete').disabled, true)
  assert.equal(items.find((item) => item.id === 'paste').disabled, true)
  assert.equal(items.find((item) => item.id === 'center-selection').disabled, true)
  assert.equal(items.find((item) => item.id === 'toggle-group').disabled, true)
})

test('contextMenuItems function can hide a default item and append a custom item', () => {
  const defaults = buildContextMenuItems(baseContext({ targetType: 'node', targetId: 'heap-1' }))
  const items = mergeContextMenuItems(
    baseContext({ targetType: 'node', targetId: 'heap-1' }),
    defaults,
    (context, defaultItems) =>
      defaultItems
        .filter((item) => item.id !== 'toggle-performance')
        .concat({ id: 'inspect-node', label: '查看详情', action: 'inspect-node' }),
  )
  assert.equal(items.some((item) => item.id === 'toggle-performance'), false)
  assert.equal(items.at(-1).id, 'inspect-node')
})

test('contextMenuItems array overrides matching ids and appends new ids', () => {
  const defaults = buildContextMenuItems(baseContext())
  const items = mergeContextMenuItems(baseContext(), defaults, [
    { id: 'paste', label: '业务粘贴', disabled: true },
    { id: 'open-panel', label: '打开面板', action: 'open-panel' },
  ])
  assert.equal(items.find((item) => item.id === 'paste').label, '业务粘贴')
  assert.equal(items.find((item) => item.id === 'paste').disabled, true)
  assert.equal(items.at(-1).id, 'open-panel')
})

test('built-in action set marks component-owned actions', () => {
  assert.equal(BUILT_IN_CONTEXT_MENU_ACTIONS.has('copy'), true)
  assert.equal(BUILT_IN_CONTEXT_MENU_ACTIONS.has('inspect-node'), false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- test/minimap-context-menu.test.js
```

Expected: FAIL with module-not-found for `src/minimap/context-menu.js`.

- [ ] **Step 3: Implement the pure model**

Create `src/minimap/context-menu.js`:

```js
export const BUILT_IN_CONTEXT_MENU_ACTIONS = new Set([
  'add-child',
  'add-sibling',
  'copy',
  'paste-into-target',
  'delete',
  'center-target',
  'toggle-group',
  'paste',
  'fit-to-screen',
  'center-selection',
  'toggle-search',
  'toggle-grid',
  'toggle-performance',
  'toggle-readonly',
])

function separator(id) {
  return { id, type: 'separator', visible: true, disabled: true }
}

function item(input) {
  return {
    type: input.type ?? 'item',
    visible: input.visible ?? true,
    disabled: input.disabled ?? false,
    checked: input.checked ?? false,
    danger: input.danger ?? false,
    action: input.action ?? input.id,
    ...input,
  }
}

function optionEnabled(options, key, defaultValue = true) {
  return options?.[key] ?? defaultValue
}

function commonItems(context) {
  const readonly = context.readonly === true
  const hasSelection = context.selectedIds.length > 0
  return [
    item({ id: 'paste', label: '粘贴', disabled: readonly || !context.canPaste }),
    item({ id: 'fit-to-screen', label: '适配视图' }),
    item({ id: 'center-selection', label: '居中选中', disabled: !hasSelection }),
    separator('view-separator'),
    item({
      id: 'toggle-search',
      label: '显示搜索',
      type: 'checkbox',
      checked: optionEnabled(context.options, 'enableSearch', true),
    }),
    item({
      id: 'toggle-grid',
      label: '显示网格',
      type: 'checkbox',
      checked: optionEnabled(context.options, 'showGrid', true),
    }),
    item({
      id: 'toggle-performance',
      label: '显示性能信息',
      type: 'checkbox',
      checked: optionEnabled(context.options, 'showPerformance', false),
    }),
    item({
      id: 'toggle-readonly',
      label: '编辑模式',
      type: 'checkbox',
      checked: !readonly,
    }),
  ]
}

function targetItems(context) {
  const readonly = context.readonly === true
  const hasTarget = context.targetType === 'node' || context.targetType === 'group'
  const canActOnTarget = hasTarget || context.selectedIds.length > 0
  return [
    item({ id: 'add-child', label: '添加子节点', disabled: true }),
    item({ id: 'add-sibling', label: '添加兄弟节点', disabled: true }),
    item({ id: 'copy', label: '复制', disabled: !canActOnTarget }),
    item({
      id: 'paste-into-target',
      label: '粘贴到此节点下',
      disabled: readonly || !context.canPaste || !hasTarget,
    }),
    item({ id: 'delete', label: '删除', danger: true, disabled: readonly || !canActOnTarget }),
    separator('target-view-separator'),
    item({ id: 'center-target', label: '居中到此节点', disabled: !hasTarget }),
    item({ id: 'toggle-group', label: '展开/折叠子分组', disabled: !context.hasToggleableGroup }),
    separator('common-separator'),
  ]
}

export function buildContextMenuItems(context) {
  const base = context.targetType === 'canvas' ? commonItems(context) : targetItems(context).concat(commonItems(context))
  return base.filter((entry) => entry.visible !== false)
}

export function mergeContextMenuItems(context, defaults, customItems) {
  if (!customItems) return defaults
  if (typeof customItems === 'function') {
    return customItems(context, defaults).map(item).filter((entry) => entry.visible !== false)
  }
  const byId = new Map(defaults.map((entry) => [entry.id, entry]))
  const result = [...defaults]
  for (const custom of customItems) {
    const normalized = item(custom)
    if (byId.has(normalized.id)) {
      const index = result.findIndex((entry) => entry.id === normalized.id)
      result[index] = { ...result[index], ...normalized }
    } else {
      result.push(normalized)
    }
  }
  return result.filter((entry) => entry.visible !== false)
}
```

- [ ] **Step 4: Run pure-model tests**

Run:

```bash
npm test -- test/minimap-context-menu.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/context-menu.js test/minimap-context-menu.test.js
git commit -m "feat: add context menu model"
```

## Task 2: Open, Position, Render, and Close the Menu

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-shell.test.js`

- [ ] **Step 1: Write failing Vue integration tests for opening and closing**

Append to `test/minimap-shell.test.js`:

```js
function dispatchContextMenu(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
  })
  canvasEl.dispatchEvent(event)
  return event
}

test('right-clicking a node opens the node context menu with common canvas actions', async () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  flushAnimationFrames()
  const ctx = contexts.at(-1)
  const rootRect = renderedRectForLabel(ctx, 'Energy Root')
  const event = dispatchContextMenu(wrapper, centerOf(rootRect))
  await wrapper.vm.$nextTick()

  assert.equal(event.defaultPrevented, true)
  assert.equal(wrapper.find('.minimap-context-menu').exists(), true)
  const labels = wrapper.findAll('.minimap-context-menu-item').wrappers.map((item) => item.text())
  assert.ok(labels.includes('添加子节点'))
  assert.ok(labels.includes('复制'))
  assert.ok(labels.includes('适配视图'))
  assert.ok(labels.includes('显示搜索'))
  assert.equal(wrapper.find('.minimap-context-menu-item[data-menu-id="add-child"]').attributes('aria-disabled'), 'true')

  wrapper.destroy()
})

test('right-clicking blank canvas opens only common canvas actions and closes on Escape', async () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  dispatchContextMenu(wrapper, { x: 760, y: 560 })
  await wrapper.vm.$nextTick()

  const labels = wrapper.findAll('.minimap-context-menu-item').wrappers.map((item) => item.text())
  assert.equal(labels.includes('复制'), false)
  assert.ok(labels.includes('粘贴'))
  assert.ok(labels.includes('居中选中'))

  wrapper.find('canvas').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await wrapper.vm.$nextTick()
  assert.equal(wrapper.find('.minimap-context-menu').exists(), false)

  wrapper.destroy()
})

test('context menu position is clamped inside the canvas container', async () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  dispatchContextMenu(wrapper, { x: 795, y: 595 })
  await wrapper.vm.$nextTick()

  const style = wrapper.find('.minimap-context-menu').attributes('style')
  assert.match(style, /left: \d+px/)
  assert.match(style, /top: \d+px/)
  assert.doesNotMatch(style, /left: 795px/)

  wrapper.destroy()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: FAIL because `.minimap-context-menu` does not exist.

- [ ] **Step 3: Add props, emits, imports, and menu state**

In `src/minimap/Minimap.vue`, update imports:

```js
import {
  BUILT_IN_CONTEXT_MENU_ACTIONS,
  buildContextMenuItems,
  mergeContextMenuItems,
} from './context-menu.js'
```

Add prop:

```js
contextMenuItems: { type: [Array, Function], default: null },
```

Add emits:

```js
'context-menu-action',
'config-change',
```

Add state near other refs:

```js
const contextMenuState = ref(null)
const CONTEXT_MENU_WIDTH = 190
const CONTEXT_MENU_MAX_HEIGHT = 360
```

- [ ] **Step 4: Add context resolution and open/close helpers**

Add these functions near `screenPointFromEvent`:

```js
function clampContextMenuPosition(screenPoint) {
  return {
    x: Math.max(8, Math.min(screenPoint.x, cssWidth - CONTEXT_MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(screenPoint.y, cssHeight - CONTEXT_MENU_MAX_HEIGHT - 8)),
  }
}

function canPaste() {
  return !!clipboard?.nodes?.length
}

function groupForHit(hit) {
  if (!hit || hit.type !== 'group') return null
  return layout?.groups.find((group) => group.id === hit.id) ?? null
}

function contextFromHit(hit, event) {
  const screenPoint = screenPointFromEvent(event)
  const worldPoint = screenToWorld(screenPoint, currentViewport())
  if (hit?.type === 'node') {
    const node = props.graph.nodes.get(hit.id)
    return {
      targetType: 'node',
      targetId: hit.id,
      groupId: null,
      screenPoint,
      worldPoint,
      selectedIds: currentSelectedIds(),
      readonly: props.readonly,
      canPaste: canPaste(),
      canUndo: canUndo(),
      canRedo: canRedo(),
      options: props.options ?? {},
      hasToggleableGroup: !!node?.children?.length,
    }
  }
  if (hit?.type === 'group') {
    const group = groupForHit(hit)
    return {
      targetType: 'group',
      targetId: group?.parentId ?? hit.childId ?? null,
      groupId: hit.id,
      screenPoint,
      worldPoint,
      selectedIds: currentSelectedIds(),
      readonly: props.readonly,
      canPaste: canPaste(),
      canUndo: canUndo(),
      canRedo: canRedo(),
      options: props.options ?? {},
      hasToggleableGroup: !!group,
    }
  }
  return {
    targetType: 'canvas',
    targetId: null,
    groupId: null,
    screenPoint,
    worldPoint,
    selectedIds: currentSelectedIds(),
    readonly: props.readonly,
    canPaste: canPaste(),
    canUndo: canUndo(),
    canRedo: canRedo(),
    options: props.options ?? {},
    hasToggleableGroup: false,
  }
}

function closeContextMenu() {
  contextMenuState.value = null
}

function openContextMenu(event) {
  if (!layout) return
  event.preventDefault()
  cancelPointerInteractions()
  canvasRef.value.focus?.()
  const hit = hitTest(layout, pointFromEvent(event))
  const context = contextFromHit(hit, event)
  const defaults = buildContextMenuItems(context)
  const items = mergeContextMenuItems(context, defaults, props.contextMenuItems)
  contextMenuState.value = {
    context,
    items,
    position: clampContextMenuPosition(context.screenPoint),
  }
}
```

- [ ] **Step 5: Wire close behavior into existing handlers and lifecycle**

At the start of `handlePointerDown`, `handleWheel`, and the `Escape` branch in `handleKeyDown`, call `closeContextMenu()`.

In `onMounted()`, add:

```js
canvas.addEventListener('contextmenu', openContextMenu)
```

In `onUnmounted()`, add:

```js
canvas.removeEventListener('contextmenu', openContextMenu)
```

Add watchers:

```js
watch(() => props.graph, () => closeContextMenu())
watch(() => props.options, () => closeContextMenu())
```

If there is already a watcher for the same source, merge `closeContextMenu()` into the existing watcher instead of adding a duplicate watcher.

- [ ] **Step 6: Render the menu template**

Inside `.minimap-canvas-container`, after the overview panel, add:

```vue
<div
  v-if="contextMenuState"
  class="minimap-context-menu"
  role="menu"
  :style="{ left: `${contextMenuState.position.x}px`, top: `${contextMenuState.position.y}px` }"
  @pointerdown.stop
>
  <template v-for="item in contextMenuState.items" :key="item.id">
    <div v-if="item.type === 'separator'" class="minimap-context-menu-separator"></div>
    <button
      v-else
      class="minimap-context-menu-item"
      :class="{ 'is-danger': item.danger, 'is-checked': item.checked }"
      type="button"
      role="menuitem"
      :data-menu-id="item.id"
      :aria-disabled="item.disabled ? 'true' : 'false'"
      :disabled="item.disabled"
      @click="runContextMenuItem(item)"
    >
      <span class="minimap-context-menu-check" aria-hidden="true">{{ item.type === 'checkbox' ? (item.checked ? '✓' : '') : '' }}</span>
      <span class="minimap-context-menu-label">{{ item.label }}</span>
    </button>
  </template>
</div>
```

- [ ] **Step 7: Add minimal no-op click handler and styles**

Add handler:

```js
function runContextMenuItem(item) {
  if (item.disabled) return
  emit('context-menu-action', {
    action: item.action,
    item,
    context: contextMenuState.value.context,
  })
  closeContextMenu()
}
```

Add styles:

```css
.minimap-context-menu {
  position: absolute;
  z-index: 8;
  width: 190px;
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
  color: #d8dee8;
  background: rgba(17, 21, 27, 0.98);
  border: 1px solid #303741;
  border-radius: 8px;
  box-shadow: 0 18px 38px rgba(0, 0, 0, 0.42);
}
.minimap-context-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 30px;
  gap: 8px;
  padding: 0 8px;
  color: #cfd6df;
  background: transparent;
  border: 0;
  border-radius: 5px;
  text-align: left;
  font: 13px/1 system-ui, sans-serif;
}
.minimap-context-menu-item:hover:not(:disabled) {
  background: #232930;
}
.minimap-context-menu-item:disabled {
  opacity: 0.38;
}
.minimap-context-menu-item.is-danger:not(:disabled) {
  color: #ff8d8d;
}
.minimap-context-menu-check {
  width: 14px;
  color: #2bdd7f;
  text-align: center;
}
.minimap-context-menu-label {
  flex: 1;
}
.minimap-context-menu-separator {
  height: 1px;
  margin: 5px 4px;
  background: #2a3038;
}
```

- [ ] **Step 8: Run integration tests**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: PASS for the newly added opening/closing tests and existing shell tests.

- [ ] **Step 9: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-shell.test.js
git commit -m "feat: render minimap context menu"
```

## Task 3: Built-In Menu Actions

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-shell.test.js`

- [ ] **Step 1: Write failing tests for built-in actions**

Append to `test/minimap-shell.test.js`:

```js
async function clickContextMenuItem(wrapper, id) {
  await wrapper.find(`.minimap-context-menu-item[data-menu-id="${id}"]`).trigger('click')
}

test('context menu copy delete and paste actions reuse edit commands', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  flushAnimationFrames()
  const ctx = contexts.at(-1)
  const feederRect = renderedRectForLabel(ctx, 'Feeder 2')

  dispatchContextMenu(wrapper, centerOf(feederRect))
  await wrapper.vm.$nextTick()
  await clickContextMenuItem(wrapper, 'copy')
  assert.equal(wrapper.emitted('copy').at(-1)[0].capturedIds.includes('feeder-2'), true)

  dispatchContextMenu(wrapper, centerOf(feederRect))
  await wrapper.vm.$nextTick()
  await clickContextMenuItem(wrapper, 'paste-into-target')
  assert.equal(wrapper.emitted('paste').at(-1)[0].targetParentId, 'feeder-2')

  dispatchContextMenu(wrapper, centerOf(feederRect))
  await wrapper.vm.$nextTick()
  await clickContextMenuItem(wrapper, 'delete')
  assert.equal(graph.nodes.has('feeder-2'), false)

  wrapper.destroy()
})

test('context menu view actions call existing viewport methods', async () => {
  const wrapper = mount(Minimap, {
    propsData: {
      graph: createDemoGraph(),
      selectedIds: ['energy-root'],
    },
  })

  dispatchContextMenu(wrapper, { x: 760, y: 560 })
  await wrapper.vm.$nextTick()
  await clickContextMenuItem(wrapper, 'fit-to-screen')
  assert.ok(wrapper.emitted('viewport-change')?.length > 0)

  dispatchContextMenu(wrapper, { x: 760, y: 560 })
  await wrapper.vm.$nextTick()
  await clickContextMenuItem(wrapper, 'center-selection')
  assert.ok(wrapper.emitted('viewport-change')?.length > 1)

  wrapper.destroy()
})

test('context menu group toggle emits group-state-change', async () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  flushAnimationFrames()
  const ctx = contexts.at(-1)
  const clusterRect = renderedRectForLabel(ctx, 'cluster-1')

  dispatchContextMenu(wrapper, centerOf(clusterRect))
  await wrapper.vm.$nextTick()
  await clickContextMenuItem(wrapper, 'toggle-group')

  assert.ok(wrapper.emitted('group-state-change')?.length > 0)
  wrapper.destroy()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: FAIL because `runContextMenuItem` only emits and closes.

- [ ] **Step 3: Add target selection helpers**

Add near `copySelection()`:

```js
function idsForContextTarget(context) {
  if (!context) return []
  if (context.targetType === 'group' && context.groupId) {
    const group = layout?.groups.find((item) => item.id === context.groupId)
    return group ? [group.id] : []
  }
  return context.targetId ? [context.targetId] : []
}

function runWithTemporarySelection(ids, command) {
  const previous = currentSelectedIds()
  const shouldRestore = props.selectedIds === null
  if (ids.length > 0) setSelected(ids)
  const result = command()
  if (shouldRestore) {
    internalSelectedIds = previous
    emit('select', previous)
    renderCurrent()
  }
  return result
}
```

- [ ] **Step 4: Add targeted paste helper**

Refactor `paste()` to call a new helper:

```js
function pasteInto(targetParentId = pasteTargetId()) {
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

function paste() {
  return pasteInto()
}
```

- [ ] **Step 5: Execute built-in actions**

Replace `runContextMenuItem` with:

```js
function toggleConfig(key, value, context) {
  emit('config-change', { key, value, source: 'context-menu', context })
}

function executeContextMenuAction(action, context) {
  if (action === 'copy') return runWithTemporarySelection(idsForContextTarget(context), copySelection)
  if (action === 'delete') return runWithTemporarySelection(idsForContextTarget(context), deleteSelection)
  if (action === 'paste-into-target') return pasteInto(context.targetId)
  if (action === 'paste') return paste()
  if (action === 'fit-to-screen') return fitToScreen()
  if (action === 'center-selection') return centerOnSelection()
  if (action === 'center-target') return centerOnNode(context.targetId)
  if (action === 'toggle-group' && context.groupId) {
    const group = layout?.groups.find((item) => item.id === context.groupId)
    if (!group) return
    updateGroupState(context.groupId, { expanded: !group.expanded })
    updateLayout()
    return
  }
  if (action === 'toggle-search') {
    return toggleConfig('enableSearch', !(props.options?.enableSearch ?? true), context)
  }
  if (action === 'toggle-grid') {
    return toggleConfig('showGrid', !(props.options?.showGrid ?? true), context)
  }
  if (action === 'toggle-performance') {
    return toggleConfig('showPerformance', !(props.options?.showPerformance ?? false), context)
  }
  if (action === 'toggle-readonly') {
    return toggleConfig('readonly', !props.readonly, context)
  }
}

function runContextMenuItem(item) {
  if (item.disabled || !contextMenuState.value) return
  const context = contextMenuState.value.context
  emit('context-menu-action', { action: item.action, item, context })
  if (BUILT_IN_CONTEXT_MENU_ACTIONS.has(item.action)) executeContextMenuAction(item.action, context)
  closeContextMenu()
}
```

- [ ] **Step 6: Run action tests**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-shell.test.js
git commit -m "feat: wire context menu actions"
```

## Task 4: Custom Items and Config Events

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-shell.test.js`

- [ ] **Step 1: Write failing customization and config tests**

Append to `test/minimap-shell.test.js`:

```js
test('contextMenuItems can hide defaults and add a custom action', async () => {
  const wrapper = mount(Minimap, {
    propsData: {
      graph: createDemoGraph(),
      contextMenuItems: (context, defaults) =>
        defaults
          .filter((item) => item.id !== 'toggle-performance')
          .concat({ id: 'inspect-node', label: '查看详情', action: 'inspect-node' }),
    },
  })

  dispatchContextMenu(wrapper, { x: 760, y: 560 })
  await wrapper.vm.$nextTick()
  assert.equal(wrapper.find('.minimap-context-menu-item[data-menu-id="toggle-performance"]').exists(), false)
  await clickContextMenuItem(wrapper, 'inspect-node')

  const action = wrapper.emitted('context-menu-action').at(-1)[0]
  assert.equal(action.action, 'inspect-node')
  assert.equal(wrapper.emitted('change'), undefined)
  wrapper.destroy()
})

test('config menu items emit config-change and do not mutate props internally', async () => {
  const wrapper = mount(Minimap, {
    propsData: {
      graph: createDemoGraph(),
      options: { enableSearch: true, showGrid: true, showPerformance: false },
      readonly: false,
    },
  })

  dispatchContextMenu(wrapper, { x: 760, y: 560 })
  await wrapper.vm.$nextTick()
  await clickContextMenuItem(wrapper, 'toggle-search')
  assert.deepEqual(wrapper.emitted('config-change').at(-1)[0].key, 'enableSearch')
  assert.equal(wrapper.emitted('config-change').at(-1)[0].value, false)
  assert.equal(wrapper.find('.minimap-search').exists(), true)

  dispatchContextMenu(wrapper, { x: 760, y: 560 })
  await wrapper.vm.$nextTick()
  await clickContextMenuItem(wrapper, 'toggle-readonly')
  assert.equal(wrapper.emitted('config-change').at(-1)[0].key, 'readonly')
  assert.equal(wrapper.emitted('config-change').at(-1)[0].value, true)

  wrapper.destroy()
})
```

- [ ] **Step 2: Run tests**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: PASS if Tasks 1-3 were implemented as specified. If this fails, fix `mergeContextMenuItems` or `executeContextMenuAction` rather than changing the test intent.

- [ ] **Step 3: Add array override integration test if not already covered by pure tests**

Append:

```js
test('contextMenuItems array can disable a default item in the rendered menu', async () => {
  const wrapper = mount(Minimap, {
    propsData: {
      graph: createDemoGraph(),
      contextMenuItems: [{ id: 'paste', label: '业务粘贴', disabled: true }],
    },
  })

  dispatchContextMenu(wrapper, { x: 760, y: 560 })
  await wrapper.vm.$nextTick()
  const paste = wrapper.find('.minimap-context-menu-item[data-menu-id="paste"]')
  assert.equal(paste.text(), '业务粘贴')
  assert.equal(paste.attributes('disabled'), '')

  wrapper.destroy()
})
```

- [ ] **Step 4: Run shell tests again**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-shell.test.js
git commit -m "test: cover context menu customization"
```

## Task 5: Polish Close Behavior, Docs State, and Full Verification

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Ensure menu closes on outside pointer starts**

Confirm `handlePointerDown` begins with:

```js
function handlePointerDown(event) {
  closeContextMenu()
  if (!layout) return
  canvasRef.value.focus?.()
  // existing logic follows
}
```

Confirm `handleWheel` begins with:

```js
function handleWheel(event) {
  closeContextMenu()
  if (!layout) return
  // existing logic follows
}
```

Confirm `handleKeyDown` closes the menu first on Escape:

```js
if (event.key === 'Escape') {
  if (contextMenuState.value) {
    event.preventDefault()
    closeContextMenu()
    return
  }
  if (currentSelectedIds().length === 0) return
  event.preventDefault()
  setSelected([])
  return
}
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
npm test -- test/minimap-context-menu.test.js test/minimap-shell.test.js
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected:

- `npm test`: all tests pass.
- `npm run build`: Vite build completes successfully.

- [ ] **Step 4: Update ROADMAP after implementation**

In `ROADMAP.md`, update the fifth-stage slice 4 item from unchecked to checked and append implementation result:

```markdown
- [x] 切片 4：右键菜单（节点/分组/空白画布右键菜单；节点菜单包含通用画布菜单；默认菜单 + `contextMenuItems` 覆盖；配置项通过 `config-change` 受控通知；新增节点入口保留但禁用；不做重命名和连线菜单；[spec](docs/superpowers/specs/2026-06-21-context-menu-design.md)，[plan](docs/superpowers/plans/2026-06-21-context-menu.md)，`npm test` 与 `npm run build` 通过）
```

Update current progress to:

```markdown
- **当前阶段**：第五阶段切片 5 —— 组件状态与可访问性
- **当前阶段 Spec**：下一步编写；范围为 `loading`/空图/`error` 状态、`error` 事件、`options.keyboard` 开关、aria 状态区域
- **当前阶段计划**：spec 确认后编写第五阶段切片 5 implementation plan
```

- [ ] **Step 5: Commit final roadmap update**

```bash
git add ROADMAP.md
git commit -m "docs: mark context menu slice complete"
```

If Task 5 produces code edits beyond docs, include those files in the same commit:

```bash
git add src/minimap/Minimap.vue ROADMAP.md
git commit -m "chore: finish context menu slice"
```

## Self-Review

- Spec coverage:
  - Node, group, and canvas contexts are covered by Tasks 1-3.
  - Default menu items and disabled states are covered by Task 1 and Task 2.
  - Built-in actions are covered by Task 3.
  - `contextMenuItems` function and array customization are covered by Tasks 1 and 4.
  - `context-menu-action` and `config-change` are covered by Tasks 3 and 4.
  - No rename, no real add child/sibling, no edge menu, and no multi-level submenu are preserved by disabled items and no `children` rendering.
- Plan completeness scan:
  - All implementation steps include concrete files, commands, and expected outcomes.
- Type consistency:
  - `contextMenuItems`, `context-menu-action`, `config-change`, `targetType`, `targetId`, `groupId`, `screenPoint`, and `worldPoint` match the spec.
  - Built-in action ids match the menu item ids and execution switch.
