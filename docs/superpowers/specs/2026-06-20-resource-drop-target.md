# 资源树拖入任意节点设计

## 背景

当前资源树拖入画布时，`Minimap.vue` 的 `handleDrop` 只使用 `selectedIds[0]` 作为目标父节点；没有选中时退回 `graph.rootIds[0]`。这导致用户把资源直接拖到某个节点上时，新增节点不会挂到鼠标命中的节点下面。

## 目标

- 资源树条目可以直接拖到任意普通节点上，新增为该节点的子节点。
- 资源拖到分组框内部 item 上时，新增到该分组真实父节点下，并尽量按鼠标位置计算插入下标。
- 资源拖到空白区域时保留旧行为：优先挂到当前选中节点，否则挂到第一个 root。
- 继续复用现有 `drop-node` operation，不新增新的 graph mutation 通道。

## 行为规则

`handleDrop` 收到 drop 事件后：

1. 将事件坐标转换为世界坐标。
2. 使用 `hitTest(layout, point)` 解析鼠标命中。
3. 如果命中普通节点 `{ type: 'node', id }`：
   - `parentId = id`
   - `index = graph.nodes.get(id).children.length`
4. 如果命中分组框 item `{ type: 'group', zone: 'item' }`：
   - `parentId = group.parentId`
   - `index = groupInsertIndexToParentIndex(parent, group, null, groupGridIndexAt(group, point))`
   - 这里没有被拖动的现有 child，所以不需要从 children 中过滤某个 id。
5. 其他命中（分组 header/body）或未命中：
   - `parentId = selectedIds[0] ?? graph.rootIds[0]`
   - `index = findInsertionIndex(graph, layout, parentId, point, layoutDirection)`

## 兼容性

- `readonly`、`beforeNodeDrop`、`undo`/`redo`、`node-drop`、`change` 继续走现有 `drop-node` operation。
- 对空白区域拖入、选中节点拖入的原有测试应保持通过。
- 不改变资源树拖拽 payload 格式。

## 测试

- 新增测试：资源拖到普通节点上，新增节点的 `parentId` 等于该节点 id，插入到其 `children` 末尾，并触发 `node-drop/change`。
- 新增测试：即使当前已有选中节点，资源拖到另一个普通节点上时，鼠标命中的节点优先于选中节点。
- 回归测试：空白区域拖入仍使用选中节点或 root。
