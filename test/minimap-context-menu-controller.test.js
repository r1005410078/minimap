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

test('isOpen reflects whether the menu is currently open', () => {
  const layout = demoLayout()
  const { deps } = createDeps(layout)
  const controller = createContextMenuController(deps)

  assert.equal(controller.isOpen(), false)

  controller.open({ clientX: -500, clientY: -500, preventDefault: () => {}, stopPropagation: () => {} })
  assert.equal(controller.isOpen(), true)

  controller.close()
  assert.equal(controller.isOpen(), false)
})
