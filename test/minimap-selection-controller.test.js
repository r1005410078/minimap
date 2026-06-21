import test from 'node:test'
import assert from 'node:assert/strict'
import { createSelectionController } from '../src/minimap/controllers/selection-controller.js'

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
