# interaction — 交互几何

## 职责

指针位置相关的纯几何：命中检测、拖拽目标解析、滚动条几何、选中集合运算、分组内让位动画数学。输入是 layout + 坐标，输出是命中结果或中间几何量，不提交图变更。

## 现有文件

| 文件 | 说明 |
|------|------|
| `interaction.js` | `hitTest`、`resolveDropTarget`、`scrollbarMetrics`/`hitScrollbarThumb`、自动滚动/边缘平移速度等 |
| `drag-transition.js` | 分组框内换位让位动画：虚拟顺序、子节点矩形插值 |
| `selection.js` | `applySelectionClick`、`applySelectionSet`、`idsInSelectionRect` |
| `spatial-index.js` | `buildSpatialIndex`/`queryPoint`/`queryRect`/`getSpatialIndex`：顶层可见项的网格空间索引，供 `hitTest`/`idsInSelectionRect` 用 |

## 规范约束

**应该放在这里的：**

- 「给定点 (x,y)，算什么」类的纯函数
- 不修改 graph、不 emit 事件、不调度 rAF

**不应该放在这里的：**

- 指针事件监听、拖拽状态机（→ `controllers/drag-controller.js`）
- 直接调用 `graph-operations.apply()` 提交变更
- Canvas 绘制（→ `render/`）

**依赖方向：**

- 可 import `graph/layout.js`、`coords/coords.js`（如 `screenRectToWorld` 用于框选）、`render/renderer.js`（如 `resolveEdges` 用于选中关系高亮）
- 函数签名中 layout 由调用方显式传入，不在此层持有 controller 引用
- 不应 import `controllers/`、`components/`

**测试：** `test/minimap-interaction.test.js`、`minimap-selection.test.js`、`minimap-drag-transition.test.js`。

更多上下文见 [docs/architecture.md](../../../docs/architecture.md)。
