# 第五阶段：兄弟节点拖拽精度调整 设计文档

## 背景

切片3（跨父级拖拽移动与排序）上线后，用户在浏览器里实测发现：把一个普通节点拖到另一个兄弟节点身上，体验很差，且存在一个会误导用户的高亮 bug：

- 现在 `siblingInsertIndexAt`（`src/minimap/interaction.js`）对兄弟节点之间的拖拽只用"目标矩形中点"做二分：指针在中点之前 → 插到目标前面，之后 → 插到目标后面。这意味着兄弟节点之间**永远不可能**产生父子关系（无法把一个兄弟拖进另一个兄弟里嵌套）。
- 同时，兄弟重排序时 `resolveDropTarget` 把 `targetParentId` 设成"拖拽节点和目标节点的共同父节点"，而不是目标兄弟节点自己。渲染层（`Minimap.vue` 的 `dragHighlightId`）拿这个 id 去做整节点高亮，结果是悬停在兄弟节点上时，**高亮的是共同父节点，不是真正悬停的目标**——这正是用户截图里"把 7 拖到 3，父节点却亮了"的根因之一。
- 此外，跟主流思维导图工具（XMind、MindNode 等）对比，发现两个会让"插入排序"功能基本不可用的缺口：① 兄弟之间的可视空隙（`SIBLING_GAP = 24` 个世界单位）目前是命中测试的死区，指针落在空隙里时 `hitTest` 返回 `null`，整体没有任何反馈；② 即使在节点内部做"边缘窄带"判定，带宽也不能定得过窄，否则鼠标基本摸不到。

本设计解决这三个问题，范围限定在**分组框之外的普通节点之间**的拖拽（分组框内部子节点的拖拽机制不变）。

## 目标行为

拖拽节点 X，悬停到兄弟节点 Y（与 X 同一父节点下的另一个子节点）附近时，按以下优先级判定：

1. **命中 X 与 Y 之间、或 Y 与它另一侧相邻兄弟之间的空隙** → 插入到对应位置（reorder，不改变 `parentId`）。
2. **命中 Y 自身矩形的边缘窄带**（屏幕像素度量，默认 5px，按 `viewport.scale` 换算成世界单位，不受缩放影响）→ 插入到 Y 前面（命中起始边）或后面（命中结束边）。这一步主要用于"列表最前/最后一个兄弟，旁边没有相邻空隙可用"的边界情况；对中间位置的兄弟来说，第 1 步通常会先命中更大的空隙区域。
3. **命中 Y 矩形中间的大片区域** → X 变成 Y 的子节点（nest，触发跨父级 `move-node`，会改变 `parentId`）。这条路径与"拖到非兄弟节点身上"完全复用同一段既有逻辑（`parentId: hit.id`），从而同时修正了"高亮共同父节点"的 bug——只有这条 nest 路径才会触发整节点高亮，且高亮目标永远是真正悬停的那个节点。

这个规则对称：不区分谁是"被拖的那个"、谁是"落脚的那个"，只看"谁悬停在谁身上"。

## 命中检测（`src/minimap/interaction.js`）

### 空隙命中：`siblingGapHitAt`

新增一个私有辅助函数（不导出，跟现有 `siblingInsertIndexAt` 同等地位，仅供 `resolveDropTarget` 内部调用）：

```js
function siblingGapHitAt(graph, layout, point, draggedNodeId, direction) {
  const dragged = graph.nodes.get(draggedNodeId)
  if (!dragged?.parentId) return null
  const parent = graph.nodes.get(dragged.parentId)
  if (!parent) return null

  const restChildren = parent.children.filter((id) => id !== draggedNodeId)
  // 被分组框消费掉的子节点在 layout.nodes 里没有独立 rect，排除在外——
  // 分组框内部的命中检测走另一套机制，不归这里管。
  const plainRestChildren = restChildren.filter((id) => layout.nodes.has(id))

  for (let i = 0; i < plainRestChildren.length - 1; i++) {
    const rectA = layout.nodes.get(plainRestChildren[i])
    const rectB = layout.nodes.get(plainRestChildren[i + 1])
    const gapRect =
      direction === 'vertical'
        ? {
            x: rectA.x + rectA.width,
            y: Math.min(rectA.y, rectB.y),
            width: rectB.x - (rectA.x + rectA.width),
            height: Math.max(rectA.height, rectB.height),
          }
        : {
            x: Math.min(rectA.x, rectB.x),
            y: rectA.y + rectA.height,
            width: Math.max(rectA.width, rectB.width),
            height: rectB.y - (rectA.y + rectA.height),
          }
    if (containsPoint(gapRect, point)) {
      return { insertIndex: restChildren.indexOf(plainRestChildren[i + 1]) }
    }
  }
  return null
}
```

- 只检查"去掉被拖节点后，剩余的、仍是平铺节点（未被分组框消费）的兄弟"之间**相邻**的空隙——`plainRestChildren.length - 1` 个空隙。
- 空隙矩形横跨两个相邻兄弟在主轴上的范围（取较大值兜底，正常情况下同父兄弟在主轴上的位置/宽度应当相等），高度/宽度就是物理空隙本身（`SIBLING_GAP = 24`）。命中即返回对应插入下标，不要求像素级精确。
- 返回 `null` 时（少于2个剩余兄弟，或没有命中任何空隙），由 `resolveDropTarget` 继续走下面的次选逻辑。

### 边缘窄带 + nest 判定：`siblingDropZoneAt`

把现有 `siblingInsertIndexAt` 改名重写为 `siblingDropZoneAt`，新增第三种结果：

```js
const EDGE_THRESHOLD_SCREEN_PX = 5

function siblingDropZoneAt(graph, layout, point, draggedNodeId, targetNodeId, direction, edgeThresholdWorld) {
  const dragged = graph.nodes.get(draggedNodeId)
  const target = graph.nodes.get(targetNodeId)
  if (!dragged || !target || dragged.parentId !== target.parentId) return null
  const parent = dragged.parentId ? graph.nodes.get(dragged.parentId) : null
  const targetRect = layout.nodes.get(targetNodeId)
  if (!parent || !targetRect || !parent.children.includes(draggedNodeId) || !parent.children.includes(targetNodeId)) {
    return null
  }
  const restChildren = parent.children.filter((id) => id !== draggedNodeId)
  const targetIndex = restChildren.indexOf(targetNodeId)
  if (targetIndex === -1) return null

  const crossStart = direction === 'vertical' ? targetRect.x : targetRect.y
  const crossExtent = direction === 'vertical' ? targetRect.width : targetRect.height
  const pointCross = direction === 'vertical' ? point.x : point.y
  // 极端缩小时节点本身在世界坐标里的 cross 范围可能塞不下两条窄带，
  // 这种情况下把窄带各自收缩到一半，保证不会重叠、也不会出现"中间区域宽度为负"。
  const threshold = Math.min(edgeThresholdWorld, crossExtent / 2)

  if (pointCross <= crossStart + threshold) {
    return { mode: 'before', insertIndex: targetIndex }
  }
  if (pointCross >= crossStart + crossExtent - threshold) {
    return { mode: 'after', insertIndex: targetIndex + 1 }
  }
  return { mode: 'nest' }
}
```

- `edgeThresholdWorld` 由调用方（`resolveDropTarget`）传入，等于 `EDGE_THRESHOLD_SCREEN_PX / viewportScale`（屏幕像素换算成世界单位，缩放后窄带的视觉宽度不变，沿用 `exceedsDragThreshold` 已有的换算惯例）。
- 不是兄弟、或目标已被排除（`targetIndex === -1`，比如拖自己）时返回 `null`，跟旧函数的契约保持一致——调用方据此判断"这不是一组合法的兄弟对，按非兄弟逻辑处理"。
- `mode: 'nest'` 时不返回 `insertIndex`，调用方据此走"目标节点自己变成新父节点"的既有逻辑。

### `resolveDropTarget` 改动

```js
export function resolveDropTarget(graph, layout, point, draggedNodeId, direction = 'horizontal', viewportScale = 1) {
  const edgeThresholdWorld = EDGE_THRESHOLD_SCREEN_PX / viewportScale

  const gapHit = siblingGapHitAt(graph, layout, point, draggedNodeId, direction)
  if (gapHit) {
    return {
      valid: true,
      parentId: graph.nodes.get(draggedNodeId).parentId,
      group: null,
      insertIndex: gapHit.insertIndex,
      previewRect: siblingGapPreviewRect(layout, graph, draggedNodeId, gapHit.insertIndex, direction),
    }
  }

  const hit = hitTest(layout, point)
  if (!hit) return { valid: false }

  if (hit.type === 'group' && hit.zone === 'item') {
    // ……（不变，省略）
  }

  if (hit.type === 'node') {
    const zone = siblingDropZoneAt(graph, layout, point, draggedNodeId, hit.id, direction, edgeThresholdWorld)
    if (zone && zone.mode !== 'nest') {
      return {
        valid: true,
        parentId: graph.nodes.get(draggedNodeId).parentId,
        group: null,
        insertIndex: zone.insertIndex,
        previewRect: siblingEdgePreviewRect(layout, hit.id, zone.mode, direction),
      }
    }
    const parentId = hit.id
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    return { valid: true, parentId, group: null, insertIndex: null, previewRect: null }
  }

  return { valid: false }
}
```

新增第6个可选参数 `viewportScale`（默认 1，保持现有测试在不传该参数时行为不变）。已有调用方 `Minimap.vue` 在 `updateDragTarget` 里调用处补上 `currentViewport().scale`。

### 插入预览框位置计算

新增两个私有辅助函数，返回世界坐标矩形（供渲染层转换成屏幕坐标后画 `dropSlot`）。固定尺寸复用 `layout.js` 导出的 `NODE`（需要把 `const NODE = { width: 120, height: 40 }` 加上 `export`）：

```js
function siblingGapPreviewRect(layout, graph, draggedNodeId, insertIndex, direction) {
  const dragged = graph.nodes.get(draggedNodeId)
  const parent = graph.nodes.get(dragged.parentId)
  const restChildren = parent.children.filter((id) => id !== draggedNodeId)
  // insertIndex 只会是 siblingGapHitAt 命中空隙时返回的下标，两侧节点必然都存在
  // （命中空隙的前提就是 i 和 i+1 都在 plainRestChildren 范围内），不需要兜底分支。
  const rectA = layout.nodes.get(restChildren[insertIndex - 1])
  const rectB = layout.nodes.get(restChildren[insertIndex])
  if (direction === 'vertical') {
    const centerX = (rectA.x + rectA.width + rectB.x) / 2
    return { x: centerX - NODE.width / 2, y: rectA.y, width: NODE.width, height: NODE.height }
  }
  const centerY = (rectA.y + rectA.height + rectB.y) / 2
  return { x: rectA.x, y: centerY - NODE.height / 2, width: NODE.width, height: NODE.height }
}

function siblingEdgePreviewRect(layout, targetNodeId, mode, direction) {
  const targetRect = layout.nodes.get(targetNodeId)
  if (direction === 'vertical') {
    const x = mode === 'before' ? targetRect.x - NODE.width : targetRect.x + targetRect.width
    return { x, y: targetRect.y, width: NODE.width, height: NODE.height }
  }
  const y = mode === 'before' ? targetRect.y - NODE.height : targetRect.y + targetRect.height
  return { x: targetRect.x, y, width: NODE.width, height: NODE.height }
}
```

- `siblingGapPreviewRect` 走空隙命中路径：预览框居中在两个相邻兄弟之间的物理空隙上（`insertIndex` 两侧分别是 `beforeId`/`afterId`，任一侧可能不存在——理论上空隙命中只发生在两侧都存在的中间空隙，这里的 `anchor` 兜底分支预留给未来若有人直接调用这两个辅助函数测试边界场景）。
- `siblingEdgePreviewRect` 走边缘窄带路径：预览框贴在目标节点对应那条边的外侧。
- 因为 `SIBLING_GAP(24) < NODE.height(40)`，预览框会和旁边节点有轻微重叠——这是"其他兄弟节点不挪位置"这个简化决定下的预期效果，不是 bug。

## 渲染（`src/minimap/Minimap.vue` + `src/minimap/renderer.js`）

- `updateDragTarget` 调用 `resolveDropTarget` 时多传一个 `currentViewport().scale` 参数；把返回值里的 `previewRect` 存进 `dragState.insertPreviewRect`（命中 nest 或非兄弟节点时为 `null`）。
- `dragHighlightId` 的判断条件加一道门槛，排除 before/after 模式（这种模式下 `targetParentId` 是共同父节点，高亮它是错的）：

  ```js
  const dragHighlightId =
    dragState?.dragging && !dragState.targetGroupId && !dragState.insertPreviewRect && dragState.targetParentId
      ? dragState.targetParentId
      : null
  ```
- `renderCurrent` 把 `dragState.insertPreviewRect`（世界坐标）转换成屏幕坐标，作为新的 `state.siblingInsertPreview` 传给 `renderScene`。
- `renderer.js` 的 `renderScene` 里，在画完普通节点、画 ghost 之前，如果 `state.siblingInsertPreview` 存在，直接调用已有的 `drawDropSlot(ctx, rect, theme, 1)`（这个函数本身就是通用的，不依赖分组框内部状态，不需要新写绘制逻辑）。

分组框内部的拖拽（`dragRenderContext`/`drawGroupChildren`/`scheduleDragShift` 等）完全不受影响。

## 不变的部分（确认不会回归）

- `Minimap.vue` 里"`reorder-group-child` vs `move-node`"的派发逻辑（约第878~934行）完全基于 `dragState.targetParentId === dragState.fromParentId`，跟"命中的是空隙/边缘窄带/中间区域"无关——本设计只需要保证 `resolveDropTarget` 在各分支正确设置 `parentId` 字段，派发逻辑不用改。
- `test/minimap-node-move.test.js` 里"插到上半/下半"的两个测试和纵向布局变体（用 `y:2` / `height-2` / `width-2` 偏移）：在默认 `viewportScale=1` 下，5屏幕像素阈值=5世界单位，2 仍然在窄带内，断言不变。
- `test/minimap-node-move.test.js` 里"readonly/beforeNodeMove 拦截跨父级拖拽"用 `feeder-1` 拖到 `feeder-2` 中心：在新设计下这会落入 nest 区域（触发 `move-node`），比旧版本（落入 reorder，`parentId` 本来就不会变，断言形同虚设）更有意义地验证了拦截逻辑，不是回归。
- `test/minimap-interaction.test.js` 里直接调用 `resolveDropTarget` 的用例不传 `direction`/`viewportScale`，使用默认值，行为不变。

## 测试计划

在 `test/minimap-interaction.test.js`（纯函数单测）和 `test/minimap-node-move.test.js`（端到端拖拽）补充：

1. 拖到两个相邻兄弟之间的物理空隙 → 正确的 `insertIndex`，且不触发整节点高亮（reorder，不是 nest）。
2. 拖到列表第一个兄弟的起始边窄带（没有前面的相邻空隙可用）→ 插到最前面。
3. 拖到列表最后一个兄弟的结束边窄带 → 插到最后面。
4. 拖到某个兄弟中间区域 → nest 生效（`move-node`，`parentId` 改变），且高亮的是这个兄弟节点本身，不是共同父节点（回归验证用户报告的原始 bug）。
5. 不同 `viewport.scale` 下，5屏幕像素阈值换算成世界单位后，窄带的实际命中范围跟缩放成反比（验证缩放无关性）。
6. 纵向布局（`direction: 'vertical'`）下，空隙判定和边缘窄带判定都按左右轴而不是上下轴计算。
7. 插入预览框（`siblingInsertPreview`）只在 reorder 模式下出现，nest 模式下不出现。

## 范围之外（明确不做）

- 分组框内部子节点之间的拖拽不变。
- 不做"其他兄弟节点让位"的位移动画——预览框出现时其他节点保持原位不动。
- 不改变 `Minimap.vue` 里 `reorder-group-child`/`move-node` 的派发判断逻辑、`beforeNodeMove`/`beforeGroupReorder`/`readonly` 拦截逻辑。
