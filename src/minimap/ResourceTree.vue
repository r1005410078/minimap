<script setup>
// 资源树展示：两层——分类（不可拖）+ 叶子资源项（可拖）。
// 拖拽信息走原生 dataTransfer，由 Minimap.vue 的 drop 处理器读取。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
defineProps({
  resources: { type: Array, default: () => [] },
})

function onDragStart(item, event) {
  event.dataTransfer.setData('application/json', JSON.stringify(item))
  event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <div class="resource-tree">
    <div v-for="category in resources" :key="category.category" class="resource-category">
      <div class="resource-category-label">{{ category.category }}</div>
      <div
        v-for="item in category.items"
        :key="item.id"
        class="resource-item"
        draggable="true"
        :data-resource-id="item.id"
        @dragstart="onDragStart(item, $event)"
      >
        {{ item.label }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.resource-tree {
  padding: 12px;
  font-size: 13px;
}
.resource-category-label {
  margin: 12px 0 6px;
  font-weight: 600;
  color: #9fb6cc;
}
.resource-item {
  padding: 6px 8px;
  margin-bottom: 4px;
  border-radius: 4px;
  background: #16202b;
  color: #cfe3f7;
  cursor: grab;
}
</style>
