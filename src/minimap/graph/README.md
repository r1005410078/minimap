# graph — 图数据与布局

## 职责

图数据模型、所有 mutation 的唯一入口、序列化，以及树布局与布局切换动画的纯数学。不依赖 Vue 或 DOM，可在 Node 里直接单测。

## 现有文件

| 文件 | 说明 |
|------|------|
| `graph.js` | 图数据模型（`nodes`/`rootIds`/`edges`）、demo/压测图构造、`reorderGroupChild` 等辅助 |
| `graph-operations.js` | mutation 唯一入口：`createGraphOperationManager`、撤销重做栈、`apply()`、`readonly`/`before` 拦截、7 种 operation 类型 |
| `graph-serialization.js` | graph ↔ JSON 序列化/反序列化，带 `version` 校验 |
| `layout.js` | 树布局：节点/分组框定位、合并分组、展开折叠、滚动窗口（折叠态按视口比例封顶、展开态按 `groupExpandedMaxHeight` 选项封顶，默认 560）；`GROUP`/`NODE`/`LEVEL_GAP` 常量 |
| `layout-transition.js` | 布局切换坐标插值/锚点补偿，供 `core-controller` 布局动画 |

## 规范约束

**应该放在这里的：**

- 图结构与布局算法
- 新增图变更方式 → 在 `graph-operations.js` 增加 operation 类型，经 `apply()` 提交

**不应该放在这里的：**

- 绕开 `apply()` 直接改 `graph.nodes`（controller 层也应通过 `applyOperation`）
- DOM/Canvas/指针事件
- 命中检测、拖拽目标解析（→ `interaction/`）
- 绘制逻辑（→ `render/`）

**依赖方向：**

- 层内可互相 import（如 `graph-operations` → `graph-serialization`）
- 可 import `coords/`（若布局需要视口数学）
- 不应 import `controllers/`、`components/`

**测试：** `test/minimap-graph.test.js`、`minimap-layout.test.js`、`minimap-graph-operations.test.js` 等。

更多上下文见 [docs/architecture.md](../../../docs/architecture.md)。
