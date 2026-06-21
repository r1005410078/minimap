<script setup>
// Phase 4 切片 3：Overview 小地图导航子组件。无 props，所有绘制数据通过
// 暴露的 render() 方法实时传入——跟 Minimap.vue 主画布一样，渲染是命令式的，
// 不挂 Vue 响应式 watch，由父组件在自己的 renderCurrent() 里显式调用。
// 固定尺寸 200×140px，不随容器变化，不需要 ResizeObserver。
// 见 docs/superpowers/specs/2026-06-20-phase-4-overview-navigation.md
import { ref, onMounted, onUnmounted } from 'vue'
import { screenToWorld } from '../coords/coords.js'
import { worldRectToScreen } from '../render/renderer.js'
import { defaultTheme } from '../render/theme.js'
import { computeOverviewViewport, mainViewportFrameRect, clampRectToCanvas } from '../render/overview.js'

const OVERVIEW_WIDTH = 200
const OVERVIEW_HEIGHT = 140

const emit = defineEmits(['navigate'])

const canvasRef = ref(null)

let ctx = null
let dragging = false
let lastOverviewViewport = { x: 0, y: 0, scale: 1 }

function syncCanvasSize() {
  const canvas = canvasRef.value
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(OVERVIEW_WIDTH * dpr))
  canvas.height = Math.max(1, Math.round(OVERVIEW_HEIGHT * dpr))
  canvas.style.width = `${OVERVIEW_WIDTH}px`
  canvas.style.height = `${OVERVIEW_HEIGHT}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function pointFromEvent(event) {
  const rect = canvasRef.value.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function navigateFromScreenPoint(screenPoint) {
  emit('navigate', screenToWorld(screenPoint, lastOverviewViewport))
}

function handlePointerDown(event) {
  dragging = true
  canvasRef.value.setPointerCapture?.(event.pointerId)
  navigateFromScreenPoint(pointFromEvent(event))
}

function handlePointerMove(event) {
  if (!dragging) return
  navigateFromScreenPoint(pointFromEvent(event))
}

function handlePointerUp() {
  dragging = false
}

function render({ layout, viewport, mainWidth, mainHeight, theme = defaultTheme }) {
  if (!ctx) return
  ctx.clearRect(0, 0, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)

  const overviewViewport = computeOverviewViewport(layout.bounds, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)
  lastOverviewViewport = overviewViewport

  ctx.fillStyle = theme.node.stroke
  for (const item of layout.visibleItems) {
    const rect = worldRectToScreen(item, overviewViewport)
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  }

  const frame = mainViewportFrameRect(viewport, mainWidth, mainHeight, overviewViewport)
  const clipped = clampRectToCanvas(frame, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)
  ctx.strokeStyle = theme.node.selectedStroke
  ctx.lineWidth = 1.5
  ctx.strokeRect(clipped.x, clipped.y, clipped.width, clipped.height)
}

defineExpose({ render })

onMounted(() => {
  const canvas = canvasRef.value
  ctx = canvas.getContext('2d')
  syncCanvasSize()
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('pointercancel', handlePointerUp)
  canvas.addEventListener('lostpointercapture', handlePointerUp)
})

onUnmounted(() => {
  const canvas = canvasRef.value
  if (canvas) {
    canvas.removeEventListener('pointerdown', handlePointerDown)
    canvas.removeEventListener('pointermove', handlePointerMove)
    canvas.removeEventListener('pointerup', handlePointerUp)
    canvas.removeEventListener('pointercancel', handlePointerUp)
    canvas.removeEventListener('lostpointercapture', handlePointerUp)
  }
})
</script>

<template>
  <canvas ref="canvasRef"></canvas>
</template>
