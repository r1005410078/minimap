# 第五阶段：复制/粘贴拆分设计

## 背景

第五阶段切片 2 已经合并的 `copySelection()` 是"复制即粘贴"：选中节点后调用，立刻在原节点的同一父节点下、紧跟原节点之后插入副本，一步完成 mutation，没有"已复制、等待粘贴"的中间状态。

这跟常规编辑器的复制/粘贴直觉不一致：复制应该是只读操作（只是记住要复制什么），粘贴才是真正产生新节点的操作，且应该能粘贴到当前选中的位置、可以重复粘贴多次。

本设计把 `copySelection()` 拆成两个独立动作：
- 复制：只把选中内容的快照记到组件内部 clipboard，不改图。
- 粘贴：新增的 `paste()` 方法，把 clipboard 的内容重新生成新 id 后，插入到当前选中节点下面，作为图变更进入 undo/redo。

## 目标

- `copySelection()` 不再修改 `props.graph`，不再进入 undo/redo，不再触发 `change`。
- 新增 `paste()`：把 clipboard 内容粘贴为当前选中节点的子节点，可撤销/重做，可重复调用粘贴出多份独立副本。
- `readonly` 不再拦截复制，只拦截粘贴。
- `beforeCopy` 保留，语义变为"复制前钩子"；新增 `beforePaste` 作为粘贴前钩子。
- 键盘 `Cmd/Ctrl+C` 复制、`Cmd/Ctrl+V` 粘贴；工具栏新增"粘贴"按钮。

## 范围

### 范围内

- `graph-operations.js`：
  - 删除现有 `copy-nodes` 操作（`applyCopyNodes`、`cloneSubtree`、dispatch 分支及对应测试）——不再有调用方。
  - 新增纯函数 `captureSubtreeSnapshot(graph, expandedIds)`：返回 JSON-safe 快照 `{ rootIds, nodes }`，复用现有 `highestExistingIds` 做父子同选去重。不注册进 `applyOperation`，因为它是只读辅助函数，不经过 undo/redo manager。
  - 新增操作 `paste-nodes`：payload 为 `{ targetParentId, snapshot, idMap }`，生成 inverse 进入 undo/redo。
- `Minimap.vue`：
  - 重写 `copySelection()`：只读，调用 `beforeCopy` 钩子，成功后把快照存入模块级 `clipboard` 变量，emit `copy`（payload 变为 `{ids, expandedIds}`，不再有 `copiedIds`），不 emit `change`。
  - 新增 `paste()`：解析粘贴目标、生成新 idMap、调用 `graphOperations().apply()` 执行 `paste-nodes`，成功后 `updateLayout()` + emit `paste` + `emitChange`。
  - 新增 prop `beforePaste`。
  - 新增 event `paste`；`copy` 的 payload 形状变化（见上）。
  - `handleKeyDown` 新增 `Cmd/Ctrl+V` → `paste()`。
  - 工具栏新增"粘贴"按钮。
- 测试覆盖：`graph-operations` 层（`captureSubtreeSnapshot`、`paste-nodes` 的 undo/redo/readonly/before/invalid）、Vue 集成层（`copySelection`/`paste` 的新行为、键盘、工具栏）。

### 范围外

- 系统剪贴板集成（`navigator.clipboard`）。`clipboard` 仍是组件内部、非受控、非持久化的状态。
- 粘贴位置/插入索引的精细控制。本设计固定追加到目标节点 `children` 末尾。
- 跨组件实例粘贴、跨页面刷新保留 clipboard。
- `exportGraph`/`importGraph` 不读写 clipboard，两者互不影响。
- 组件销毁或 `graph` prop 整体替换时是否清空 clipboard：本设计不主动清空（clipboard 是独立于某个 `graph` 实例的纯数据快照，理论上可以粘贴到替换后的新 graph，不强制清空；如果业务方需要清空，可以自己在监听到相应事件后重新创建组件实例）。

## 行为设计

### 复制（`copySelection()`）

1. 计算 `ids = currentSelectedIds()`、`expandedIds = selectedRealNodeIds()`（复用现有分组展开逻辑：选中分组框 id 时展开成其所有真实子节点 id）。
2. 若 `props.beforeCopy` 存在且调用返回 `false`：返回 `{ applied: false, type: 'copy-selection', operation: { type: 'copy-selection', payload: { ids, expandedIds } }, inverse: null, previousGraph: props.graph, nextGraph: props.graph, reason: 'blocked' }`，不修改 clipboard，不 emit 任何事件。
3. 若 `expandedIds` 为空（无选中）：同样返回未应用结果，`reason: 'empty'`。
4. 否则：`clipboard = captureSubtreeSnapshot(props.graph, expandedIds)`；`emit('copy', { ids, expandedIds })`；返回 `{ applied: true, type: 'copy-selection', operation: {...}, inverse: null, previousGraph: props.graph, nextGraph: props.graph, reason: null }`。

`readonly` 不影响复制——复制本身不修改图。

### 粘贴（`paste()`）

1. 解析粘贴目标：取 `currentSelectedIds()[0] ?? null`。若该 id 命中 `layout.groups` 里某个分组框（即不是真实节点 id，而是分组合成 id），用该分组的 `.parentId` 作为真实目标；否则原样使用。
2. 若目标为 `null`，或 `clipboard` 为空：操作内部返回 `reason: 'empty'`（统一走 `paste-nodes` 操作的内部校验，不在 Vue 层单独短路，跟 `deleteSelection`/`copySelection`(旧) 的既有模式一致——这样 `readonly`/`beforePaste` 仍按统一顺序优先生效）。
3. 计算 `idMap`：对 clipboard 快照里的每个节点 id，用跟现有 `createCopyIdMap`/`nextCopyId` 同样的策略（按当前 `props.graph` 的实时 id 集合生成无冲突新 id）生成一份新映射。每次调用 `paste()` 都重新生成，因此连续粘贴多次会产生多份独立副本，不会 id 冲突。
4. 调用 `graphOperations().apply({ type: 'paste-nodes', payload: { targetParentId, snapshot: clipboard, idMap } }, { readonly: props.readonly, before: props.beforePaste })`。
5. 若 `!result.applied`：直接返回该结果（不更新布局、不 emit）。
6. 若成功：`updateLayout()`；`emit('paste', { targetParentId, pastedIds: result.operation.payload.pastedIds, idMap })`；`emitChange(result)`；返回 `result`。

粘贴永远把快照里记录的所有根节点（`snapshot.rootIds`）插到 `targetParentId` 的 `children` 末尾，子树内部结构（孙节点及更深层级）按 `idMap` 整体重写 `parentId`/`children`，结构跟原快照一致。

### `paste-nodes` 操作（`graph-operations.js`）

payload：`{ targetParentId, snapshot, idMap }`，其中 `snapshot` 是 `captureSubtreeSnapshot` 返回的 `{ rootIds, nodes }`。

校验顺序（均不抛异常，返回 `blockedResult`）：
- `targetParentId` 为空，或在 `graph.nodes` 中不存在 → `reason: 'empty'`（无目标时视为"无事可做"，跟空选中删除/复制的现有惯例一致）。
- `snapshot` 为空、`snapshot.nodes` 为空数组、或 `snapshot.rootIds` 为空 → `reason: 'empty'`。
- `idMap` 没有覆盖 `snapshot.nodes` 里的某个 id → `reason: 'invalid'`。

校验通过后：
1. 为 `snapshot.nodes` 里每个节点按 `idMap` 生成新节点：新 `id = idMap[oldId]`；`children` 按 `idMap` 映射；`parentId`——若旧 `parentId` 也在 `idMap` 里（说明父节点也是这次快照的一部分），映射为新 id；否则（说明这是快照的根节点）设为 `targetParentId`。
2. 把生成的节点逐个 `graph.nodes.set(newId, node)`。
3. 把 `snapshot.rootIds` 映射后的新 id，依次 append 到 `graph.nodes.get(targetParentId).children` 末尾。
4. 返回 `applied: true`，`operation.payload` 追加 `pastedIds`（新生成的根节点新 id 列表），`inverse` 用既有的"整图快照回滚"模式（跟 `delete-nodes`/`copy-nodes`(旧) 一致：操作前 `cloneGraphData(graph)`，inverse 为 `{ type: 'replace-graph', payload: { graph: before } }`）。

不会产生环：粘贴出来的副本永远是全新 id，不可能是 `targetParentId` 的祖先。即使把节点 A 复制后粘贴回 A 自己下面，粘贴出来的是 A 的一个新副本（新 id），不是 A 本身，结构上不构成环。

### `captureSubtreeSnapshot(graph, expandedIds)`（`graph-operations.js`）

1. 用现有 `highestExistingIds(graph, expandedIds)` 去重（父子同时选中时只保留最高层）。
2. 对每个保留下来的 id，深度收集其完整子树（复用跟 `collectDescendants` 类似的遍历），克隆每个节点（跟 `graph-serialization.js` 的 `cloneNode` 同样的浅拷贝 + `children` 数组拷贝），得到一份 JSON-safe 的扁平节点数组。
3. 返回 `{ rootIds: [...保留下来的 id], nodes: [...扁平克隆节点数组] }`。

返回的 `nodes` 里每个节点的 `id`/`parentId`/`children` 都还是**原图里的真实 id**（还没有重新映射），重新映射是粘贴时才做的事——这样同一份 clipboard 可以被多次粘贴，每次生成不同的新 id。

## Vue 集成

### Props

新增：

```js
beforePaste: { type: Function, default: null }
```

`beforeCopy(payload)` 保留，调用时机变为复制前（`payload` 为 `{ ids, expandedIds }`），不再跟 `readonly` 绑定。

### Methods

新增：

```js
paste()
```

`copySelection()` 签名不变，行为按上述"复制"小节重写。

### Events

新增 `paste`，payload `{ targetParentId, pastedIds, idMap }`。

`copy` payload 变为 `{ ids, expandedIds }`（移除 `copiedIds`，因为复制阶段不再产生新节点）。

### 键盘与工具栏

- `handleKeyDown` 新增分支：`(event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v'` → `event.preventDefault()` + `paste()`。
- 工具栏在现有"复制"按钮（`aria-label="复制"`）之后新增一个"粘贴"按钮：`aria-label="粘贴"`，`@click="paste"`，图标暂定 `⎘`（跟现有单字符图标风格一致，可在实现时按视觉效果微调）。

## 错误处理

- 复制时 `beforeCopy` 返回 `false`：`reason: 'blocked'`，不进 clipboard，不 emit。
- 复制时无选中：`reason: 'empty'`。
- 粘贴时无选中目标或 clipboard 为空：`reason: 'empty'`。
- 粘贴时 `readonly` 为真：`reason: 'readonly'`（在 `beforePaste` 之前短路，跟现有 `apply()` 的既有顺序一致）。
- 粘贴时 `beforePaste` 返回 `false`：`reason: 'blocked'`。
- 这些失败都不抛异常，不触发 `change`。

## 测试策略

### Operation 层（`test/minimap-graph-operations.test.js`）

- 删除所有 `copy-nodes` 相关测试。
- 新增 `captureSubtreeSnapshot`：单节点快照、含子树快照、父子同选去重、快照内容是 JSON-safe（不含 `Map`）。
- 新增 `paste-nodes`：
  - 粘贴单节点快照到目标节点下，校验新增的 `children`、新 id 不冲突。
  - 粘贴含子树快照，校验子树内部 `parentId`/`children` 都按 `idMap` 正确重写。
  - 同一份快照用不同 `idMap` 连续粘贴两次，两份副本互不冲突、都正确挂在目标节点下。
  - undo/redo 还原。
  - `targetParentId` 不存在、`snapshot` 为空、`idMap` 缺项 时返回对应 `reason`，不抛异常。
  - readonly / before hook 阻止粘贴。

### Vue 集成层（`test/minimap-shell.test.js`）

- `copySelection()` 不再修改 `graph.nodes` 数量，不 emit `change`，`canUndo()` 保持不变。
- `beforeCopy` 返回 `false` 时阻止复制，`copy` 事件不触发。
- `paste()` 把 clipboard 内容插入当前选中节点下，emit `paste`/`change`，可 `undo()`。
- 连续 `copySelection()` 后 `paste()` 两次，得到两个不同 id 的独立副本，且都是当前选中节点的子节点。
- 选中目标是分组框 id 时，粘贴落到该分组的真实父节点下。
- 无选中、clipboard 为空时 `paste()` 返回 `reason: 'empty'`。
- `readonly`/`beforePaste` 阻止粘贴；`readonly` 不阻止 `copySelection()`。
- 键盘 `Cmd/Ctrl+V` 触发 `paste()`。
- 工具栏"粘贴"按钮点击触发 `paste()`。

## 验收标准

- `copySelection()` 不再修改图、不进入 undo/redo、不触发 `change`。
- `paste()` 把 clipboard 内容粘贴为当前选中节点的子节点，可撤销/重做，可重复粘贴生成多份独立副本。
- `readonly` 只阻止粘贴，不阻止复制。
- `beforeCopy`/`beforePaste` 能各自阻止对应动作。
- 粘贴目标是分组框 id 时正确落到该分组的真实父节点。
- 无选中或 clipboard 为空时粘贴返回 `reason: 'empty'`，不抛异常。
- 键盘 `Cmd/Ctrl+C`/`Cmd/Ctrl+V`、工具栏"复制"/"粘贴"按钮均可用。
- 完整 `npm test` 和 `npm run build` 通过。
