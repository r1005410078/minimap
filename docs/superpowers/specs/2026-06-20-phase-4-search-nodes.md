# Phase 4 搜索节点 Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第四阶段：导航和查找能力。
> 第四阶段拆成 3 个切片：[视图定位方法](2026-06-20-phase-4-view-positioning.md) → **搜索节点**（本 spec）→ Overview 小地图导航。本 spec 覆盖第二个切片：按 `id`/`label` 搜索普通节点和分组框内子节点，内建搜索框 UI（输入即搜 + 上一个/下一个循环导航），跳转和高亮复用切片 1 的 `centerOnNode`/`select`。
> 依赖 [视图定位方法 spec](2026-06-20-phase-4-view-positioning.md) 的 `centerOnNode(id)`（含分组揭示）、`select(ids, mode)`（含受控判断）。

## 头脑风暴决策记录

- **不支持循环导航 vs 支持**：最初按 ROADMAP 字面"搜索并跳转到匹配结果"的最简读法，只考虑"跳转到第一个匹配即可"。但确定要加可见搜索框 UI 后，重新评估：多个匹配结果只能跳第一个会让搜索框显得残缺（比如搜"cluster"会命中 24 个节点，用户却看不到、够不到其余 23 个）。改为支持上一个/下一个循环导航（绕回边界），体验对齐浏览器 Ctrl+F。
- **是否加内建搜索框 UI**：跟项目目前所有其它能力（选中、视口、分组状态）"纯方法 + 事件，不内置 UI，宿主自己决定怎么呈现"的一贯做法不同，这次决定加一个内建的可见搜索框（输入框 + 计数 + 上/下按钮），叠加在 canvas 容器右上角。原因：搜索是用户直接交互的入口，留给宿主方分别实现往往会导致大量重复劳动；通过 `options.enableSearch`（默认 `true`）可以关掉内建框，宿主方仍可以只调 `search()`/`searchNext()`/`searchPrevious()` 方法自己接 UI，两种用法不冲突。
- **响应式状态的引入**：搜索框是这个组件第一次出现的真实 DOM 交互状态（输入框的值、匹配数量、当前下标），需要用 Vue 的 `ref` 驱动模板渲染。跟现有"画布交互状态用模块级 `let`、不触发 Vue 响应式"的约定（dragState/panState/marqueeState 等）不冲突——那些状态只服务于 Canvas 命令式重绘，从来不出现在模板里；搜索框状态恰恰相反，必须出现在模板里，所以该用 `ref`。两类状态分别用各自该用的工具，不是新引入不一致。
- **匹配规则**：`id` 或 `label` 子串包含、忽略大小写。空字符串或全空白关键词显式返回 `[]`（不匹配一切）——因为 JS 里任意字符串 `.includes('')` 永远为 `true`，如果不特判，清空输入框会变成"匹配全部节点并跳到根节点"这种反直觉行为。
- **匹配顺序**：从 `graph.rootIds` 深度优先遍历 `graph.nodes`（按 `children` 顺序），命中即按遍历顺序收集。这是节点在树里出现的"自然顺序"，决定了"第一个匹配"和"下一个/上一个"的循环顺序是确定且符合直觉的（同一层级先出现的兄弟先被搜到）。
- **搜索范围只看 `graph.nodes`，不关心分组折叠**：分组是布局期的视觉聚合，不改变 `graph.nodes`/`children` 数据本身，所以遍历 `graph.nodes` 天然就能搜到分组框内部的子节点，不需要在搜索逻辑里特判"是否被折叠"——折叠态子节点的可见性问题完全交给已有的 `centerOnNode`（它已经会把目标滚动到可见区）。
- **命中后是否联动选中**：跳转到结果的同时把该节点设为选中（复用 `select([id])`，与已有的选中高亮视觉是同一套机制，不是新画法）。这样用户在画布上能直观看到"这就是搜索结果"，跟切片 1 的 `centerOnSelection` 高亮机制保持一致的视觉语言。
- **触发时机**：输入框内容变化即触发搜索（不需要回车/提交），因为对当前量级（压力图 10000 节点）只是一次子串扫描，性能可忽略；`Enter` 键复用给"跳转下一个"，贴近 Ctrl+F 的肌肉记忆。
- **`searchNext`/`searchPrevious` 也通过 `defineExpose` 暴露**：跟项目里"UI 触发的动作也始终有对应的可编程方法"这一贯穿全组件的原则保持一致（点击选中有 `select()`，拖拽视口有 `setViewport()`，这里点击下一个/上一个也应该有方法对应），方便宿主方做自己的键盘快捷键或外部搜索 UI。
- **`options.enableSearch` 开关**：默认 `true`（搜索框可见）；设为 `false` 时不渲染搜索框 DOM，但 `search`/`searchNext`/`searchPrevious` 三个方法始终可调用——这样宿主方想自己做搜索 UI 时，只需要关掉内建框，照常调方法即可，不用绕过组件。

## 范围

### 目标（本切片交付）

- `src/minimap/search.js`（新建）：
  - `searchNodes(graph, keyword)`：纯函数，深度优先遍历 + 子串匹配，返回匹配 id 数组（遍历顺序）。
- `src/minimap/Minimap.vue`：
  - 新增响应式状态：`searchKeyword`/`searchMatches`/`searchCurrentIndex`（`ref`）。
  - 新增 `jumpToSearchResult(id)`（内部辅助，复用 `centerOnNode` + `select`）。
  - 新增并通过 `defineExpose` 暴露：`search(keyword)`、`searchNext()`、`searchPrevious()`。
  - 新增 `'search'` emit，payload `{ keyword, matches, current }`。
  - 模板新增搜索框 UI（输入框 + 计数 + 上一个/下一个按钮），由 `options.enableSearch !== false` 控制渲染。
  - 新增对应样式（深色主题，绝对定位于 canvas 容器右上角）。
- 测试：新建 `test/minimap-search.test.js`（`searchNodes` 纯函数用例）；新建或扩展 Vue 组件测试覆盖搜索框 UI 交互、`defineExpose` 三个方法、受控模式、`options.enableSearch` 开关。`npm test`、`npm run build` 通过。
- `ROADMAP.md` 的 `Methods` 契约补充 `searchNext()`/`searchPrevious()`（原契约只有 `search(keyword)`，本切片落地时发现需要扩展，属于契约的自然演进，记录在这里而不是回头改之前阶段的文档）。

### 非目标（后续切片）

- Overview 小地图导航——切片 3。
- 搜索结果的 aria 无障碍状态区域——属于第五阶段"可访问性"范围，本切片不提前做。
- 搜索框的多语言/国际化文案——固定中文占位符即可，不引入 i18n 机制。

## 模块 API 契约

### `src/minimap/search.js`

```js
// 从 graph.rootIds 深度优先遍历 graph.nodes（按 children 顺序），
// 对 node.id / node.label 做忽略大小写的子串匹配；命中即按遍历顺序收集。
// keyword 为空或全空白时返回 []（不匹配一切）。
export function searchNodes(graph, keyword) { /* string[] */ }
```

### `src/minimap/Minimap.vue`（`defineExpose` 新增 3 个）

```js
// 设置关键词、计算匹配列表、跳转+选中第一个匹配（若有），emit('search', payload) 一次。
// 返回值跟 emit 的 payload 同形状，供调用方做"下一个/上一个"等自定义 UI。
search(keyword) // -> { keyword: string, matches: string[], current: string | null }

// 在当前 searchMatches 里前进一位（绕回），跳转+选中，emit('search', ...)。matches 为空则 no-op。
searchNext()    // -> void

// 同 searchNext，反方向。
searchPrevious() // -> void
```

### Events 新增

- `search`：`search`/`searchNext`/`searchPrevious` 调用后各发一次，payload `{ keyword, matches, current }`。

### `options.enableSearch`

- 默认 `true`。设为 `false` 时不渲染搜索框 DOM；三个方法不受影响，始终可调用。

## 验收标准

- 搜索普通节点（如 `feeder-1`）和分组框内部子节点（如折叠分组里的 `cluster-24`）都能正确跳转，子节点会被滚动揭示到可见区（复用 `centerOnNode` 既有行为，不重复实现）。
- 多个匹配项时，`searchNext()`/`searchPrevious()`（及对应 UI 按钮）正确循环，越过末尾/开头时绕回。
- 命中跳转后，目标节点同时被设为选中态，画布上能看到高亮。
- 空/全空白关键词不匹配任何节点，不跳转、不选中，`search` 事件仍正常发出（`matches: []`、`current: null`）。
- `options.enableSearch: false` 时搜索框 DOM 不渲染，但 `search`/`searchNext`/`searchPrevious` 仍可通过组件实例调用并生效。
- 受控 `selectedIds`/`viewport`/`groupStates` 任一为非 `null` 时，搜索触发的内部跳转/选中只 `emit` 对应事件，不直接改组件内部状态（复用 `centerOnNode`/`select` 已有的受控语义，不重新实现）。
- `npm test`、`npm run build` 通过。

## 测试清单

- `search.js`：`searchNodes` 命中 `id`/`label`、忽略大小写、子串而非全等、深度优先遍历顺序（同层兄弟先后顺序、父节点先于子节点出现时的顺序）、空/全空白关键词返回 `[]`、关键词不命中任何节点时返回 `[]`、命中分组框内部子节点（数据层面，不依赖分组是否折叠）。
- `Minimap.vue`：
  - `search(keyword)` 命中单个普通节点：跳转 + 选中 + emit 正确。
  - `search(keyword)` 命中分组框内折叠/滚出可见区的子节点：验证 `centerOnNode` 的揭示行为被正确触发（`groupStates` 的 `scrollTop` 变化）。
  - `search(keyword)` 命中多个节点：`current` 是遍历顺序里的第一个；`searchNext()`/`searchPrevious()` 正确推进/回退并在边界绕回。
  - 空关键词：不跳转、不选中、`matches` 为空数组、`current` 为 `null`。
  - `searchNext()`/`searchPrevious()` 在没有先调用过 `search()`（`searchMatches` 为空）时是 no-op，不报错。
  - `options.enableSearch: false` 时搜索框 DOM（input/button）不存在；`options.enableSearch` 默认或显式 `true` 时存在。
  - 搜索框 UI 交互：在 input 上 dispatch `input` 事件触发跳转；dispatch `Enter` keydown 触发 `searchNext`；点击上一个/下一个按钮触发对应方法；按钮在 `searchMatches` 为空时 `disabled`。
  - 受控 `selectedIds`/`viewport`/`groupStates` 模式下，`search`/`searchNext`/`searchPrevious` 只 emit，不直接改内部状态（验证方式跟切片 1 的受控测试一致）。
- 回归：现有测试套件保持通过；新增的响应式 `ref` 状态不影响现有命令式画布重绘路径。
