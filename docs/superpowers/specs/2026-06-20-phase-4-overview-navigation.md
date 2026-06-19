# Phase 4 Overview 小地图导航 Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第四阶段：导航和查找能力。
> 第四阶段拆成 3 个切片：[视图定位方法](2026-06-20-phase-4-view-positioning.md) → [搜索节点](2026-06-20-phase-4-search-nodes.md) → **Overview 小地图导航**（本 spec）。本 spec 覆盖第三个切片：右下角显示全局缩略图和当前主视口框，点击/拖动缩略图快速移动主画布视口。
> 依赖 [视图定位方法 spec](2026-06-20-phase-4-view-positioning.md) 的 `centerViewportOn`（不引入新的视口跳转逻辑，复用它）。跟搜索节点切片相互独立，不依赖它。

## 头脑风暴决策记录

- **拖拽导航交互模式**：点击缩略图任意位置即让主视口跳转到那，按住不放则连续跟随拖拽（类似 Figma/VSCode 的 minimap）。不要求用户必须先精确抓住代表当前视口的那个矩形框才能拖动——抓哪都一样，区别只在于"按下瞬间"和"按住后移动"在实现上是同一套逻辑（`pointerdown` 立即导航一次，`pointermove` 期间持续导航），不需要为"点击"和"拖拽"分别写两套判断逻辑。
- **缩略图内容画法**：纯色块矩形，复用 `layout.visibleItems`（已有的布局计算结果），不画文字、不画连线、不调用 `nodeRenderer`/`groupRenderer`/`edgeRenderer` 自定义绘制器。原因：`layout.js` 的自动分组已经把超过 `GROUP_THRESHOLD`（默认 5）个连续叶子兄弟节点折叠成一个分组框，所以哪怕是 10000 节点压力图（`createStressGraph`，全部子节点折叠成一个分组），`visibleItems` 的数量也只有个位数到几十个，跟总节点数无关——缩略图重绘的成本天然是 O(可见项数)，不是 O(总节点数)，不需要额外的离屏缓存优化。同时缩略图尺寸下，文字/连线细节本来就看不清，画了也是视觉噪音。
- **整体架构（方式 A，已确认；拒绝方式 B/C 的理由见下）**：
  - 新建独立子组件 `Overview.vue`，不是像搜索框那样直接内嵌进 `Minimap.vue` 的模板——这是 ROADMAP 里早就定好的方向（"overview 是独立 mini canvas 子组件，跟前两个切片的视口数学性质不同，拆开做"）。
  - **渲染方式是命令式的，不是响应式 props 驱动**：`Overview.vue` 通过 `defineExpose` 暴露一个 `render({ layout, viewport, mainWidth, mainHeight, theme })` 方法，`Minimap.vue` 在自己已有的 `renderCurrent()` 函数末尾调用它。`Overview.vue` 不声明任何 `props`，所有绘制所需的数据都作为 `render()` 的参数实时传入。
    - 拒绝"让 `Overview.vue` 当一个标准响应式 Vue 子组件，自己 `watch` props 重绘"的方式（方式 C）：这要求把 `Minimap.vue` 里现有的 `layout`/`cssWidth`/`cssHeight` 这些模块级 `let` 状态（专门为了避开 Vue 响应式开销、只服务于命令式 Canvas 重绘而设计）改造成响应式 `ref`，才能当 prop 传给子组件。这个改造会牵动整个主渲染管线的核心状态，跟项目从第一阶段就坚持的"画布渲染路径用模块级 `let`，从不挂 Vue 响应式"的既有原则相悖，为了一个子组件的"优雅"去冒这个风险不值得。
    - 拒绝"直接复用 `renderScene` 画缩略图，只是换一个小 viewport"（方式 B）：每次重绘都会多跑一遍 `resolveEdges` 和逐节点绘制逻辑，10000 节点压力图下每次主视口平移/缩放都多一份开销；且缩略图尺寸下节点细节本来就看不清，复用完整绘制器没有实际视觉收益。
  - 反方向（缩略图点击/拖拽 → 主视口平移）走 Vue 标准的 `emit`：`Overview.vue` 自己监听 pointer 事件，转换坐标后 `emit('navigate', worldPoint)`；`Minimap.vue` 接到后复用已有的 `centerViewportOn` + `applyViewport`（自动遵守受控/非受控视口语义，不重新实现）。这个 `navigate` 事件是 `Overview.vue` 与 `Minimap.vue` 之间的内部协作事件，不出现在 `Minimap.vue` 对外的公开 `events` 契约里——外部能感知到的只是平移结果触发的既有 `viewport-change`，跟搜索框内部的原生 DOM 事件不对外暴露是同一个道理。
- **`computeOverviewViewport` 不夹限缩放范围**：缩略图的定位是"必须完整显示全部内容"，跟主视口"限制用户能缩放到多远/多近"是完全不同的目的。如果直接复用 `fitViewportToBounds(bounds, width, height, props.options, padding)`（用主视口的 `options.minScale`/`maxScale`），遇到内容范围远大于缩略图画布尺寸的情况（比如 10000 节点压力图），算出来需要的缩放比例可能远小于主视口允许的 `minScale`（默认 0.25），夹限之后缩略图就显示不全了，违背了"缩略图=全局视图"的本意。所以 `computeOverviewViewport` 内部调用 `fitViewportToBounds` 时显式传 `{ minScale: 0, maxScale: Infinity }`，让缩放不受主视口的缩放范围限制。
- **缩略图固定尺寸 200×140px，不做可配置项**：跟搜索框输入框固定 140px 宽是同一思路（YAGNI），后续如果真的需要可配置尺寸再加 `options.overview*`。位置固定在画布容器右下角，跟搜索框（右上角）对角分布，不会视觉冲突。
- **视口框超出缩略图画布范围时做视觉裁剪**：用户把主视口缩得比全图内容范围还大时，理论算出的视口框矩形可能比缩略图画布本身还大。这种情况下画框前裁剪到缩略图画布边界内再画，避免画出明显跑出边界的线条——这只是绘制时的视觉裁剪，不影响 `mainViewportFrameRect` 函数本身的数学结果（数学上仍然返回真实坐标，裁剪只发生在 `Overview.vue` 的绘制环节）。
- **不画选中态高亮**：ROADMAP 对这个切片的验收标准只要求"全局缩略图 + 当前视口框 + 点击/拖动后主画布视口同步变化"，没有要求展示选中节点的高亮状态，这次不做（YAGNI，后续如果有需求再加）。
- **退化情况复用现有逻辑，不新写特判**：图为空或只有一个节点时 `bounds` 退化，`fitViewportToBounds` 已经有处理（回退到 `DEFAULT_VIEWPORT`），`computeOverviewViewport` 直接继承这个行为，不需要额外的空图特判。

## 范围

### 目标（本切片交付）

- 新建 `src/minimap/overview.js`（纯函数，不依赖 Vue/DOM）：
  - `computeOverviewViewport(bounds, width, height, padding = 20)`：包一层 `fitViewportToBounds`，不夹限缩放范围。
  - `mainViewportFrameRect(mainViewport, mainWidth, mainHeight, overviewViewport)`：算出主视口当前可见范围，对应到缩略图坐标系下的屏幕矩形。
- 新建 `src/minimap/Overview.vue`：
  - 固定尺寸 200×140px 的独立 `<canvas>` 子组件，挂载时按固定尺寸 × DPR 设置一次（不需要 `ResizeObserver`，尺寸由 CSS 固定，不随容器变化）。
  - 不声明 `props`；通过 `defineExpose` 暴露 `render({ layout, viewport, mainWidth, mainHeight, theme })`。
  - 监听 `pointerdown`/`pointermove`/`pointerup`，转换坐标后 `emit('navigate', { x, y })`（世界坐标点）；`pointerdown` 时调用 `setPointerCapture`，跟主画布现有拖拽手势写法一致。
- 修改 `src/minimap/Minimap.vue`：
  - `renderCurrent()` 末尾追加调用 `overviewRef.value?.render(...)`。
  - 新增 `handleOverviewNavigate(worldPoint)`：复用 `centerViewportOn` + `applyViewport`（不经过 `runViewportTween`，跟空白拖拽平移逻辑一致，连续跟随手势不需要补间动画）。
  - 模板新增 `<Overview v-if="options?.enableOverview !== false" ref="overviewRef" @navigate="handleOverviewNavigate" />`，定位画布容器右下角。
  - 样式新增 `.minimap-overview` 容器定位（`position: absolute; bottom: 8px; right: 8px`）。
- 测试：新建 `test/minimap-overview.test.js`（`overview.js` 纯函数用例）；新建 `test/minimap-overview-ui.test.js`（`Overview.vue` 组件级用例，含绘制断言、pointer 手势、`enableOverview` 开关）；扩展现有 `Minimap.vue` 测试覆盖 `navigate` 事件联动主视口（含受控 `viewport` 模式）。`npm test`、`npm run build` 通过。
- `ROADMAP.md` 收尾更新：勾选第四阶段切片 3，第四阶段整体勾选完成（三个切片全部完成），「当前进度」块指向第五阶段待规划。

### 非目标（后续阶段或本切片不做）

- 缩略图内选中态高予——本切片不做（见头脑风暴决策记录）。
- 缩略图尺寸/位置可配置——固定常量，YAGNI。
- 缩略图自身的缩放/平移——缩略图永远是"全图自动 fit"，没有独立于主视口之外的缩放/平移状态。
- 缩略图内容的自定义绘制器（`nodeRenderer`/`groupRenderer`/`edgeRenderer` 复用）——固定画纯色矩形，不接入自定义绘制。
- 第五阶段的可访问性（aria 状态区域等）——跟搜索框一样延后到第五阶段统一处理。

## 模块 API 契约

### `src/minimap/overview.js`

```js
// 缩略图自己的"完整显示全部内容"视口变换，不受主视口 minScale/maxScale 限制。
// bounds 退化时（空图/单节点）继承 fitViewportToBounds 的回退行为（DEFAULT_VIEWPORT）。
export function computeOverviewViewport(bounds, width, height, padding = 20) {
  /* { x, y, scale } */
}

// 把主视口当前可见的世界坐标范围，转换成缩略图坐标系下的屏幕矩形（用于画视口框）。
export function mainViewportFrameRect(mainViewport, mainWidth, mainHeight, overviewViewport) {
  /* { x, y, width, height } */
}
```

### `src/minimap/Overview.vue`

```js
// 无 props。绘制所需数据全部通过 render() 参数实时传入。
defineExpose({
  render({ layout, viewport, mainWidth, mainHeight, theme }) {
    /* 清空画布 → 按 layout.visibleItems 画纯色矩形 → 画主视口框 */
  },
})

// 'navigate'：pointerdown 时立即触发一次，pointermove 期间（pointer capture 中）持续触发。
// payload 是世界坐标点 { x, y }。
defineEmits(['navigate'])
```

### `src/minimap/Minimap.vue` 改动

- `renderCurrent()` 末尾新增对 `overviewRef.value?.render(...)` 的调用，不新增 `defineExpose` 方法（这个切片不需要新的公开可编程方法，跟搜索切片不同）。
- 新增内部函数 `handleOverviewNavigate(worldPoint)`，复用 `centerViewportOn(worldPoint, currentViewport(), cssWidth, cssHeight)` 算出新视口，再走 `applyViewport(next)`。
- 不新增对外 `events`（`navigate` 是 `Overview.vue`/`Minimap.vue` 内部协作事件，对外仍然只看到 `viewport-change`）。

### `options.enableOverview`

- 默认 `true`。设为 `false` 时不渲染 `<Overview>` 组件（不挂载，不创建第二个 canvas、不监听 pointer 事件）。

## 验收标准

- 缩略图正确显示全局内容范围和当前主视口框；缩放或平移主视口后，视口框位置/大小同步更新。
- 点击缩略图任意位置，主视口平移使该点成为新的视口中心（缩放比例不变）；按住拖拽时主视口持续跟随指针移动。
- 10000 节点压力图下，缩略图绘制的图元数量等于 `layout.visibleItems.length`（不是节点总数），不因为节点数量级增加而变慢。
- `options.enableOverview: false` 时缩略图 DOM 不存在（不创建第二个 canvas）。
- 受控 `viewport` 非 `null` 时，缩略图点击/拖拽只 `emit('viewport-change', ...)`，不直接改变组件内部视口状态（复用 `applyViewport` 已有的受控语义）。
- `npm test`、`npm run build` 通过。

## 测试清单

- `overview.js`：
  - `computeOverviewViewport`：构造一个明显需要 scale < 0.25 才能完整放进缩略图画布的超大 `bounds`，断言算出的 scale 确实小于 0.25（证明走的是无夹限路径）；正常 `bounds` 下结果跟手算一致；退化 `bounds`（如 `minX`/`maxX` 为 `NaN`）回退到 `DEFAULT_VIEWPORT`。
  - `mainViewportFrameRect`：给定已知的 `mainViewport`/`mainWidth`/`mainHeight`/`overviewViewport`，断言算出的屏幕矩形跟手算坐标一致。
- `Overview.vue`：
  - 调用 `render(...)` 后，mock ctx 上有等于 `layout.visibleItems.length` 次的 `fillRect` 调用，加上代表视口框的一次 `strokeRect`（或 `stroke`）调用。
  - 模拟 `pointerdown`，断言 `emit('navigate', worldPoint)` 触发且世界坐标数值正确，且调用了 `setPointerCapture`。
  - 模拟 `pointerdown` 后接 `pointermove`，断言再次 `emit('navigate', ...)`，且坐标随指针位置变化。
  - 模拟 `pointerup` 后再次 `pointermove`，断言不再触发 `navigate`（capture 已释放）。
  - `options.enableOverview: false` 时 `.minimap-overview` 容器不存在；省略或显式 `true` 时存在。
- `Minimap.vue` 集成：
  - 模拟 `Overview` 组件 emit 的 `navigate` 事件，断言主视口正确平移（`getViewport()` 与手算的 `centerViewportOn` 结果一致），`viewport-change` 正确触发。
  - 受控 `viewport` 模式下，`navigate` 触发后只 `emit('viewport-change', ...)`，`getViewport()` 仍返回受控传入的原值不变（跟切片 1/2 已有的受控测试套路一致）。
  - `renderCurrent()` 触发的链路（平移/缩放/布局变化）都会让 `Overview` 的 `render()` 被调用到最新的 `layout`/`viewport`/尺寸（可以通过给子组件 mock/spy 一个 `render` 方法来验证调用参数）。
- 回归：现有测试套件保持通过；新增的 `Overview.vue` 不影响主画布命中检测、拖拽、动画等既有交互路径。
