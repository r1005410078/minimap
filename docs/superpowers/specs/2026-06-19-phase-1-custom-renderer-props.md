# Phase 1 自定义绘制 props 接通 Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第一阶段验收点"传入自定义节点绘制函数后，节点视觉可被替换"和功能列表"自定义绘制节点"。
> 依赖 [Canvas 渲染器 spec](2026-06-18-phase-1-canvas-renderer.md) 已实现并测试过的 `renderScene(ctx, { renderers })` 钩子，[Vue 组件壳 spec](2026-06-18-phase-1-vue-shell.md) 的 `Minimap.vue` props 契约。

## 背景：第一阶段验收回归发现的缺口

2026-06-19 的第一阶段验收回归里，用真实浏览器驱动 `<Minimap nodeRenderer="...">` 实测：画面 0 个自定义颜色像素，自定义绘制完全不生效。读代码确认原因：`src/minimap/renderer.js` 的 `renderScene()` 早就支持 `renderers: { node, group, edge }` 选项并有完整单测（`test/minimap-renderer.test.js`），但 `src/minimap/Minimap.vue` 从未把 `nodeRenderer`/`groupRenderer`/`edgeRenderer` 声明成 props，`renderCurrent()` 调 `renderScene` 时也没传 `renderers` 字段。这是组件公开契约和底层实现之间的连线缺失，不是底层逻辑有 bug。

## 头脑风暴决策记录

- **范围**：本切片只接通 `nodeRenderer`/`groupRenderer`/`edgeRenderer` 三个 props。ROADMAP 组件契约里同列的 `measureNode`、`options` 不在本切片范围内——`measureNode` 需要先给 `layout.js` 加节点尺寸覆盖逻辑（目前 `NODE` 是模块级常量，没有任何覆盖点），`options` 里除了 `groupThreshold`、`animationDuration` 之外的项（zoom 范围、overview/框选/键盘开关）对应的功能在第一阶段根本不存在，提前加开关是空中楼阁。这两个留给以后单独的切片。
- **不改底层**：`src/minimap/renderer.js` 和 `src/minimap/layout.js` 不动，因为 `renderScene` 已经完整支持 `renderers` 选项并测试过；本切片纯粹是组件层接线。
- **测试位置**：新增 3 个用例加进 `test/minimap-shell.test.js`，跟 `Minimap.vue` 其它组件级测试放在一起，不开新文件。

## 范围

### 目标（本切片交付）

- `src/minimap/Minimap.vue`：新增 `nodeRenderer`、`groupRenderer`、`edgeRenderer` 三个 `Function` 类型 props（默认 `null`），在 `renderCurrent()` 调用 `renderScene` 时传入 `renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer }`。
- 测试：`test/minimap-shell.test.js` 新增三个用例，分别验证传入 `nodeRenderer`/`groupRenderer`/`edgeRenderer` 后对应钩子被调用、对应默认绘制（`fillText`/`fillRect`）被跳过。

### 非目标（后续切片 / 阶段）

- `measureNode`：需要先扩展 `layout.js` 的节点尺寸计算逻辑（`node.width`/`node.height` 覆盖 → `measureNode(node)` → 默认常量），单独成片。
- `options`（`groupThreshold`、`animationDuration`、缩放范围、overview/框选/键盘开关等）：单独成片；其中缩放范围、overview、框选、键盘开关对应的功能在第三/四/五阶段才存在，不在本片提前加开关。
- 改变 `renderScene`/`layout.js` 的任何行为：本片只传递已有的钩子，不改底层实现或测试。

## 模块 API 契约

### `src/minimap/Minimap.vue` 新增 Props

```js
nodeRenderer: { type: Function, default: null }
groupRenderer: { type: Function, default: null }
edgeRenderer: { type: Function, default: null }
```

- 函数签名与 `renderScene` 已有契约一致，不新增参数：
  - `nodeRenderer(ctx, { node, rect, state, theme, viewport })`
  - `groupRenderer(ctx, { group, rect, state, theme, viewport })`
  - `edgeRenderer(ctx, { edge, from, to, theme, viewport })`
- 未提供时为 `null`，`renderScene` 内部 `if (renderers.node)` 等判断已经能正确回退到默认绘制，组件侧不需要额外的空值判断逻辑。

### `renderCurrent()` 改动

在现有调用里加一个字段，其余字段不变：

```js
renderScene(ctx, {
  layout: currentLayout,
  graph: props.graph,
  layoutDirection: props.layoutDirection,
  viewport: currentViewport,
  width: cssWidth,
  height: cssHeight,
  theme: props.theme || defaultTheme,
  state: { selectedIds: new Set(currentSelectedIds()) },
  renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
})
```

## 验收标准

- 给 `<Minimap>` 传 `nodeRenderer`，画布上对应节点不再用默认深色矩形 + label 绘制，而是执行自定义绘制函数。
- 给 `<Minimap>` 传 `groupRenderer`，分组框不再用默认绘制，执行自定义绘制函数。
- 给 `<Minimap>` 传 `edgeRenderer`，连线不再用默认折线绘制，执行自定义绘制函数。
- 三个 props 都不传时，行为与现在完全一致（默认绘制），不引入回归。
- `npm test`、`npm run build` 通过。

## 测试清单

- `test/minimap-shell.test.js`：
  - 传入 `nodeRenderer` 时该函数被调用，且默认节点 `fillText`（label）未被调用。
  - 传入 `groupRenderer` 时该函数被调用，且默认分组框绘制（分组 header `fillText`）未被调用。
  - 传入 `edgeRenderer` 时该函数被调用，且默认连线 `stroke`/箭头绘制未被调用。
- 全量验证：
  - `npm test`
  - `npm run build`
- 浏览器手动/CDP 复核：用上次验收回归的 harness 方式重新跑一次 `scenario=custom-renderer`，确认画面出现自定义颜色像素（之前是 0）。

## 风险与取舍

- 风险很低：改动只新增三行 props 声明和一行 `renderers` 字段，不碰任何既有渲染分支，回归面很小。
- `measureNode` 和 `options` 被推迟，意味着 ROADMAP 组件契约里这两项目前仍然是"文档先写、代码未接"的状态；下一次有人尝试用这两个 prop 时还会遇到同样的"传了没用"问题，需要在对应切片的 spec 里再次提醒。
