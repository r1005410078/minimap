<template>
  <aside class="resource-tree">
    <div class="resource-tree-header">
      <h2 class="resource-tree-title">资源树</h2>
      <button class="resource-tree-collapse" type="button" aria-label="收起资源树" title="收起资源树" @click="$emit('collapse')">
        <svg class="resource-tree-collapse-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 2.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
          <path d="M6 2.5v11M10 5.5 7.5 8l2.5 2.5" />
        </svg>
      </button>
    </div>
    <label class="resource-search">
      <span class="resource-search-icon" aria-hidden="true">⌕</span>
      <input
        class="resource-search-input"
        :value="searchInput"
        placeholder="搜索节点..."
        @input="onSearchInput"
      />
    </label>
    <div
      ref="scroller"
      class="resource-tree-scroll"
      tabindex="0"
      role="tree"
      @scroll="onScroll"
      @keydown="onKeyDown"
    >
      <div class="resource-tree-spacer" :style="{ height: `${virtualWindow.totalHeight}px` }">
        <div class="resource-tree-window" :style="{ transform: `translateY(${virtualWindow.offsetY}px)` }">
          <div
            v-for="row in renderedRows"
            :key="row.key"
            class="resource-row"
            :class="rowClasses(row)"
            :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
            :data-row-key="row.key"
            :data-resource-id="row.type === 'resource' ? row.id : null"
            :draggable="row.type === 'resource' && !row.disabled ? 'true' : undefined"
            role="treeitem"
            :aria-expanded="row.type === 'folder' ? String(row.expanded) : null"
            :aria-selected="row.type === 'resource' ? String(selectedKeys.has(row.key)) : null"
            :aria-disabled="row.disabled ? 'true' : null"
            @click="onRowClick(row, $event)"
            @dragstart="onDragStart(row, $event)"
          >
            <span v-if="row.type === 'folder'" class="resource-category-caret" aria-hidden="true"></span>
            <span v-else class="resource-item-dot" aria-hidden="true"></span>
            <span class="resource-item-label">{{ row.label }}</span>
            <span v-if="row.type === 'folder'" class="resource-category-count">{{ row.count }}</span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
<script>
// 资源树展示：虚拟滚动 + 可嵌套文件夹 + 多选拖拽。
// 拖拽信息走原生 dataTransfer，由 Minimap.vue 的 drop 处理器读取。
import { flattenResourceRows, normalizeResourceTree } from '../resource-tree/model.js'
import { resolveVirtualWindow } from '../resource-tree/virtual-window.js'
import {
  applyResourceRowClick,
  moveResourceFocus,
  toggleFocusedResource,
} from '../resource-tree/selection.js'

const ROW_HEIGHT = 34

function rowKey(type, path) {
  return `${type}:${path.join('/')}`
}

function collectExpandedKeys(nodes, path = [], keys = new Set()) {
  for (const node of nodes) {
    const nextPath = [...path, node.id]
    if (node.type === 'folder' && node.expanded === true) {
      keys.add(rowKey(node.type, nextPath))
    }
    if (node.children) {
      collectExpandedKeys(node.children, nextPath, keys)
    }
  }
  return keys
}

function folderCount(item = {}) {
  if (Array.isArray(item.items)) return item.items.length
  if (Array.isArray(item.children)) return item.children.length
  return 0
}

export default {
  props: {
    resources: { type: Array, default: () => [] },
    usedResourceIds: { default: () => new Set() },
    searchDelay: { type: Number, default: 120 },
  },
  data() {
    return {
      expandedKeys: collectExpandedKeys(normalizeResourceTree(this.resources)),
      selectedKeys: new Set(),
      focusedKey: null,
      anchorKey: null,
      searchInput: '',
      searchKeyword: '',
      scrollTop: 0,
      previousScrollTop: 0,
      viewportHeight: 320,
      searchTimer: null,
    }
  },
  computed: {
    visibleRows() {
      return flattenResourceRows(this.resources, {
        expandedKeys: this.expandedKeys,
        searchKeyword: this.searchKeyword,
        usedResourceIds: this.usedResourceIds || new Set(),
      }).map((row) => (row.type === 'folder'
        ? { ...row, count: folderCount(row.item) }
        : row))
    },
    virtualWindow() {
      return resolveVirtualWindow({
        rowCount: this.visibleRows.length,
        rowHeight: ROW_HEIGHT,
        viewportHeight: this.viewportHeight,
        scrollTop: this.scrollTop,
        previousScrollTop: this.previousScrollTop,
      })
    },
    renderedRows() {
      return this.visibleRows.slice(this.virtualWindow.start, this.virtualWindow.end)
    },
  },
  watch: {
    resources(nextResources) {
      const defaults = collectExpandedKeys(normalizeResourceTree(nextResources))
      this.expandedKeys = new Set([...this.expandedKeys, ...defaults])
    },
  },
  mounted() {
    this.measureViewport()
  },
  beforeDestroy() {
    clearTimeout(this.searchTimer)
  },
  methods: {
    measureViewport() {
      this.viewportHeight = this.$refs.scroller?.clientHeight || 320
    },
    onScroll(event) {
      this.previousScrollTop = this.scrollTop
      this.scrollTop = event.target.scrollTop
      this.measureViewport()
    },
    onSearchInput(event) {
      this.searchInput = event.target.value
      clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(() => {
        this.searchKeyword = this.searchInput
        this.scrollTop = 0
        if (this.$refs.scroller) this.$refs.scroller.scrollTop = 0
      }, this.searchDelay)
    },
    rowClasses(row) {
      return {
        'resource-category-row': row.type === 'folder',
        'resource-item': row.type === 'resource',
        'is-collapsed': row.type === 'folder' && !row.expanded,
        'is-selected': this.selectedKeys.has(row.key),
        'is-focused': this.focusedKey === row.key,
        'is-disabled': row.disabled,
      }
    },
    onRowClick(row, event) {
      this.focusedKey = row.key
      if (row.type === 'folder') {
        this.toggleFolder(row.key)
        return
      }
      const next = applyResourceRowClick({
        rows: this.visibleRows,
        selectedKeys: this.selectedKeys,
        focusedKey: this.focusedKey,
        anchorKey: this.anchorKey,
        key: row.key,
        additive: event.metaKey || event.ctrlKey,
        range: event.shiftKey,
      })
      this.selectedKeys = next.selectedKeys
      this.focusedKey = next.focusedKey
      this.anchorKey = next.anchorKey
    },
    toggleFolder(key) {
      const expanded = new Set(this.expandedKeys)
      if (expanded.has(key)) expanded.delete(key)
      else expanded.add(key)
      this.expandedKeys = expanded
    },
    onKeyDown(event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        this.focusedKey = moveResourceFocus(this.visibleRows, this.focusedKey, event.key === 'ArrowDown' ? 1 : -1)
      } else if (event.key === 'ArrowRight' && this.focusedKey) {
        const row = this.visibleRows.find((item) => item.key === this.focusedKey)
        if (row?.type !== 'folder') return
        event.preventDefault()
        if (!row.expanded) {
          this.toggleFolder(row.key)
          return
        }
        const rowIndex = this.visibleRows.findIndex((item) => item.key === row.key)
        const child = this.visibleRows[rowIndex + 1]
        if (child && child.depth > row.depth) this.focusedKey = child.key
      } else if (event.key === 'ArrowLeft' && this.focusedKey) {
        const row = this.visibleRows.find((item) => item.key === this.focusedKey)
        if (!row) return
        event.preventDefault()
        if (row.type === 'folder' && row.expanded) {
          this.toggleFolder(row.key)
          return
        }
        const rowIndex = this.visibleRows.findIndex((item) => item.key === row.key)
        for (let index = rowIndex - 1; index >= 0; index -= 1) {
          const candidate = this.visibleRows[index]
          if (candidate.type === 'folder' && candidate.depth < row.depth) {
            this.focusedKey = candidate.key
            return
          }
        }
      } else if (event.key === ' ' && this.focusedKey) {
        event.preventDefault()
        const next = toggleFocusedResource({
          rows: this.visibleRows,
          selectedKeys: this.selectedKeys,
          focusedKey: this.focusedKey,
        })
        this.selectedKeys = next.selectedKeys
        this.anchorKey = next.anchorKey
      } else if (event.key === 'Enter' && this.focusedKey) {
        const row = this.visibleRows.find((item) => item.key === this.focusedKey)
        if (row?.type === 'folder') this.toggleFolder(row.key)
      }
    },
    selectedDragResources(row) {
      const keys = this.selectedKeys.has(row.key) ? this.selectedKeys : new Set([row.key])
      return this.visibleRows
        .filter((item) => keys.has(item.key) && item.type === 'resource' && !item.disabled)
        .map((item) => item.item)
    },
    onDragStart(row, event) {
      if (row.type !== 'resource' || row.disabled) {
        event.preventDefault()
        return
      }
      const resources = this.selectedDragResources(row)
      const payload = resources.length === 1 ? { ...resources[0], resources } : { resources }
      event.dataTransfer.setData('application/json', JSON.stringify(payload))
      event.dataTransfer.effectAllowed = 'copy'
    },
  },
}
</script>
<style scoped>
.resource-tree {
  height: 100%;
  padding: 14px 10px;
  color: #cfd6df;
  background: #101418;
  border: 1px solid #252a32;
  border-radius: 10px;
  font-size: 13px;
}
.resource-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding: 0 6px;
}
.resource-tree-title {
  margin: 0;
  color: #e7ebf0;
  font-size: 14px;
  font-weight: 700;
}
.resource-tree-collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: #8e98a5;
  background: #171c22;
  border: 1px solid #2a3038;
  border-radius: 5px;
  cursor: pointer;
}
.resource-tree-collapse:hover {
  color: #dce3ec;
  background: #20262d;
  border-color: #3a434e;
}
.resource-tree-collapse:focus-visible {
  outline: 1px solid #4b8cff;
  outline-offset: 2px;
}
.resource-tree-collapse-icon {
  display: block;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.4;
}
.resource-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  margin: 0 4px 16px;
  padding: 0 12px;
  color: #57616d;
  background: #12171d;
  border: 1px solid #252b34;
  border-radius: 6px;
}
.resource-search-input {
  width: 100%;
  min-width: 0;
  color: inherit;
  background: transparent;
  border: 0;
  outline: none;
  font: inherit;
}
.resource-tree-scroll {
  position: relative;
  height: calc(100% - 68px);
  overflow: auto;
  outline: none;
  scrollbar-color: #55606b rgba(18, 23, 29, 0.45);
  scrollbar-width: thin;
}
.resource-tree-scroll::-webkit-scrollbar {
  width: 8px;
}
.resource-tree-scroll::-webkit-scrollbar-track {
  background: rgba(18, 23, 29, 0.45);
  border-radius: 999px;
}
.resource-tree-scroll::-webkit-scrollbar-thumb {
  background: #4a5560;
  border: 2px solid rgba(18, 23, 29, 0.9);
  border-radius: 999px;
}
.resource-tree-scroll::-webkit-scrollbar-thumb:hover {
  background: #66717d;
}
.resource-tree-spacer {
  position: relative;
  min-height: 100%;
}
.resource-tree-window {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}
.resource-row {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 8px;
  height: 34px;
  border-radius: 5px;
  user-select: none;
}
.resource-row.is-selected {
  background: #26313b;
  color: #f4f7fb;
}
.resource-row.is-focused {
  outline: 1px solid #4b8cff;
  outline-offset: -1px;
}
.resource-row.is-disabled {
  color: #535b65;
  cursor: default;
  opacity: 0.58;
}
.resource-category-row {
  grid-template-columns: 8px 1fr auto;
  gap: 4px;
  min-height: 28px;
  padding-right: 4px;
  color: #87909c;
  cursor: pointer;
  font-weight: 600;
}
.resource-category-row:hover,
.resource-category-row:focus {
  color: #cdd4de;
}
.resource-category-caret {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 8px;
  height: 8px;
}
.resource-category-caret::before {
  content: '';
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid currentColor;
  transform: rotate(90deg);
  transform-origin: 45% 50%;
}
.resource-category-row.is-collapsed .resource-category-caret::before {
  transform: rotate(0deg);
}
.resource-category-count {
  min-width: 22px;
  height: 20px;
  border: 1px solid #2a3038;
  border-radius: 5px;
  text-align: center;
  line-height: 18px;
}
.resource-item {
  padding-right: 8px;
  color: #cdd4de;
  cursor: grab;
}
.resource-item:hover,
.resource-item:focus {
  background: #1f2328;
}
.resource-item-dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: #2bdd7f;
  box-shadow: 0 0 12px rgba(43, 221, 127, 0.45);
}
</style>
