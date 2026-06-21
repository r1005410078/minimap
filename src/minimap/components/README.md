# components — Vue 组件层

## 职责

薄 Vue 包装：props/emits 声明、模板绑定、生命周期挂载、向 controller 转发调用。不持有编排逻辑或状态机。

对外入口：[`../index.js`](../index.js) 默认导出 `Minimap` 组件。

本目录组件使用 **Vue 2.7 Options API**（`export default { props, data, computed, methods, ... }`），不用 `<script setup>`。SFC 块顺序为 **`<template>` → `<script>` → `<style>`**。

## 现有文件

| 文件 | 说明 |
|------|------|
| `Minimap.vue` | 根组件壳。创建并挂载 `minimap-controller`，绑定工具栏/搜索框/右键菜单/性能面板，`methods` 暴露相机/选中/编辑/搜索方法供 `$refs` 调用 |
| `Overview.vue` | 小地图子组件。命令式 `render(scene)`，自有 canvas + DPR，点击 emit `navigate` |
| `ResourceTree.vue` | 资源树。展示可拖拽资源，原生 drag and drop 发起拖入 |

## 规范约束

**应该放在这里的：**

- 需要模板/DOM 的 Vue 单文件组件（Options API）
- props/emits/`methods` 公开 API 等与外部调用方的接口声明

**不应该放在这里的：**

- 指针事件处理、拖拽状态机、撤销重做等编排逻辑（→ `controllers/`）
- 纯函数、布局/命中/渲染数学（→ 对应纯逻辑层）
- 在组件内直接改 `graph.nodes` 或绕过 `graph-operations` 提交变更

**依赖方向：**

- 可 import `controllers/`、`render/theme.js`、`coords/viewport.js` 等
- 不应被 `graph/`、`interaction/` 等纯逻辑层 import（避免 Vue ↔ 纯逻辑循环）

**测试：** 组件行为优先用集成测试（`minimap-shell.test.js` 等）；单组件 UI 用 `minimap-*-ui.test.js`。

更多上下文见 [docs/architecture.md](../../../docs/architecture.md)。
