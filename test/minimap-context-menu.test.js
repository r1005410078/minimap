import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILT_IN_CONTEXT_MENU_ACTIONS,
  buildContextMenuItems,
  mergeContextMenuItems,
} from '../src/minimap/edit/context-menu.js'

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
      'toggle-hide-text-during-interaction',
      'toggle-readonly',
    ],
  )
  assert.equal(items.find((item) => item.id === 'toggle-hide-text-during-interaction').checked, false)
})

test('node context prepends node actions and keeps common canvas actions', () => {
  const items = buildContextMenuItems(
    baseContext({
      targetType: 'node',
      targetId: 'heap-1',
      selectedIds: ['heap-1'],
      canPaste: true,
      hasToggleableGroup: true,
      options: {
        enableSearch: false,
        showGrid: true,
        showPerformance: false,
        hideTextDuringInteraction: true,
      },
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
    'toggle-hide-text-during-interaction',
    'toggle-readonly',
  ])
  assert.equal(items.find((item) => item.id === 'add-child').disabled, true)
  assert.equal(items.find((item) => item.id === 'add-sibling').disabled, true)
  assert.equal(items.find((item) => item.id === 'toggle-search').checked, false)
  assert.equal(items.find((item) => item.id === 'toggle-grid').checked, true)
  assert.equal(items.find((item) => item.id === 'toggle-hide-text-during-interaction').checked, true)
})

test('preview mode canvas context keeps only fit-to-screen and center-selection', () => {
  const items = buildContextMenuItems(
    baseContext({
      selectedIds: ['heap-1'],
      options: { previewMode: true },
    }),
  )

  assert.deepEqual(
    items.filter((item) => item.type !== 'separator').map((item) => item.id),
    ['fit-to-screen', 'center-selection'],
  )
})

test('preview mode node context keeps only center-target toggle-group fit-to-screen and center-selection', () => {
  const items = buildContextMenuItems(
    baseContext({
      targetType: 'node',
      targetId: 'heap-1',
      selectedIds: ['heap-1'],
      canPaste: true,
      hasToggleableGroup: true,
      options: { previewMode: true },
    }),
  )

  assert.deepEqual(
    items.filter((item) => item.type !== 'separator').map((item) => item.id),
    ['center-target', 'toggle-group', 'fit-to-screen', 'center-selection'],
  )
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

test('preview mode passes preview-filtered defaults into contextMenuItems function merging', () => {
  const context = baseContext({
    targetType: 'node',
    targetId: 'heap-1',
    selectedIds: ['heap-1'],
    hasToggleableGroup: true,
    options: { previewMode: true },
  })
  const defaults = buildContextMenuItems(context)
  const items = mergeContextMenuItems(context, defaults, (mergedContext, defaultItems) => {
    assert.equal(mergedContext, context)
    assert.deepEqual(
      defaultItems.filter((item) => item.type !== 'separator').map((item) => item.id),
      ['center-target', 'toggle-group', 'fit-to-screen', 'center-selection'],
    )
    return defaultItems.concat({ id: 'inspect-node', label: '查看详情', action: 'inspect-node' })
  })

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
  assert.equal(BUILT_IN_CONTEXT_MENU_ACTIONS.has('toggle-hide-text-during-interaction'), true)
  assert.equal(BUILT_IN_CONTEXT_MENU_ACTIONS.has('inspect-node'), false)
})
