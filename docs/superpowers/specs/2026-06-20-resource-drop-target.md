# 资源树拖入任意节点设计

## 背景

当前资源树拖入画布时，`Minimap.vue` 的 `handleDrop` 只使用 `selectedIds[0]` 作为目标父节点；没有选中时退回 `graph.rootIds[0]`。这导致用户把资源直接拖到某个节点上时，新增节点不会挂到鼠标命中的节点下面。

## 目标

- 资源树条目可以直接拖到任意普通节点上，新增为该节点的子节点。
- 资源拖到分组框内部 item 上时，该 item 也按真实节点处理，新增为这个 item 节点的子节点。
- 资源拖到空白区域时保留旧行为：优先挂到当前选中节点，否则挂到第一个 root。
- 继续复用现有 `drop-node` operation，不新增新的 graph mutation 通道。
- 真实节点拖拽到同父兄弟节点附近时，应解释为兄弟换位置，而不是变成该兄弟的子节点。

## 行为规则

### 资源树拖入

`handleDrop` 收到 drop 事件后：

1. 将事件坐标转换为世界坐标。
2. 使用 `hitTest(layout, point)` 解析鼠标命中。
3. 如果命中普通节点 `{ type: 'node', id }`：
   - `parentId = id`
   - `index = graph.nodes.get(id).children.length`
4. 如果命中分组框 item `{ type: 'group', zone: 'item', childId }`：
   - `parentId = childId`
   - `index = graph.nodes.get(childId).children.length`
   - 这样分组框内部 item 与普通节点保持一致，都能直接接收资源作为子节点。
5. 其他命中（分组 header/body）或未命中：
   - `parentId = selectedIds[0] ?? graph.rootIds[0]`
   - `index = findInsertionIndex(graph, layout, parentId, point, layoutDirection)`

### 同父兄弟换位置

已有真实节点从画布内拖拽时，如果拖拽节点和命中的目标节点拥有同一个真实父节点，则这次 drop 优先解释为兄弟换位置：

1. 不修改拖拽节点的 `parentId`。
2. 只调整共同父节点的 `children` 顺序。
3. 继续复用现有 `reorder-group-child` operation。
4. 继续触发 `group-reorder` 和标准化 `change` 事件。
5. 继续支持 `undo` / `redo`、`readonly` 和 `beforeGroupReorder`。

排序方向按布局方向判断：

- 左右布局时，兄弟节点在交叉轴上通常上下排列；拖到目标节点上半区表示插到目标前，下半区表示插到目标后。
- 上下布局时，兄弟节点在交叉轴上通常左右排列；拖到目标节点左半区表示插到目标前，右半区表示插到目标后。

如果拖拽节点和目标节点不是同父兄弟，则保留第五阶段切片 3 的跨父级移动语义：拖到目标节点上表示变成目标节点的子节点。

> 拖拽过程中的虚拟占位、插入线、兄弟让位动画等视觉预览方案仍待单独讨论；本文档只固定最终 mutation 语义。

## 兼容性

- `readonly`、`beforeNodeDrop`、`undo`/`redo`、`node-drop`、`change` 继续走现有 `drop-node` operation。
- 对空白区域拖入、选中节点拖入的原有测试应保持通过。
- 不改变资源树拖拽 payload 格式。
- 兄弟换位置继续走 `reorder-group-child`，不新增 mutation 类型。

## 测试

- 新增测试：资源拖到普通节点上，新增节点的 `parentId` 等于该节点 id，插入到其 `children` 末尾，并触发 `node-drop/change`。
- 新增测试：即使当前已有选中节点，资源拖到另一个普通节点上时，鼠标命中的节点优先于选中节点。
- 回归测试：资源拖到已选中的分组框 item 上时，新增为该 item 的子节点，保持原有“拆出分组”能力。
- 回归测试：空白区域拖入仍使用选中节点或 root。
- 新增测试：拖拽真实节点到同父兄弟节点前半区 / 后半区时，只改变共同父节点 `children` 顺序，不修改 `parentId`。
