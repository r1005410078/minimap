<script setup>
// Phase 1 Vue 组件壳骨架：挂载真实 canvas、DPR 适配、ResizeObserver 驱动的按需重渲染。
// 点击选中和资源拖入在后续切片（Task 5 / Task 6）里加到这个文件上。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { computeLayout } from './layout.js'
import { renderScene } from './renderer.js'
import { defaultTheme } from './theme.js'
import { screenToWorld } from './coords.js'
import { hitTest, findInsertionIndex } from './interaction.js'
import ResourceTree from './ResourceTree.vue'

const props = defineProps({
  graph: { type: Object, required: true },
  resources: { type: Array, default: () => [] },
  layoutDirection: { type: String, default: 'horizontal' },
  selectedIds: { type: Array, default: null },
  theme: { type: Object, default: null },
})

const emit = defineEmits(['select', 'node-drop', 'change'])

const containerRef = ref(null)
const canvasRef = ref(null)

let ctx = null
let resizeObserver = null
let layout = null
let cssWidth = 0
let cssHeight = 0
let internalSelectedId = null

// Phase 1 固定视口，平移/缩放是第三阶段才做；那时改这里要联动下面的 pointFromEvent。
const viewport = { x: 0, y: 0, scale: 1 }

function currentSelectedIds() {
  if (props.selectedIds !== null) return props.selectedIds
  return internalSelectedId ? [internalSelectedId] : []
}

function render() {
  if (!ctx) return
  layout = computeLayout(props.graph, {
    direction: props.layoutDirection,
    viewportWidth: cssWidth,
    viewportHeight: cssHeight,
  })
  renderScene(ctx, {
    layout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: { selectedIds: new Set(currentSelectedIds()) },
  })
}

function setSelected(ids) {
  if (props.selectedIds === null) internalSelectedId = ids[0] ?? null
  emit('select', ids)
  render()
}

function pointFromEvent(event) {
  const rect = canvasRef.value.getBoundingClientRect()
  return screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport)
}

function handlePointerDown(event) {
  if (!layout) return
  const hit = hitTest(layout, pointFromEvent(event))
  setSelected(hit ? [hit.id] : [])
}

function handleDragOver(event) {
  event.preventDefault()
}

function handleDrop(event) {
  event.preventDefault()
  if (!layout) return
  const raw = event.dataTransfer.getData('application/json')
  if (!raw) return
  const resource = JSON.parse(raw)

  const point = pointFromEvent(event)
  const selected = currentSelectedIds()
  const parentId = selected[0] ?? props.graph.rootIds[0]
  const parent = props.graph.nodes.get(parentId)
  if (!parent) return

  const index = findInsertionIndex(props.graph, layout, parentId, point, props.layoutDirection)
  const id = `res-${resource.id}-${Date.now()}`
  props.graph.nodes.set(id, { id, label: resource.label, parentId, children: [] })
  parent.children.splice(index, 0, id)

  render()
  emit('node-drop', { resource, parentId, index })
  emit('change', props.graph)
}

function syncCanvasSize() {
  const container = containerRef.value
  const canvas = canvasRef.value
  if (!container || !canvas) return
  cssWidth = container.clientWidth
  cssHeight = container.clientHeight
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas.height = Math.max(1, Math.round(cssHeight * dpr))
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  // setTransform 而不是 scale：避免每次 resize 后缩放重复叠加。
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

onMounted(() => {
  ctx = canvasRef.value.getContext('2d')
  syncCanvasSize()
  resizeObserver = new ResizeObserver(() => {
    syncCanvasSize()
    render()
  })
  resizeObserver.observe(containerRef.value)
  canvasRef.value.addEventListener('pointerdown', handlePointerDown)
  canvasRef.value.addEventListener('dragover', handleDragOver)
  canvasRef.value.addEventListener('drop', handleDrop)
  render()
})

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect()
})

watch(() => props.layoutDirection, render)
watch(() => props.selectedIds, render)
</script>

<template>
  <div class="minimap">
    <ResourceTree class="minimap-resources" :resources="resources" />
    <div ref="containerRef" class="minimap-canvas-container">
      <canvas ref="canvasRef"></canvas>
    </div>
  </div>
</template>

<style scoped>
.minimap {
  display: flex;
  width: 100%;
  height: 100%;
}
.minimap-resources {
  flex: 0 0 220px;
  overflow-y: auto;
  border-right: 1px solid #1b2530;
}
.minimap-canvas-container {
  flex: 1 1 auto;
  position: relative;
}
.minimap-canvas-container canvas {
  display: block;
}
</style>
