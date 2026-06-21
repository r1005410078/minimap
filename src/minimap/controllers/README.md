# controllers — Controller 编排层

## 职责

框架无关的状态机与编排逻辑。全部是工厂函数 `createXController(deps) -> { 方法... }`，通过 `deps` 里的只读 getter 和回调与外部（Vue props、其他 controller）交互。

## 现有文件

| 文件 | 说明 |
|------|------|
| `minimap-controller.js` | 根 controller。组装 6 个子 controller，挂载/卸载 canvas DOM 事件，对外暴露 Vue 需要的全部方法 |
| `core-controller.js` | canvas/resize/layout/viewport/渲染调度/`renderCurrent()` |
| `selection-controller.js` | 选中态受控/非受控 |
| `edit-controller.js` | 撤销重做、剪贴板、复制粘贴、删除、导入导出；拥有 `operationManager` 单例 |
| `search-controller.js` | 搜索、上一个/下一个、跳转 |
| `context-menu-controller.js` | 右键菜单开关、命中转 context、动作执行 |
| `drag-controller.js` | 节点拖拽、滚动条、框选、平移、rAF 循环、滚轮、资源拖放 |

## 规范约束

**应该放在这里的：**

- 需要跨模块协调的状态机（拖拽、菜单、撤销栈、DOM 事件分发）
- 闭包内持有交互过程状态（`dragState`、`panState` 等）
- 根 controller 对「哪个 DOM 事件转发给哪个 controller」的唯一决策点

**不应该放在这里的：**

- 直接持有 Vue ref 或组件实例
- 新的 pub-sub / 全局 store 抽象
- 纯几何/布局/绘制算法（→ `graph/`、`interaction/`、`render/`）
- 不经过 `deps` 回调直接 emit 给 Vue（emit 由 Vue 层注入 deps）

**依赖方向：**

- 可 import `graph/`、`coords/`、`interaction/`、`render/`、`edit/`
- 子 controller 之间通过根 controller 延迟闭包解循环依赖，避免 controller 互相 import 形成硬循环

**测试：** 每个 `*-controller.js` 对应 `test/minimap-*-controller.test.js`；根组装用 `test/minimap-root-controller.test.js`。

更多上下文见 [docs/architecture.md](../../../docs/architecture.md)。
