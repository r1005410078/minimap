import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph/graph.js'
import { createSearchController } from '../src/minimap/controllers/search-controller.js'

function createDeps(graph) {
  const centeredIds = []
  const selectedCalls = []
  const emitted = []
  const states = []
  const deps = {
    getGraph: () => graph,
    centerOnNode: (id) => centeredIds.push(id),
    select: (ids) => selectedCalls.push(ids),
    emitSearch: (payload) => emitted.push(payload),
    onSearchStateChange: (state) => states.push(state),
  }
  return { deps, centeredIds, selectedCalls, emitted, states }
}

test('search with matches publishes state, jumps to the first match, and emits the payload', () => {
  const graph = createDemoGraph()
  const { deps, centeredIds, selectedCalls, emitted, states } = createDeps(graph)
  const controller = createSearchController(deps)

  const payload = controller.search('feeder')

  assert.deepEqual(payload.matches, ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.equal(payload.current, 'feeder-1')
  assert.deepEqual(states.at(-1), { keyword: 'feeder', matches: ['feeder-1', 'feeder-2', 'feeder-3'], currentIndex: 0 })
  assert.deepEqual(centeredIds, ['feeder-1'])
  assert.deepEqual(selectedCalls, [['feeder-1']])
  assert.deepEqual(emitted, [payload])
})

test('search with no matches publishes empty state and does not jump', () => {
  const graph = createDemoGraph()
  const { deps, centeredIds, selectedCalls, states } = createDeps(graph)
  const controller = createSearchController(deps)

  const payload = controller.search('does-not-exist')

  assert.deepEqual(payload.matches, [])
  assert.equal(payload.current, null)
  assert.deepEqual(states.at(-1), { keyword: 'does-not-exist', matches: [], currentIndex: -1 })
  assert.deepEqual(centeredIds, [])
  assert.deepEqual(selectedCalls, [])
})

test('searchNext cycles forward through matches and wraps around', () => {
  const graph = createDemoGraph()
  const { deps, centeredIds, emitted } = createDeps(graph)
  const controller = createSearchController(deps)
  controller.search('feeder')

  controller.searchNext()
  controller.searchNext()
  controller.searchNext()

  assert.deepEqual(centeredIds, ['feeder-1', 'feeder-2', 'feeder-3', 'feeder-1'])
  assert.equal(emitted.at(-1).current, 'feeder-1')
})

test('searchPrevious cycles backward through matches and wraps around', () => {
  const graph = createDemoGraph()
  const { deps, centeredIds } = createDeps(graph)
  const controller = createSearchController(deps)
  controller.search('feeder')

  controller.searchPrevious()

  assert.deepEqual(centeredIds, ['feeder-1', 'feeder-3'])
})

test('searchNext and searchPrevious are no-ops when there are no matches', () => {
  const graph = createDemoGraph()
  const { deps, centeredIds, emitted } = createDeps(graph)
  const controller = createSearchController(deps)
  controller.search('does-not-exist')

  controller.searchNext()
  controller.searchPrevious()

  assert.deepEqual(centeredIds, [])
  assert.equal(emitted.length, 1) // only the initial search() emit, no extra emits from next/previous
})

test('getCurrentMatchId tracks the active match through search/next/previous, and is null before any search or with no matches', () => {
  const graph = createDemoGraph()
  const { deps } = createDeps(graph)
  const controller = createSearchController(deps)

  assert.equal(controller.getCurrentMatchId(), null)

  controller.search('feeder')
  assert.equal(controller.getCurrentMatchId(), 'feeder-1')

  controller.searchNext()
  assert.equal(controller.getCurrentMatchId(), 'feeder-2')

  controller.searchPrevious()
  assert.equal(controller.getCurrentMatchId(), 'feeder-1')

  controller.search('does-not-exist')
  assert.equal(controller.getCurrentMatchId(), null)
})
