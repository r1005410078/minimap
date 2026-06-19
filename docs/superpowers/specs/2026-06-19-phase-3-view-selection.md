# Phase 3 View and Selection Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第三阶段：视图和选择能力。
> 本阶段拆成 2 个连续切片，避免新窗口或新 agent 丢失上下文。每个切片完成后必须更新本文件、ROADMAP、对应 plan，并写明 commit 范围和验证结果。

## 阶段状态

- [x] 切片 1：视口平移缩放
- [x] 切片 2：选择模型和高亮

当前下一步：开始第四阶段「导航和查找能力」的 spec 和 plan。

切片 1 完成记录：commit `29c8ccb..2af8e4c`；`npm test` 172 全过，`npm run build` 通过；`npm test -- test/minimap-viewport-interaction.test.js test/minimap-group-interaction.test.js test/minimap-select.test.js` 40 全过；Vite dev server `http://127.0.0.1:5173/` 可访问。Browser 插件当前没有可用 `iab` 实例（browser list 为空），因此本轮未能做 in-app Browser 手动操作，改用 jsdom + Canvas mock 的真实 wheel/pointer 组件事件验收覆盖滚轮缩放、分组滚轮优先、受控 viewport 不持久化、空白拖拽平移、节点拖拽不触发平移。

切片 2 完成记录：commit `e83086b..d225d4c`；`npm test` 183 全过，`npm run build` 通过；`npm test -- test/minimap-selection.test.js test/minimap-renderer.test.js test/minimap-select.test.js test/minimap-viewport-interaction.test.js test/minimap-group-interaction.test.js` 83 全过；`http://127.0.0.1:5173/` 可访问。Browser 插件当前仍没有可用 `iab` 实例（browser list 为空），因此本轮未能做 in-app Browser 手动操作，改用 jsdom + Canvas mock 的真实 wheel/pointer/keyboard 组件事件验收覆盖多选、框选、Esc 清空、关系高亮和非相关降权。

## 头脑风暴决策记录

- 节点拖拽移动经讨论后移到第五阶段。原因是完整需求不是简单同父级换位，而是允许分组框内部节点和外部节点拖到其他父节点下面，需要修改 `parentId`、多个父节点的 `children`、支持 before hooks、只读模式和撤销/重做，属于编辑能力。
- 第三阶段只做视图和选择，拆成 2 个切片推进：先稳定 viewport，再做选择/高亮。
- 空白拖拽默认用于画布平移。框选需要明确进入框选语义：按住 `Shift` 从空白处拖拽，或后续工具栏提供框选模式时复用同一套状态机。本阶段先实现 `Shift` 空白拖拽框选。
- 分组框内部滚轮继续优先滚动分组；只有滚轮没有命中可滚动分组时，才触发画布缩放。
- 第二阶段已有的分组内部拖拽换位保留；命中分组 item 时继续走分组内换位，不触发画布平移或框选。
- 第三阶段保留节点拖拽移动的手势空间：节点上的拖拽不用于框选；框选只从 `Shift` + 空白区域开始。第五阶段实现节点跨父级拖拽时复用这个边界。

## 总体范围

第三阶段交付后需要满足：

- `viewport` 支持受控和非受控模式，外部可通过 prop 控制视口，组件通过 `viewport-change` 通知变更。
- 用户可以拖动画布空白区域平移视口。
- 用户可以用鼠标滚轮或触控板缩放画布，缩放中心为鼠标位置，且受最小/最大缩放限制。
- 单击节点或分组框时只保留当前目标；使用 `Shift`、`Cmd` 或 `Ctrl` 点击可追加或取消选择。
- 使用 `Shift` 从空白区域拖出框选矩形时，矩形内可见节点被选中。
- 点击空白区域或按 `Esc` 清空选择。
- 选中节点后，高亮父级、子级和相关连线，其他元素降权。

## 非目标

- 不做节点跨父级拖拽移动与排序；这属于第五阶段编辑能力。
- 不做拖拽普通节点成为另一个节点子节点；这属于第五阶段编辑能力。
- 不做分组框内部节点拖出到其他父节点；这属于第五阶段编辑能力。
- 不做 fit to screen、center selection、search、overview；这些属于第四阶段。
- 不做删除、复制、只读模式、before hooks、撤销/重做；这些属于第五阶段。
- 不引入第三方渲染、拖拽或图布局库。

## 手势优先级

事件状态机按以下优先级判断：

1. 命中分组滚动条滑块：执行第二阶段已有的滚动条拖拽。
2. 命中分组 header：点击切换展开/折叠。
3. 命中分组 item：执行第二阶段已有的分组内部拖拽换位；未超过阈值时仍是点击选中该子节点。
4. 命中普通节点：点击执行单选/多选；拖拽移动预留给第五阶段，本阶段不把节点拖拽解释为框选或平移。
5. 命中分组 body：点击选中分组；拖拽不做节点移动。
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

- 文档没有遗留待补内容。
- 两个切片互相依赖顺序明确：viewport -> selection/highlight。
- 节点跨父级拖拽移动与排序已明确移出第三阶段，归入第五阶段编辑能力。
- 第二阶段分组内部滚动、拖拽换位的手势优先级已保留。
- 第三阶段已完成，后续进入第四阶段规划。
