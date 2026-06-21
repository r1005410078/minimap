<script setup>
import Minimap from './minimap/index.js'
import { createDemoGraph } from './minimap/graph/graph.js'

const graph = createDemoGraph()
graph.nodes.get('energy-root').data = { resourceId: 'site' }
graph.nodes.get('grid-tie').data = { resourceId: 'subsystem' }
graph.nodes.get('heap-1').data = { resourceId: 'bms-stack' }
graph.nodes.get('cluster-1').data = { resourceId: 'bms-cluster' }
graph.nodes.get('feeder-1').data = { resourceId: 'pcs-device' }
graph.nodes.get('feeder-2').data = { resourceId: 'metering' }

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
  <Minimap :graph="graph" :resources="resources" />
</template>
