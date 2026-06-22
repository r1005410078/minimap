import test from 'node:test'
import assert from 'node:assert/strict'
import { graphToTreeData, treeDataToGraph } from '../src/minimap/graph/tree-data.js'

test('treeDataToGraph converts nested data into the internal graph shape', () => {
  const graph = treeDataToGraph([
    {
      id: 'root',
      label: 'Root',
      icon: { text: 'R', color: '#2bdd7f' },
      data: { resourceId: 'site' },
      children: [
        { id: 'child-a', label: 'Child A', icon: 'A' },
        { id: 'child-b', label: 'Child B', kind: 'meter', children: [{ id: 'leaf', label: 'Leaf' }] },
      ],
    },
  ])

  assert.equal(graph.version, 1)
  assert.deepEqual(graph.rootIds, ['root'])
  assert.deepEqual(graph.edges, [])
  assert.deepEqual(graph.nodes.get('root'), {
    id: 'root',
    label: 'Root',
    parentId: null,
    children: ['child-a', 'child-b'],
    icon: { text: 'R', color: '#2bdd7f' },
    data: { resourceId: 'site' },
  })
  assert.deepEqual(graph.nodes.get('child-a'), {
    id: 'child-a',
    label: 'Child A',
    parentId: 'root',
    children: [],
    icon: 'A',
  })
  assert.equal(graph.nodes.get('child-b').parentId, 'root')
  assert.deepEqual(graph.nodes.get('child-b').children, ['leaf'])
  assert.equal(graph.nodes.get('leaf').parentId, 'child-b')
})

test('graphToTreeData converts an edited graph back to nested data', () => {
  const graph = treeDataToGraph([
    { id: 'root', label: 'Root', children: [{ id: 'child', label: 'Child', icon: 'C' }] },
  ])
  graph.nodes.get('root').children.push('added')
  graph.nodes.set('added', { id: 'added', label: 'Added', parentId: 'root', children: [], data: { resourceId: 'added' } })

  assert.deepEqual(graphToTreeData(graph), [
    {
      id: 'root',
      label: 'Root',
      children: [
        { id: 'child', label: 'Child', icon: 'C', children: [] },
        { id: 'added', label: 'Added', data: { resourceId: 'added' }, children: [] },
      ],
    },
  ])
})
