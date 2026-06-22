<script setup>
import Minimap from './minimap/index.js'

const graphData = [
  {
    id: 'energy-root',
    label: 'Energy Root',
    icon: { text: 'S', color: '#2bdd7f' },
    data: { resourceId: 'site' },
    children: [
      {
        id: 'grid-tie',
        label: 'Grid Tie',
        icon: { text: 'G', color: '#3d9cff' },
        data: { resourceId: 'subsystem' },
        children: [
          { id: 'feeder-1', label: 'Feeder 1', icon: { text: 'P', color: '#ff8a65' }, data: { resourceId: 'pcs-device' } },
          { id: 'feeder-2', label: 'Feeder 2', icon: { text: 'M', color: '#7f95ad' }, data: { resourceId: 'metering' } },
          { id: 'feeder-3', label: 'Feeder 3' },
        ],
      },
      {
        id: 'heap-1',
        label: 'Storage Heap 1',
        icon: { text: 'B', color: '#f6c85f' },
        data: { resourceId: 'bms-stack' },
        children: Array.from({ length: 24 }, (_, index) => ({
          id: `cluster-${index + 1}`,
          label: `cluster-${index + 1}`,
          ...(index === 0 ? { icon: { text: 'C', color: '#d18cff' }, data: { resourceId: 'bms-cluster' } } : {}),
        })),
      },
      {
        id: 'cluster-25',
        label: 'Cluster 25',
        children: Array.from({ length: 10 }, (_, index) => ({
          id: `leaf-${index + 1}`,
          label: `leaf-${index + 1}`,
        })),
      },
    ],
  },
]

function makeResources(prefix, label, count, baseItems = []) {
  return [
    ...baseItems,
    ...Array.from({ length: count - baseItems.length }, (_, index) => ({
      id: `${prefix}-${index + 1}`,
      label: `${label} ${index + 1}`,
      kind: 'mock-resource',
    })),
  ]
}

const storageResources = makeResources('storage-resource', '储能性能资源', 2500, [
  { id: 'site', label: '站点' },
  { id: 'subsystem', label: '子系统' },
  { id: 'bms-stack', label: 'BMS 堆' },
  { id: 'bms-cluster', label: 'BMS 簇' },
  { id: 'pcs-device', label: 'PCS 设备' },
  { id: 'metering', label: '电能计量' },
])

const resources = [
  {
    category: '储能设备',
    expanded: true,
    items: storageResources,
  },
  {
    category: '光伏设备',
    expanded: false,
    items: makeResources('pv-resource', '光伏性能资源', 2200),
  },
  {
    category: '配电设备',
    expanded: false,
    items: makeResources('distribution-resource', '配电性能资源', 2300),
  },
  {
    category: '监控设备',
    expanded: false,
    items: makeResources('monitor-resource', '监控性能资源', 2400),
  },
]
</script>

<template>
  <Minimap :data="graphData" :resources="resources" />
</template>
