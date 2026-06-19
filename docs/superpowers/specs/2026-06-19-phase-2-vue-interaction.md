# Phase 2 Vue 交互 Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第二阶段：分组框能力。
> 本 spec 覆盖第二阶段的**第三个切片：Vue 交互**（命中检测细分、滚轮滚动、框内拖拽换位、展开/折叠点击、`groupStates`/`options` props 接线），完成后第二阶段验收标准全部达成。
> 依赖 [分组逻辑 spec](2026-06-19-phase-2-group-logic.md) 的 `Group` 数据契约、`visibleGroupChildren`、`clampGroupScroll`、`GROUP` 网格常量；依赖 [Canvas 渲染器 spec](2026-06-19-phase-2-canvas-renderer.md) 的 `drawGroupChildren`、`renderScene`、多分组 `resolveEdges` 既有结构；依赖 [Phase 1 Vue 壳 spec](2026-06-18-phase-1-vue-shell.md) 的 `hitTest`/`findInsertionIndex`/`selectedIds` 受控模式既有约定。

## 头脑风暴决策记录

- **点击语义**：分组框内部按命中区域区分三种操作——点击 header（含 ▾/▸ 图标整行）只切换 `expanded`，不触发 `select`；点击具体子节点格子选中该子节点本身（跟点击普通节点行为一致）；点击分组框内空白区域（padding、滚动条、网格空位）选中分组本身（`group.id`）。这跟"点击即选中点击到的最具体对象"的现有语义保持一致。
- **拖拽视觉反馈**：选择了更完整的看板式体验——拖拽过程中实时显示插入位置（让其余子节点按虚拟顺序"让位"，空出的格子高亮成"空位提示"），被拖动的子节点本身跟随鼠标绘制（ghost，半透明）。实现上完全复用已有的 `visibleGroupChildren`：把"虚拟顺序"（被拖项从原位置摘出、插入到当前插入下标）伪装成一个临时 `{ ...group, children: virtualOrder }` 对象传给它，其余节点自动按新顺序占位，**不需要改动 `layout.js`**。
- **自动滚动**：拖拽时指针靠近分组框上/下边缘（24px 热区）会自动滚动该分组，允许把子节点换位到当前不可见的位置。
- **架构选择**：几何计算（命中区域细分、组内插入下标、阈值判断、自动滚动速度、组内下标→`parent.children`绝对下标换算）做成 `interaction.js` 里不依赖 DOM 的纯函数；指针状态机本身（监听事件、`requestAnimationFrame` 驱动自动滚动、调用 `renderCurrent`/`updateLayout`）作为 `Minimap.vue` 内部模块级变量管理，跟现有 `viewport`/`layout`/`activeTransition` 的写法一致，不新增模块文件。
- **`groupStates` prop 形状**：用 JSON 友好的普通对象 `{ [groupId]: { expanded, scrollTop } }`，不是 `Map`。`computeLayout` 已经约定内部用 `Map`，在 `Minimap.vue` 调用前转换（`new Map(Object.entries(...))`），不改 `layout.js` 的既有契约。
- **拖拽中不连续广播状态**：自动滚动的 `scrollTop` 变化在拖拽过程中只直接 mutate `group.scrollTop` 用于即时视觉反馈，不在每一帧都 `emit('group-state-change', ...)`；只在 `pointerup` 落地时广播一次最终值，避免受控模式的外部监听者被每帧事件刷屏。滚轮滚动（独立的离散事件，不是逐帧）则每次都正常广播。
- **修复一个连带的旧 bug**：`renderer.js` 的 `renderScene` 第 370 行 `makeState(item.parentId, selectedIds)` 是按 `parentId` 判断分组chrome是否高亮选中——这是切片 2 遗留的、跟本切片要修的"分组选中身份"同一类问题。本切片把分组选中语义统一成 `group.id`（hitTest body 区域返回 `group.id`），所以这一行必须同步改成 `makeState(item.id, selectedIds)`，否则点击分组空白区域选中后分组框本身不会显示选中态描边。
- **不支持跨分组拖拽**：`groupGridIndexAt` 对超出分组矩形范围的点也会做 clamp（不报错，自然收敛到最近的边界格子），所以即使指针拖到了分组外部（另一个分组、普通节点、空白画布），插入下标仍然落在原分组的合法范围内——天然保证"只能在同一个分组框内换位"，不需要额外的越界检测代码。
- **已知行为边界：分组内叶子节点被拖入新子节点后会自动从分组里分裂出去**。这条路径在本切片之前不可达——之前点击分组永远选中整个分组（旧的 `parentId` 语义），拖资源时 `parentId` 只会是分组的父节点；本切片新增的"点击分组内某个子节点选中该子节点本身"打开了这条路径：先选中分组内的某个叶子子节点，再拖资源丢进画布，`handleDrop` 的 `parentId` 就会等于这个叶子子节点的 id。`layout.js` 的 `collectGroupSegments` 在每次 `updateLayout()` 时都会重新按"当前是否叶子"分段，所以分裂后的布局结果本身一定正确（截断成两段、分别按 `groupThreshold` 判断是否还成组），不需要新代码。唯一的已知限制是 `group.id = ${parentId}::g${segmentIndex}` 按位置而非内容编号——分裂后新的某个分段哪怕成员完全变了也可能复用旧的 `group.id`，导致 `groupStates` 里该 id 下的 `scrollTop`/`expanded` 被"捡"给一个成员不同的新分组（`clampGroupScroll` 会夹紧到合法范围，不会崩，最多是滚动位置在分裂瞬间跳一下）。本切片不做"跨重新布局的稳定分组身份追踪"（按内容重叠匹配迁移状态），只在测试里确认分裂后布局、选中态都正确，滚动位置的轻微跳变是可接受的已知行为。

## 范围

### 目标（本切片交付，完成后第二阶段验收全部达成）

- `src/minimap/interaction.js`：
  - `hitTest`：分组命中细分为 `zone: 'header' | 'item' | 'body'`（`item` 额外带 `childId`）。
  - `findInsertionIndex`：修复多分组场景下退化成"永远追加到末尾"的 bug。
  - 新增纯函数：`groupGridIndexAt`、`exceedsDragThreshold`、`groupAutoScrollSpeed`、`groupInsertIndexToParentIndex`。
- `src/minimap/renderer.js`：
  - `drawGroupChildren` 新增可选末尾参数 `dragContext`，支持画"让位后的虚拟顺序 + 空位提示 + ghost"。
  - `renderScene` 把 `state.groupDrag` 路由给对应 group 的 `drawGroupChildren` 调用；修复第 370 行 `makeState(item.parentId, ...)` → `makeState(item.id, ...)`。
- `src/minimap/theme.js`：`group` 主题新增 `dropSlot: { fill, stroke }`。
- `src/minimap/Minimap.vue`：
  - 新增 props `groupStates`（默认 `null`，受控/非受控同 `selectedIds`）、`options`（默认 `null`，目前只读 `options.groupThreshold`）。
  - 新增事件 `group-state-change`、`group-reorder`。
  - 完整指针状态机：`pointerdown`/`pointermove`/`pointerup` 实现展开折叠点击、子节点选中、框内拖拽换位（含自动滚动）。
  - 新增 `wheel` 监听，实现分组框内部滚动。
- 测试：`test/minimap-interaction.test.js`、`test/minimap-renderer.test.js` 新增/更新用例；新建 `test/minimap-group-interaction.test.js` 覆盖 `Minimap.vue` 层面的点击/拖拽/滚轮/`groupStates`/`options` 行为。`npm test`、`npm run build` 通过。

### 非目标（后续阶段）

- 跨分组或跨父节点的拖拽（"框内换位"明确限定在同一个分组框内部）。
- 直接拖动滚动条滑块本身（本切片只做滚轮滚动；滑块本身仍是纯视觉，不响应指针事件）。
- 画布平移、缩放（第三阶段）；分组框外的滚轮事件本切片不处理，留给第三阶段的缩放。
- `beforeGroupReorder` 等编辑拦截 hook、撤销/重做（第五阶段）。
- `viewport` 受控 prop、`options` 里除 `groupThreshold` 外的其它字段（缩放范围、动画时长等，等对应能力实现时再加）。

## 模块 API 契约

### `src/minimap/interaction.js`

```js
// 命中检测：node 不变；group 细分为 header / item / body 三种 zone。
// header: { type:'group', id: group.id, zone:'header' }
// item:   { type:'group', id: group.id, zone:'item', childId }
// body:   { type:'group', id: group.id, zone:'body' }
export function hitTest(layout, point) { /* ... */ }

// 修复：先判断 point 是否落在该 parentId 下某个具体分组的矩形范围内——
// 若是，插入到该分组对应 segment 在 children 里的末尾之后；
// 否则按未折叠子节点 rect 中线逐个比较，跳过已被任意分组消费的子节点。
export function findInsertionIndex(graph, layout, parentId, point, direction) { /* ... */ }

// 世界坐标点 -> 分组网格里的插入下标（0..group.children.length）。
// 不要求该下标当前真的有子节点；col 用 Math.round 而非 Math.floor，
// 靠近格子左右半边时四舍五入到更近的插入缝；超出分组矩形范围的点会被 clamp
// 到最近的合法行/列，天然限制"只能在同一分组框内换位"。
export function groupGridIndexAt(group, point) { /* ... */ }

// 阈值判断用屏幕像素坐标（不是世界坐标），保证以后第三阶段加入缩放后
// 阈值含义不变（像素距离，不受 viewport.scale 影响）。
export function exceedsDragThreshold(startScreenPoint, currentScreenPoint, thresholdPx = 4) { /* ... */ }

// 指针（世界坐标 y）靠近分组框上/下边缘 edgeZone(默认24px) 范围内时，
// 返回这一帧应叠加到 scrollTop 上的增量，越靠边缘越接近 maxSpeed(默认8px/帧)；
// 不可滚动（!overflowY）或不在热区时返回 0。
export function groupAutoScrollSpeed(group, pointerWorldY, edgeZone = 24, maxSpeed = 8) { /* ... */ }

// 把组内（相对于"去掉被拖项后的 group.children"）插入下标换算成
// parent.children 的绝对下标，供 graph.js 的 reorderGroupChild 使用。
// 分组永远是 parent.children 里的一段连续区间：在"去掉被拖项后的
// parent.children"里找这段区间的起始位置，加上组内插入下标。
export function groupInsertIndexToParentIndex(parent, group, draggingChildId, insertIndexInRest) { /* ... */ }
```

### `src/minimap/renderer.js`

```js
// 新增可选末尾参数 dragContext = { order, draggingChildId, ghostRect } | undefined。
// - order: 跟 group.children 等长的虚拟顺序（被拖项已挪到目标插入下标）。
// - draggingChildId: 虚拟顺序里这个 id 对应的格子不画真实节点，改画"空位提示"
//   （ctx.fillRect + 虚线 ctx.strokeRect，颜色取 theme.group.dropSlot）。
// - ghostRect: 屏幕坐标矩形，循环结束后单独在这里把被拖节点本身再画一次
//   （ctx.globalAlpha = 0.85，state.dragging = true）。
// 不传 dragContext 时行为跟切片 2 完全一致（virtualGroup = group 本身）。
function drawGroupChildren(ctx, graph, group, rect, viewport, theme, renderers, selectedIds, dragContext) { /* ... */ }

// renderScene 改动两处：
// 1. drawGroupChildren 调用追加第 9 个参数：
//    state.groupDrag && state.groupDrag.groupId === group.id ? state.groupDrag : undefined
// 2. 第 370 行 makeState(item.parentId, selectedIds) 改成 makeState(item.id, selectedIds)
//    （分组选中身份统一成 group.id，跟新 hitTest body zone 返回值一致）。
export function renderScene(ctx, scene) { /* ... */ }
```

### `src/minimap/theme.js`

```js
group: {
  fill: '#16202b',
  stroke: '#3a4f66',
  header: '#9fb6cc',
  font: '12px sans-serif',
  scrollbar: { track: '#10161d', thumb: '#4a6280' },
  dropSlot: { fill: '#24344a', stroke: '#6f93b8' }, // 新增；拖拽悬停时的空位提示
},
```

### `src/minimap/Minimap.vue`

```js
const props = defineProps({
  // ...既有 props 不变
  groupStates: { type: Object, default: null },
  options: { type: Object, default: null },
})
const emit = defineEmits(['select', 'node-drop', 'change', 'group-state-change', 'group-reorder'])
```

- `currentGroupStates()` / `updateGroupState(groupId, patch)`：镜像 `currentSelectedIds()`/`setSelected()` 的受控判断（`props.groupStates !== null` 时只读 + `emit('group-state-change', next)`；否则写内部 `internalGroupStates` 普通对象）。
- `updateLayout()` 调 `computeLayout` 新增传入 `groupThreshold: props.options?.groupThreshold`、`groupStates: new Map(Object.entries(currentGroupStates()))`。
- 模块级状态新增 `let internalGroupStates = {}`、`let dragState = null`（结构：`{ groupId, childId, startScreen, dragging, insertIndex, ghostWorldPoint, ghostScreenRect, scrollRafId }`）。
- `pointerdown`：`hitTest` 命中 `zone:'header'` → 切换 `expanded`（`updateGroupState` + `updateLayout()`），不 select；命中 `zone:'item'` → 只记录 `dragState` 候选（调用 `canvasRef.value.setPointerCapture?.(event.pointerId)`），**不立即 select**，等 `pointerup` 判断是否真的发生了拖拽；命中 `zone:'body'`、普通节点或空白处 → 维持现有 `setSelected` 行为不变（立即触发）。
- `pointermove`：候选存在且未超过 `exceedsDragThreshold`（屏幕像素）→ 不动；超过 → 转入 `dragging`，启动 `requestAnimationFrame` 自动滚动循环；已在 `dragging` → 用 `groupGridIndexAt` 重算 `insertIndex`，更新 `ghostScreenRect`（以世界坐标点为中心，按 `GROUP.itemW`/`GROUP.itemH` 取一个世界矩形，`worldRectToScreen` 转换），`renderCurrent()`。
- `pointerup`：非 `dragging`（普通点击未超阈值）→ `setSelected([childId])`；`dragging` → 取消自动滚动 raf，用 `groupInsertIndexToParentIndex` 换算绝对下标，调用 `reorderGroupChild(props.graph, group.parentId, childId, index)`、`updateGroupState(group.id, { scrollTop: group.scrollTop })`、`updateLayout()`，`emit('group-reorder', { groupId, childId, index })` + `emit('change', props.graph)`；清空 `dragState`。
- 自动滚动 raf tick：每帧用 `groupAutoScrollSpeed` 算增量，非 0 时 `group.scrollTop = clampGroupScroll(group, group.scrollTop + delta)` 并 `renderCurrent()`（不广播事件，见决策记录）。
- `wheel` 监听（`{ passive: false }`）：`hitTest` 落在某个 `overflowY` 分组上才 `event.preventDefault()`，`clampGroupScroll` 夹紧后 mutate `scrollTop`、`updateGroupState`、`renderCurrent()`；否则不处理（不 `preventDefault`，留给以后画布缩放）。
- `renderCurrent()` 的 `state` 新增字段 `groupDrag`：`dragState?.dragging` 为真时算出 `{ groupId, order, draggingChildId, ghostRect }`（`order` = `group.children` 去掉 `childId` 后在 `insertIndex` 处插回）传给 `renderScene`；否则为 `null`。

## 验收标准

- 点击分组 header 整行切换 `expanded`，触发 `updateLayout()` 的动画过渡，不触发 `select` 事件。
- 点击分组框内某个子节点格子（未发生拖拽）选中该子节点 id，跟点击普通节点视觉/事件行为一致。
- 点击分组框内空白区域（padding/滚动条/网格空位）选中分组本身（`group.id`），分组框 chrome 显示选中态描边。
- 鼠标滚轮悬停在 `overflowY` 为真的分组上滚动：可见子节点窗口随 `scrollTop` 变化，不触发 `updateLayout`（即 `layout` 对象引用不变）；分组框外或不可滚动分组上的滚轮事件不被处理。
- 拖拽分组内某个子节点超过 4px 屏幕像素阈值后进入换位模式：其余子节点按虚拟顺序让位，空出的格子显示"空位提示"，被拖节点本身半透明跟随鼠标；松手后 `graph` 里 `parent.children` 的真实顺序发生变化（不仅是视觉位置），`emit('group-reorder', ...)` 和 `emit('change', ...)`。
- 拖拽中指针靠近分组框上/下边缘时自动滚动，可以把子节点换位到拖拽开始时不可见的位置。
- 未超过阈值的纯点击（在 `item` zone 按下又抬起，没有明显移动）只触发 `select`，不触发任何换位。
- `groupStates`/`options` 的受控/非受控模式行为跟现有 `selectedIds` 等价：传 prop 时组件不内部持久化，只发事件；不传时组件内部维护默认状态并在下次渲染保持。
- 多分组场景下（一个父节点有两个独立分组段）`hitTest`/`findInsertionIndex` 都按具体的 `group.id`/分组矩形定位，不再退化或取错对象。
- 选中分组内某个叶子子节点后拖入资源：该子节点正确获得新子节点、自动从分组里分裂出去（不再是分组成员），分裂后剩余/截断的两段分别按 `groupThreshold` 正确判断是否继续成组；选中态仍然指向该子节点本身，不丢失、不串位。
- 现有单分组场景（demo 图 `heap-1`/`cluster-25`、压力图）的点击选中、资源拖入行为不回归。
- `npm test`、`npm run build` 通过。

## 测试清单

- `test/minimap-interaction.test.js`：
  - 更新现有 `hitTest finds the group box for a folded parent` 用例为新的 `zone` 返回值（用实际 `group.id` 而不是 `parentId`）。
  - 新增 header/item/body 三种 zone 各自的命中用例。
  - 新增多分组场景（一个父节点两个分组段）下 `findInsertionIndex` 落在某个具体分组矩形内、落在两个分组之间间隙的用例。
  - `groupGridIndexAt`：左上角/右下角/超出分组矩形范围（验证 clamp）的边界用例。
  - `exceedsDragThreshold`：刚好等于阈值、明显超过、明显不足三种用例。
  - `groupAutoScrollSpeed`：上边缘热区、下边缘热区、`overflowY: false`、不在热区四种用例。
  - `groupInsertIndexToParentIndex`：被拖项是 segment 首项/尾项/中间项三种边界情况，验证换算出的绝对下标喂给 `reorderGroupChild` 后结果正确。
- `test/minimap-renderer.test.js`：
  - `drawGroupChildren` 传 `dragContext` 时：验证空位提示被画出（颜色匹配 `theme.group.dropSlot`）、ghost 节点在 `ghostRect` 位置被画出（`globalAlpha` 变化）、其余子节点按虚拟顺序让位。
  - 不传 `dragContext` 时行为跟切片 2 完全一致（回归）。
  - `renderScene` 第 370 行修复后的回归：选中 `group.id` 后分组 chrome 收到 `state.selected === true`。
- 新建 `test/minimap-group-interaction.test.js`（`Minimap.vue` 层面，复用 `minimap-select.test.js`/`minimap-shell.test.js` 的 `dispatchPointerDown` 风格 helper，新增 `dispatchPointerMove`/`dispatchPointerUp`/`dispatchWheel`）：
  - 点击 header 切换 `expanded` 且不 emit `select`。
  - 点击 item（无明显移动）emit `select` 为该子节点 id。
  - 点击 body emit `select` 为 `group.id`。
  - 在 item 上按下、移动超过阈值、抬手：`graph` 的 `children` 顺序改变，emit `group-reorder` 和 `change`。
  - 在 item 上按下但移动很小幅度后抬手：不触发换位，只触发 `select`。
  - 滚轮在 `overflowY` 分组内：可见子节点窗口变化，`emit('group-state-change', ...)` 携带新 `scrollTop`，但不触发 `updateLayout`（断言 `layout` 引用不变或用某个不受布局影响但受渲染影响的探针）。
  - `groupStates`/`options` 受控模式：传入后组件不内部持久化（跟 `selectedIds` 受控测试同构）。
  - 回归：现有单分组点击选中、资源拖入（`minimap-drop.test.js`）行为不变。
  - 选中分组内某个叶子子节点（如 `cluster-5`）→ 拖入资源丢给它：`graph.nodes.get('cluster-5').children` 增加新节点；下一次渲染里 `cluster-5` 不再属于任何 `layout.groups` 成员（已分裂出去）；分裂后两段（若仍超过 `groupThreshold`）各自成为独立的 `group.id`；`select` 状态仍指向 `cluster-5`。
