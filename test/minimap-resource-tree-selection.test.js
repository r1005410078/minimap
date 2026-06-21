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
