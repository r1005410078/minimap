<script setup>
import Minimap from './minimap/Minimap.vue'
import { createDemoGraph } from './minimap/graph.js'

const graph = createDemoGraph()

const resources = [
  {
    category: '储能设备',
    expanded: true,
    items: [
      { id: 'site', label: '站点' },
      { id: 'subsystem', label: '子系统' },
      { id: 'bms-stack', label: 'BMS 堆' },
      { id: 'bms-cluster', label: 'BMS 簇' },
      { id: 'pcs-device', label: 'PCS 设备' },
      { id: 'metering', label: '电能计量' },
    ],
  },
  {
    category: '光伏设备',
    expanded: false,
    count: 5,
    items: [],
  },
  {
    category: '配电设备',
    expanded: false,
    count: 4,
    items: [],
  },
  {
    category: '监控设备',
    expanded: false,
    count: 4,
    items: [],
  },
]
</script>

<template>
  <Minimap :graph="graph" :resources="resources" />
</template>
