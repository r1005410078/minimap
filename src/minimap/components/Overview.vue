<template>
  <canvas ref="canvasRef"></canvas>
</template>
<script>
// Phase 4 切片 3：Overview 小地图导航子组件。无 props，所有绘制数据通过
// 暴露的 render() 方法实时传入——跟 Minimap.vue 主画布一样，渲染是命令式的，
// 不挂 Vue 响应式 watch，由父组件在自己的 renderCurrent() 里显式调用。
// 固定尺寸 200×140px，不随容器变化，不需要 ResizeObserver。
// 见 docs/superpowers/specs/2026-06-20-phase-4-overview-navigation.md
import { screenToWorld } from '../coords/coords.js'
import { worldRectToScreen } from '../render/renderer.js'
import { defaultTheme } from '../render/theme.js'
import { computeOverviewViewport, mainViewportFrameRect, clampRectToCanvas } from '../render/overview.js'

const OVERVIEW_WIDTH = 200
const OVERVIEW_HEIGHT = 140

export default {
  emits: ['navigate'],
  data() {
    return {
      ctx: null,
      dragging: false,
      lastOverviewViewport: { x: 0, y: 0, scale: 1 },
    }
  },
  mounted() {
    const canvas = this.$refs.canvasRef
    this.ctx = canvas.getContext('2d')
    this.syncCanvasSize()
    canvas.addEventListener('pointerdown', this.handlePointerDown)
    canvas.addEventListener('pointermove', this.handlePointerMove)
    canvas.addEventListener('pointerup', this.handlePointerUp)
    canvas.addEventListener('pointercancel', this.handlePointerUp)
    canvas.addEventListener('lostpointercapture', this.handlePointerUp)
  },
  beforeDestroy() {
    const canvas = this.$refs.canvasRef
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.handlePointerDown)
      canvas.removeEventListener('pointermove', this.handlePointerMove)
      canvas.removeEventListener('pointerup', this.handlePointerUp)
      canvas.removeEventListener('pointercancel', this.handlePointerUp)
      canvas.removeEventListener('lostpointercapture', this.handlePointerUp)
    }
  },
  methods: {
    syncCanvasSize() {
      const canvas = this.$refs.canvasRef
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(OVERVIEW_WIDTH * dpr))
      canvas.height = Math.max(1, Math.round(OVERVIEW_HEIGHT * dpr))
      canvas.style.width = `${OVERVIEW_WIDTH}px`
      canvas.style.height = `${OVERVIEW_HEIGHT}px`
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    },
    pointFromEvent(event) {
      const rect = this.$refs.canvasRef.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    },
    navigateFromScreenPoint(screenPoint) {
      this.$emit('navigate', screenToWorld(screenPoint, this.lastOverviewViewport))
    },
    handlePointerDown(event) {
      this.dragging = true
      this.$refs.canvasRef.setPointerCapture?.(event.pointerId)
      this.navigateFromScreenPoint(this.pointFromEvent(event))
    },
    handlePointerMove(event) {
      if (!this.dragging) return
      this.navigateFromScreenPoint(this.pointFromEvent(event))
    },
    handlePointerUp() {
      this.dragging = false
    },
    render({ layout, viewport, mainWidth, mainHeight, theme = defaultTheme }) {
      if (!this.ctx) return
      this.ctx.clearRect(0, 0, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)
      this.ctx.fillStyle = theme.background
      this.ctx.fillRect(0, 0, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)

      const overviewViewport = computeOverviewViewport(layout.bounds, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)
      this.lastOverviewViewport = overviewViewport

      this.ctx.fillStyle = theme.node.stroke
      for (const item of layout.visibleItems) {
        const rect = worldRectToScreen(item, overviewViewport)
        this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      }

      const frame = mainViewportFrameRect(viewport, mainWidth, mainHeight, overviewViewport)
      const clipped = clampRectToCanvas(frame, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)
      this.ctx.strokeStyle = theme.node.selectedStroke
      this.ctx.lineWidth = 1.5
      this.ctx.strokeRect(clipped.x, clipped.y, clipped.width, clipped.height)
    },
  },
}
</script>
