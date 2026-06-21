# Minimap

不引入第三方库的 Vue 2.7 大图 minimap 组件：Canvas 渲染、最多 10000 节点、相邻节点自动分组、左右/上下布局、视口导航、搜索、Overview、完整编辑与撤销重做。

完整功能路线图与各阶段验收标准见 [ROADMAP.md](ROADMAP.md)。模块分层与目录约束见 [docs/architecture.md](docs/architecture.md)。

## 状态

| 阶段 | 进度 |
| --- | --- |
| 第一阶段：核心可用能力 | 已完成 |
| 第二阶段：分组框能力 | 已完成 |
| 第三阶段：视图和选择能力 | 已完成 |
| 第四阶段：导航和查找能力 | 已完成 |
| 第五阶段：编辑和状态能力 | 进行中（编辑/撤销/右键菜单已完成；loading/aria/performance 事件待做） |
| Controller 抽取 | 已完成（编排逻辑在 `controllers/`，Vue 层为薄包装） |

当前 **`npm test` 467 项全过**，`npm run build` 通过。

## 脚本

```bash
npm run dev      # Vite 开发服务器
npm run build    # 生产构建
npm test         # node --test 单元测试
```

## 快速开始

在 Vue 应用里引入组件（对外入口 [`src/minimap/index.js`](src/minimap/index.js)）：

```vue
<script setup>
import Minimap from './minimap/index.js'
import { createDemoGraph } from './minimap/graph/graph.js'

const graph = createDemoGraph()
const resources = [
  { category: '储能设备', expanded: true, items: [{ id: 'site', label: '站点' }] },
]
</script>

<template>
  <Minimap :graph="graph" :resources="resources" />
</template>
```

组件内置：Canvas 主画布、左侧资源树拖入、搜索框、Overview 小地图、工具栏（撤销/重做/导入导出等）。交互编排由 [`minimap-controller`](src/minimap/controllers/minimap-controller.js) 驱动，`Minimap.vue` 只负责 props/emits/模板与生命周期。

## 目录结构

`src/minimap/` 按职责分 7 个子目录（各目录有 README 说明约束）：

| 目录 | 职责 |
| --- | --- |
| [`components/`](src/minimap/components/) | `Minimap.vue`、`Overview.vue`、`ResourceTree.vue` |
| [`controllers/`](src/minimap/controllers/) | 框架无关的状态机与 DOM 事件编排 |
| [`graph/`](src/minimap/graph/) | 图数据、layout、mutation 唯一入口 |
| [`coords/`](src/minimap/coords/) | 世界/屏幕坐标、viewport 数学 |
| [`interaction/`](src/minimap/interaction/) | 命中检测、拖拽几何、选中运算 |
| [`render/`](src/minimap/render/) | Canvas 绘制、合帧、降级、主题 |
| [`edit/`](src/minimap/edit/) | 搜索、右键菜单项、剪贴板 |

## 数据模型

```js
const graph = {
  version: 1,
  nodes: new Map(), // Map<id, node>
  rootIds: ['energy-root'],
  edges: [],
}
```

- `node`：`{ id, label, parentId, children: string[], kind?, width?, height?, data? }`
- `edge`：`{ id, source, target, label?, kind?, data? }`
- 父子层级由 `parentId` + `children` 表达；`edges` 不参与主布局，只用于连线绘制与高亮。
- 同一父节点的相邻子节点 ≥ `GROUP_THRESHOLD + 1`（默认 6）时自动折叠成分组框。

## 组件 API 概览

### 主要 props

| Prop | 说明 |
| --- | --- |
| `graph` | 图数据（必填） |
| `resources` | 左侧资源树数据 |
| `layoutDirection` | `'horizontal'` / `'vertical'` |
| `selectedIds` / `groupStates` / `viewport` | 受控模式；不传则组件内部管理 |
| `options` | 功能开关（搜索、Overview、网格、性能面板等） |
| `theme` | 覆盖默认主题 |
| `nodeRenderer` / `groupRenderer` / `edgeRenderer` | 自定义绘制钩子 |
| `readonly` | 禁止一切编辑操作 |
| `beforeNodeDrop` / `beforeGroupReorder` / `beforeNodeMove` / `beforeDelete` / … | 编辑拦截钩子 |
| `contextMenuItems` | 覆盖/扩展右键菜单 |

### 主要 emits

`select`、`viewport-change`、`group-state-change`、`change`（含 undo/redo 元数据）、`node-drop`、`node-move`、`group-reorder`、`search`、`delete`、`copy`、`paste`、`import`、`export`、`context-menu-action`、`config-change`

### `defineExpose` 方法

相机：`fitToScreen`、`centerOnNode`、`centerOnSelection`、`zoomTo`、`setViewport`、`getViewport`

选择：`select`、`clearSelection`

搜索：`search`、`searchNext`、`searchPrevious`

编辑：`undo`、`redo`、`canUndo`、`canRedo`、`deleteSelection`、`copySelection`、`paste`、`exportGraph`、`importGraph`

## 底层模块（可选）

不经过 Vue 组件、直接接 Canvas 时，可按层 import 纯函数模块，例如：

```js
import { createDemoGraph } from './src/minimap/graph/graph.js'
import { computeLayout } from './src/minimap/graph/layout.js'
import { renderScene } from './src/minimap/render/renderer.js'

const graph = createDemoGraph()
const layout = computeLayout(graph, {
  direction: 'horizontal',
  viewportWidth: 1200,
  viewportHeight: 760,
})
const stats = renderScene(ctx, {
  graph,
  layout,
  viewport: { x: 80, y: 80, scale: 1 },
  width: canvas.width,
  height: canvas.height,
})
// stats: { total, drawn, culled, durationMs }
```

常用入口：

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| 图与布局 | `graph/graph.js`、`graph/layout.js` | 数据模型、`computeLayout`、`keepAnchorStable` |
| 坐标 | `coords/coords.js`、`coords/viewport.js` | 坐标变换、平移缩放、fit/tween |
| 渲染 | `render/renderer.js`、`render/theme.js` | `renderScene`、自定义 `renderers`、默认主题 |
| 变更 | `graph/graph-operations.js` | 所有图 mutation 的唯一入口（含 undo/redo） |

自定义绘制通过 `renderers: { node, group, edge }` 传入 `renderScene` 或组件 props；只负责视觉，不改数据/视口/选中。示例见 [docs/architecture.md](docs/architecture.md) 与各层 README。

## 约束

不引入新的第三方运行时库。实现使用 Vue 2.7、Vite、Canvas 2D、原生 pointer/拖拽事件、ResizeObserver、`requestAnimationFrame`，以及 Node 内置测试运行器。详见 [docs/project-conventions.md](docs/project-conventions.md)。
