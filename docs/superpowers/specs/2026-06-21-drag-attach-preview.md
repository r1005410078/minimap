# 拖拽"挂接预览"补齐 设计文档

## 背景

上一轮（兄弟节点拖拽精度调整）排查发现，画布内部的拖拽视觉反馈在不同场景下不统一：

- 兄弟节点插入排序（空隙命中/边缘窄带）：有占位框（`drawDropSlot`），**没有连接线**。
- 拖到普通节点中间变成子节点、拖到非兄弟普通节点变成子节点、从分组框拖出落到普通节点上变成子节点：**只有整节点高亮，没有占位框，没有连接线**。
- 拖进任意分组框的格子里（同组内换位，或从别处/别的分组跨过来）：已经有占位框 + 让位动画，而且分组框本身任何时候都通过正常渲染（`resolveEdges`，`renderer.js:77`）永久连着它的父节点——这条连线不是预览，是真实存在的，拖不拖都在。**这一类不需要补任何东西**。

本设计补齐前两类的缺口，统一成一套机制：**占位框 + 连接线**，去掉整节点高亮。

## 目标行为

任何"拖拽落地后会让画布上出现一个新的父子关系"的场景（不管是兄弟间插入排序，还是变成某个普通节点的子节点），都用同一种反馈：

- 在落点位置画一个跟标准节点同样大小的占位框（复用已有的 `drawDropSlot`）。
- 从占位框画一条线连到它未来的父节点，复用 `orthogonalPath` 计算路径（跟真实连线同一套几何算法），用预览色（`dropSlot` 的描边色 `#3d9cff`）画成虚线，跟真实连线（`theme.edge.color`，实线）区分开。
- 不再对任何节点做整节点高亮。

涵盖的场景：
1. 兄弟节点之间的空隙命中、边缘窄带（已有占位框，补连接线）。
2. 拖到兄弟节点中间区域（nest，变成该兄弟的子节点）。
3. 拖到非兄弟普通节点上（变成该节点的子节点）。
4. 从分组框内部拖出，落到一个普通节点上（变成该节点的子节点）。
5. 拖到自己当前的父节点身上（"重新排到最后"，技术上走 `reorder-group-child`，但视觉上跟"变成子节点"用同一条计算逻辑——见下文"挂接预览框位置计算"）。

不涵盖（已经有完整反馈，不用动）：
- 分组框内部子节点之间的拖拽换位。
- 拖到任意分组框的格子里（不管来源是哪里）。

## 数据流改动

### `resolveDropTarget` 的"nest"分支补上 `previewRect`

`src/minimap/interaction.js` 里 `resolveDropTarget` 现在对"nest"结果（兄弟中间区域、非兄弟节点命中）统一返回 `previewRect: null`（见上一轮实现，`interaction.js` 第 309~315 行附近）。这次改成：这条分支也计算一个"挂接预览框"，跟兄弟插入排序的 `previewRect` 是同一个字段，只是计算方式不同（见下文几何计算）。

### `Minimap.vue` 渲染层

- `dragState.insertPreviewRect` 字段不用改名，含义扩展为"无论插入排序还是变成子节点，落点的预览框世界坐标"，`null` 表示这次悬停不产生任何新的父子关系（比如悬停在分组框 header、悬停空白、目标是自己或自己的后代）。
- `dragHighlightId` 这个变量和它依赖的高亮逻辑**整段删除**——现在所有"会产生父子关系"的悬停都用 `insertPreviewRect`+连接线表达，不再需要整节点高亮。`renderCurrent` 里原来 `highlightedIds` 在拖拽态时只会是 `relations.highlightedIds`（空集合，因为拖拽中 `buildSelectionRelations` 已经传空选区），不再叠加 `dragHighlightId`。
- 新增一个 `dragState.previewParentRect`（世界坐标，`previewRect` 非空时同步设置，指向 `targetParentId` 对应节点的矩形，用 `layout.nodes.get(targetParentId)` 取——`targetParentId` 在这套机制里只会是"即将变成父节点"的那个普通节点本身，不会是分组，不需要查分组）——渲染连接线需要知道线的另一端在哪。
- `renderCurrent` 传给 `renderScene` 的 `state.siblingInsertPreview` 形状从 `{ rect }` 扩展成 `{ rect, parentRect }`，两个字段都是屏幕坐标（`worldRectToScreen` 转换后）；`parentRect` 为 `null` 时（理论上不会发生，`previewRect` 非空必然伴随 `previewParentRect` 非空）不画连接线，只画框。

### `renderer.js`

新增一个连接线绘制函数，复用 `orthogonalPath`：

```js
function drawAttachPreviewLine(ctx, fromBox, toBox, mainAxis, theme) {
  const dropSlot = { ...defaultTheme.group.dropSlot, ...(theme.group.dropSlot || {}) }
  const path = orthogonalPath(toBox, fromBox, mainAxis).map((point) => worldToScreen(point, viewport))
  ctx.strokeStyle = dropSlot.stroke
  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(path[0].x, path[0].y)
  for (const point of path.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.stroke()
  ctx.setLineDash([])
}
```

（具体参数列表、`viewport`/`theme` 怎么传入由实施计划决定，这里只定设计意图：复用 `orthogonalPath`，虚线，颜色取 `dropSlot.stroke`。）

`renderScene` 在画 `state.siblingInsertPreview.rect` 的 `drawDropSlot` 之前，先用 `state.siblingInsertPreview.parentRect` 画这条线（线在下，框在上，框压住线的起点，视觉上像是"框挂在线上"）。

## 挂接预览框位置计算（新增）

新增一个私有函数 `attachPreviewRect(graph, layout, draggedNodeId, targetParentId, direction)`，在 `resolveDropTarget` 的 nest 分支调用，计算"如果把 `draggedNodeId` 追加成 `targetParentId` 的最后一个子节点，它会出现在哪"：

- 拿 `targetParentId` 的 `children`，去掉 `draggedNodeId`（防止"拖到自己当前父节点身上"这种情况把自己算进去）。
- 在剩下的 children 里找最后一个仍是平铺节点的（`layout.nodes.has(id)`，跟空隙命中那段排除分组消费节点的逻辑一致）。
  - **找到了**：新预览框紧贴在它后面——跟 `siblingEdgePreviewRect` 的"after"逻辑一样的轴向数学（横向树：贴在下边外侧；纵向树：贴在右边外侧），只是锚点换成"目标节点的最后一个平铺子节点"而不是"被拖节点的兄弟"。
  - **没找到**（没有子节点，或所有子节点都被分组框消费掉了）：退回固定偏移——主轴方向跟目标节点保持一层深度（`LEVEL_GAP`，需要从 `layout.js` 导出，跟 `NODE` 一样），交叉轴方向跟目标节点自身居中对齐。

`LEVEL_GAP`、`SIBLING_GAP` 都需要从 `layout.js` 导出（目前是模块内私有 `const`）。

## 不变的部分

- 分组框内部拖拽换位、跨分组拖到格子里：完全不变，继续用 `dragRenderContext`/`drawGroupChildren`/`scheduleDragShift`，不加连接线（它们已经有永久的真实连线）。
- `reorder-group-child` vs `move-node` 的派发判断（`dragState.targetParentId === dragState.fromParentId`）不变。
- 资源树拖入画布：本轮不做（已跟用户确认放到下一轮）。

## 测试计划

- `test/minimap-interaction.test.js`：`attachPreviewRect` 的两种分支（有平铺子节点时贴在最后一个后面；没有子节点/子节点全被分组消费时退回固定偏移），横向/纵向树都要覆盖。
- `test/minimap-node-move.test.js`：
  - 拖到兄弟节点中间（nest）：mid-drag 时画出了预览框+连接线，且没有整节点高亮（替换掉之前那个验证"高亮目标本身"的回归测试，因为现在改成完全不用高亮了）。
  - 拖到非兄弟普通节点：同上。
  - 拖到自己当前父节点身上：预览框出现在"当前最后一个兄弟后面"。
  - 兄弟插入排序（空隙命中/边缘窄带）：除了已有的占位框断言，新增连接线确实被画出来的断言。
  - 分组框内部换位/跨分组：确认没有任何连接线绘制调用（防止误伤）。

## 范围之外（明确不做）

- 资源树拖入画布的实时预览（下一轮单独做）。
- 分组框内部/跨分组拖拽不加连接线（已经有永久真实连线）。
- 不做"其他兄弟节点让位"的位移动画（沿用上一轮的决定）。
