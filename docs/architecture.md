# 模块地图

> `src/minimap/` 目录是平铺的，没有子目录。这份文档按职责给现有文件分类，方便定位代码——文件物理位置不变，分类只是文档层面的归类。新增文件时，先看它属于哪一类，再决定放进哪个文件、要不要新建文件；如果哪个文件已经不再符合所在分类的约束，就是该拆分或挪动职责的信号。

## 总览

```
src/minimap/                       （物理上平铺，下面按职责分组展示）
├─ 1. Vue 组件层
│  ├─ Minimap.vue                  根组件壳
│  ├─ Overview.vue                 小地图子组件
│  └─ ResourceTree.vue             资源树组件
│
├─ 2. Controller 编排层
│  ├─ minimap-controller.js        根 controller
│  ├─ core-controller.js           canvas/resize/layout/viewport/渲染调度
│  ├─ selection-controller.js      选中态
│  ├─ edit-controller.js           撤销重做/剪贴板/复制粘贴/删除/导入导出
│  ├─ search-controller.js         搜索/跳转
│  ├─ context-menu-controller.js   右键菜单
│  └─ drag-controller.js           拖拽/框选/平移/滚动条/资源拖放
│
├─ 3. 图数据与布局
│  ├─ graph.js                     图数据模型
│  ├─ graph-operations.js          mutation 唯一入口 + 撤销重做栈
│  ├─ graph-serialization.js       序列化/反序列化
│  ├─ layout.js                    树布局计算
│  └─ layout-transition.js         布局切换动画数学
│
├─ 4. 坐标与视口
│  ├─ coords.js                    世界坐标↔屏幕坐标
│  └─ viewport.js                  viewport 纯数学
│
├─ 5. 交互几何
│  ├─ interaction.js               命中检测/拖拽目标解析/滚动条几何
│  ├─ drag-transition.js           分组框内拖拽让位动画数学
│  └─ selection.js                 选中集合纯运算
│
├─ 6. 渲染
│  ├─ renderer.js                  Canvas 绘制主体
│  ├─ render-scheduler.js          高频交互渲染合帧
│  ├─ render-quality.js            缩小时渲染降级
│  ├─ theme.js                     默认主题
│  ├─ orthogonal.js                直角折线连线几何
│  └─ overview.js                  Overview 纯转换逻辑
│
└─ 7. 编辑辅助
   ├─ search.js                    图搜索
   ├─ context-menu.js              右键菜单项构建/合并
   └─ clipboard.js                 模块级单例剪贴板
```

## 1. Vue 组件层

薄包装：只负责 props/emits 声明、模板绑定、生命周期挂载、向 controller 转发调用。不持有编排逻辑或状态机。

- `Minimap.vue` — 根组件壳。创建并挂载 `minimap-controller`，模板绑定工具栏/搜索框/右键菜单/性能面板，`defineExpose` 转发相机/选中/编辑/搜索方法给外部调用方。所有指针事件处理、拖拽状态机、撤销重做等编排逻辑都已经迁进 controller 层，这个文件不应该再长出新的本地状态机。
- `Overview.vue` — 独立的小地图子组件。命令式 `render(scene)` 接口（不用 props 驱动重绘），自己的 canvas + DPR 适配，点击时 emit `navigate` 给父组件联动主视口。
- `ResourceTree.vue` — 左侧资源树组件，展示可拖拽资源节点，原生 drag and drop 发起拖入。

## 2. Controller 编排层

框架无关的状态机/编排逻辑，Controller 抽取三个切片的产物。全部是工厂函数 `createXController(deps) -> { 方法... }`：`deps` 只读 getter 转发 Vue props 或跨 controller 回调，不直接持有 Vue ref/组件实例，不引入新的 pub-sub/store 抽象。以后要换 React/Vue3，重写一层薄包装调用这些 controller 即可，这层本身不用动。

- `minimap-controller.js` — 根 controller，组装下面 6 个 controller，挂载/卸载 canvas 全部 DOM 事件监听，对外暴露 Vue 需要的全部方法。是唯一知道"一个 DOM 事件该转发给哪个 controller"的地方。
- `core-controller.js` — canvas/ctx 初始化、resize、layout 状态、布局切换动画、viewport + tween、渲染调度/降级、`renderCurrent()`。
- `selection-controller.js` — 选中态受控/非受控、`select`/`clearSelection`。
- `edit-controller.js` — 撤销/重做、剪贴板、复制/粘贴/删除/导入导出；拥有 `operationManager` 单例，`applyOperation`/`emitChangeIfApplied` 暴露出来给 `drag-controller` 复用同一条撤销栈。
- `search-controller.js` — 搜索、上一个/下一个、跳转。
- `context-menu-controller.js` — 右键菜单开关、命中转 context、菜单项构建/合并、动作执行；自己管理菜单开着期间的 document 外部点击监听，不挂在根 controller 的 canvas 监听机制上。
- `drag-controller.js` — 节点拖拽、滚动条拖拽、框选、空白平移、三个 rAF 循环（自动滚动/边缘平移/拖拽让位动画）、滚轮、资源拖放提交。这层里状态最复杂的一块。

## 3. 图数据与布局

纯逻辑，不依赖 Vue 或 DOM，可以在 Node 里直接单测。

- `graph.js` — 图数据模型（`nodes`/`rootIds`/`edges`）；demo 图/压力测试图构造；`reorderGroupChild` 等直接修改 `children` 顺序的辅助函数。
- `graph-operations.js` — 所有图 mutation 的唯一入口：`createGraphOperationManager` 撤销/重做栈 + `apply()`（统一处理 `readonly`/`before` 拦截）+ 7 种 operation 类型（`drop-node`/`reorder-group-child`/`move-node`/`delete-nodes`/`paste-nodes`/`replace-graph`/`remove-dropped-node`）各自的应用逻辑。新增一种图变更方式，应该是在这里加一个 operation 类型，而不是绕开 `apply()` 直接改 `graph.nodes`。
- `graph-serialization.js` — graph ↔ JSON-safe 数据的序列化/反序列化，供 `exportGraph`/`importGraph` 用，带 `version` 校验。
- `layout.js` — 树布局计算主体：节点/分组框定位、相邻兄弟自动合并成分组框、展开/折叠、滚动窗口；`GROUP`/`NODE`/`LEVEL_GAP` 几何常量。
- `layout-transition.js` — 布局切换时的坐标插值/锚点补偿数学，供 `core-controller` 的布局动画使用。

## 4. 坐标与视口

- `coords.js` — 世界坐标与屏幕坐标的双向转换。
- `viewport.js` — viewport 纯数学：平移/缩放/`fitViewportToBounds`/`tweenViewport`/`zoomViewportAt`/`panViewportBy`/`clampScale`/`viewportOptions`（`minScale`/`maxScale`/`zoomSensitivity` 归一化）。

## 5. 交互几何

- `interaction.js` — 命中检测（`hitTest`，含分组框 header/item/body 三区细分）、拖入插入下标计算、跨父级拖拽目标解析（`resolveDropTarget`）、自动滚动/边缘平移速度、滚动条几何（`scrollbarMetrics`/`hitScrollbarThumb`）。
- `drag-transition.js` — 分组框内拖拽换位时的"让位"动画数学：虚拟顺序计算、子节点矩形插值。
- `selection.js` — 选中集合的纯运算：点击命中转选择意图（`applySelectionClick`）、多模式合并（`applySelectionSet`）、框选命中判定（`idsInSelectionRect`）。

## 6. 渲染

- `renderer.js` — Canvas 绘制主体：节点/分组框/连线/网格/选中态/拖拽态全部绘制逻辑，`nodeRenderer`/`groupRenderer`/`edgeRenderer` 自定义绘制钩子的接入点。
- `render-scheduler.js` — 高频交互（平移/框选）路径的渲染合帧调度。
- `render-quality.js` — 缩小时的渲染降级策略（减少文字/分组子项绘制）。
- `theme.js` — 默认主题/颜色常量。
- `orthogonal.js` — 连线走直角折线的几何计算（横-竖-横或竖-横-竖），供 `renderer.js` 画连线用。
- `overview.js` — Overview 小地图的纯转换逻辑：缩略图视口变换、视口框坐标转换、视觉裁剪。

## 7. 编辑辅助

- `search.js` — 图的深度优先搜索 + 子串匹配。
- `context-menu.js` — 右键菜单默认菜单项构建（`buildContextMenuItems`）+ 跟 `contextMenuItems` prop 覆盖合并（`mergeContextMenuItems`）+ `BUILT_IN_CONTEXT_MENU_ACTIONS` 集合。
- `clipboard.js` — 模块级单例剪贴板（`getClipboard`/`setClipboard`/`hasClipboard`/`clearClipboard`），不是 Vue state，跨组件实例共享。

## 测试文件对应关系

`test/` 目录同样是平铺的，文件名跟上面的源文件按 `minimap-<name>.test.js` 一一对应（例如 `drag-controller.js` ↔ `test/minimap-drag-controller.test.js`），不需要单独再分类。少数例外是覆盖多个文件协作行为的集成测试（`minimap-shell.test.js`、`minimap-node-move.test.js`、`minimap-root-controller.test.js` 等），它们按"测的是哪个用户可见行为"命名，不对应单个源文件。
