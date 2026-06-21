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
