<script setup>
// Phase 1 Vue 组件壳骨架：挂载真实 canvas、DPR 适配、ResizeObserver 驱动的按需重渲染。
// 分组框命中检测细分、框内拖拽换位、滚轮滚动、展开折叠点击见 Phase 2 切片3。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
// 和 docs/superpowers/specs/2026-06-19-phase-2-vue-interaction.md
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { computeLayout, keepAnchorStable, GROUP, clampGroupScroll } from './layout.js'
import {
  createLayoutTransition,
  layoutAt,
  resolveAnchorCenter,
} from './layout-transition.js'
import { renderScene, worldRectToScreen } from './renderer.js'
import { defaultTheme } from './theme.js'
import { screenToWorld } from './coords.js'
import {
  hitTest,
  findInsertionIndex,
  groupGridIndexAt,
  exceedsDragThreshold,
  groupAutoScrollSpeed,
  groupInsertIndexToParentIndex,
} from './interaction.js'
import { reorderGroupChild } from './graph.js'
import ResourceTree from './ResourceTree.vue'

const ANIMATION_DURATION_MS = 200

const props = defineProps({
  graph: { type: Object, required: true },
  resources: { type: Array, default: () => [] },
  layoutDirection: { type: String, default: 'horizontal' },
  selectedIds: { type: Array, default: null },
  groupStates: { type: Object, default: null },
  options: { type: Object, default: null },
  theme: { type: Object, default: null },
  nodeRenderer: { type: Function, default: null },
  groupRenderer: { type: Function, default: null },
  edgeRenderer: { type: Function, default: null },
})

const emit = defineEmits(['select', 'node-drop', 'change', 'group-state-change', 'group-reorder'])

const containerRef = ref(null)
const canvasRef = ref(null)

let ctx = null
let resizeObserver = null
let layout = null
let cssWidth = 0
let cssHeight = 0
let internalSelectedId = null
let internalGroupStates = {}
let dragState = null

// Phase 1 固定视口，平移/缩放是第三阶段才做；那时改这里要联动下面的 pointFromEvent。
let viewport = { x: 0, y: 0, scale: 1 }
let settledLayout = null
let animationFrameId = null
let activeTransition = null
let lastRenderedLayout = null
let lastRenderedViewport = viewport

function currentSelectedIds() {
  if (props.selectedIds !== null) return props.selectedIds
  return internalSelectedId ? [internalSelectedId] : []
}

function currentGroupStates() {
  return props.groupStates !== null ? props.groupStates : internalGroupStates
}

function updateGroupState(groupId, patch) {
  const current = currentGroupStates()
  const next = { ...current, [groupId]: { ...current[groupId], ...patch } }
  if (props.groupStates === null) internalGroupStates = next
  emit('group-state-change', next)
}

function dragRenderContext() {
  if (!dragState || !dragState.dragging || !layout) return null
  const group = layout.groups.find((g) => g.id === dragState.groupId)
  if (!group) return null
  const order = group.children.filter((id) => id !== dragState.childId)
  order.splice(dragState.insertIndex, 0, dragState.childId)
  return { groupId: group.id, order, draggingChildId: dragState.childId, ghostRect: dragState.ghostScreenRect }
}

function renderCurrent(currentLayout = layout, currentViewport = viewport) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...currentViewport }
  renderScene(ctx, {
    layout: currentLayout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport: currentViewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: { selectedIds: new Set(currentSelectedIds()), groupDrag: dragRenderContext() },
    renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
  })
}

function cancelAnimation() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }
  activeTransition = null
}

function settleAnimation() {
  if (!activeTransition) return
  const { nextLayout, nextViewport } = activeTransition
  cancelAnimation()
  finishLayout(nextLayout, nextViewport)
}

function chooseAnchorId(startLayout, nextLayout) {
  const selected = currentSelectedIds()[0]
  if (selected && resolveAnchorCenter(startLayout, selected) && resolveAnchorCenter(nextLayout, selected)) return selected
  const root = props.graph.rootIds[0]
  if (root && resolveAnchorCenter(startLayout, root) && resolveAnchorCenter(nextLayout, root)) return root
  return null
}

function targetViewportFor(startLayout, nextLayout, preserveAnchor) {
  if (!preserveAnchor || !startLayout) return viewport
  const anchorId = chooseAnchorId(startLayout, nextLayout)
  if (!anchorId) return viewport
  const before = resolveAnchorCenter(startLayout, anchorId)
  const after = resolveAnchorCenter(nextLayout, anchorId)
  return keepAnchorStable(viewport, before, after)
}

function finishLayout(nextLayout, nextViewport) {
  layout = nextLayout
  settledLayout = nextLayout
  viewport = { ...nextViewport }
  renderCurrent(layout, viewport)
}

function startAnimation(startLayout, nextLayout, startViewport, nextViewport) {
  const transition = createLayoutTransition({
    fromLayout: startLayout,
    toLayout: nextLayout,
    fromViewport: startViewport,
    toViewport: nextViewport,
    durationMs: ANIMATION_DURATION_MS,
  })
  activeTransition = { transition, startedAt: null, nextLayout, nextViewport }

  const tick = (time) => {
    if (!activeTransition) return
    if (activeTransition.startedAt === null) activeTransition.startedAt = time
    const elapsed = time - activeTransition.startedAt
    const progress = elapsed / activeTransition.transition.durationMs
    const frame = layoutAt(activeTransition.transition, progress)
    layout = frame.layout
    viewport = { ...frame.viewport }
    renderCurrent(layout, viewport)

    if (progress >= 1) {
      animationFrameId = null
      const finished = activeTransition
      activeTransition = null
      finishLayout(finished.nextLayout, finished.nextViewport)
      return
    }

    animationFrameId = requestAnimationFrame(tick)
  }

  animationFrameId = requestAnimationFrame(tick)
}

function updateLayout({ animate = true, preserveAnchor = true } = {}) {
  if (!ctx) return
  const nextLayout = computeLayout(props.graph, {
    direction: props.layoutDirection,
    viewportWidth: cssWidth,
    viewportHeight: cssHeight,
    groupThreshold: props.options?.groupThreshold,
    groupStates: new Map(Object.entries(currentGroupStates())),
  })

  const startLayout = lastRenderedLayout || settledLayout || layout
  const startViewport = lastRenderedViewport || viewport
  const nextViewport = targetViewportFor(startLayout, nextLayout, preserveAnchor)
  const canAnimate =
    animate &&
    typeof requestAnimationFrame === 'function' &&
    typeof cancelAnimationFrame === 'function'

  cancelAnimation()

  if (!startLayout || !canAnimate || ANIMATION_DURATION_MS <= 0) {
    finishLayout(nextLayout, nextViewport)
    return
  }

  viewport = { ...startViewport }
  startAnimation(startLayout, nextLayout, startViewport, nextViewport)
}

function setSelected(ids) {
  if (props.selectedIds === null) internalSelectedId = ids[0] ?? null
  emit('select', ids)
  renderCurrent()
}

function pointFromEvent(event) {
  const rect = canvasRef.value.getBoundingClientRect()
  return screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport)
}

function ghostRectForPoint(worldPoint) {
  const worldRect = {
    x: worldPoint.x - GROUP.itemW / 2,
    y: worldPoint.y - GROUP.itemH / 2,
    width: GROUP.itemW,
    height: GROUP.itemH,
  }
  return worldRectToScreen(worldRect, viewport)
}

function cancelAutoScrollLoop() {
  if (dragState && dragState.scrollRafId !== null) {
    cancelAnimationFrame(dragState.scrollRafId)
    dragState.scrollRafId = null
  }
}

function startAutoScrollLoop() {
  const tick = () => {
    if (!dragState || !dragState.dragging) return
    const group = layout.groups.find((g) => g.id === dragState.groupId)
    if (group && dragState.ghostWorldPoint) {
      const delta = groupAutoScrollSpeed(group, dragState.ghostWorldPoint.y)
      if (delta !== 0) {
        group.scrollTop = clampGroupScroll(group, group.scrollTop + delta)
        renderCurrent()
      }
    }
    dragState.scrollRafId = requestAnimationFrame(tick)
  }
  dragState.scrollRafId = requestAnimationFrame(tick)
}

function handlePointerDown(event) {
  if (!layout) return
  const point = pointFromEvent(event)
  const hit = hitTest(layout, point)

  if (hit?.type === 'group' && hit.zone === 'header') {
    const group = layout.groups.find((g) => g.id === hit.id)
    updateGroupState(hit.id, { expanded: !group.expanded })
    updateLayout()
    return
  }

  if (hit?.type === 'group' && hit.zone === 'item') {
    canvasRef.value.setPointerCapture?.(event.pointerId)
    dragState = {
      groupId: hit.id,
      childId: hit.childId,
      startScreen: { x: event.clientX, y: event.clientY },
      dragging: false,
      insertIndex: 0,
      ghostWorldPoint: null,
      ghostScreenRect: null,
      scrollRafId: null,
    }
    return
  }

  setSelected(hit ? [hit.id] : [])
}

function handlePointerMove(event) {
  if (!dragState) return
  const screenPoint = { x: event.clientX, y: event.clientY }

  if (!dragState.dragging) {
    if (!exceedsDragThreshold(dragState.startScreen, screenPoint)) return
    dragState.dragging = true
    startAutoScrollLoop()
  }

  const group = layout.groups.find((g) => g.id === dragState.groupId)
  if (!group) return
  const worldPoint = pointFromEvent(event)
  const restGroup = { ...group, children: group.children.filter((id) => id !== dragState.childId) }
  dragState.insertIndex = groupGridIndexAt(restGroup, worldPoint)
  dragState.ghostWorldPoint = worldPoint
  dragState.ghostScreenRect = ghostRectForPoint(worldPoint)
  renderCurrent()
}

function handlePointerUp() {
  if (!dragState) return

  if (dragState.dragging) {
    cancelAutoScrollLoop()
    const group = layout.groups.find((g) => g.id === dragState.groupId)
    if (group) {
      const parent = props.graph.nodes.get(group.parentId)
      const index = groupInsertIndexToParentIndex(parent, group, dragState.childId, dragState.insertIndex)
      reorderGroupChild(props.graph, group.parentId, dragState.childId, index)
      updateGroupState(group.id, { scrollTop: group.scrollTop })
      updateLayout()
      emit('group-reorder', { groupId: group.id, childId: dragState.childId, index })
      emit('change', props.graph)
    }
  } else {
    setSelected([dragState.childId])
  }

  dragState = null
}

function handleWheel(event) {
  if (!layout) return
  const point = pointFromEvent(event)
  const hit = hitTest(layout, point)
  if (hit?.type !== 'group') return
  const group = layout.groups.find((g) => g.id === hit.id)
  if (!group || !group.overflowY) return

  event.preventDefault()
  group.scrollTop = clampGroupScroll(group, group.scrollTop + event.deltaY)
  updateGroupState(group.id, { scrollTop: group.scrollTop })
  renderCurrent()
}

function handleDragOver(event) {
  event.preventDefault()
}

function handleDrop(event) {
  event.preventDefault()
  settleAnimation()
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

  updateLayout()
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
  const canvas = canvasRef.value
  ctx = canvas.getContext('2d')
  syncCanvasSize()
  resizeObserver = new ResizeObserver(() => {
    syncCanvasSize()
    updateLayout({ animate: false, preserveAnchor: false })
  })
  resizeObserver.observe(containerRef.value)
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('wheel', handleWheel, { passive: false })
  canvas.addEventListener('dragover', handleDragOver)
  canvas.addEventListener('drop', handleDrop)
  updateLayout({ animate: false, preserveAnchor: false })
})

onUnmounted(() => {
  const canvas = canvasRef.value
  cancelAnimation()
  cancelAutoScrollLoop()
  if (canvas) {
    canvas.removeEventListener('pointerdown', handlePointerDown)
    canvas.removeEventListener('pointermove', handlePointerMove)
    canvas.removeEventListener('pointerup', handlePointerUp)
    canvas.removeEventListener('wheel', handleWheel)
    canvas.removeEventListener('dragover', handleDragOver)
    canvas.removeEventListener('drop', handleDrop)
  }
  if (resizeObserver) resizeObserver.disconnect()
})

watch(() => props.layoutDirection, () => updateLayout())
watch(() => props.graph, () => updateLayout())
watch(() => props.selectedIds, () => renderCurrent())
watch(() => props.groupStates, () => updateLayout())
watch(() => props.options, () => updateLayout())
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
