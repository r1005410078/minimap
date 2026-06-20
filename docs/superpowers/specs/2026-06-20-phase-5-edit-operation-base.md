# 第五阶段切片 1：编辑操作底座设计

## 背景

第四阶段已经完成视图定位、搜索和 overview，小地图具备完整浏览能力。进入第五阶段后，组件要开始支持可编辑能力，包括撤销/重做、删除、复制、导入导出、跨父级拖拽、只读模式和 before hooks。

当前代码里已经存在两类图数据修改：

- 资源树拖入节点：`Minimap.vue` 在 `handleDrop` 中直接修改 `props.graph.nodes` 和父节点 `children`。
- 分组框内部换位：`Minimap.vue` 在拖拽结束后调用 `reorderGroupChild(props.graph, ...)`，再触发 `group-reorder` 和 `change`。

这些 mutation 入口比较分散。第五阶段如果直接继续加删除、复制、跨父级拖拽，会导致每个行为都重复处理只读、拦截、历史栈和事件 payload。因此切片 1 先建立统一的编辑操作底座。

## 目标

新增一个独立的 `graph-operations` / history 层，让现有拖入和分组内换位先迁移到同一个 mutation 入口，并为后续编辑能力提供稳定合同。

切片 1 完成后：

- 资源拖入和分组内换位仍保持现有交互体验；
- 这两类操作都会通过 operation 层执行；
- 支持 `readonly` 阻止编辑；
- 支持 before hooks 阻止默认操作；
- 支持 `undo` / `redo`；
- 支持 `canUndo` / `canRedo`；
- `change` 事件 payload 标准化，后续删除、复制、跨父级移动都复用同一形状。

## 范围

### 范围内

- 新增纯 JS operation 层，脱离 Vue，可单元测试。
- 新增 history 栈：
  - 成功执行 operation 后入 undo 栈；
  - `undo()` 回退上一步；
  - `redo()` 重做上一步；
  - 新操作发生后清空 redo 栈；
  - 无可撤销或可重做项时返回空结果，不修改 graph。
- 迁移现有拖入节点：
  - operation 类型为 `drop-node`；
  - 继续生成新节点并插入目标父节点的指定位置；
  - 继续触发 `node-drop`；
  - 继续触发 `change`，但 payload 改为标准对象。
- 迁移现有分组内换位：
  - operation 类型为 `reorder-group-child`；
  - 继续更新真实 `parent.children` 顺序；
  - 继续触发 `group-reorder`；
  - 继续触发 `change`，但 payload 改为标准对象。
- 增加 props / options 合同：
  - `readonly` prop，默认 `false`；
  - `beforeNodeDrop(payload)`；
  - `beforeGroupReorder(payload)`。
- 增加暴露方法：
  - `undo()`；
  - `redo()`；
  - `canUndo()`；
  - `canRedo()`。
- 更新测试覆盖：
  - 纯 operation 层测试；
  - Vue 拖入和换位行为回归；
  - readonly 阻止拖入和换位；
  - before hooks 返回 `false` 时阻止默认 mutation；
  - undo/redo 能还原拖入和换位。

### 范围外

- 删除节点。
- 复制节点。
- 导入/导出 graph JSON。
- graph `version` 校验。
- 节点跨父级拖拽移动与排序。
- 键盘 `Delete`、复制快捷键。
- loading、空图、error 状态。
- aria 状态区域。
- 性能状态和生命周期收尾。
- 工具栏按钮真实接入 undo/redo。

这些能力属于第五阶段后续切片，但要基于本切片建立的 operation/history 合同实现。

## 数据模型和操作合同

### Operation

operation 是描述一次图数据修改的普通对象。

```js
{
  type: 'drop-node',
  payload: {
    resource,
    parentId,
    index,
    id,
  },
}
```

```js
{
  type: 'reorder-group-child',
  payload: {
    groupId,
    parentId,
    childId,
    index,
  },
}
```

`id` 由 Vue 层在拖入时生成并传入 operation，避免 operation 层依赖 `Date.now()`，保证测试稳定。

### Operation Result

执行结果统一返回：

```js
{
  applied: true,
  type,
  operation,
  inverse,
  previousGraph,
  nextGraph,
  reason: null,
}
```

未执行时返回：

```js
{
  applied: false,
  type,
  operation,
  inverse: null,
  previousGraph: graph,
  nextGraph: graph,
  reason: 'readonly' | 'blocked' | 'invalid' | 'empty',
}
```

`previousGraph` 和 `nextGraph` 在切片 1 中允许指向同一个 graph 对象，因为现有组件仍以原地 mutation 为基础。切片 1 先稳定事件合同。后续如果需要不可变更新，只在 operation 层内部演进，不改变外部 payload 形状。

### Inverse Operation

每个成功 operation 必须生成一个 inverse：

- `drop-node` 的 inverse 是删除刚插入的新节点，并从父节点 `children` 移除该 id。
- `reorder-group-child` 的 inverse 是把同一个 child 移回原始下标。

切片 1 不暴露通用删除能力；inverse 内部可以使用 private operation 类型，例如 `remove-dropped-node`，只服务 history。

## Vue 集成

### Props

`Minimap.vue` 新增：

- `readonly: { type: Boolean, default: false }`
- `beforeNodeDrop: { type: Function, default: null }`
- `beforeGroupReorder: { type: Function, default: null }`

readonly 为 true 时：

- 资源拖入不修改 graph；
- 分组内点击仍可选中子节点；拖拽超过阈值后释放也不写回 `parent.children`；
- 不触发 `node-drop`、`group-reorder`、`change`；
- operation result 的 `reason` 为 `readonly`。

### Events

保留现有事件名：

- `node-drop`
- `group-reorder`
- `change`

`node-drop` 和 `group-reorder` 继续发送面向行为的轻量 payload，保证现有调用方容易理解。

`change` 改为发送标准 payload：

```js
{
  type,
  operation,
  previousGraph,
  nextGraph,
  reason: null,
}
```

当 operation 被 readonly、before hook 或非法输入阻止时，不触发 `change`。

### Methods

通过 `defineExpose` 增加：

- `undo()`
- `redo()`
- `canUndo()`
- `canRedo()`

`undo()` / `redo()` 成功时触发 `change`，type 分别为：

- `undo`
- `redo`

payload 中包含被回退或重做的 operation，便于外部记录审计日志。

## Before Hooks

### `beforeNodeDrop(payload)`

在创建新节点前调用。

payload：

```js
{
  resource,
  parentId,
  index,
  id,
}
```

返回 `false` 时阻止默认拖入，不修改 graph，不触发 `node-drop` 或 `change`。

### `beforeGroupReorder(payload)`

在真实写回 `parent.children` 前调用。

payload：

```js
{
  groupId,
  parentId,
  childId,
  index,
}
```

返回 `false` 时阻止默认换位，不修改 graph，不触发 `group-reorder` 或 `change`。

本切片只支持同步返回值。异步校验放后续扩展，避免在切片 1 引入拖拽结束后的 pending 状态。

## 错误和非法输入

operation 层对非法输入保持防御式处理：

- 父节点不存在：返回 `reason: 'invalid'`；
- 拖入 id 已存在：返回 `reason: 'invalid'`；
- 换位 child 不属于 parent：返回 `reason: 'invalid'`；
- index 越界：夹到合法范围；
- undo/redo 栈为空：返回 `reason: 'empty'`。

非法输入不抛异常，不触发 `change`。真正的错误状态展示留给第五阶段状态切片。

## 测试策略

### 纯函数测试

新增 `test/minimap-graph-operations.test.js`：

- `drop-node` 会新增节点并插入父节点指定位置；
- `drop-node` 会生成 inverse，undo 后移除节点并恢复 children；
- `reorder-group-child` 会更新顺序并生成 inverse；
- 新操作后 redo 栈清空；
- readonly 返回 `applied: false`；
- before hook 返回 false 返回 `reason: 'blocked'`；
- 非法 parent/child 返回 `reason: 'invalid'`。

### Vue 集成测试

更新现有测试：

- `test/minimap-drop.test.js`：
  - 拖入仍增加节点；
  - `node-drop` payload 不变；
  - `change` payload 改为标准对象；
  - readonly 阻止拖入；
  - `beforeNodeDrop` 阻止拖入。
- `test/minimap-group-interaction.test.js`：
  - 分组内拖拽仍更新 graph；
  - `group-reorder` payload 不变；
  - `change` payload 改为标准对象；
  - readonly 阻止换位；
  - `beforeGroupReorder` 阻止换位。
- `test/minimap-shell.test.js` 或新增 focused 测试：
  - `wrapper.vm.undo()` / `redo()` 可以撤销和重做拖入；
  - `canUndo()` / `canRedo()` 状态随操作变化。

## 验收标准

- 现有拖入和分组内换位交互不退化。
- `readonly` 下拖入和换位不会修改 graph。
- before hooks 能阻止拖入和换位。
- 拖入和换位后可以 undo，再 redo。
- 新操作发生后 redo 栈被清空。
- `change` payload 统一为标准对象。
- 完整 `npm test` 和 `npm run build` 通过。
