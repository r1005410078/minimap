<script setup>
// 资源树展示：两层——分类（不可拖）+ 叶子资源项（可拖）。
// 拖拽信息走原生 dataTransfer，由 Minimap.vue 的 drop 处理器读取。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
import { ref } from 'vue'

defineProps({
  resources: { type: Array, default: () => [] },
})

const expandedOverrides = ref({})

function isExpanded(category) {
  return expandedOverrides.value[category.category] ?? category.expanded !== false
}

function toggleCategory(category) {
  expandedOverrides.value = {
    ...expandedOverrides.value,
    [category.category]: !isExpanded(category),
  }
}

function onDragStart(item, event) {
  event.dataTransfer.setData('application/json', JSON.stringify(item))
  event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <aside class="resource-tree">
    <div class="resource-tree-header">
      <h2 class="resource-tree-title">资源树</h2>
      <button class="resource-tree-hint" type="button" disabled>拖至画布</button>
    </div>
    <div class="resource-search" aria-hidden="true">
      <span class="resource-search-icon">⌕</span>
      <span class="resource-search-placeholder">搜索节点...</span>
    </div>
    <div v-for="category in resources" :key="category.category" class="resource-category">
      <div
        class="resource-category-row"
        :class="{ 'is-collapsed': !isExpanded(category) }"
        role="button"
        tabindex="0"
        @click="toggleCategory(category)"
        @keydown.enter.prevent="toggleCategory(category)"
        @keydown.space.prevent="toggleCategory(category)"
      >
        <span class="resource-category-caret" aria-hidden="true"></span>
        <span class="resource-category-label">{{ category.category }}</span>
        <span class="resource-category-count">{{ category.items.length }}</span>
      </div>
      <div v-show="isExpanded(category)" class="resource-items">
        <div
          v-for="item in category.items"
          :key="item.id"
          class="resource-item"
          draggable="true"
          :data-resource-id="item.id"
          @dragstart="onDragStart(item, $event)"
        >
          <span class="resource-item-dot" aria-hidden="true"></span>
          <span class="resource-item-label">{{ item.label }}</span>
          <span class="resource-item-handle" aria-hidden="true">⌘</span>
        </div>
      </div>
    </div>
  </aside>
</template>

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
.resource-tree-hint {
  height: 28px;
  padding: 0 10px;
  color: #69717c;
  background: #171c22;
  border: 1px solid #2a3038;
  border-radius: 5px;
  font: inherit;
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
.resource-category-row {
  display: grid;
  grid-template-columns: 8px 1fr auto;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 4px;
  color: #87909c;
  font-weight: 600;
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
.resource-items {
  margin-top: 4px;
}
.resource-item {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px 0 22px;
  border-radius: 5px;
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
.resource-item-handle {
  color: #535b65;
  font-size: 11px;
}
</style>
