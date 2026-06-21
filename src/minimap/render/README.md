# render — 渲染

## 职责

Canvas 绘制、渲染合帧与降级策略、主题常量、连线几何、Overview 缩略图坐标转换。负责「怎么画」，不负责「改图数据」或「处理指针状态机」。

## 现有文件

| 文件 | 说明 |
|------|------|
| `renderer.js` | 主绘制：`renderScene`、节点/分组/连线/网格/选中态/拖拽态；自定义 `nodeRenderer`/`groupRenderer`/`edgeRenderer` 钩子 |
| `render-scheduler.js` | 平移/框选等高频路径的渲染合帧 |
| `render-quality.js` | 缩小时降级（减少文字、分组子项） |
| `theme.js` | 默认主题与颜色常量 |
| `orthogonal.js` | 直角折线连线路径几何 |
| `overview.js` | Overview 缩略图视口变换、视口框矩形、裁剪 |

## 规范约束

**应该放在这里的：**

- 绘制与视觉相关的纯函数或轻量调度器
- 主题、连线走线、overview 坐标换算

**不应该放在这里的：**

- 修改 graph 或 selection 业务状态
- 指针/键盘事件处理（→ `controllers/`）
- 布局树计算（→ `graph/layout.js`）

**依赖方向：**

- 可 import `coords/`、`graph/layout.js`、`interaction/` 的几何结果（只读）
- 自定义 renderer 钩子必须接收稳定的公开参数，不依赖 Vue 私有 state
- 不应 import `controllers/`、`components/`

**测试：** `test/minimap-renderer.test.js`、`minimap-render-scheduler.test.js`、`minimap-overview.test.js` 等。

更多上下文见 [docs/architecture.md](../../../docs/architecture.md)。
