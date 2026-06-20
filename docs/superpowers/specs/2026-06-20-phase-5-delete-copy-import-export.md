# 第五阶段切片 2：删除、复制、导入导出设计

## 背景

第五阶段切片 1 已经建立 `graph-operations` / history 底座，并把资源拖入、分组内换位接入同一个 operation 入口。切片 2 在此基础上补齐第一批面向编辑器的通用操作：

- 删除选中节点；
- 复制选中节点；
- 导出 graph JSON；
- 导入 graph JSON；
- 键盘 `Delete` / `Backspace` 删除；
- `Cmd/Ctrl+C` 复制；
- 顶部工具栏中的撤销、重做、删除、复制按钮从展示态变成真实按钮。

本切片仍不做跨父级拖拽移动，也不做 loading / error / aria 状态区。导入导出先作为公开 methods，不引入文件选择器、下载按钮或复杂弹窗。

## 目标

让组件具备基础编辑命令，并继续复用切片 1 的 operation/history 合同：

- `deleteSelection()` 删除当前选中内容，并可撤销/重做；
- `copySelection()` 复制当前选中内容，并可撤销/重做；
- `exportGraph()` 返回 JSON-safe graph；
- `importGraph(data)` 校验版本并替换当前 graph，可撤销/重做；
- `readonly` 阻止删除、复制、导入，但不阻止导出；
- before hooks 能阻止删除、复制、导入；
- 顶部工具栏按钮和键盘快捷键调用同一套 methods；
- `change` 继续使用切片 1 的标准 payload。

## 范围

### 范围内

- 扩展 `graph-operations.js`：
  - `delete-nodes`；
  - `copy-nodes`；
  - `replace-graph`；
  - 这些 operation 均生成 inverse，并进入 undo/redo history。
- 新增 graph 序列化 helper：
  - `serializeGraph(graph)`；
  - `deserializeGraph(data)`；
  - `validateGraphVersion(data)`。
- `Minimap.vue` 新增 props：
  - `beforeDelete(payload)`；
  - `beforeCopy(payload)`；
  - `beforeImport(payload)`。
- `Minimap.vue` 新增 expose methods：
  - `deleteSelection()`；
  - `copySelection()`；
  - `exportGraph()`；
  - `importGraph(data)`。
- 顶部工具栏接入真实行为：
  - 撤销按钮调用 `undo()`；
  - 重做按钮调用 `redo()`；
  - 删除按钮调用 `deleteSelection()`；
  - 复制按钮调用 `copySelection()`。
- 键盘接入：
  - `Delete` / `Backspace` 调用 `deleteSelection()`；
  - `Cmd/Ctrl+C` 调用 `copySelection()`；
  - 继续保留 `Esc` 清空选择。
- 删除后清理 selection：
  - 非受控 `selectedIds`：内部清空被删除 id；
  - 受控 `selectedIds`：通过 `select` 事件通知新 selection。
- 操作成功后更新布局并触发 `change`。
- 测试覆盖 operation 层、Vue methods、键盘和工具栏按钮。

### 范围外

- 跨父级拖拽移动与排序。
- 删除或复制边的独立 UI。
- 复制到鼠标位置、剪贴板系统集成、粘贴。
- 导入文件选择器、导出下载文件。
- 工具栏按钮可用态的细粒度响应式刷新。本切片按钮保持可点击，命令内部根据当前状态返回 no-op。
- loading、空图、error 可视状态。
- aria 状态区域。
- graph schema 迁移。切片 2 只接受当前 `version`。

## 行为设计

### 删除选中

`deleteSelection()` 删除当前选中的真实节点和分组内子节点。

删除规则：

- 选中普通节点时，删除该节点及其全部后代；
- 选中分组框 id（例如 `heap-1::g0`）时，删除该分组当前包含的所有子节点及其后代；
- 如果同时选中父节点和其子节点，只删除一次；
- 从父节点 `children` 中移除删除目标；
- 从 `rootIds` 中移除被删除 root；
- 删除与这些节点相关的 `edges`；
- 删除后 selection 移除已删除 id。

删除 operation payload：

```js
{
  ids,
  expandedIds,
}
```

其中 `ids` 是调用方原始选中 id，`expandedIds` 是 operation 层解析后的真实节点 id。inverse 保存被删除节点快照、原始父子顺序、原始 rootIds 和原始 edges。

### 复制选中

`copySelection()` 复制当前选中的真实节点和分组内子节点。

复制规则：

- 选中普通节点时，复制该节点及其全部后代；
- 选中分组框 id 时，复制该分组中的全部子节点及其后代；
- 同时选中父节点和子节点时，只复制最高层选中项，避免重复复制同一子树；
- 新节点插入到原父节点 `children` 中，紧跟原节点之后；
- 如果复制 root 节点，新 root 插入到 `rootIds` 的原节点之后；
- 新 id 由调用方传入 id factory，格式默认 `copy-<sourceId>-<n>`；
- label 默认保持不变；
- 复制子树内部 `parentId` 和 `children` 指向新 id；
- 本切片不复制与原节点相关的 `edges`，避免不明确的业务关系被误复制。

复制 operation payload：

```js
{
  ids,
  expandedIds,
  idMap,
}
```

`idMap` 由 Vue 层或 operation helper 根据当前 graph 生成，确保测试稳定。inverse 是删除所有新复制出的节点。

### 导出 graph

`exportGraph()` 返回 JSON-safe object：

```js
{
  version: 1,
  nodes: [
    { id, label, parentId, children, kind, width, height, data }
  ],
  rootIds,
  edges,
}
```

导出不修改 graph，不进入 history，不受 `readonly` 阻止。

### 导入 graph

`importGraph(data)` 接受 object 或 JSON string。

导入规则：

- `version` 必须等于当前支持版本；
- `nodes` 必须能转换为 `Map`；
- `rootIds` 必须存在；
- `edges` 缺省为 `[]`；
- 节点 `children` 缺省为 `[]`；
- 导入成功后用新 graph 内容替换当前 graph 内容，并进入 undo/redo；
- 导入失败返回 `{ applied: false, reason: 'invalid-version' | 'invalid' }`，不触发 `change`。

因为当前组件是原地 mutation 模型，`replace-graph` 会清空并重建现有 `props.graph.nodes`、`rootIds`、`edges`，保持外部 graph 对象引用稳定。

## Vue 集成

### Props

新增：

```js
beforeDelete: { type: Function, default: null }
beforeCopy: { type: Function, default: null }
beforeImport: { type: Function, default: null }
```

所有 before hooks 同步执行，返回 `false` 阻止默认行为。

### Methods

新增 expose methods：

```js
deleteSelection()
copySelection()
exportGraph()
importGraph(data)
```

成功执行 mutation 的 method 返回 operation result。无选中、readonly、hook 阻止或非法导入时返回未应用 result，不触发 `change`。

### Events

保留 `change` 标准 payload。

新增轻量事件：

- `delete`：删除成功后触发，payload 包含 `ids` 和 `deletedIds`；
- `copy`：复制成功后触发，payload 包含 `ids`、`copiedIds` 和 `idMap`；
- `import`：导入成功后触发，payload 包含 `graph`；
- `export`：导出成功后触发，payload 包含导出的 JSON-safe graph。

本切片不新增 `error` 事件；导入错误的可视化和 `error` 事件留给状态切片。

### 工具栏

现有顶部工具栏从展示态变为局部真实：

- 撤销：`@click="undo"`；
- 重做：`@click="redo"`；
- 删除：`@click="deleteSelection"`；
- 复制：`@click="copySelection"`。

按钮文案/图标沿用当前视觉字符，不引入图标库。导入导出不放入工具栏。

## 错误处理

- 无选中删除/复制：返回 `reason: 'empty'`；
- readonly 删除/复制/导入：返回 `reason: 'readonly'`；
- hook 阻止：返回 `reason: 'blocked'`；
- 导入版本不匹配：返回 `reason: 'invalid-version'`；
- 导入结构非法：返回 `reason: 'invalid'`。

这些失败不抛异常，不触发 `change`。

## 测试策略

### Operation 层

扩展 `test/minimap-graph-operations.test.js`：

- 删除叶子节点、带子树节点、root 节点；
- 删除时清理父 `children`、`rootIds`、相关 `edges`；
- 删除 undo/redo 还原 graph；
- 复制叶子节点和子树；
- 复制时生成稳定新 id，插入到原节点之后；
- 复制 undo/redo；
- replace graph 导入成功并可 undo/redo；
- readonly / before hooks 阻止 delete/copy/import；
- invalid version 和 invalid graph 返回失败。

### 序列化

新增或扩展 graph serialization 测试：

- `serializeGraph` 把 `Map` 转为 array；
- `deserializeGraph` 把 array 转回 `Map`；
- round trip 后 graph 结构一致；
- `version` 不匹配失败。

### Vue 集成

扩展 `test/minimap-shell.test.js` 或新增 focused 测试：

- `deleteSelection()` 删除当前选中并 emit `delete` / `change`；
- `copySelection()` 复制当前选中并 emit `copy` / `change`；
- `exportGraph()` emit `export` 且不进入 history；
- `importGraph()` emit `import` / `change`，并可 undo；
- readonly 阻止 delete/copy/import；
- before hooks 阻止 delete/copy/import；
- 键盘 `Delete` / `Backspace` 删除；
- `Cmd/Ctrl+C` 复制；
- 工具栏撤销、重做、删除、复制按钮调用真实方法。

## 验收标准

- 删除选中节点后 graph 结构正确，undo/redo 正常。
- 复制选中节点后 graph 结构正确，undo/redo 正常。
- 导出 graph 是 JSON-safe 数据，不包含 `Map`。
- 导入合法 graph 后组件重新布局，undo/redo 正常。
- 非法版本导入被拒绝。
- `readonly` 和 before hooks 能阻止删除、复制、导入。
- 键盘删除、键盘复制、工具栏撤销/重做/删除/复制可用。
- 完整 `npm test` 和 `npm run build` 通过。
