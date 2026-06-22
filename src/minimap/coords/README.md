# coords — 坐标与视口

## 职责

世界坐标与屏幕坐标的双向转换，以及 viewport 的纯数学（平移、缩放、fit、tween、边界 clamp）。无 DOM 依赖。

## 现有文件

| 文件 | 说明 |
|------|------|
| `coords.js` | `worldToScreen` / `screenToWorld` / `screenRectToWorld` |
| `viewport.js` | `panViewportBy`、`zoomViewportAt`、`fitViewportToBounds`、`tweenViewport`、`clampScale`、`viewportOptions` 等 |

## 规范约束

**应该放在这里的：**

- 坐标变换与 viewport 数值运算
- 与 scale/x/y 相关的纯函数

**不应该放在这里的：**

- 直接读写 canvas 或 DOM
- 布局树结构计算（→ `graph/layout.js`）
- 命中检测（→ `interaction/`）
- 持有交互过程状态或 rAF 循环（→ `controllers/`）

**依赖方向：**

- `viewport.js` 可 import `coords.js`、`graph/layout-transition.js`（ease 函数）
- 不应 import `render/`、`controllers/`（避免渲染/编排反向依赖视口数学）

**测试：** `test/minimap-coords.test.js`、`minimap-viewport.test.js`。

更多上下文见 [docs/architecture.md](../../../docs/architecture.md)。
