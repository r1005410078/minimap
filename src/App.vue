<script setup>
import Minimap from './minimap/Minimap.vue'
import { createDemoGraph } from './minimap/graph.js'

const graph = createDemoGraph()

const resources = [
  {
    category: 'Generation',
    items: [
      { id: 'solar-array', label: 'Solar Array' },
      { id: 'wind-turbine', label: 'Wind Turbine' },
    ],
  },
  {
    category: 'Storage',
    items: [{ id: 'battery-bank', label: 'Battery Bank' }],
  },
]
</script>

<template>
  <Minimap :graph="graph" :resources="resources" />
</template>
