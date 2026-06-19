# Phase 3 View and Selection Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第三阶段：视图和选择能力。
> 本阶段拆成 3 个连续切片，避免新窗口或新 agent 丢失上下文。每个切片完成后必须更新本文件、ROADMAP、对应 plan，并写明 commit 范围和验证结果。

## 阶段状态

- [ ] 切片 1：视口平移缩放
- [ ] 切片 2：选择模型和高亮
- [ ] 切片 3：普通节点拖拽换位

当前下一步：为切片 1「视口平移缩放」写实施计划。

## 头脑风暴决策记录

- 第三阶段不再只做视图和选择，还包含用户明确要求提前实现的「普通节点拖拽换位」。
- 普通节点拖拽换位先限定为同一父节点下的普通可见兄弟节点排序；跨父节点移动、before hooks、撤销/重做放到第五阶段。
- 第三阶段拆成 3 个切片推进：先稳定 viewport，再做选择/高亮，最后做普通节点拖拽换位。原因是这三类能力共享 pointer/wheel 状态机，先把平移、缩放、框选边界定稳，普通节点拖拽更容易接入。
- 空白拖拽默认用于画布平移。框选需要明确进入框选语义：按住 `Shift` 从空白处拖拽，或后续工具栏提供框选模式时复用同一套状态机。本阶段先实现 `Shift` 空白拖拽框选。
- 分组框内部滚轮继续优先滚动分组；只有滚轮没有命中可滚动分组时，才触发画布缩放。
- 第二阶段已有的分组内部拖拽换位优先级高于第三阶段普通节点拖拽；命中分组 item 时继续走分组内换位，不触发画布平移、框选或普通节点换位。

## 总体范围

第三阶段交付后需要满足：

- `viewport` 支持受控和非受控模式，外部可通过 prop 控制视口，组件通过 `viewport-change` 通知变更。
- 用户可以拖动画布空白区域平移视口。
- 用户可以用鼠标滚轮或触控板缩放画布，缩放中心为鼠标位置，且受最小/最大缩放限制。
- 单击节点或分组框时只保留当前目标；使用 `Shift`、`Cmd` 或 `Ctrl` 点击可追加或取消选择。
- 使用 `Shift` 从空白区域拖出框选矩形时，矩形内可见节点被选中。
- 点击空白区域或按 `Esc` 清空选择。
- 选中节点后，高亮父级、子级和相关连线，其他元素降权。
- 同一父节点下的普通可见兄弟节点可以拖拽排序，排序结果写回 `parent.children`，触发 `node-move` 和 `change`。

## 非目标

- 不做跨父节点拖拽移动。
- 不做拖拽普通节点成为另一个节点子节点。
- 不做 fit to screen、center selection、search、overview；这些属于第四阶段。
- 不做删除、复制、只读模式、before hooks、撤销/重做；这些属于第五阶段。
- 不引入第三方渲染、拖拽或图布局库。

## 手势优先级

事件状态机按以下优先级判断：

1. 命中分组滚动条滑块：执行第二阶段已有的滚动条拖拽。
2. 命中分组 header：点击切换展开/折叠。
3. 命中分组 item：执行第二阶段已有的分组内部拖拽换位；未超过阈值时仍是点击选中该子节点。
4. 命中普通节点：点击执行单选/多选；拖拽超过阈值时进入切片 3 的普通节点兄弟排序。
5. 命中分组 body：点击选中分组；拖拽不做普通节点换位。
6. 命中空白区域并按住 `Shift`：拖拽进入框选。
7. 命中空白区域且没有框选修饰键：拖拽平移视口；未拖动时点击清空选择。
8. `wheel` 命中可滚动分组：滚动分组内容。
9. `wheel` 其他情况：缩放画布。

## 切片 1：视口平移缩放

### 目标

- 新增 `viewport` prop，支持 `{ x, y, scale }` 受控/非受控模式。
- 新增 `viewport-change` 事件。
- 新增 `options.minScale`、`options.maxScale`、`options.zoomSensitivity`，默认值分别为 `0.25`、`3`、`0.0015`。
- 空白区域 pointer drag 平移视口。
- wheel 缩放画布，以鼠标所在屏幕点为缩放中心。
- 缩放后鼠标下方世界坐标保持稳定。
- 分组框内部滚轮优先滚动分组，不能误触发画布缩放。

### API 契约

```js
const props = defineProps({
  viewport: { type: Object, default: null },
  options: { type: Object, default: null },
})

const emit = defineEmits([
  'select',
  'node-drop',
  'change',
  'group-state-change',
  'group-reorder',
  'viewport-change',
])
```

非受控模式下，组件内部维护 `internalViewport`；受控模式下，组件不直接持久化 prop 外的新视口，只发 `viewport-change`，等待外部回传。

### 几何规则

缩放计算必须用同一套世界/屏幕转换：

```js
const before = screenToWorld(screenPoint, viewport)
const nextScale = clamp(viewport.scale * zoomFactor, minScale, maxScale)
const nextViewport = {
  x: screenPoint.x - before.x * nextScale,
  y: screenPoint.y - before.y * nextScale,
  scale: nextScale,
}
```

若 `nextScale` 被 clamp 到当前 scale 且 `x/y` 不变，不发 `viewport-change`。

### 验收

- 缩放时鼠标下方的世界坐标保持稳定。
- 缩放比例受 `minScale`/`maxScale` 限制。
- 拖动空白区域可平移视口，并触发 `viewport-change`。
- 传入 `viewport` prop 时组件进入受控模式，内部交互只发事件，不自行改变持久状态。
- 分组框内部滚轮仍只滚动分组，不缩放画布。

## 切片 2：选择模型和高亮

### 目标

- `selectedIds` 非受控内部状态从单个 id 升级为数组。
- 普通点击替换选择；`Shift`、`Cmd`、`Ctrl` 点击追加或取消选择。
- `Shift` 空白拖拽绘制框选矩形，选择矩形内的可见普通节点和分组框。
- 点击空白区域清空选择。
- Canvas 容器可聚焦，按 `Esc` 清空选择。
- 渲染器支持 `state.highlighted`、`state.dimmed`，用于选中关系高亮和非相关降权。

### 高亮规则

选中集合不为空时：

- 选中项本身保持 selected。
- 普通节点被选中时，其父节点、直接子节点、以及 `graph.edges` 中相连的另一端节点为 highlighted。
- 分组被选中时，分组本身 selected，分组 parent highlighted，分组内可见/不可见子节点视为相关节点；如果某条 `edge` 端点落在分组子节点上，对应连线 highlighted。
- 与选中项、父子关系、相关业务边均无关的节点、分组、连线为 dimmed。

### 框选规则

- 框选使用屏幕坐标绘制 selection rect，再转换或比较 `worldRectToScreen(item, viewport)`。
- 只选择当前可见项：普通可见节点和可见分组框；折叠分组内部不可见子节点不被框选。
- 框选结束后按框选结果替换选择；如果框选为空，则清空选择。

### 验收

- 单击节点只保留一个选中项。
- `Shift`/`Cmd`/`Ctrl` 点击可追加或取消选择。
- `Shift` 空白拖拽框选矩形内的可见节点和分组框。
- 点击空白或按 `Esc` 清空选择。
- 选中节点后父级、子级和相关连线高亮，其他元素降权。

## 切片 3：普通节点拖拽换位

### 目标

- 普通可见节点在同一父节点下可拖拽排序。
- 拖拽超过 4px 屏幕阈值后进入换位模式。
- 拖拽过程中绘制 ghost 和 drop slot，视觉规则复用第二阶段分组内部拖拽的思路。
- 松手后更新真实 `parent.children` 顺序。
- 触发 `node-move` 和 `change`。

### 约束

- 只处理普通可见节点之间排序。
- 只允许同一父节点下兄弟节点排序。
- 如果目标位置落在另一个父节点、分组内部、画布空白或不可排序区域，插入位置 clamp 到原父节点兄弟列表的合法范围。
- 被自动分组消费的折叠子节点仍然使用第二阶段的分组内部换位，不走普通节点换位。
- 拖拽排序完成后调用 `updateLayout()`，让布局和连线重新计算，并沿用现有布局切换动画。

### 事件

```js
emit('node-move', {
  nodeId,
  parentId,
  fromIndex,
  toIndex,
})
emit('change', props.graph)
```

### 验收

- 同一父节点下两个普通可见兄弟节点拖拽换位后，`parent.children` 顺序改变。
- 拖拽未超过阈值时仍是点击选中，不触发 `node-move`。
- 命中分组内部 item 时仍走分组内部换位，不触发普通节点 `node-move`。
- 换位后布局、连线、选中态不丢失。

## 文档和进度规则

- 第三阶段总入口是 `ROADMAP.md` 的「当前进度」。
- 本文件记录第三阶段总设计和切片状态。
- 每个切片都必须有独立 plan：`docs/superpowers/plans/YYYY-MM-DD-phase-3-<slice>.md`。
- 每个切片完成后更新：
  - `ROADMAP.md` 当前进度、已完成切片、下一步、待办切片。
  - 本 spec 的阶段状态。
  - 对应 plan 的 Progress。
- 每次完成必须记录验证结果：至少 `npm test` 和 `npm run build`；涉及视觉/交互的切片还要做浏览器验收。

## Spec 自检

- 无占位符或未完成条目。
- 三个切片互相依赖顺序明确：viewport -> selection/highlight -> node reorder。
- 普通节点拖拽换位已明确纳入第三阶段，且跨父节点移动明确排除。
- 第二阶段分组内部滚动、拖拽换位的手势优先级已保留。
