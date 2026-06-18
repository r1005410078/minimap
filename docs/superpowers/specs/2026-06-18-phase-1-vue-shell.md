# Phase 1 Vue 组件壳 + 资源树拖入 Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第一阶段；是逻辑层、Canvas 渲染器两个切片之后的第三个切片。
> 依赖 [逻辑层 spec](2026-06-18-phase-1-core-logic.md) 的 `graph`/`coords`，[Canvas 渲染器 spec](2026-06-18-phase-1-canvas-renderer.md) 的 `renderScene`。

## 头脑风暴决策记录

- **挂载父节点规则**：拖入资源时挂到"当前选中节点"下；未选中则挂到 `graph.rootIds[0]`。
- **选中能力的范围**：本切片只做"最小可用点击选中"——单选，`selectedIds` 受控/非受控双模式 + `select` 事件；多选、框选、高亮留给第三阶段。
- **插入位置**：根据拖放世界坐标与父节点现有同胞兄弟的距离，插入到最接近的位置；若父节点的子节点已经折叠成分组框（没有逐个子节点的世界坐标），退化为追加到 `children` 末尾。
- **资源树结构**：两层——分类（不可拖）+ 叶子资源项（可拖）。
- **测试依赖**：新增 `@vue/test-utils`（Vue 2 兼容版本）+ `jsdom` 作为开发依赖，用于 Vue 组件级测试；用户已明确批准这次新增开发依赖（按约定，超出"不引入新开发依赖"默认规则需要显式批准）。测试运行器仍是 Node 内置 `node --test`，不引入 Vitest。
- **文件组织**：组件放在 `src/minimap/` 下（`Minimap.vue` + `ResourceTree.vue`），与现有纯函数文件同目录；删除占位 `HelloWorld.vue`，`App.vue` 改为演示页（`createDemoGraph()` 示例图 + 示例资源数据 + `Minimap`）。

## 范围

### 目标（本切片交付）

- `src/minimap/interaction.js`：`hitTest`、`findInsertionIndex` 两个可测纯函数。
- `src/minimap/Minimap.vue`：挂载真实 `<canvas>`、DPR 适配、`ResizeObserver` 驱动的按需重渲染、点击选中（单选）、资源拖入落图、对外 props/emits。
- `src/minimap/ResourceTree.vue`：资源分类 + 可拖叶子项的展示组件，被 `Minimap.vue` 内部使用。
- `App.vue` 改为演示页，移除 `HelloWorld.vue` 占位及其专属资源文件。
- 测试：`test/minimap-interaction.test.js`（纯函数）+ Vue 组件级测试（mount 真实组件，stub canvas）。

### 非目标（后续切片 / 阶段）

- 布局切换动画（坐标插值）：下一个切片。本切片 `layoutDirection` 切换是瞬时重新布局。
- 平移、缩放、`viewport` 受控、`setViewport`/`zoomTo`/`fitToScreen`/`centerOnNode` 等方法：第三、四阶段。
- 多选、框选、`Esc` 清空、选中关系高亮（父子链/连线高亮）：第三阶段。点击空白清空单选作为本切片最小闭环的一部分保留。
- `readonly`/`loading`/`error`、before hooks（`beforeNodeDrop` 等）、撤销/重做、导入导出：第五阶段。
- 公开 `resize()`/`destroy()` 方法：`ResizeObserver` + `onUnmounted` 自动清理已经覆盖本切片场景，暂不加这两个目前没有调用方的公开方法。
- 分组框内部子节点的逐个世界坐标（影响 `findInsertionIndex` 在已折叠分组下的精度）：第二阶段分组内部虚拟绘制时再补。

## 模块 API 契约

### `src/minimap/interaction.js`

```js
hitTest(layout, worldPoint) -> { type: 'node' | 'group', id } | null
```

- 遍历 `layout.visibleItems`，找世界坐标包围盒包含 `worldPoint` 的项。
- `type: 'node'` 时 `id` 是节点 id；`type: 'group'` 时 `id` 是该分组框的 `parentId`。
- 树布局下节点与分组框天然不重叠（分组框是其父节点的子项之一，占据独立的交叉轴区间），不需要处理重叠优先级；找到第一个命中项即返回。
- 没有任何项包含该点时返回 `null`。

```js
findInsertionIndex(graph, layout, parentId, worldPoint, direction) -> number
```

- 若 `layout.groups` 中存在 `parentId` 对应的分组框（即该父节点的子节点已折叠），没有逐个子节点的世界坐标可比较，直接返回 `parent.children.length`（追加末尾）。
- 否则取 `graph.nodes.get(parentId).children`，按数组顺序依次用 `layout.nodes.get(childId)` 取每个兄弟的世界包围盒，计算交叉轴（`direction === 'vertical'` 时交叉轴是 `x`，否则交叉轴是 `y`，与 `layout.js` 的主轴/交叉轴映射一致）中心；从前往后找第一个交叉轴中心大于 `worldPoint` 对应坐标的兄弟，返回其下标（插在它前面）；如果都不大于，返回 `children.length`。
- 子节点为空数组时返回 `0`。

### `src/minimap/Minimap.vue`

**Props（本切片范围）**

- `graph`：图数据（`{ version, nodes: Map, rootIds, edges }`），必填。组件就地修改其 `nodes`/`children`（沿用 `graph.js` 的 `reorderGroupChild` 既有模式），不复制新对象。
- `resources`：`[{ category: string, items: [{ id, label, kind? }] }]`，默认 `[]`。
- `layoutDirection`：`'horizontal' | 'vertical'`，默认 `'horizontal'`。变化时瞬时重新 `computeLayout` 并重渲染，不做插值动画。
- `selectedIds`：受控可选，外部传入/`select` 事件参数统一用数组（本切片长度只会是 0 或 1）；组件内部转换成 `Set` 再传给 `renderScene` 的 `scene.state.selectedIds`（与渲染器既有契约 `Set<string>` 一致）。不传时组件内部维护非受控状态。
- `theme`：可选，覆盖 `defaultTheme` 的部分字段，直接传给 `renderScene`。

**Emits**

- `change`：内部图数据被拖入修改后触发，参数是同一个（被就地修改的）`graph` 引用。
- `select`：选中变化（点击命中节点/分组框，或点击空白清空）时触发，参数是新的选中数组（本切片长度 0 或 1）。
- `node-drop`：资源拖入落图完成后触发，参数 `{ resource, parentId, index }`。

**渲染触发时机（按需调用 `computeLayout` + `renderScene`，无 rAF 循环）**

1. `onMounted` 首次挂载。
2. `ResizeObserver` 回调（容器尺寸变化）。
3. `layoutDirection` prop 变化。
4. 内部拖入修改 `graph` 之后（手动调用，不依赖 Vue 响应式监听 `graph`，因为 `graph.nodes` 是 `Map`，Vue 2.7 的响应式系统不追踪 Map 内部的增删变更）。
5. 选中状态变化（点击命中或清空）之后。

**DPR 与 resize 处理**

- `ResizeObserver` 监听画布容器；回调里读容器 CSS 尺寸与 `window.devicePixelRatio`（缺省按 1 处理，兼容 jsdom 测试环境），设置 `canvas.width/height` 为物理像素尺寸，`canvas.style.width/height` 保持 CSS 尺寸不变。
- 用 `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` 而不是 `ctx.scale(dpr, dpr)`，避免每次 resize 后缩放重复叠加。
- `renderScene` 的 `scene.width/height` 始终传 CSS 逻辑像素尺寸（与 `setTransform` 配合，绘制坐标不用关心 DPR）。

**点击选中**

- 画布容器监听 `pointerdown`；用事件的容器内相对坐标 → `screenToWorld(point, viewport)` 转世界坐标 → `hitTest(layout, point)`。
- 命中节点或分组框：替换式单选，更新（受控/非受控对应处理）`selectedIds` 并 `emit('select', [...])`，把新的选中集合放进 `renderScene` 的 `scene.state.selectedIds` 触发重渲染——选中描边复用渲染器已有的 `theme.node.selectedStroke`，不新增绘制逻辑。
- 点击空白（`hitTest` 返回 `null`）：清空选中，`emit('select', [])`。
- 本切片视口固定为内部默认值 `{ x: 0, y: 0, scale: 1 }`，不受控、不提供修改入口（平移缩放是第三阶段）。

**资源拖入落图**

- `ResourceTree.vue` 渲染 `resources` 的分类（不可拖）与叶子项（`draggable="true"`）；叶子项 `dragstart` 把该资源项原样（`{ id, label }`，若有 `kind` 也带上）序列化进 `event.dataTransfer`。
- 画布容器监听 `dragover`（`preventDefault()` 以允许放）与 `drop`：
  1. 从 `dataTransfer` 解析出资源 payload。
  2. 用容器内相对坐标 → `screenToWorld` 得到世界坐标 `point`。
  3. `parentId` = 当前选中集合的第一个元素，为空则 `graph.rootIds[0]`。
  4. `index` = `findInsertionIndex(graph, layout, parentId, point, layoutDirection)`。
  5. 生成新节点 id（如 `` `res-${resource.id}-${Date.now()}` ``，避免同一资源多次拖入冲突），构造节点对象 `{ id, label: resource.label, parentId, children: [] }`，`nodes.set(id, node)`；`parent.children.splice(index, 0, id)`。
  6. 手动重渲染；`emit('node-drop', { resource, parentId, index })`；`emit('change', graph)`。

### `src/minimap/ResourceTree.vue`

- Props：`resources`（同上结构）。
- Emits：无业务事件，拖拽信息直接走原生 `dataTransfer`，由 `Minimap.vue` 的 `drop` 处理器读取（避免引入额外的拖拽状态同步）。
- 纯展示 + 原生拖拽属性，不持有选中/图数据状态。

## 验收标准

对应 [ROADMAP.md](../../../ROADMAP.md) 第一阶段验收中与本切片相关的部分：

- 示例图能正确显示在真实 Canvas 上（不是 mock ctx）；容器 resize 后 Canvas 尺寸与内容同步，高清屏（DPR）下不模糊。
- 从资源树拖入后 `graph.nodes` 增加节点，新增节点的 `parentId` 符合"挂选中节点/无选中挂根"规则，插入位置符合 `findInsertionIndex` 规则。
- 点击节点/分组框后该项呈现选中描边；点击空白后选中清空。
- `layoutDirection` 切换后画布按新方向重新布局并重绘（瞬时，无需动画）。
- 销毁组件（unmount）后 `ResizeObserver` 被断开，不残留监听。

## 测试清单

- `hitTest`：命中节点、命中分组框、未命中返回 `null`。
- `findInsertionIndex`：未折叠时按交叉轴位置返回正确下标（含插入最前/最后/中间三种情况）；已折叠时返回 `children.length`；空 `children` 返回 `0`。
- `Minimap.vue` 组件测试（`@vue/test-utils` mount + jsdom，stub `HTMLCanvasElement.prototype.getContext` 返回 `test/helpers/mock-ctx.js`）：
  - 挂载后 mock ctx 收到绘制调用（复用渲染器测试的断言方式，不做像素断言）。
  - 模拟 `drop` 后 `graph.nodes.size` 增加，`node-drop` 与 `change` 被 emit，新节点 `parentId`/位置符合预期。
  - 模拟 `pointerdown` 命中节点后 `select` 被 emit，且重渲染时 `renderScene` 收到的 `state.selectedIds` 包含该节点；再次点击空白后 `select` emit 空集合。
  - `layoutDirection` prop 变化后触发新一轮 `computeLayout` + `renderScene`。
  - unmount 后 `ResizeObserver.disconnect` 被调用（可 spy 全局 `ResizeObserver`）。
- 既有测试（`graph`/`layout`/`coords`/`renderer`）保持全绿，不回归。
- `npm test` 与 `npm run build` 均通过。

## 风险与取舍

- `@vue/test-utils` 选型需要 Vue 2 兼容的版本（不是面向 Vue 3 的 v2 系列包），实现阶段安装时需确认 `peerDependencies` 对齐 `vue@2.7.16`。
- jsdom 默认不提供 `ResizeObserver` 和真正的 Canvas 2D 实现，组件测试需要分别 stub/polyfill；这部分实现细节在 plan 阶段细化，不影响本 spec 的契约。
- `findInsertionIndex` 在父节点已折叠成分组框时只能退化为追加末尾，是因为 Phase 1 的分组框还没有逐个子节点的世界坐标（分组内部虚拟绘制是第二阶段）；这是已知的精度上限，不是 bug。
