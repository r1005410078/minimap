# Minimap

一个面向大图场景的 Vue 2.7 Canvas 组件。

它不是截图缩略图，而是一个可直接交互的图编辑/浏览组件：支持树形布局、分组框、拖拽编辑、搜索、视口导航、Overview、小地图、右键菜单、撤销重做，以及资源树拖入。

完整路线图见 [ROADMAP.md](ROADMAP.md)。如果你关心内部模块分层，再看 [docs/architecture.md](docs/architecture.md)。

## 支持什么

- Canvas 渲染大图，避免大量 DOM 节点
- 水平 / 垂直两种树布局
- 相邻子节点自动聚合成分组框
- 节点选择、多选、框选
- 平移、缩放、适配视图、居中到节点 / 选中
- 整张图居中但保持当前缩放不变
- 节点搜索与命中跳转
- 右下角 Overview 导航
- 左侧资源树拖入创建节点
- 节点重排、跨父移动、删除、复制、粘贴、导入、导出
- 撤销 / 重做
- `readonly` 只读模式
- `previewMode` 预览模式
- 自定义节点 / 分组 / 连线绘制
- 受控与非受控两种使用方式

## 最常见的用法

对外入口是 [src/minimap/index.js](/Users/rongts/minimap/src/minimap/index.js)。

```vue
<script setup>
import Minimap from './src/minimap/index.js'

const data = [
  {
    id: 'energy-root',
    label: 'Energy Root',
    children: [
      { id: 'grid-tie', label: 'Grid Tie' },
      {
        id: 'heap-1',
        label: 'Storage Heap 1',
        children: [
          { id: 'cluster-1', label: 'Cluster 1' },
          { id: 'cluster-2', label: 'Cluster 2' },
        ],
      },
    ],
  },
]

const resources = [
  {
    category: '储能设备',
    expanded: true,
    items: [
      { id: 'site', label: '站点' },
      { id: 'bms-stack', label: 'BMS 堆' },
    ],
  },
]
</script>

<template>
  <Minimap :data="data" :resources="resources" />
</template>
```

这会直接得到：

- 主画布
- 左侧资源树
- 搜索框
- 左下缩放 / 历史控件
- 右下 Overview
- 右键菜单

## 两种数据入口

### 1. `data`

适合大多数业务页面，直接传树形结构：

```js
const data = [
  {
    id: 'root',
    label: 'Root',
    children: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
  },
]
```

节点字段常用这些：

- `id`: 唯一 id
- `label`: 展示文本
- `children`: 子节点数组
- `icon`: 图标文本或 `{ text, color }`
- `kind`: 业务类型
- `width` / `height`: 自定义节点尺寸
- `data`: 业务自定义数据

### 2. `graph`

适合你已经有内部图模型，或者需要直接操作节点表：

```js
const graph = {
  version: 1,
  nodes: new Map([
    ['root', { id: 'root', label: 'Root', parentId: null, children: ['a', 'b'] }],
    ['a', { id: 'a', label: 'A', parentId: 'root', children: [] }],
    ['b', { id: 'b', label: 'B', parentId: 'root', children: [] }],
  ]),
  rootIds: ['root'],
  edges: [],
}
```

说明：

- `graph` 优先级高于 `data`
- `edges` 会绘制，但不参与主树布局
- 组件会原地修改 `graph.nodes` / `children`

## 常用配置

所有显示和交互开关都走 `options`。

```vue
<Minimap
  :data="data"
  :resources="resources"
  :options="{
    enableSearch: true,
    enableOverview: true,
    showGrid: true,
    showPerformance: false,
    previewMode: false,
    disableUsedResources: true,
    groupExpandedMaxHeight: 560,
  }"
/>
```

最常用的选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `enableSearch` | `true` | 是否显示搜索框 |
| `enableOverview` | `true` | 是否显示右下角 Overview |
| `enableActiveBorder` | `false` | 画布聚焦时显示描边 |
| `showGrid` | `true` | 是否绘制背景网格 |
| `showPerformance` | `true` | 是否显示左下角性能信息 |
| `previewMode` | `false` | 预览模式，隐藏工作区 chrome，保留浏览能力，并自动禁用编辑 |
| `hideTextDuringInteraction` | `false` | 拖拽 / 平移时临时隐藏文字 |
| `disableInitialCenter` | `false` | 首次挂载时不自动居中 |
| `disableUsedResources` | `true` | 已落图资源在资源树中自动禁用 |
| `groupExpandedMaxHeight` | `560` | 分组展开后的最大高度，超出显示滚动条 |

## 预览模式

如果你不是拿它做完整编辑器，而是想嵌在详情页、对比页、只读预览页里，可以开 `previewMode`：

```vue
<Minimap
  :data="data"
  :options="{ previewMode: true }"
/>
```

开启后：

- 保留搜索框
- 保留左下缩放控件
- 保留平移、缩放、Overview 导航等浏览能力
- 隐藏资源树
- 隐藏历史按钮
- 隐藏性能信息
- 隐藏 Overview
- 右键菜单默认只保留查看 / 定位类动作
- 自动禁用节点编辑、资源拖入、删除、粘贴、导入、拖拽重排

## 只读模式

```vue
<Minimap
  :data="data"
  :readonly="true"
/>
```

只读模式会阻止编辑类操作，包括：

- 资源拖入
- 节点移动 / 重排
- 删除
- 粘贴
- 导入

浏览、搜索、缩放、Overview 导航仍然可用。

## 资源树拖入

资源树数据格式：

```js
const resources = [
  {
    category: '储能设备',
    expanded: true,
    items: [
      { id: 'site', label: '站点', kind: 'site' },
      { id: 'pcs', label: 'PCS', kind: 'pcs' },
    ],
  },
]
```

拖入后通常会创建新节点，并把资源信息带进节点 `data`。

如果你的节点里有 `data.resourceId`，并且 `disableUsedResources !== false`，对应资源会在资源树中自动禁用。

## 受控模式

这三个状态既可以让组件自己管，也可以由外部接管：

- `selectedIds`
- `groupStates`
- `viewport`

典型的受控视口写法：

```vue
<script setup>
import { ref } from 'vue'
import Minimap from './src/minimap/index.js'

const viewport = ref({ x: 0, y: 0, scale: 1 })

function onViewportChange(next) {
  viewport.value = next
}
</script>

<template>
  <Minimap
    :data="data"
    :viewport="viewport"
    @viewport-change="onViewportChange"
  />
</template>
```

对应事件：

- `select`
- `viewport-change`
- `group-state-change`

## 事件

常用事件：

| 事件 | 说明 |
| --- | --- |
| `select` | 选中项变化 |
| `change` | 图数据发生编辑类变更 |
| `node-drop` | 资源拖入落图 |
| `node-move` | 节点跨父移动 |
| `group-reorder` | 分组内重排 |
| `viewport-change` | 视口变化 |
| `group-state-change` | 分组折叠 / 展开状态变化 |
| `search` | 搜索关键词、命中列表、当前索引变化 |
| `delete` / `copy` / `paste` | 对应编辑动作触发 |
| `import` / `export` | 导入导出 |
| `context-menu-action` | 右键菜单动作触发 |
| `config-change` | 内建配置项被右键菜单切换 |
| `data-change` | 使用 `data` 入口时，组件回传新的树数据 |

最常见的是监听 `change`：

```vue
<Minimap
  :data="data"
  @change="({ reason, graph, meta }) => {
    console.log(reason, graph, meta)
  }"
/>
```

## 组件实例方法

可以通过 `ref` 直接调用：

```vue
<script setup>
import { ref } from 'vue'

const minimapRef = ref(null)

function zoomToFit() {
  minimapRef.value?.fitToScreen()
}
</script>

<template>
  <Minimap ref="minimapRef" :data="data" />
</template>
```

常用方法：

### 视口

- `fitToScreen()`
- `centerGraph()`
- `centerOnNode(id)`
- `centerOnSelection()`
- `zoomTo(scale, center?)`
- `setViewport(viewport)`
- `getViewport()`

### 选择

- `select(ids, mode?)`
- `clearSelection()`

### 搜索

- `search(keyword)`
- `searchNext()`
- `searchPrevious()`

### 编辑

- `undo()`
- `redo()`
- `canUndo()`
- `canRedo()`
- `deleteSelection()`
- `copySelection()`
- `paste()`
- `exportGraph()`
- `importGraph(data)`

## 自定义绘制

如果你只想换视觉，不想接管交互逻辑，可以传 renderer：

```vue
<Minimap
  :data="data"
  :nodeRenderer="drawNode"
  :groupRenderer="drawGroup"
  :edgeRenderer="drawEdge"
/>
```

适合这些场景：

- 按业务类型换节点皮肤
- 自定义分组框样式
- 自定义连线颜色 / 样式

不适合在 renderer 里做这些事：

- 改数据
- 改视口
- 改选中状态

## 编辑拦截

你可以在默认行为执行前拦截：

```vue
<Minimap
  :data="data"
  :beforeNodeDrop="beforeNodeDrop"
  :beforeNodeMove="beforeNodeMove"
  :beforeGroupReorder="beforeGroupReorder"
  :beforeDelete="beforeDelete"
  :beforeCopy="beforeCopy"
  :beforePaste="beforePaste"
  :beforeImport="beforeImport"
/>
```

返回 `false` 就会阻止默认操作。

适合做：

- 权限控制
- 业务规则校验
- 禁止某些节点被拖入 / 移动 / 删除

## 右键菜单扩展

通过 `contextMenuItems` 覆盖或扩展默认菜单。

函数形式：

```js
function contextMenuItems(context, defaults) {
  return defaults.concat({
    id: 'inspect-node',
    label: '查看详情',
    action: 'inspect-node',
  })
}
```

数组形式：

```js
const contextMenuItems = [
  { id: 'paste', label: '业务粘贴' },
  { id: 'inspect-node', label: '查看详情', action: 'inspect-node' },
]
```

## Demo 入口

仓库里的 [src/App.vue](/Users/rongts/minimap/src/App.vue) 就是一份可运行示例，展示了：

- `data` 入口
- 大量资源树数据
- 自动分组
- 默认编辑与导航能力

如果你只是想先看组件跑起来，先从这个文件改最省事。
