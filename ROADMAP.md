# Minimap 组件功能路线图

> 本文档是 minimap 组件的功能路线图。后续每个阶段都按 superpowers 流程开发（从头脑风暴开始），完成一个阶段就在下面打勾。

## 路线图进度

- [x] 第一阶段：核心可用能力
- [x] 第二阶段：分组框能力
- [x] 第三阶段：视图和选择能力
- [x] 第四阶段：导航和查找能力
- [ ] 第五阶段：编辑和状态能力

## 当前进度

> 换窗口/新会话时先读这里。进度是持久状态，做完一步就更新本块。

- **当前阶段**：Controller 抽取切片 3 —— drag-controller（第五阶段切片 5/6 暂缓，等 controller 抽取完成后再回来做）
- **当前阶段 Spec**：[design](docs/superpowers/specs/2026-06-21-controller-extraction-slice-3-design.md)（已确认，待写计划）
- **当前阶段计划**：待写计划
- **已完成切片**：
  - 逻辑层 `graph` / `layout` / `coords` + 测试（commit `893b6b7`）
  - Canvas 渲染器 `renderer` / `theme` + 测试（commit `1caccd8`，`npm test` 22 全过）
  - Vue 组件壳 `Minimap.vue` / `ResourceTree.vue` / `interaction.js` + 资源树拖入 + 测试（commit `0c50895`..`e4c451b`，`npm test` 49 全过，浏览器手动验收通过）
  - 正交连线 `orthogonalPath` / `resolveEdges` endpoint boxes / 折线 + 箭头绘制 + 测试（commit `7902000`..`0d4b711`，`npm test` 与 `npm run build` 通过）
  - 布局切换动画 + 视口锚点稳定 `layout-transition` / `Minimap.vue` raf 动画 + 测试（commit `8ab447a..5ee9672`，`npm test` 与 `npm run build` 通过）
  - 自定义绘制 props 接通 `nodeRenderer`/`groupRenderer`/`edgeRenderer` + 测试（commit `6f12cd2..c645ca4`，`npm test` 与 `npm run build` 通过）
  - 分组逻辑 `layout.js` 叶子兄弟分段 + 多分组身份 + 最小尺寸 + 展开态 + 滚动窗口 + 测试（[plan](docs/superpowers/plans/2026-06-19-phase-2-group-logic.md)，`npm test` 92 全过，`npm run build` 通过）
  - Canvas 渲染器 `renderer.js` 分组框子节点虚拟绘制 + 滚动条视觉 + 多分组动画适配 + 测试（[plan](docs/superpowers/plans/2026-06-19-phase-2-canvas-renderer.md)，`npm test` 101 全过，`npm run build` 通过）
  - Vue 交互 `interaction.js` 命中检测细分 + `Minimap.vue` 拖拽换位/滚轮/展开折叠 + 测试（[plan](docs/superpowers/plans/2026-06-19-phase-2-vue-interaction.md)，`npm test` 131 全过，`npm run build` 通过）
  - 视口平移缩放 `viewport.js` / `Minimap.vue` 受控 viewport + wheel zoom + blank pan + 测试（[plan](docs/superpowers/plans/2026-06-19-phase-3-viewport-pan-zoom.md)，commit `29c8ccb..2af8e4c`，`npm test` 172 全过，`npm run build` 通过；dev server 可访问，Browser 插件无可用 `iab`，以组件真实事件验收覆盖交互）
  - 选择模型和高亮 `selection.js` / `renderer.js` / `Minimap.vue` 多选、Cmd/Ctrl 框选、Esc 清空、关系高亮和非相关降权 + 测试（[plan](docs/superpowers/plans/2026-06-19-phase-3-selection-highlight.md)，commit `e83086b..d225d4c`，收尾修正 commit `71224ca`，`npm test` 184 全过，`npm run build` 通过；`http://127.0.0.1:5173/` 可访问，Browser 插件仍无可用 `iab`，以 jsdom + Canvas mock + 真实组件事件覆盖交互）
  - 视图定位方法 `viewport.js` 视口补动 + `layout.js` 分组子节点定位 + `selection.js` 多模式选择 + `Minimap.vue` 首次 `defineExpose`（`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport`/`select`/`clearSelection`） + 测试（[plan](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md)，`npm test` 214 全过，`npm run build` 通过）
  - 搜索节点 `search.js` 深度优先遍历 + 子串匹配 + `Minimap.vue` 内建搜索框（输入即搜、上一个/下一个循环导航、`options.enableSearch` 开关） + 测试（[plan](docs/superpowers/plans/2026-06-20-phase-4-search-nodes.md)，`npm test` 233 全过，`npm run build` 通过；UI 用 jsdom + Vue Test Utils 真实组件事件覆盖，没有真实浏览器可用，未做人工目测）
  - Overview 小地图导航 `overview.js` 缩略图视口变换 + 视口框坐标转换 + 视觉裁剪 + `Overview.vue` 独立子组件（命令式 `render()`，无 props） + `Minimap.vue` 接入（`renderCurrent()` 联动绘制、`navigate` 事件联动主视口、`options.enableOverview` 开关） + 测试（[plan](docs/superpowers/plans/2026-06-20-phase-4-overview-navigation.md)，`npm test` 253 全过，`npm run build` 通过；UI 用 jsdom + mock canvas ctx + Vue Test Utils 真实组件事件覆盖，没有真实浏览器可用，未做人工目测）
- **第一阶段验收回归结果（2026-06-19，复跑）**：`npm test` 85 全过、`npm run build` 通过；真实浏览器驱动（headless Chrome + CDP）逐条核对「第一阶段验收」10 条，全部通过——示例图与 10000 节点压力图正常渲染且不创建 10000 个 DOM 节点（仅 17 个）；`edges` 不改变父子树节点坐标（7 个节点 diff 0）；左右/上下布局正确切换，父节点居中、兄弟顺序稳定；选中 `feeder-1` 后切换布局方向，视口锚点补偿生效（截图确认其屏幕位置基本不变）；`nodeRenderer`/`groupRenderer`/`edgeRenderer` 同时生效（截图可见洋红节点/青色分组框/黄色连线）；容器 resize + DPR=3 下 canvas 像素尺寸正确按比例放大；资源树拖入后 graph 正确增加节点。
- **第三阶段切片**：
  - [x] 切片 1：视口平移缩放（`viewport` 受控/非受控、空白拖拽平移、滚轮缩放、缩放边界、`viewport-change`）
  - [x] 切片 2：选择模型和高亮（单选、多选、框选、空白/Esc 清空、父级/子级/相关连线高亮、非相关元素降权）
- **第四阶段切片**（overview 是独立 mini canvas 子组件，跟前两个切片的视口数学性质不同，拆开做）：
  - [x] 切片 1：视图定位方法（`viewport.js`/`layout.js`/`selection.js` 纯函数 + `Minimap.vue` 首次 `defineExpose`：`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport`/`select`/`clearSelection`；[plan](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md)，`npm test` 214 全过，`npm run build` 通过）
  - [x] 切片 2：搜索节点（`search.js` + `Minimap.vue` 内建搜索框，复用切片 1 的 `centerOnNode`/`select` 跳转和高亮；[plan](docs/superpowers/plans/2026-06-20-phase-4-search-nodes.md)，`npm test` 233 全过，`npm run build` 通过）
  - [x] 切片 3：Overview 小地图导航（独立子组件 `Overview.vue`，命令式渲染 + `navigate` 事件联动主视口；[plan](docs/superpowers/plans/2026-06-20-phase-4-overview-navigation.md)，`npm test` 253 全过，`npm run build` 通过）
- **第五阶段切片**（先建立可撤销/可拦截的编辑底座，再接入具体编辑交互，避免跨父级拖拽先做导致返工）：
  - [x] 切片 1：编辑操作底座（新增 `graph-operations`/history 层，统一节点拖入和分组内换位的 mutation 入口；支持 `readonly`、before hooks、`undo`/`redo`、`canUndo`/`canRedo`、`change` payload 规范；[spec](docs/superpowers/specs/2026-06-20-phase-5-edit-operation-base.md)，[plan](docs/superpowers/plans/2026-06-20-phase-5-edit-operation-base.md)，`npm test` 与 `npm run build` 通过）
  - [x] 切片 2：删除、复制、导入导出（基于切片 1 的 operation 机制实现 `deleteSelection`/`exportGraph`/`importGraph`，补齐键盘 `Delete`、`Cmd/Ctrl+C`/`Cmd/Ctrl+V` 快捷键和 graph `version` 校验；复制/粘贴拆分为只读 `copySelection`（写入内部 clipboard，`readonly` 不拦截）+ 新增 `paste()`（插入到当前选中节点下，可重复粘贴，`readonly`/`beforePaste` 拦截）；[spec](docs/superpowers/specs/2026-06-20-phase-5-delete-copy-import-export.md)，[plan](docs/superpowers/plans/2026-06-20-phase-5-delete-copy-import-export.md)，复制/粘贴拆分 [spec](docs/superpowers/specs/2026-06-20-phase-5-copy-paste-split.md)，[plan](docs/superpowers/plans/2026-06-20-phase-5-copy-paste-split.md)，`npm test` 与 `npm run build` 通过）
  - [x] 切片 3：节点跨父级拖拽移动与排序（任意真实节点都可拖到另一个父节点下面变成其子节点；目标父节点跟起点父节点相同时退化为现有 `reorder-group-child`（含未分组兄弟互拖新场景）；新增 `move-node` operation 处理跨父级移动，复用整图快照回滚做 undo/redo；悬停分组框 item 时复用并泛化让位动画，悬停普通节点时只高亮；拖近画布边缘自动平移视口；`beforeNodeMove`/`beforeGroupReorder`/`readonly` 拦截；[spec](docs/superpowers/specs/2026-06-20-phase-5-cross-parent-move.md)，[plan](docs/superpowers/plans/2026-06-20-phase-5-cross-parent-move.md)，`npm test` 与 `npm run build` 通过）
  - [x] 切片 4：右键菜单（节点/分组/空白画布右键菜单；节点菜单包含通用画布菜单；默认菜单 + `contextMenuItems` 覆盖；配置项通过 `config-change` 受控通知；新增节点入口保留但禁用；不做重命名和连线菜单；新增 `context-menu.js`/`clipboard.js` + 测试；[spec](docs/superpowers/specs/2026-06-21-context-menu-design.md)，[plan](docs/superpowers/plans/2026-06-21-context-menu.md)，commit `a3a0f01`（跟性能优化切片1一起提交），`npm test` 全过，`npm run build` 通过；本条之前未及时勾选，2026-06-21 补记）
  - [ ] 切片 5：组件状态与可访问性（`loading`/空图/`error` 状态，`error` 事件，`options.keyboard` 开关，aria 状态区域展示选中数量、选中 label、搜索结果和错误信息）
  - [ ] 切片 6：性能状态与生命周期收尾（`performance` 事件或调试状态展示总节点数、可见节点数、缩放比例、帧耗时；验证销毁后没有残留事件监听、ResizeObserver 或动画循环）
- **视觉整理切片**：
  - [x] 暗色工作台视觉优化（按参考图方向 B：资源树、顶部工具栏骨架、点阵画布、卡片式节点/分组、右下 overview 外框；只做视觉和结构，不引入第五阶段编辑行为；[spec](docs/superpowers/specs/2026-06-20-visual-polish-design.md)，[plan](docs/superpowers/plans/2026-06-20-visual-polish.md)，commit `47f975c..fadbbe0`，`npm test` 258 全过）
- **性能优化切片**：
  - [x] 切片 1：大图交互合帧与缩放降级渲染（新增 `render-scheduler.js`、`render-quality.js`；平移/框选高频路径合帧；缩小时减少文字和分组子项绘制；拖拽合帧、空间索引和静态缓存作为后续独立切片；[spec](docs/superpowers/specs/2026-06-21-large-graph-performance.md)，[plan](docs/superpowers/plans/2026-06-21-large-graph-performance.md)，`npm test` 363 全过，`npm run build` 通过）
- **Controller 抽取切片**（`Minimap.vue` 已超 2000 行，目标是把编排/状态机逻辑迁到框架无关的 controller 模块，Vue 只保留 props/emits/模板绑定/生命周期挂载，方便以后换 React 或 Vue3；6 个 controller 文件按复杂度合并成 3 个实施切片，core 和 drag 各有 rAF 循环/状态机单独做，剩下 4 个无循环的打包一起做；[design](docs/superpowers/specs/2026-06-21-controller-extraction-design.md)）：
  - [x] 切片 1：根 controller + core-controller（canvas/resize/layout 状态/布局切换动画/viewport+tween/渲染调度降级；新增 `core-controller.js`/`minimap-controller.js` + 测试；`Minimap.vue` 改为创建并挂载 controller，`onMounted`/`onUnmounted`/`defineExpose` 的相机方法全部转发给 controller，拖拽/选择/搜索/撤销重做/右键菜单逻辑本切片不动；分组滚动条拖拽预览保留原有"先直接改本地、松手才提交"行为，未跟着表头展开/滚轮一起改成 `controller.scrollGroup`；[design](docs/superpowers/specs/2026-06-21-controller-extraction-design.md)，[plan](docs/superpowers/plans/2026-06-21-controller-extraction-slice-1.md)，subagent-driven-development 4 个任务全部 spec+quality 通过（含一轮修复：`setGroupExpanded` 的 id 嗅探 hack 还原成计划的简单形式、共享测试 helper `stubAnimationFrame` 还原原语义），`npm test` 392 全过，`npm run build` 通过，dev server 真实浏览器手动验收通过（初始渲染、平移、滚轮缩放、搜索跳转+分组展开滚动均正常，控制台无报错））
  - [x] 切片 2：selection-controller + edit-controller + search-controller + context-menu-controller（受控选中态/撤销重做剪贴板/搜索/右键菜单，四个文件一起做；`edit-controller` 拥有 `operationManager` 单例并暴露 `applyOperation`/供切片 3 drag-controller 复用同一条撤销栈，本切片里 `Minimap.vue` 尚未迁移的拖拽换位/跨父级移动/资源拖入也改接这个方法；`context-menu-controller` 自己管理菜单开关时的 document 外部点击监听；[design](docs/superpowers/specs/2026-06-21-controller-extraction-slice-2-design.md)，[plan](docs/superpowers/plans/2026-06-21-controller-extraction-slice-2.md)，`npm test` 全过，`npm run build` 通过）
  - [ ] 切片 3：drag-controller（节点拖拽/滚动条拖拽/框选/空白平移/自动滚动/边缘平移/拖拽让位动画/资源拖放提交）
- **下一步**：推进 Controller 抽取切片 3（drag-controller，节点拖拽/滚动条拖拽/框选/空白平移/自动滚动/边缘平移/拖拽让位动画/资源拖放提交；完成后 `Minimap.vue` 里不再有任何指针事件处理逻辑，`emitChange` 本地函数也可以删掉，根 controller 的 DOM 回调全部指向真实 controller）；全部完成后再回到第五阶段切片 5/6，或继续性能优化后续切片（空间索引 / 静态层缓存 / 拖拽动态层合帧）。

## 目标

构建一个不引入第三方库的 Vue minimap 组件。组件需要支持最多 10000 个节点的渲染和交互，同时支持从资源树拖入节点、相邻节点自动合并成分组框、分组框内部节点换位，以及左右布局和上下布局两种方式。

## 功能列表

### 第一阶段：核心可用能力

- Canvas 大图渲染：节点、连线、分组框、网格背景、选中态、拖拽态都通过 Canvas 绘制。
- 自定义绘制节点：外部可以传入节点、分组、连线等绘制函数，在不改组件内部代码的情况下替换默认视觉样式。
- 10000 节点性能支撑：布局、绘制、命中检测都需要避免依赖 10000 个 DOM 节点。
- 边和连接关系：除父子树结构外，支持通过 `edges` 描述非父子连接、跨层连接和业务关系线。
- 坐标系统：明确世界坐标、屏幕坐标和视口变换，保证缩放、拖拽、框选、overview、拖入坐标转换一致。
- 左侧资源树：展示可拖拽资源节点，支持拖入 minimap 画布。
- 节点拖入：资源从左侧拖到画布后，添加为当前图中的节点。
- 左右布局：父子关系从左到右排列。
- 上下布局：父子关系从上到下排列。
- 正交连线：所有连线（父子树连线 + `edges` 业务关系线）都画成直角折线（横-竖-横或竖-横-竖）+ 箭头，不画斜线；同一父节点的子节点共享同一个转折坐标，视觉上对齐成一条公共脊线。
- 布局切换动画：布局方向切换或重新布局时，节点坐标平滑过渡。
- 视口锚点稳定：重新布局时保持当前拖拽或选中的节点在用户视野附近，避免整个画布突然跳走。

### 第二阶段：分组框能力

- 自动分组：同一父节点下，连续相邻且都没有子节点（叶子节点）的兄弟节点数量超过 5 个时，合并成分组框。只要某个兄弟节点自身带子节点，它就不参与合并、始终单独布局和绘制，并把原本连续的兄弟序列从它这里截断成两段，分别按各自的叶子节点数量判断是否折叠。
- 分组框尺寸限制：分组框最大宽高按画布视口比例计算，同时保留可用的最小尺寸。
- 分组框内部滚动：内容超过最大高度时出现滚动条。
- 分组框内部虚拟绘制：只绘制当前可见的分组子节点。
- 分组框内部换位：框内节点可以拖拽排序，排序结果写回图数据。
- 分组展开/折叠：支持手动展开或折叠分组，用于查看细节或降低画面复杂度。

### 第三阶段：视图和选择能力

- 平移：拖动画布空白区域移动视口。
- 缩放：鼠标滚轮或触控板缩放画布，并以鼠标位置作为缩放中心。
- 缩放边界：限制最小和最大缩放比例。
- 单选：点击节点或分组框时只选中当前目标，并清空其他选择。
- 多选：使用 `Shift`、`Cmd` 或 `Ctrl` 点击追加或取消选择。
- 框选：按住 `Cmd` / `Ctrl` 从空白区域拖出矩形区域，选择区域内的可见节点。
- 取消选择：点击空白区域或按 `Esc` 清空选择。
- 选中关系高亮：选中节点后，高亮父级、子级和相关连线，降低其他元素视觉权重。

### 第四阶段：导航和查找能力

- 适配视图：一键 fit to screen，将全部内容缩放并居中到当前画布。
- 定位选中：一键把当前选中的节点或分组移动到视口中心。
- 搜索节点：按 `label` 或 `id` 搜索节点，并跳转到匹配结果。
- Overview 小地图：右下角显示全局缩略图和当前视口框。
- 小地图拖拽导航：拖动 overview 中的视口框，快速移动主画布视口。

### 第五阶段：编辑和状态能力

- 撤销/重做：支持撤销或重做节点拖入、框内换位、布局切换、删除等操作。
- 删除节点：选中节点后可以删除。
- 复制节点：复制已有节点到当前父级或当前视口位置。
- 节点跨父级拖拽移动与排序：普通节点、分组框内部节点都可以拖到其他父节点下面或目标父节点的指定子节点顺序位置，结果写回 `parentId` 和 `children`。
- 右键菜单：普通节点、分组框和空白画布提供常用编辑、视图定位和显示配置入口；默认菜单可通过 `contextMenuItems` 覆盖。
- 只读/编辑模式：只读模式下禁止拖入、换位、删除等编辑操作。
- 操作拦截：拖入、移动、换位、删除、复制前允许外部校验并阻止默认行为。
- 加载、空状态和错误状态：组件支持 loading、空图提示。
- 性能状态提示：显示总节点数、可见节点数、缩放比例、当前帧渲染耗时等调试信息。

## 各阶段验收标准

每个阶段的勾选以下面的验收点全部通过为准。具体任务拆分在进入该阶段时再按当时情况分析。

### 第一阶段验收

- 能生成能源系统示例图，也能生成 10000 节点压力图。
- graph 能表达父子关系之外的业务连接线（`edges`），且 `edges` 不改变父子树主布局。
- 同一份 graph 能切换左右和上下布局，父子方向符合布局模式。
- 父节点位于子树/子分组的中线位置，兄弟节点顺序在布局结果中保持稳定。
- 布局切换后能按选中或拖拽的节点做视口锚点补偿，画面不突然跳走。
- 世界/屏幕/视口坐标转换在拖入和点击命中检测之间复用；缩放、框选、overview 的复用验收挪到对应阶段（第三、四阶段，那时这些功能才存在）。
- 示例图正确显示；传入自定义节点绘制函数后，节点视觉可被替换。
- 10000 节点不创建 10000 个 DOM 节点，挂载和交互保持响应；缩放和平移的连续性验收挪到第三阶段（那时才实现平移缩放）。
- 容器 resize 后 Canvas 尺寸与内容同步，高清屏（DPR）下不模糊。
- 从资源树拖入后 graph 增加节点。

### 第二阶段验收

- 5 个及以下相邻叶子兄弟不合并，6 个及以上自动合并为分组框；带子节点的兄弟节点本身永远不参与合并，并会把原本连续的叶子兄弟序列从它这里截断成两段分别判断。
- 调整 `groupThreshold` 后自动分组结果同步变化。
- 大分组不一次性绘制所有子节点，滚动后可见子节点集合变化。
- 分组框内部换位后，真实 graph 顺序发生变化（不仅是视觉位置）。
- 支持分组展开/折叠。

### 第三阶段验收

- 缩放时鼠标下方的世界坐标保持稳定，并受最小/最大缩放比例限制。
- 拖动空白区域可平移视口。
- 单击节点只保留一个选中项；`Shift`/`Cmd`/`Ctrl` 可追加或取消选择。
- 按住 `Cmd` / `Ctrl` 从空白区域拖出的框选矩形内，可见节点被选中。
- 选中节点后，父级、子级和相关连线被高亮。
- 点击空白区域或按 `Esc` 可取消选择。

### 第四阶段验收

- fit to screen 后全图进入视口。
- center selection 后选中内容靠近视口中心。
- 能按 `id`/`label` 搜索到普通节点和分组框内部节点，跳转后目标进入视口中心附近。
- overview 显示全局缩略图和当前视口框；点击或拖动 overview 后主画布视口同步变化。

### 第五阶段验收

- 编辑后可撤销回上一步，撤销后可重做，新操作发生后重做栈被清空。
- 删除/复制选中节点生效；只读模式下拖入、删除、换位都不生效。
- 节点跨父级拖拽移动后，原父节点 `children` 删除该节点，新父节点 `children` 在目标位置插入该节点，节点 `parentId` 更新；分组框内部节点也可被拖出并移动到其他父节点下面。
- 拖入、移动、换位、删除、复制前的 before hooks 能阻止默认行为。
- loading、空图、错误三类状态都能展示，并触发 `error` 事件。
- 支持导出 graph JSON 并导入还原，graph 含 `version` 字段。
- 画布容器可聚焦，键盘快捷键可开关；选中数量、选中节点 label、搜索结果和错误信息通过 aria 状态区域可读。
- 销毁组件后不再保留全局事件监听和动画循环。
- 显示总节点数、可见节点数、缩放比例、帧渲染耗时等性能状态。

## 架构

组件采用 Canvas 优先的渲染架构。Vue 负责应用状态、资源树 UI、工具栏控制，以及高层事件串联。Canvas 负责高频、大规模的视觉渲染，包括节点、连线、分组框、可见的分组子节点、网格背景、选中态和拖拽预览。

布局引擎使用纯 JavaScript 实现，并且不依赖 Vue。它接收图数据模型和布局选项，返回已定位的渲染项、分组框、连线、内容边界和查找映射。这样可以让性能敏感的布局逻辑脱离浏览器进行测试。

## 数据模型

图数据包含 `version`、`nodes`、`rootIds` 和 `edges`。`version` 用于导入导出格式兼容；`nodes` 存储节点；`rootIds` 表示入口节点；`edges` 表示连接关系。

节点包含 `id`、`label`、`parentId`、`children`，以及可选的 `kind`、`width`、`height`、`data`。`width` 和 `height` 用于覆盖默认节点尺寸；如果未提供，则使用 `theme.nodeSize` 或 `measureNode(node)` 的结果。示例从一个小型能源系统图开始，同时可以生成 10000 个节点的压力测试数据。资源树中的条目可以拖拽到 Canvas 上，并添加到当前图结构中。

边包含 `id`、`source`、`target`，以及可选的 `label`、`kind`、`data`。父子层级关系仍由 `parentId` 和 `children` 表达；非父子连接、跨层连接、业务关系线由 `edges` 表达。布局引擎可以根据父子关系生成默认树状连线，也可以根据 `edges` 生成额外关系线。

当多个节点拥有同一个父节点，并且在该父节点的 `children` 顺序中连续出现时，它们被视为相邻节点。只有没有子节点（叶子节点）的兄弟节点才参与折叠判断；只要某个兄弟节点自身带子节点，就不参与合并，并把原本连续的兄弟序列从它这里截断为两段，分别按各自的叶子节点数量判断是否折叠。如果截断后某一段连续叶子兄弟节点的数量超过 5 个，就把这一段折叠成一个分组框。分组框内部子节点的顺序保存在图数据中，因此在框内拖拽换位会改变真实逻辑顺序，而不仅仅是改变视觉位置。

## 坐标系统

组件内部区分三类坐标：

- 世界坐标：布局引擎输出的稳定坐标，节点、分组框、连线和内容边界都以世界坐标表示。
- 屏幕坐标：浏览器事件中的像素坐标，例如鼠标位置、框选矩形和拖放位置。
- 视口变换：`viewport.x`、`viewport.y`、`viewport.scale` 表示从世界坐标到屏幕坐标的转换。

坐标转换规则为：`screenX = worldX * scale + viewport.x`，`screenY = worldY * scale + viewport.y`。反向转换用于拖入、命中检测、框选、滚轮缩放中心计算和 overview 导航。

Canvas 渲染需要处理设备像素比 DPR。组件根据容器尺寸和 `window.devicePixelRatio` 设置 Canvas 实际像素尺寸，同时保持 CSS 尺寸稳定，避免高清屏模糊。

## 组件契约接口

Minimap 组件应该通过明确的 props、events 和 methods 对外暴露能力。外部调用方只需要维护业务数据和响应事件，不需要了解 Canvas 内部绘制细节。

### Props

- `graph`：图数据，包含 `nodes` 和 `rootIds`。
- `resources`：左侧资源树数据。
- `layoutDirection`：布局方向，取值为 `horizontal` 或 `vertical`。
- `readonly`：是否只读。只读时禁止拖入、拖动、换位、删除、复制等编辑操作。
- `loading`：是否显示加载状态。
- `error`：外部传入的错误状态或错误文案。
- `selectedIds`：外部受控的选中节点 id 集合。
- `groupStates`：外部受控的分组状态，包括展开/折叠和滚动位置。
- `viewport`：外部受控的视口状态，包括 `x`、`y`、`scale`。
- `nodeRenderer`：自定义普通节点绘制函数。
- `groupRenderer`：自定义分组框绘制函数。
- `edgeRenderer`：自定义连线绘制函数。
- `measureNode`：自定义节点尺寸测量函数，用于布局前计算节点包围盒。
- `theme`：颜色、字号、间距、节点尺寸、分组框比例等视觉配置。
- `options`：行为配置，例如分组阈值、分组策略、缩放范围、动画时长、是否启用 overview、是否启用框选、是否启用键盘快捷键。

### 受控和非受控模式

`selectedIds`、`groupStates`、`viewport` 支持受控和非受控两种模式。外部传入对应 prop 时，组件不直接持久化该状态，而是通过事件通知外部更新；外部未传入时，组件内部维护默认状态。

受控状态变化遵循 `prop` + `event` 契约：

- `selectedIds` 对应 `select`。
- `groupStates` 对应 `group-state-change`。
- `viewport` 对应 `viewport-change`。

### Events

- `change`：图数据发生变化时触发，例如新增、删除、复制、换位。
- `select`：选中集合变化时触发。
- `viewport-change`：平移、缩放、fit to screen、overview 导航导致视口变化时触发。
- `layout-change`：布局方向变化或重新布局完成时触发。
- `node-drop`：资源树节点拖入画布时触发。
- `node-move`：普通节点拖动完成时触发。
- `group-reorder`：分组框内部节点换位完成时触发。
- `group-state-change`：分组展开/折叠或滚动位置变化时触发。
- `search`：搜索关键词变化或搜索结果跳转时触发。
- `performance`：渲染耗时、可见节点数、总节点数等性能状态变化时触发。
- `error`：导入失败、数据非法或渲染异常时触发。

### Before Hooks

- `beforeNodeDrop(payload)`：资源拖入前调用，返回 `false` 时阻止默认新增。
- `beforeNodeMove(payload)`：节点移动前调用，返回 `false` 时阻止默认移动。
- `beforeGroupReorder(payload)`：分组框内部换位前调用，返回 `false` 时阻止默认换位。
- `beforeDelete(payload)`：删除前调用，返回 `false` 时阻止默认删除。
- `beforeCopy(payload)`：复制前调用，返回 `false` 时阻止默认复制。

### Methods

- `fitToScreen()`：将全部内容适配到当前画布视口。
- `centerOnNode(id)`：将指定节点移动到视口中心附近。
- `centerOnSelection()`：将当前选中内容移动到视口中心附近。
- `zoomTo(scale, center)`：缩放到指定比例，可指定屏幕中心点。
- `setViewport(viewport)`：设置视口。
- `getViewport()`：读取当前视口。
- `select(ids, mode)`：设置或追加选中节点。
- `clearSelection()`：清空选中。
- `search(keyword)`：按 `id` 或 `label` 搜索节点，跳转并选中第一个匹配项。
- `searchNext()`：跳转到下一个匹配项（绕回）。
- `searchPrevious()`：跳转到上一个匹配项（绕回）。
- `undo()`：撤销上一步编辑。
- `redo()`：重做上一步撤销。
- `exportGraph()`：导出当前图数据。
- `importGraph(graph)`：导入图数据。
- `resize()`：手动触发容器尺寸、DPR 和 Canvas 尺寸同步。
- `destroy()`：销毁内部事件监听、ResizeObserver 和动画帧。

## 自定义绘制

默认绘制器提供一套可直接使用的深色节点、分组框和连线样式。业务方可以通过 `nodeRenderer`、`groupRenderer`、`edgeRenderer` 替换默认绘制逻辑。

自定义绘制函数接收 Canvas 上下文和标准化渲染参数：

```js
function nodeRenderer(ctx, params) {
  const {
    node,
    rect,
    state,
    theme,
    viewport,
  } = params
}
```

其中 `node` 是业务节点数据，`rect` 是布局引擎计算出的世界坐标包围盒，`state` 包含 `selected`、`hovered`、`dragging`、`highlighted`、`readonly` 等状态，`theme` 是当前主题配置，`viewport` 是当前视口状态。

自定义绘制只负责视觉输出，不负责修改图数据、视口或选中状态。命中检测默认仍使用布局引擎的包围盒。如果业务方需要非矩形命中区域，可以后续扩展 `hitTester` 接口，但第一版先不加入，避免 API 面过大。

## 分组框

分组框的最大宽度和最大高度根据视口计算，同时保留固定的最小可用尺寸。左右布局下，建议最大宽度约为 Canvas 宽度的 48%，最大高度约为 Canvas 高度的 42%；上下布局时会根据方向做相应调整。如果分组内容超过可见区域，分组框内部会渲染为可滚动区域，并显示自定义滚动条。

只绘制分组框内部当前可见的子节点。滚动偏移量归属于每个分组框，因此即使大型分组包含大量子节点，也不需要在每一帧挂载或绘制全部条目。

默认分组策略是“同一父节点下，连续相邻且都没有子节点的兄弟节点（叶子节点）数量超过 `groupThreshold` 时自动分组”，默认阈值为 5；带子节点的兄弟节点永远不参与合并，并会把原本连续的叶子节点序列截断成两段分别判断。业务方可以通过 `options.groupThreshold` 调整阈值，也可以后续扩展 `shouldGroup` 或 `groupBy` 来定义自定义分组策略。

## 布局和动画

组件支持两种布局模式：

- `horizontal`：父子节点从左到右排列，子节点分组出现在右侧。
- `vertical`：父子节点从上到下排列，子节点分组出现在下方。

主布局采用稳定的分层树布局算法（Layered Tree Layout）。左右布局时，节点深度决定 `x` 坐标，同层和兄弟顺序决定 `y` 坐标；上下布局时，节点深度决定 `y` 坐标，同层和兄弟顺序决定 `x` 坐标。父节点放在子树或子分组的中线位置，分组框作为一个聚合节点参与布局。

布局计算分为几个步骤：

1. 从 `rootIds` 开始遍历父子树。
2. 先根据分组策略把超过阈值的连续兄弟节点折叠成分组项。
3. 自底向上计算每个节点、分组框和子树的占用尺寸。
4. 自顶向下分配每个节点和分组框的世界坐标。
5. 根据 `horizontal` 或 `vertical` 将主轴和交叉轴映射为 `x/y`。
6. 生成节点包围盒、分组框包围盒、树状连线和额外业务连线。

选择分层树布局的原因是：当前图数据的主结构是 `parentId` 和 `children` 组成的层级关系，左右/上下布局本质上只是主轴方向不同。分层树布局结果稳定、可预测、方便动画插值，也能保持父子和兄弟顺序，适合用户在拖拽或切换布局后继续找到刚刚操作的节点。

不采用力导向布局，因为力导向更适合一般网络图，但它会产生抖动，结果不够稳定，10000 节点下计算成本更高，也不利于保持用户当前关注点。不采用完整 DAG/Sugiyama 布局作为第一版，是因为当前主关系是树，额外 `edges` 可以作为关系线叠加绘制和高亮，不需要参与主布局；如果未来出现大量跨层依赖并且需要主动减少交叉线，可以再扩展 edge-aware layout。

默认情况下，`edges` 不参与主布局，只参与连线绘制、关系高亮和搜索定位。这样可以避免业务关系线把父子树布局拉乱。

重新布局会生成新的目标坐标。动画使用 `requestAnimationFrame`，从旧坐标插值到目标坐标。在拖拽和布局切换期间，当前选中或正在拖拽的节点会作为视口锚点。如果该节点在重新布局后的世界坐标发生变化，视口偏移也会按相同差值进行补偿，从而让用户关注的节点保持在鼠标附近或原来的屏幕位置附近，避免整个画布突然跳走。

## 交互

左侧资源树使用原生 HTML 拖拽能力。将资源拖放到 Canvas 上时，会使用视口变换的逆变换，把屏幕坐标转换为世界坐标，并在拖放位置附近添加节点。

Canvas 指针事件支持画布平移、节点选中、普通节点拖拽、分组框滚动，以及分组框内部子节点换位。命中检测使用布局引擎生成的包围盒，并尽量只检测当前可见的候选项。

键盘快捷键作为基础交互能力，可通过 `options.keyboard` 开启或关闭。默认支持 `Esc` 清空选择、`Delete` 删除选中、方向键微调选中节点、`Cmd/Ctrl+A` 选择可见节点、`Cmd/Ctrl+Z` 撤销、`Cmd/Ctrl+Shift+Z` 或 `Cmd/Ctrl+Y` 重做、`+/-` 缩放。

拖拽编辑需要遵守约束配置。默认不允许只读模式下编辑；是否允许跨父级移动、是否吸附网格、是否允许拖进分组框、是否限制在内容边界内，由 `options.drag` 配置控制，并可以被 before hooks 拦截。

组件需要提供基础状态反馈：加载中显示 loading 状态；空图显示空状态；导入失败、数据非法或渲染异常时显示错误状态并触发 `error` 事件。

## 性能

Canvas 渲染器使用视口裁剪。每一帧只绘制可见节点、连线、分组框，以及可见的分组子节点。布局过程对图数据做线性遍历，并避免让 Vue 渲染大规模节点集合。压力测试控制项会生成 10000 个子节点，用于验证渲染仍然保持响应。

组件需要监听容器尺寸变化并自动 resize。销毁时必须取消 `requestAnimationFrame`、移除全局事件监听、断开 `ResizeObserver`，避免页面切换后仍然占用资源。

## 可访问性

Canvas 本身不直接暴露完整 DOM 结构，因此组件需要提供最低限度的可访问性支持：画布容器可聚焦；键盘快捷键可操作；当前选中数量、选中节点 label、搜索结果和错误信息通过隐藏的 aria 状态区域对辅助技术可读。

## 测试

测试策略以单元测试为主，轻量 E2E 测试为辅。

单元测试必须覆盖核心纯逻辑：分组阈值、分组框尺寸和溢出、左右/上下布局方向、坐标转换、分组子节点换位、视口锚点补偿、选择集合、撤销/重做、搜索、导入/导出，以及 10000 节点图结构生成。

E2E 测试用于覆盖真实浏览器交互中单元测试难以验证的部分，包括 Canvas 是否非空绘制、布局切换后画布仍然有内容、滚轮缩放、拖动画布平移、框选、多选、资源树拖入、overview 导航、分组框滚动，以及 10000 节点压力模式下页面仍然可响应。

E2E 第一版只做轻量冒烟测试，不做脆弱的全量像素级断言。断言优先使用组件暴露的状态、调试面板数据、选中数量、节点数量、viewport 变化和 Canvas 非空像素检查。

如果“不引入第三方库”约束只限制运行时依赖，可以在开发依赖中使用 Playwright 执行 E2E。如果该约束也包括测试依赖，则第一版不引入 Playwright，改为保留浏览器手动验收清单，后续在允许新增开发依赖时再补自动化 E2E。

## 约束

不引入新的第三方运行时库或开发依赖。实现使用 Vue 2.7、Vite、Canvas 2D、原生 HTML 拖拽、原生 pointer 事件，以及 Node 内置测试运行器。
