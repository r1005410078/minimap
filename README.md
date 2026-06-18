# Minimap

不引入第三方库的 Vue 2.7 大图 minimap 组件：Canvas 渲染、最多 10000 节点、相邻节点自动分组、左右/上下布局。

完整功能路线图与各阶段验收标准见 [ROADMAP.md](ROADMAP.md)。

## 状态

第一阶段（核心可用能力）进行中。已落地并带测试的是**纯逻辑层**与 **Canvas 渲染器**（均不依赖浏览器，可用 `node --test` 验证）：

| 模块 | 职责 |
| --- | --- |
| `src/minimap/graph.js` | 图数据模型、示例/压力数据、框内换位 |
| `src/minimap/layout.js` | 分层树布局、自动分组折叠、视口锚点补偿 |
| `src/minimap/coords.js` | 世界坐标 / 屏幕坐标互转 |
| `src/minimap/renderer.js` | 场景绘制、视口裁剪、自定义绘制钩子、渲染统计 |
| `src/minimap/theme.js` | 内置深色默认主题 |

> Vue 组件壳（真实 `<canvas>` 挂载、DPR、资源树拖入）是下一个切片，尚未提供。当前可按下面的方式手动把模块接到一个 canvas 上。

## 脚本

```bash
npm run dev      # Vite 开发服务器
npm run build    # 生产构建
npm test         # node --test 单元测试
```

## 快速开始

把图数据、布局、渲染三步接到一个 Canvas 2D 上下文：

```js
import { createDemoGraph } from './src/minimap/graph.js'
import { computeLayout } from './src/minimap/layout.js'
import { renderScene } from './src/minimap/renderer.js'

const graph = createDemoGraph()
const canvas = document.querySelector('canvas')
const ctx = canvas.getContext('2d')

const layout = computeLayout(graph, {
  direction: 'horizontal', // 或 'vertical'
  viewportWidth: canvas.width,
  viewportHeight: canvas.height,
})

const viewport = { x: 80, y: 80, scale: 1 }
const stats = renderScene(ctx, {
  graph,
  layout,
  viewport,
  width: canvas.width,
  height: canvas.height,
})
// stats: { total, drawn, culled, durationMs }
```

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
- 父子层级由 `parentId` + `children` 表达；`edges` 表达非父子/跨层/业务关系线，**不参与主布局**，只用于连线绘制。
- **自动分组**：同一父节点的相邻子节点数量超过 `GROUP_THRESHOLD`（默认 5，即 ≥6）时，全部折叠成一个分组框；分组内部子节点顺序即真实逻辑顺序。

## API

### graph.js

- `createDemoGraph()` → 能源系统示例图。
- `createStressGraph(childCount = 10000)` → 压力测试图（根 + 1 父 + `childCount` 子，`nodes.size === childCount + 2`）。
- `reorderGroupChild(graph, parentId, childId, newIndex)` → 把子节点移到父节点 `children` 的 `newIndex` 位置，结果保持唯一。

### layout.js

- `GROUP_THRESHOLD` → 自动分组阈值（`5`）。
- `computeLayout(graph, { direction, viewportWidth, viewportHeight })` →
  `{ nodes: Map<id,{x,y,width,height}>, groups, visibleItems, bounds }`。
  - `horizontal`：深度增大 → `x` 增大；`vertical`：深度增大 → `y` 增大。
  - 分组框尺寸受视口约束：最大宽 `viewportWidth*0.48`、最大高 `viewportHeight*0.42`，超出则 `overflowY=true`。
  - `visibleItems` 已做结构性虚拟化：折叠进分组的子节点不单独出现，因此大图候选集很小。
- `keepAnchorStable(viewport, beforeWorld, afterWorld)` → 重新布局后补偿视口，让锚点节点保持在原屏幕位置。

### coords.js

- `worldToScreen(point, viewport)` → `{ x: x*scale + viewport.x, y: y*scale + viewport.y }`。
- `screenToWorld(point, viewport)` → 上式逆变换（用于拖入落点、命中检测、缩放中心等）。

### renderer.js

- `renderScene(ctx, scene)` → 绘制场景并返回 `{ total, drawn, culled, durationMs }`。
  `scene`：`{ layout, graph, viewport, width, height, theme?, state?, renderers? }`。
  - 绘制顺序：网格 → 连线 → 分组框 → 普通节点。
  - 只对视口内的项发绘制调用（视口裁剪）。
  - `state.selectedIds`（`Set<string>`，可选）驱动选中态。
- 纯函数（无 ctx 依赖，便于复用/测试）：
  - `worldRectToScreen(rect, viewport)`
  - `collectVisible(layout, viewport, width, height)` → `{ items, culled }`
  - `resolveEdges(graph, layout)` → `[{ id, kind, from, to }]`（端点落在折叠子节点上时路由到其分组框）

## 自定义绘制

通过 `renderers` 替换默认绘制；只负责视觉输出，不改数据/视口/选中：

```js
renderScene(ctx, {
  graph, layout, viewport, width, height,
  renderers: {
    node(ctx, { node, rect, state, theme, viewport }) {
      ctx.fillStyle = state.selected ? '#5aa9ff' : '#1e2a38'
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    },
    // group(ctx, { group, rect, state, theme, viewport }) { ... }
    // edge(ctx, { edge, from, to, theme, viewport }) { ... }
  },
})
```

`theme` 缺省用 `src/minimap/theme.js` 的 `defaultTheme`，可传入自定义对象覆盖颜色/字号/网格/内边距。

## 约束

不引入新的第三方运行时或开发依赖。实现使用 Vue 2.7、Vite、Canvas 2D、原生 HTML 拖拽、原生 pointer 事件，以及 Node 内置测试运行器。详见 [docs/project-conventions.md](docs/project-conventions.md)。
