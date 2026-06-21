<script setup>
// Phase 1 Vue 组件壳骨架：挂载真实 canvas、DPR 适配、ResizeObserver 驱动的按需重渲染。
// 分组框命中检测细分、框内拖拽换位、滚轮滚动、展开折叠点击见 Phase 2 切片3。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
// 和 docs/superpowers/specs/2026-06-19-phase-2-vue-interaction.md
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { createMinimapController } from './minimap-controller.js'
import { defaultTheme } from './theme.js'
import { centerViewportOn } from './viewport.js'
import Overview from './Overview.vue'
import ResourceTree from './ResourceTree.vue'

const props = defineProps({
  graph: { type: Object, required: true },
  resources: { type: Array, default: () => [] },
  layoutDirection: { type: String, default: 'horizontal' },
  selectedIds: { type: Array, default: null },
  groupStates: { type: Object, default: null },
  viewport: { type: Object, default: null },
  options: { type: Object, default: null },
  theme: { type: Object, default: null },
  nodeRenderer: { type: Function, default: null },
  groupRenderer: { type: Function, default: null },
  edgeRenderer: { type: Function, default: null },
  readonly: { type: Boolean, default: false },
  beforeNodeDrop: { type: Function, default: null },
  beforeGroupReorder: { type: Function, default: null },
  beforeDelete: { type: Function, default: null },
  beforeCopy: { type: Function, default: null },
  beforeImport: { type: Function, default: null },
  beforeNodeMove: { type: Function, default: null },
  beforePaste: { type: Function, default: null },
  contextMenuItems: { type: [Function, Array], default: null },
})

const emit = defineEmits([
  'select',
  'node-drop',
  'change',
  'group-state-change',
  'group-reorder',
  'viewport-change',
  'search',
  'delete',
  'copy',
  'import',
  'export',
  'paste',
  'node-move',
  'context-menu-action',
  'config-change',
])

const containerRef = ref(null)
const canvasRef = ref(null)
const overviewRef = ref(null)
const searchKeyword = ref('')
const searchMatches = ref([])
const searchCurrentIndex = ref(-1)
const contextMenuRef = ref(null)
const renderStats = ref(null)
const internalReadonly = ref(props.readonly)
const internalOptions = ref({ ...(props.options ?? {}) })
const effectiveReadonly = computed(() => internalReadonly.value)
const effectiveOptions = computed(() => ({
  enableSearch: true,
  enableOverview: true,
  enableActiveBorder: false,
  showGrid: true,
  showPerformance: false,
  hideTextDuringInteraction: false,
  ...internalOptions.value,
}))
const effectiveTheme = computed(() => {
  const baseTheme = props.theme || defaultTheme
  return {
    ...baseTheme,
    grid: {
      ...(baseTheme.grid || {}),
      visible: effectiveOptions.value.showGrid !== false,
    },
  }
})

let controller = null
const contextMenuState = ref(null)

function syncConfigFromProps() {
  internalReadonly.value = props.readonly
  internalOptions.value = { ...(props.options ?? {}) }
}

function handleOverviewNavigate(worldPoint) {
  const { width, height } = controller.getCssSize()
  controller.applyViewport(centerViewportOn(worldPoint, controller.getViewport(), width, height))
}

function emitConfigChange(key, value, context) {
  if (key === 'readonly') internalReadonly.value = value
  else internalOptions.value = { ...internalOptions.value, [key]: value }
  controller.renderCurrent()
  emit('config-change', { key, value, source: 'context-menu', context })
}

defineExpose({
  fitToScreen: () => controller.fitToScreen(),
  centerOnNode: (id) => controller.centerOnNode(id),
  centerOnSelection: () => controller.centerOnSelection(),
  zoomTo: (scale, center) => controller.zoomTo(scale, center),
  setViewport: (viewport) => controller.setViewport(viewport),
  getViewport: () => controller.getViewport(),
  select: (ids, mode) => controller.select(ids, mode),
  clearSelection: () => controller.clearSelection(),
  search: (keyword) => controller.search(keyword),
  searchNext: () => controller.searchNext(),
  searchPrevious: () => controller.searchPrevious(),
  undo: () => controller.undo(),
  redo: () => controller.redo(),
  canUndo: () => controller.canUndo(),
  canRedo: () => controller.canRedo(),
  deleteSelection: () => controller.deleteSelection(),
  copySelection: () => controller.copySelection(),
  paste: () => controller.paste(),
  exportGraph: () => controller.exportGraph(),
  importGraph: (data) => controller.importGraph(data),
})

function createInteractionController() {
  return createMinimapController({
    getGraph: () => props.graph,
    getLayoutDirection: () => props.layoutDirection,
    getOptions: () => effectiveOptions.value,
    getTheme: () => effectiveTheme.value,
    getRenderers: () => ({ node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer }),
    getViewportProp: () => props.viewport,
    getGroupStatesProp: () => props.groupStates,
    getSelectedIdsProp: () => props.selectedIds,
    emitSelect: (ids) => emit('select', ids),
    getReadonly: () => effectiveReadonly.value,
    getBeforeDelete: () => props.beforeDelete,
    getBeforeCopy: () => props.beforeCopy,
    getBeforeImport: () => props.beforeImport,
    getBeforePaste: () => props.beforePaste,
    emitDelete: (payload) => emit('delete', payload),
    emitCopy: (payload) => emit('copy', payload),
    emitPaste: (payload) => emit('paste', payload),
    emitImport: (payload) => emit('import', payload),
    emitExport: (payload) => emit('export', payload),
    emitChange: (payload) => emit('change', payload),
    emitSearch: (payload) => emit('search', payload),
    onSearchStateChange: ({ keyword, matches, currentIndex }) => {
      searchKeyword.value = keyword
      searchMatches.value = matches
      searchCurrentIndex.value = currentIndex
    },
    emitConfigChange,
    emitContextMenuAction: (payload) => emit('context-menu-action', payload),
    getContextMenuItemsProp: () => props.contextMenuItems,
    getMenuEl: () => contextMenuRef.value,
    onMenuStateChange: (state) => { contextMenuState.value = state },
    emitViewportChange: (next) => emit('viewport-change', next),
    emitGroupStateChange: (next) => emit('group-state-change', next),
    getBeforeNodeDrop: () => props.beforeNodeDrop,
    getBeforeGroupReorder: () => props.beforeGroupReorder,
    getBeforeNodeMove: () => props.beforeNodeMove,
    emitNodeDrop: (payload) => emit('node-drop', payload),
    emitGroupReorder: (payload) => emit('group-reorder', payload),
    emitNodeMove: (payload) => emit('node-move', payload),
    onRenderStats: (stats) => { renderStats.value = stats },
    onOverviewRender: (scene) => overviewRef.value?.render(scene),
  })
}

controller = createInteractionController()

onMounted(() => {
  controller.mount(canvasRef.value, containerRef.value)
})

onUnmounted(() => {
  controller?.cancelPointerInteractions()
  controller?.closeContextMenu()
  controller?.destroy()
  controller = null
})

watch(() => props.layoutDirection, () => controller.updateLayout())
watch(
  () => props.graph,
  () => {
    controller.closeContextMenu()
    controller.onGraphReplaced()
    controller.updateLayout()
  },
)
watch(() => props.selectedIds, () => controller.renderCurrent())
watch(() => props.groupStates, () => controller.updateLayout())
watch(() => props.viewport, () => controller.renderCurrent())
watch(() => props.options, () => {
  syncConfigFromProps()
  controller.closeContextMenu()
  controller.updateLayout()
})
watch(() => props.readonly, () => syncConfigFromProps())
watch(() => props.contextMenuItems, () => controller.closeContextMenu())
</script>

<template>
  <div class="minimap">
    <ResourceTree class="minimap-resources" :resources="resources" />
    <div ref="containerRef" class="minimap-canvas-container">
      <div class="minimap-toolbar" aria-label="画布工具栏">
        <button class="minimap-toolbar-button is-primary" type="button" aria-label="返回">◀</button>
        <span class="minimap-toolbar-separator"></span>
        <button class="minimap-toolbar-button" type="button" aria-label="撤销" @click="controller.undo">↶</button>
        <button class="minimap-toolbar-button" type="button" aria-label="重做" @click="controller.redo">↷</button>
        <span class="minimap-toolbar-separator"></span>
        <button class="minimap-toolbar-button" type="button" aria-label="选择">□</button>
        <button class="minimap-toolbar-button" type="button" aria-label="复制" @click="controller.copySelection">⌘</button>
        <button class="minimap-toolbar-button" type="button" aria-label="粘贴" @click="controller.paste">⎘</button>
        <button class="minimap-toolbar-button" type="button" aria-label="删除" @click="controller.deleteSelection">⌫</button>
        <button class="minimap-toolbar-button" type="button" aria-label="框选">▣</button>
        <span class="minimap-toolbar-separator"></span>
        <button class="minimap-toolbar-button" type="button" aria-label="定位">◎</button>
        <button class="minimap-toolbar-button" type="button" aria-label="缩小">⊖</button>
        <button class="minimap-toolbar-button" type="button" aria-label="放大">⊕</button>
        <span class="minimap-toolbar-spacer"></span>
        <button class="minimap-toolbar-button" type="button" aria-label="展开">↗</button>
        <button class="minimap-toolbar-button is-accent" type="button" aria-label="列表">▦</button>
        <button class="minimap-toolbar-button" type="button" aria-label="信息">ⓘ</button>
      </div>
      <canvas
        ref="canvasRef"
        :class="{ 'is-active-border-enabled': effectiveOptions.enableActiveBorder === true }"
        tabindex="0"
      ></canvas>
      <div v-if="effectiveOptions.enableSearch !== false" class="minimap-search">
        <input
          :value="searchKeyword"
          class="minimap-search-input"
          placeholder="搜索节点..."
          @input="controller.search($event.target.value)"
          @keydown.enter="controller.searchNext"
        />
        <span class="minimap-search-count">{{ searchMatches.length ? `${searchCurrentIndex + 1}/${searchMatches.length}` : '0/0' }}</span>
        <button
          class="minimap-search-btn minimap-search-prev"
          :disabled="searchMatches.length === 0"
          @click="controller.searchPrevious"
        >
          ‹
        </button>
        <button
          class="minimap-search-btn minimap-search-next"
          :disabled="searchMatches.length === 0"
          @click="controller.searchNext"
        >
          ›
        </button>
      </div>
      <div v-if="effectiveOptions.enableOverview !== false" class="minimap-overview-panel">
        <div class="minimap-overview-header">
          <span>MINIMAP</span>
          <span>拖入放置</span>
        </div>
        <Overview
          ref="overviewRef"
          class="minimap-overview"
          @navigate="handleOverviewNavigate"
        />
      </div>
      <div v-if="effectiveOptions.showPerformance" class="minimap-performance">
        <span class="minimap-performance-label">性能</span>
        <span class="minimap-performance-value">{{ renderStats ? `${renderStats.drawn}/${renderStats.total}` : '0/0' }}</span>
        <span class="minimap-performance-value">{{ renderStats ? `${renderStats.culled} culled` : '0 culled' }}</span>
        <span class="minimap-performance-value">{{ renderStats ? `${renderStats.durationMs.toFixed(1)}ms` : '0.0ms' }}</span>
      </div>
      <div
        v-if="contextMenuState"
        ref="contextMenuRef"
        class="minimap-context-menu"
        role="menu"
        :style="{ left: `${contextMenuState.position.x}px`, top: `${contextMenuState.position.y}px` }"
      >
        <div v-for="item in contextMenuState.items" :key="item.id">
          <div v-if="item.type === 'separator'" class="minimap-context-menu-separator"></div>
          <button
            v-else
            class="minimap-context-menu-item"
            :class="{ 'is-danger': item.danger, 'is-checked': item.checked }"
            type="button"
            role="menuitem"
            :data-menu-id="item.id"
            :aria-disabled="item.disabled ? 'true' : 'false'"
            :disabled="item.disabled"
            @click="controller.runContextMenuItem(item)"
          >
            <span class="minimap-context-menu-check" aria-hidden="true">
              {{ item.type === 'checkbox' ? (item.checked ? '✓' : '') : '' }}
            </span>
            <span class="minimap-context-menu-label">{{ item.label }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.minimap {
  display: flex;
  width: 100%;
  height: 100%;
  gap: 10px;
  padding: 8px;
  background: #0b0f14;
}
.minimap-resources {
  flex: 0 0 220px;
  overflow-y: auto;
}
.minimap-canvas-container {
  flex: 1 1 auto;
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid #252b34;
  border-radius: 10px;
  background: #0f1318;
}
.minimap-canvas-container canvas {
  display: block;
  outline: none;
}
.minimap-canvas-container canvas.is-active-border-enabled:focus {
  outline: 1px solid #3d9cff;
  outline-offset: -1px;
}
.minimap-toolbar {
  position: absolute;
  z-index: 3;
  top: 8px;
  left: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 12px;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: rgba(22, 26, 32, 0.96);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
}
.minimap-toolbar-button {
  width: 28px;
  height: 28px;
  color: #9aa3af;
  background: transparent;
  border: 0;
  border-radius: 5px;
  font: 16px/1 system-ui, sans-serif;
}
.minimap-toolbar-button:hover:not(:disabled) {
  color: #d8dee8;
  background: #232930;
}
.minimap-toolbar-button:disabled {
  opacity: 0.45;
}
.minimap-toolbar-button.is-primary {
  color: #d8dee8;
}
.minimap-toolbar-button.is-accent {
  color: #2bdd7f;
}
.minimap-toolbar-separator {
  width: 1px;
  height: 24px;
  background: #2a3038;
}
.minimap-toolbar-spacer {
  flex: 1;
}
.minimap-search {
  position: absolute;
  z-index: 4;
  top: 68px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(18, 23, 29, 0.94);
  border: 1px solid #2a3038;
  border-radius: 7px;
}
.minimap-search-input {
  width: 150px;
  color: #d9e0ea;
  background: #0f141a;
  border: 1px solid #303741;
  border-radius: 5px;
  padding: 5px 7px;
  font-size: 12px;
}
.minimap-search-count {
  min-width: 36px;
  color: #87909c;
  font-size: 12px;
  text-align: center;
}
.minimap-search-btn {
  width: 22px;
  height: 22px;
  color: #cfd6df;
  background: #20262d;
  border: 1px solid #303741;
  border-radius: 4px;
}
.minimap-search-btn:disabled {
  opacity: 0.4;
}
.minimap-overview-panel {
  position: absolute;
  z-index: 4;
  right: 14px;
  bottom: 14px;
  padding: 8px;
  border: 1px solid #303741;
  border-radius: 9px;
  background: rgba(18, 23, 29, 0.92);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.38);
}
.minimap-overview-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  color: #68727f;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
}
.minimap-overview {
  display: block;
  overflow: hidden;
  border-radius: 5px;
}
.minimap-overview canvas {
  display: block;
  cursor: pointer;
}
.minimap-performance {
  position: absolute;
  z-index: 4;
  left: 14px;
  bottom: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  color: #b8c1cc;
  background: rgba(18, 23, 29, 0.92);
  border: 1px solid #303741;
  border-radius: 8px;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.38);
  font: 12px/1 system-ui, sans-serif;
}
.minimap-performance-label {
  color: #7f8a99;
  letter-spacing: 0;
}
.minimap-performance-value {
  white-space: nowrap;
}
.minimap-context-menu {
  position: absolute;
  z-index: 8;
  width: 232px;
  max-height: 360px;
  overflow-y: auto;
  padding: 6px;
  color: #d8dee8;
  background: rgba(17, 21, 27, 0.98);
  border: 1px solid #303741;
  border-radius: 8px;
  box-shadow: 0 18px 38px rgba(0, 0, 0, 0.42);
  scrollbar-width: thin;
  scrollbar-color: #2e3540 transparent;
}
.minimap-context-menu::-webkit-scrollbar {
  width: 6px;
}
.minimap-context-menu::-webkit-scrollbar-track {
  background: transparent;
}
.minimap-context-menu::-webkit-scrollbar-thumb {
  background-color: #2e3540;
  border: 2px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
}
.minimap-context-menu::-webkit-scrollbar-thumb:hover {
  background-color: #3a4250;
}
.minimap-context-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 30px;
  gap: 8px;
  padding: 0 8px;
  color: #cfd6df;
  background: transparent;
  border: 0;
  border-radius: 5px;
  text-align: left;
  font: 13px/1 system-ui, sans-serif;
}
.minimap-context-menu-item:hover:not(:disabled) {
  background: #232930;
}
.minimap-context-menu-item:disabled {
  opacity: 0.38;
}
.minimap-context-menu-item.is-danger:not(:disabled) {
  color: #ff8d8d;
}
.minimap-context-menu-check {
  width: 14px;
  color: #2bdd7f;
  text-align: center;
}
.minimap-context-menu-label {
  flex: 1;
}
.minimap-context-menu-separator {
  height: 1px;
  margin: 5px 4px;
  background: #2a3038;
}
</style>
