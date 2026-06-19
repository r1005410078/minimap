# Phase 1 布局切换动画 + 视口锚点稳定 Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第一阶段的“布局切换动画”和“视口锚点稳定”两个收尾功能项。
> 依赖 [逻辑层 spec](2026-06-18-phase-1-core-logic.md) 的 `computeLayout` / `keepAnchorStable`，[Vue 组件壳 spec](2026-06-18-phase-1-vue-shell.md) 的 `Minimap.vue` 渲染触发点，以及 [正交连线 spec](2026-06-18-phase-1-orthogonal-edges.md) 的默认折线绘制。

## 头脑风暴决策记录

- **范围合并**：把布局切换动画和视口锚点稳定放在同一个 Phase 1 收尾切片里做。单独做动画但不稳定锚点会让画面仍然“跳”，体验不完整。
- **触发范围**：动画不只覆盖 `layoutDirection` 左右/上下切换，也覆盖 graph 变化导致的重新布局。拖入节点、节点顺序变化、未来分组展开折叠都可以复用同一套机制。
- **架构选择**：新增纯 JS 模块 `layout-transition.js`，负责旧 layout 和新 layout 的匹配与插值；`Minimap.vue` 只负责计算 layout、调度 `requestAnimationFrame`、取消动画和调用 `renderScene`。
- **动画策略**：相同普通节点和相同分组框做矩形插值；新出现的项直接使用目标位置；消失项本切片不保留 ghost，避免 renderer、命中检测和选择状态复杂化。
- **锚点策略**：优先保持当前选中节点稳定；没有选中时保持第一个 root 稳定；锚点在新旧布局中任一边不存在时不补偿。

## 范围

### 目标（本切片交付）

- `src/minimap/layout-transition.js`：纯函数模块，创建布局过渡、按进度输出过渡 layout、提供 easing 和 viewport 插值。
- `src/minimap/Minimap.vue`：在 graph 或 `layoutDirection` 变化时启动布局动画；动画中每帧用过渡 layout + 过渡 viewport 调用 `renderScene`；新变化打断旧动画时平滑接续；unmount 时取消 raf。
- 视口锚点补偿：复用 `keepAnchorStable(viewport, before, after)`，在布局变化时计算目标 viewport，并在动画过程中插值 `viewport.x/y`。
- 测试：纯函数测试覆盖 layout 插值和新 item；组件测试覆盖方向切换动画、raf 取消、锚点 viewport 参与渲染。

### 非目标（后续阶段 / 范围外）

- 平移、缩放、viewport 受控 prop、`fitToScreen`、`centerOnNode`：第三、四阶段处理。本切片只让内部固定 viewport 在重新布局时能被锚点补偿。
- 消失项 ghost 动画、淡入淡出透明度、边独立插值：本切片不做。边会随过渡 layout 重新解析和绘制，已经能跟随节点移动。
- 对折叠分组内部子节点做精确锚点：如果选中 id 当前没有可见 box，本切片回退到 root。分组内部坐标等第二阶段分组内部虚拟绘制时再扩展。
- 新增公开 API 或 `options.animationDuration` prop：先使用内部常量，避免 Phase 1 API 面扩大。后续有调用方需要再外放。
- resize 动画：容器 resize 时直接重算重绘，不做过渡，避免窗口拖拽时持续动画造成拖泥带水。

## 模块 API 契约

### `src/minimap/layout-transition.js`

```js
createLayoutTransition({ fromLayout, toLayout, fromViewport, toViewport, durationMs }) -> transition
layoutAt(transition, progress) -> { layout, viewport }
easeOutCubic(t) -> number
```

- `fromLayout` / `toLayout`：`computeLayout` 返回值，结构为 `{ nodes, groups, visibleItems, bounds }`。
- `fromViewport` / `toViewport`：形如 `{ x, y, scale }` 的内部 viewport。
- `durationMs`：默认由组件传入 200。`durationMs <= 0` 时组件可以直接渲染终态。
- `progress`：`0..1`。`layoutAt` 内部先 clamp，再套用 `easeOutCubic` 后插值。

### item 匹配规则

- 普通节点 key：`node:<id>`。
- 分组框 key：`group:<parentId>`。
- 两边都存在的 item：插值 `x/y/width/height`。
- 只在目标 layout 存在的 item：使用目标 rect。
- 只在旧 layout 存在的 item：不输出到过渡 layout。

### 过渡 layout 输出

- `nodes`：Map。对 `toLayout.nodes` 里的每个节点输出目标集合对应的 rect；若旧 layout 有同 id 节点，则 rect 为插值结果。
- `groups`：数组。以 `toLayout.groups` 为准，复制 group 元数据并替换 `x/y/width/height`，让分组框位置和尺寸都能参与过渡。
- `visibleItems`：以 `toLayout.visibleItems` 顺序为准，保证兄弟顺序和绘制顺序稳定；每个 item 的 `x/y/width/height` 是过渡 rect。
- `bounds`：覆盖过渡后的所有 `visibleItems`。如果没有可见项，退回 `toLayout.bounds`。
- `viewport`：`x/y` 在 `fromViewport` 和 `toViewport` 之间插值，`scale` 保持 `fromViewport.scale`。

## `Minimap.vue` 数据流

### 渲染状态

组件内部维护：

- `layout`：当前最终 layout 或动画当前帧 layout。
- `settledLayout`：最近一次已确认的目标 layout，用于下一次重新布局的比较起点。
- `viewport`：内部 viewport 对象。Phase 1 仍固定 `scale: 1`，但 `x/y` 可以被锚点补偿改变。
- `animationFrameId`：当前 raf id。
- `activeTransition`：当前过渡对象，包含起始时间、起点 layout、终点 layout、起点 viewport、终点 viewport。

### 触发重新布局

新增内部函数：

```js
updateLayout({ animate = true, preserveAnchor = true } = {})
```

流程：

1. 使用当前 `graph`、`layoutDirection`、`cssWidth`、`cssHeight` 调 `computeLayout` 得到 `nextLayout`。
2. 选择 anchor id：当前选中 id 的第一个；没有选中时用 `graph.rootIds[0]`。
3. 如果 `preserveAnchor` 且 anchor 在起点 layout 和 `nextLayout` 中都能解析到可见 rect，取两边中心点，调用 `keepAnchorStable(viewport, before, after)` 得到 `targetViewport`。
4. 如果不能解析 anchor，`targetViewport` 等于当前 viewport。
5. 如果没有起点 layout、`animate === false` 或动画时长为 0，直接设置 `layout = nextLayout`、`settledLayout = nextLayout`、`viewport = targetViewport` 并渲染。
6. 否则取消旧 raf，以“当前屏幕正在显示的 layout 和 viewport”为起点，创建新 transition，启动 raf。

### 动画帧

- 每帧根据 `performance.now()` 和 `durationMs` 算 progress。
- `layoutAt` 返回过渡 layout 和过渡 viewport 后，调用 `renderScene`。
- progress 到 1 时停止 raf，把 `layout` 和 `settledLayout` 固定为 `nextLayout`，`viewport` 固定为 `targetViewport`。
- 如果 graph 或 `layoutDirection` 在动画中再次变化，取消旧 raf，以当前过渡帧作为起点启动新动画，避免回跳。

### resize 和 unmount

- `ResizeObserver` 回调仍先 `syncCanvasSize()`。
- resize 后调用 `updateLayout({ animate: false, preserveAnchor: false })`，直接重算重绘。
- `onUnmounted` 断开 `ResizeObserver`，并取消当前 raf。

## 锚点解析

锚点只在可见 layout 项里解析：

```js
resolveAnchorCenter(layout, id) -> { x, y } | null
```

- 优先查 `layout.nodes.get(id)`。
- 如果没有节点 rect，不在本切片中追踪折叠分组内部子节点。
- 可见 rect 的中心点为 `{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }`。

如果当前选中 id 被折叠进分组框导致查不到 rect，组件会尝试 root anchor。root 也不存在时不补偿。

## 验收标准

- 切换 `layoutDirection` 时，节点和分组框从旧位置平滑移动到新位置，而不是瞬时跳变。
- graph 变化导致重新布局时，相同 id 的可见节点和分组框平滑移动；新出现项直接出现在目标位置。
- 动画过程中默认正交连线跟随节点/分组框移动，不出现使用旧端点的滞后连线。
- 有选中节点时，重新布局后该节点在屏幕上的位置保持在原位置附近；没有选中时，第一个 root 保持稳定。
- 动画过程中再次触发重新布局不会跳回旧布局，而是从当前帧继续过渡到新布局。
- resize 不触发布局动画，只做同步重算重绘。
- 组件销毁后不会继续执行 raf，也不会再调用 `renderScene`。

## 测试清单

- `layout-transition.js`：
  - 相同 node id 的 `x/y/width/height` 会按 progress 插值。
  - 相同 group parentId 的 rect 会按 progress 插值。
  - 新出现 item 使用目标 rect。
  - 输出 `visibleItems` 顺序跟随 `toLayout.visibleItems`。
  - 输出 `bounds` 覆盖过渡可见项。
  - viewport `x/y` 插值，`scale` 保持稳定。
- `Minimap.vue`：
  - `layoutDirection` 变化后启动 raf，并在中间帧调用 `renderScene`。
  - 选中节点作为 anchor 时，下一次 renderScene 接收到补偿后的 viewport。
  - 动画中再次变化会取消上一帧 raf。
  - unmount 会取消 raf 并断开 `ResizeObserver`。
  - resize 触发重绘但不启动动画。
- 全量验证：
  - `npm test`
  - `npm run build`

## 风险与取舍

- 本切片让内部 `viewport.x/y` 开始变化，但仍不暴露平移缩放 API。第三阶段引入受控 viewport 时，需要把这部分内部状态迁移到受控/非受控契约中。
- 过渡 layout 以目标 layout 的可见项为准，因此消失项不会做退场动画。这是为了保持命中检测、选择、renderer 输入结构简单。
- 锚点只解析可见节点，不解析折叠分组内部子节点。当前 Phase 1 的可见层级已经能覆盖 root、普通节点和分组框级别的稳定体验。
