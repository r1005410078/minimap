# edit — 编辑辅助

## 职责

搜索、右键菜单项构建、模块级剪贴板等编辑相关的纯辅助逻辑。不持有 Vue state，不直接挂载 DOM 监听。

## 现有文件

| 文件 | 说明 |
|------|------|
| `search.js` | 图 DFS + 子串匹配（`searchNodes`） |
| `context-menu.js` | 默认菜单项构建（`buildContextMenuItems`）、与 prop 合并（`mergeContextMenuItems`）、`BUILT_IN_CONTEXT_MENU_ACTIONS` |
| `clipboard.js` | 模块级单例剪贴板（`getClipboard`/`setClipboard`/`hasClipboard`/`clearClipboard`） |

## 规范约束

**应该放在这里的：**

- 可复用的编辑辅助纯函数
- 跨 Minimap 实例共享的剪贴板（模块单例，非 Vue ref）

**不应该放在这里的：**

- 撤销重做栈与 operation 应用（→ `graph/graph-operations.js`，由 `edit-controller` 编排）
- 菜单开关、document 外部点击监听（→ `controllers/context-menu-controller.js`）
- 搜索跳转、相机联动（→ `controllers/search-controller.js`）

**依赖方向：**

- 尽量只依赖 `graph/` 的数据形状；避免 import `controllers/`
- `clipboard.js` 不依赖 Vue

**测试：** `test/minimap-search.test.js`、`minimap-context-menu.test.js`；剪贴板行为在 `minimap-edit-controller.test.js` 等集成测试中覆盖。

更多上下文见 [docs/architecture.md](../../../docs/architecture.md)。
