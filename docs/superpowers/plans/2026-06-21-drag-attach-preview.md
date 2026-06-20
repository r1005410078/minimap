# 拖拽"挂接预览"补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"占位框+连接线"这套反馈，从目前只覆盖"兄弟节点插入排序"扩展到所有"会让画布上出现新父子关系"的拖拽场景（兄弟中间区域、非兄弟节点、从分组框拖出落到普通节点上），同时去掉这些场景现在用的整节点高亮。

**Architecture:** `resolveDropTarget` 的"嵌套"分支补上一个新的 `previewRect` 计算（贴在目标节点现有最后一个平铺子节点后面，没有子节点时退回固定偏移）；`Minimap.vue` 记录这个预览框对应的"未来父节点"矩形；`renderer.js` 新增一个连接线绘制函数，复用真实连线的 `orthogonalPath` 几何算法，用预览色虚线画出来，画在 `drawDropSlot` 之前。原来的整节点高亮逻辑（`dragHighlightId`）整段删除。

**Tech Stack:** Vue 2.7 `<script setup>`、Canvas 2D、`node:test` + `@vue/test-utils` v1 + jsdom + mock canvas ctx。

## Global Constraints

- 占位框尺寸固定为标准节点尺寸 `NODE`（`{width: 120, height: 40}`，已从 `layout.js` 导出）。
- 连接线复用 `orthogonalPath` 几何算法（跟真实连线同一套路径计算），虚线 `[4, 4]`，颜色取 `theme.group.dropSlot.stroke`（默认 `#3d9cff`），跟真实连线（实线，`theme.edge.color`）区分开。
- 分组框内部子节点拖拽、跨分组拖到格子里：完全不变，不加占位框（已经有），不加连接线（分组框本身永远通过 `resolveEdges` 的正常渲染连着父节点，不需要额外画一条预览线）。
- `reorder-group-child` vs `move-node` 的派发判断（`dragState.targetParentId === dragState.fromParentId`）不变。
- 资源树拖入画布的实时预览：本轮不做（已跟用户确认放到下一轮）。
- 拖拽过程中不再对任何节点做整节点高亮——`dragHighlightId` 这个机制整段删除，不是"调整条件"，是删掉。

---

### Task 1: 嵌套挂接预览框几何计算

**Files:**
- Modify: `src/minimap/layout.js`（导出 `LEVEL_GAP`）
- Modify: `src/minimap/interaction.js`（新增 `attachPreviewRect`，接入 `resolveDropTarget` 的嵌套分支）
- Test: `test/minimap-interaction.test.js`

**Interfaces:**
- Consumes：既有 `NODE`（已导出）、`siblingEdgePreviewRect(layout, targetNodeId, mode, direction)`（私有，本文件内直接调用）。
- Produces：`export const LEVEL_GAP` from `layout.js`（当前值 `80`）。`resolveDropTarget` 的嵌套分支（命中非兄弟普通节点、或命中兄弟节点中间区域）现在返回的 `previewRect` 不再是 `null`，而是世界坐标矩形 `{x, y, width, height}`——这是 Task 2 要消费的字段，字段名和 shape 不变。

- [ ] **Step 1: 把 `layout.js` 的 `LEVEL_GAP` 常量导出**

读取 `src/minimap/layout.js` 第8行，当前是：

```js
const LEVEL_GAP = 80 // 主轴（深度方向）层距
```

改成：

```js
export const LEVEL_GAP = 80 // 主轴（深度方向）层距
```

- [ ] **Step 2: 在 `test/minimap-interaction.test.js` 写3个失败的单测**

在文件顶部 import 列表里，把 `from './layout.js'` 那一行（现在是 `import { computeLayout, GROUP, visibleGroupChildren } from '../src/minimap/layout.js'`，先确认实际内容再改，可能跟这里写的不完全一样）加上 `NODE`、`LEVEL_GAP`：

```js
import { computeLayout, GROUP, NODE, LEVEL_GAP, visibleGroupChildren } from '../src/minimap/layout.js'
```

在第298行（现有 `'resolveDropTarget resolves a sibling plain node hit as a same-parent reorder target'` 测试结束的 `})` 之后，紧接着上一轮加的4个测试之前或之后均可，这里放在它们之后）插入：

```js
test('resolveDropTarget anchors the nest-mode attach preview after the target\'s last plain child', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const targetRect = layout.nodes.get('grid-tie')
  const point = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2 }

  const target = resolveDropTarget(graph, layout, point, 'feeder-1')

  assert.equal(target.valid, true)
  assert.equal(target.parentId, 'grid-tie')
  const feeder3Rect = layout.nodes.get('feeder-3')
  assert.deepEqual(target.previewRect, {
    x: feeder3Rect.x,
    y: feeder3Rect.y + feeder3Rect.height,
    width: NODE.width,
    height: NODE.height,
  })
})

test('resolveDropTarget falls back to a fixed offset for the nest-mode attach preview when the target has no plain children', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const feeder1Rect = layout.nodes.get('feeder-1')
  const point = { x: feeder1Rect.x + feeder1Rect.width / 2, y: feeder1Rect.y + feeder1Rect.height / 2 }

  const target = resolveDropTarget(graph, layout, point, 'cluster-25')

  assert.equal(target.valid, true)
  assert.equal(target.parentId, 'feeder-1')
  assert.deepEqual(target.previewRect, {
    x: feeder1Rect.x + feeder1Rect.width + LEVEL_GAP,
    y: feeder1Rect.y,
    width: NODE.width,
    height: NODE.height,
  })
})

test('resolveDropTarget anchors the nest-mode attach preview along the cross axis for a vertical layout', () => {
  const graph = createDemoGraph()
  const verticalOpts = { ...VIEWPORT, direction: 'vertical' }
  const layout = computeLayout(graph, verticalOpts)
  const targetRect = layout.nodes.get('grid-tie')
  const point = { x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2 }

  const target = resolveDropTarget(graph, layout, point, 'feeder-1', 'vertical')

  assert.equal(target.valid, true)
  assert.equal(target.parentId, 'grid-tie')
  const feeder3Rect = layout.nodes.get('feeder-3')
  assert.deepEqual(target.previewRect, {
    x: feeder3Rect.x + feeder3Rect.width,
    y: feeder3Rect.y,
    width: NODE.width,
    height: NODE.height,
  })
})
```

（第一个测试里，`feeder-1` 拖到 `grid-tie`——这正是已有的"拖到自己当前父节点"场景：`grid-tie.children` 去掉 `feeder-1` 后剩 `['feeder-2', 'feeder-3']`，最后一个平铺子节点是 `feeder-3`，预览框应该贴在它后面。第二个测试里，`cluster-25` 拖到 `feeder-1`——`feeder-1` 没有任何子节点，退回固定偏移。这两个节点和被拖节点之间都不是兄弟关系也不是祖先/后代关系，会落到 `resolveDropTarget` 的"非兄弟节点"分支。)

- [ ] **Step 3: 运行测试，确认新增的3个失败**

```bash
npm test -- test/minimap-interaction.test.js
```

预期：3个新测试全部失败在 `previewRect` 的断言上（现在这条分支永远返回 `previewRect: null`）。已有测试应该仍然全部通过。

- [ ] **Step 4: 在 `src/minimap/interaction.js` 新增 `attachPreviewRect`**

在 `siblingEdgePreviewRect` 函数定义之后（第263行 `}` 之后）、`resolveDropTarget` 之前，插入：

```js
// 嵌套模式下，把被拖节点追加成目标节点的最后一个子节点会出现在哪——优先贴在
// 目标现有最后一个仍是平铺节点（未被分组框消费）的子节点后面，跟 siblingEdgePreviewRect
// 的 'after' 逻辑完全一样，只是锚点换成目标的子节点而不是被拖节点的兄弟。目标没有平铺
// 子节点时（没有子节点，或所有子节点都被分组框消费），退回固定偏移：主轴上跟目标保持
// 一层深度（LEVEL_GAP），交叉轴上跟目标自身对齐——这种情况下预览框可能跟目标已有的
// 分组框轻微重叠，是简化设计下的预期效果，不是 bug。
function attachPreviewRect(graph, layout, draggedNodeId, targetParentId, direction) {
  const target = graph.nodes.get(targetParentId)
  const restChildren = target.children.filter((id) => id !== draggedNodeId)
  const plainRestChildren = restChildren.filter((id) => layout.nodes.has(id))
  const lastChildId = plainRestChildren[plainRestChildren.length - 1]
  if (lastChildId) return siblingEdgePreviewRect(layout, lastChildId, 'after', direction)

  const targetRect = layout.nodes.get(targetParentId)
  return direction === 'vertical'
    ? { x: targetRect.x, y: targetRect.y + targetRect.height + LEVEL_GAP, width: NODE.width, height: NODE.height }
    : { x: targetRect.x + targetRect.width + LEVEL_GAP, y: targetRect.y, width: NODE.width, height: NODE.height }
}
```

把文件顶部的 import（第6行）：

```js
import { GROUP, NODE, visibleGroupChildren } from './layout.js'
```

改成：

```js
import { GROUP, NODE, LEVEL_GAP, visibleGroupChildren } from './layout.js'
```

- [ ] **Step 5: 把 `resolveDropTarget` 的嵌套分支接上 `attachPreviewRect`**

读取当前 `resolveDropTarget` 函数体里 `hit.type === 'node'` 分支的末尾（现在是）：

```js
    const parentId = hit.id
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    return { valid: true, parentId, group: null, insertIndex: null, previewRect: null }
  }

  return { valid: false }
}
```

改成：

```js
    const parentId = hit.id
    if (isNodeOrDescendant(graph, draggedNodeId, parentId)) return { valid: false }
    return {
      valid: true,
      parentId,
      group: null,
      insertIndex: null,
      previewRect: attachPreviewRect(graph, layout, draggedNodeId, parentId, direction),
    }
  }

  return { valid: false }
}
```

- [ ] **Step 6: 运行测试，确认全部通过**

```bash
npm test -- test/minimap-interaction.test.js
```

预期：本文件全部测试（包括 Step 2 新增的3个，和原有的全部）都 PASS。

- [ ] **Step 7: 跑全量测试，确认没有跨文件回归**

```bash
npm test
```

预期：全部通过——`Minimap.vue` 此时还没用到新的 `previewRect` 数值（嵌套场景下还是按旧的 `dragHighlightId` 逻辑高亮，新算出来的 `previewRect` 暂时没人读取），端到端测试此时行为应该跟改动前完全一致。

- [ ] **Step 8: Commit**

```bash
git add src/minimap/layout.js src/minimap/interaction.js test/minimap-interaction.test.js
git commit -m "feat: compute nest-mode attach preview geometry in resolveDropTarget"
```

---

### Task 2: 接入渲染、画连接线、删除整节点高亮

**Files:**
- Modify: `src/minimap/Minimap.vue`（`dragState` 初始化、`updateDragTarget`、`renderCurrent`）
- Modify: `src/minimap/renderer.js`（新增连接线绘制、`renderScene` 接线）
- Test: `test/minimap-node-move.test.js`

**Interfaces:**
- Consumes：Task 1 产出的 `resolveDropTarget(...)` 返回值里非空的 `previewRect`（嵌套模式下不再是 `null`）；已有的 `worldRectToScreen(rect, viewport)`、`orthogonalPath(fromBox, toBox, mainAxis)`、`edgeMainAxis(direction)`（`renderer.js` 内部私有，`renderScene` 同文件内可直接调用）。
- Produces：`dragState.attachPreviewRect`（世界坐标矩形或 `null`，替换原来的 `insertPreviewRect` 字段名）、`dragState.attachPreviewParentRect`（世界坐标矩形或 `null`，预览框对应的未来父节点矩形）；传给 `renderScene` 的 `state.attachPreview`（替换原来的 `state.siblingInsertPreview`，shape 变成 `{ rect, parentRect }`，均为屏幕坐标，`parentRect` 可能是 `null`）。

- [ ] **Step 1: 在 `test/minimap-node-move.test.js` 加一个 `attachLineDrawn` 辅助函数**

在第297行 `dropSlotDrawn` 函数定义之后插入：

```js
// Helper to check if an attach-preview connector line was drawn in the current frame.
// 连接线用 moveTo/lineTo 画路径，drawDropSlot 的方框边框走 roundedRect（测试环境里
// 走 ctx.roundRect，不会产生 moveTo 调用），两者不会混淆。
function attachLineDrawn(ctx, theme) {
  const lastClear = ctx.calls.map((c) => c.method).lastIndexOf('clearRect')
  const calls = ctx.calls.slice(lastClear + 1)
  return calls.some((call, i) => {
    if (call.method !== 'moveTo') return false
    for (let j = i - 1; j >= 0; j--) {
      if (calls[j].method === 'set:strokeStyle') return calls[j].args[0] === theme.group.dropSlot.stroke
    }
    return false
  })
}
```

- [ ] **Step 2: 改写3个依赖旧高亮逻辑的现有测试**

这三个测试现在断言"嵌套悬停时目标节点会被整节点高亮"，改动后这个高亮机制被整段删除，改成断言"显示占位框+连接线，且没有任何高亮"。

**第一处**（现在第299~325行，`'plain node drop target is recognized and can be dropped on'`）：

```js
test('plain node drop target is recognized and can be dropped on', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'cluster-25')

  // Start drag on feeder-1
  dispatchPointerDown(wrapper, from)
  // Hover over a non-sibling plain node WITHOUT releasing yet - this should highlight it as drop target
  dispatchPointerMove(wrapper, to)

  // Verify that cluster-25 is highlighted mid-drag (before pointerup)
  const highlightedMidDrag = highlightedLabels(contexts.at(-1), defaultTheme)
  assert.ok(highlightedMidDrag.includes('Cluster 25'),
    `cluster-25 should be highlighted mid-drag; got: ${highlightedMidDrag}`)

  // Complete the drag by releasing
  dispatchPointerUp(wrapper, to)

  // Verify the drop succeeded - feeder-1 should now be a child of cluster-25
  assert.equal(graph.nodes.get('feeder-1').parentId, 'cluster-25',
    'feeder-1 should have been moved to be a child of cluster-25')

  wrapper.destroy()
})
```

改成：

```js
test('plain node drop target shows an attach preview and can be dropped on', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'cluster-25')

  // Start drag on feeder-1
  dispatchPointerDown(wrapper, from)
  // Hover over a non-sibling plain node WITHOUT releasing yet - this should show an
  // attach preview (box + connector line), not a whole-node highlight
  dispatchPointerMove(wrapper, to)

  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), true)
  assert.equal(attachLineDrawn(contexts.at(-1), defaultTheme), true)
  assert.deepEqual(highlightedLabels(contexts.at(-1), defaultTheme), [])

  // Complete the drag by releasing
  dispatchPointerUp(wrapper, to)

  // Verify the drop succeeded - feeder-1 should now be a child of cluster-25
  assert.equal(graph.nodes.get('feeder-1').parentId, 'cluster-25',
    'feeder-1 should have been moved to be a child of cluster-25')

  wrapper.destroy()
})
```

**第二处**（现在第327~355行，`'dragging an already-selected node shows the live drop target highlight, not the stale selection relation'`）：

```js
test('dragging an already-selected node shows the live drop target highlight, not the stale selection relation', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  // feeder-1 is selected before the drag starts (e.g. from an earlier click), so
  // buildSelectionRelations would normally highlight its parent (grid-tie) and dim
  // everything else - that must not fight with the live drag-target highlight.
  wrapper.vm.select(['feeder-1'])

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'cluster-25')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  const highlightedMidDrag = highlightedLabels(contexts.at(-1), defaultTheme)
  assert.ok(
    highlightedMidDrag.includes('Cluster 25'),
    `cluster-25 should be highlighted as the live drop target even though feeder-1 was already selected; got: ${highlightedMidDrag}`,
  )
  assert.ok(
    !highlightedMidDrag.includes('Grid Tie'),
    `feeder-1's old parent (grid-tie) should not show the stale selection-relation highlight while dragging; got: ${highlightedMidDrag}`,
  )

  dispatchPointerUp(wrapper, to)
  wrapper.destroy()
})
```

改成：

```js
test('dragging an already-selected node shows the live attach preview, not the stale selection relation', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  // feeder-1 is selected before the drag starts (e.g. from an earlier click), so
  // buildSelectionRelations would normally highlight its parent (grid-tie) and dim
  // everything else - that must not fight with the live drag-target attach preview.
  wrapper.vm.select(['feeder-1'])

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'cluster-25')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), true)
  assert.equal(attachLineDrawn(contexts.at(-1), defaultTheme), true)
  assert.deepEqual(
    highlightedLabels(contexts.at(-1), defaultTheme),
    [],
    'no node should show the stale selection-relation highlight while dragging',
  )

  dispatchPointerUp(wrapper, to)
  wrapper.destroy()
})
```

**第三处**（现在第467~495行，`'dragging a sibling onto the middle of another sibling highlights that sibling itself, not the shared parent, and shows no insert preview'`）：

```js
test('dragging a sibling onto the middle of another sibling highlights that sibling itself, not the shared parent, and shows no insert preview', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  const highlightedMidDrag = highlightedLabels(contexts.at(-1), defaultTheme)
  assert.ok(
    highlightedMidDrag.includes('Feeder 2'),
    `feeder-2 should be highlighted as the live nest target; got: ${highlightedMidDrag}`,
  )
  assert.ok(
    !highlightedMidDrag.includes('Grid Tie'),
    `the shared parent (grid-tie) should not be highlighted; got: ${highlightedMidDrag}`,
  )
  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), false)

  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'feeder-2')
  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.equal(graph.nodes.get('feeder-2').children.includes('feeder-1'), true)
  wrapper.destroy()
})
```

改成：

```js
test('dragging a sibling onto the middle of another sibling shows an attach preview, not a highlight', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'feeder-2')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), true)
  assert.equal(attachLineDrawn(contexts.at(-1), defaultTheme), true)
  assert.deepEqual(highlightedLabels(contexts.at(-1), defaultTheme), [])

  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'feeder-2')
  assert.equal(graph.nodes.get('grid-tie').children.includes('feeder-1'), false)
  assert.equal(graph.nodes.get('feeder-2').children.includes('feeder-1'), true)
  wrapper.destroy()
})
```

- [ ] **Step 3: 给"拖到自己当前父节点"这个已有测试加预览断言**

现在第174~192行的 `'dragging an ungrouped child onto its own real parent reorders within that parent'`：

```js
test('dragging an ungrouped child onto its own real parent reorders within that parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = nodeCenter(layout, 'feeder-1')
  const to = nodeCenter(layout, 'grid-tie')

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)
  dispatchPointerUp(wrapper, to)

  assert.equal(graph.nodes.get('feeder-1').parentId, 'grid-tie')
  assert.deepEqual(graph.nodes.get('grid-tie').children, ['feeder-2', 'feeder-3', 'feeder-1'])
  assert.equal(wrapper.emitted('group-reorder').length, 1)
  assert.equal(wrapper.emitted('node-move'), undefined)
  assert.equal(wrapper.emitted('change').at(-1)[0].type, 'reorder-group-child')
  wrapper.destroy()
})
```

在 `dispatchPointerMove(wrapper, to)` 和 `dispatchPointerUp(wrapper, to)` 之间插入两行断言：

```js
  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  assert.equal(dropSlotDrawn(contexts.at(-1), defaultTheme), true)
  assert.equal(attachLineDrawn(contexts.at(-1), defaultTheme), true)

  dispatchPointerUp(wrapper, to)
```

- [ ] **Step 4: 在文件末尾新增一个"分组框内部拖拽不画连接线"的测试**

在 `firstItemCenter` 函数定义之后（第55行附近）插入一个新的几何辅助函数：

```js
function itemCenterAt(group, index) {
  const rowHeight = GROUP.itemH + GROUP.itemGap
  const colWidth = GROUP.itemW + GROUP.itemGap
  const columns = Math.max(1, group.columns)
  const row = Math.floor(index / columns)
  const col = index % columns
  return {
    x: group.x + GROUP.padding + col * colWidth + GROUP.itemW / 2,
    y: group.y + GROUP.header + GROUP.padding + row * rowHeight - (group.scrollTop ?? 0) + GROUP.itemH / 2,
  }
}
```

在文件末尾（最后一个测试的 `})` 之后）追加：

```js
test('dragging a node within a group does not draw an attach preview connector line', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, LAYOUT_OPTS)
  const targetGroup = layout.groups.find((g) => g.parentId === 'heap-1')
  const wrapper = mount(Minimap, { propsData: { graph } })

  const from = itemCenterAt(targetGroup, 0)
  const to = itemCenterAt(targetGroup, 1)

  dispatchPointerDown(wrapper, from)
  dispatchPointerMove(wrapper, to)

  assert.equal(attachLineDrawn(contexts.at(-1), defaultTheme), false)

  dispatchPointerUp(wrapper, to)
  wrapper.destroy()
})
```

- [ ] **Step 5: 运行测试，确认目前预期的失败**

```bash
npm test -- test/minimap-node-move.test.js
```

预期：Step 2 改写的3个测试失败在 `dropSlotDrawn`/`attachLineDrawn` 断言上（现在还没有连接线绘制逻辑，嵌套场景也还没接上新的 `previewRect`）；Step 3 新增的2行断言同样失败；Step 4 新增的测试此时应该已经 PASS（因为分组框内部拖拽从来没有也不会触发这条新逻辑，`attachLineDrawn` 恒为 `false`）。

- [ ] **Step 6: 修改 `src/minimap/Minimap.vue` 的 `dragState` 初始化**

读取第747~767行，把：

```js
      targetParentId: null,
      targetGroupId: null,
      insertIndex: 0,
      insertPreviewRect: null,
```

改成：

```js
      targetParentId: null,
      targetGroupId: null,
      insertIndex: 0,
      attachPreviewRect: null,
      attachPreviewParentRect: null,
```

- [ ] **Step 7: 修改 `updateDragTarget`**

读取第316~371行，当前是：

```js
function updateDragTarget(worldPoint) {
  const previousGroupId = dragState.targetGroupId
  const previousIndex = dragState.insertIndex

  const activeGroup = previousGroupId ? layout.groups.find((g) => g.id === previousGroupId) : null
  const target =
    activeGroup && withinGroupBody(activeGroup, worldPoint)
      ? {
          valid: true,
          parentId: activeGroup.parentId,
          group: activeGroup,
          insertIndex: groupGridIndexAt(
            { ...activeGroup, children: activeGroup.children.filter((id) => id !== dragState.nodeId) },
            worldPoint,
          ),
          previewRect: null,
        }
      : resolveDropTarget(
          props.graph,
          layout,
          worldPoint,
          dragState.nodeId,
          props.layoutDirection,
          currentViewport().scale,
        )

  if (!target.valid) {
    clearDragShiftAnimation()
    dragState.targetParentId = null
    dragState.targetGroupId = null
    dragState.insertIndex = 0
    dragState.insertPreviewRect = null
  } else if (target.group) {
    const autoScrolling = shouldAutoScroll(target.group)
    const groupChanged = previousGroupId !== target.group.id
    const indexChanged = previousIndex !== target.insertIndex
    if (!autoScrolling && (groupChanged || indexChanged)) {
      scheduleDragShift(target.group, target.insertIndex, { reset: groupChanged })
    } else if (autoScrolling) {
      clearDragShiftAnimation()
    }
    dragState.targetParentId = target.parentId
    dragState.targetGroupId = target.group.id
    dragState.insertIndex = target.insertIndex
    dragState.insertPreviewRect = null
  } else {
    clearDragShiftAnimation()
    dragState.targetParentId = target.parentId
    dragState.targetGroupId = null
    dragState.insertIndex = target.insertIndex
    dragState.insertPreviewRect = target.previewRect ?? null
  }

  dragState.ghostWorldPoint = worldPoint
  dragState.ghostScreenRect = ghostRectForPoint(worldPoint)
}
```

改成：

```js
function updateDragTarget(worldPoint) {
  const previousGroupId = dragState.targetGroupId
  const previousIndex = dragState.insertIndex

  const activeGroup = previousGroupId ? layout.groups.find((g) => g.id === previousGroupId) : null
  const target =
    activeGroup && withinGroupBody(activeGroup, worldPoint)
      ? {
          valid: true,
          parentId: activeGroup.parentId,
          group: activeGroup,
          insertIndex: groupGridIndexAt(
            { ...activeGroup, children: activeGroup.children.filter((id) => id !== dragState.nodeId) },
            worldPoint,
          ),
          previewRect: null,
        }
      : resolveDropTarget(
          props.graph,
          layout,
          worldPoint,
          dragState.nodeId,
          props.layoutDirection,
          currentViewport().scale,
        )

  if (!target.valid) {
    clearDragShiftAnimation()
    dragState.targetParentId = null
    dragState.targetGroupId = null
    dragState.insertIndex = 0
    dragState.attachPreviewRect = null
    dragState.attachPreviewParentRect = null
  } else if (target.group) {
    const autoScrolling = shouldAutoScroll(target.group)
    const groupChanged = previousGroupId !== target.group.id
    const indexChanged = previousIndex !== target.insertIndex
    if (!autoScrolling && (groupChanged || indexChanged)) {
      scheduleDragShift(target.group, target.insertIndex, { reset: groupChanged })
    } else if (autoScrolling) {
      clearDragShiftAnimation()
    }
    dragState.targetParentId = target.parentId
    dragState.targetGroupId = target.group.id
    dragState.insertIndex = target.insertIndex
    dragState.attachPreviewRect = null
    dragState.attachPreviewParentRect = null
  } else {
    clearDragShiftAnimation()
    dragState.targetParentId = target.parentId
    dragState.targetGroupId = null
    dragState.insertIndex = target.insertIndex
    dragState.attachPreviewRect = target.previewRect ?? null
    dragState.attachPreviewParentRect = target.previewRect ? layout.nodes.get(target.parentId) : null
  }

  dragState.ghostWorldPoint = worldPoint
  dragState.ghostScreenRect = ghostRectForPoint(worldPoint)
}
```

- [ ] **Step 8: 修改 `renderCurrent`，删除整节点高亮，画连接线**

读取第391~431行，当前是：

```js
function renderCurrent(currentLayout = layout, renderViewport = currentViewport()) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...renderViewport }
  // 拖拽过程中暂时不展示旧选区的父子关系高亮/降权——否则会跟拖拽目标高亮互相打架，
  // 视觉上显得"父节点亮了"而不是真正悬停的目标（旧选区跟当前拖拽目标是两件不相关的事）。
  const relations = dragState?.dragging
    ? buildSelectionRelations(props.graph, currentLayout, [])
    : buildSelectionRelations(props.graph, currentLayout, currentSelectedIds())
  const dragHighlightId =
    dragState?.dragging && !dragState.targetGroupId && !dragState.insertPreviewRect && dragState.targetParentId
      ? dragState.targetParentId
      : null
  const highlightedIds = dragHighlightId
    ? new Set([...relations.highlightedIds, dragHighlightId])
    : relations.highlightedIds
  const siblingInsertPreview =
    dragState?.dragging && dragState.insertPreviewRect
      ? { rect: worldRectToScreen(dragState.insertPreviewRect, renderViewport) }
      : null
  renderScene(ctx, {
    layout: currentLayout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport: renderViewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: {
      selectedIds: relations.selectedIds,
      highlightedIds,
      dimmedIds: relations.dimmedIds,
      highlightedEdgeIds: relations.highlightedEdgeIds,
      dimmedEdgeIds: relations.dimmedEdgeIds,
      groupDrag: dragRenderContext(),
      groupScrollbarHoverId: hoveredScrollbarGroupId,
      selectionRect: marqueeState?.active ? normalizeRect(marqueeState.rect) : null,
      siblingInsertPreview,
    },
    renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
  })
```

改成：

```js
function renderCurrent(currentLayout = layout, renderViewport = currentViewport()) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...renderViewport }
  // 拖拽过程中暂时不展示旧选区的父子关系高亮/降权——拖拽时的反馈完全交给下面的
  // attachPreview（占位框+连接线），不需要整节点高亮。
  const relations = dragState?.dragging
    ? buildSelectionRelations(props.graph, currentLayout, [])
    : buildSelectionRelations(props.graph, currentLayout, currentSelectedIds())
  const highlightedIds = relations.highlightedIds
  const attachPreview =
    dragState?.dragging && dragState.attachPreviewRect
      ? {
          rect: worldRectToScreen(dragState.attachPreviewRect, renderViewport),
          parentRect: dragState.attachPreviewParentRect
            ? worldRectToScreen(dragState.attachPreviewParentRect, renderViewport)
            : null,
        }
      : null
  renderScene(ctx, {
    layout: currentLayout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport: renderViewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: {
      selectedIds: relations.selectedIds,
      highlightedIds,
      dimmedIds: relations.dimmedIds,
      highlightedEdgeIds: relations.highlightedEdgeIds,
      dimmedEdgeIds: relations.dimmedEdgeIds,
      groupDrag: dragRenderContext(),
      groupScrollbarHoverId: hoveredScrollbarGroupId,
      selectionRect: marqueeState?.active ? normalizeRect(marqueeState.rect) : null,
      attachPreview,
    },
    renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
  })
```

- [ ] **Step 9: 在 `src/minimap/renderer.js` 新增连接线绘制函数**

在 `drawDropSlot` 函数定义之后（第414行 `}` 之后）插入：

```js
// 拖拽挂接预览的连接线：从未来父节点连到占位框，复用真实连线同一套正交路径算法，
// 用预览色虚线区分"这只是预览"——parentBox/previewBox 都是已经转换好的屏幕坐标矩形。
function drawAttachPreviewLine(ctx, parentBox, previewBox, mainAxis, theme) {
  const dropSlot = { ...defaultTheme.group.dropSlot, ...(theme.group.dropSlot || {}) }
  const path = orthogonalPath(parentBox, previewBox, mainAxis)
  ctx.strokeStyle = dropSlot.stroke
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(path[0].x, path[0].y)
  for (const point of path.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.stroke()
  ctx.setLineDash([])
}
```

- [ ] **Step 10: 在 `renderScene` 里接上新函数，替换旧的 `siblingInsertPreview`**

读取第556~567行，当前是：

```js
  if (state.groupDrag) {
    drawNodeDragGhost(ctx, graph, state.groupDrag, theme, renderers, viewport, selectedIds, highlightedIds, dimmedIds)
  }

  if (state.siblingInsertPreview) {
    drawDropSlot(ctx, state.siblingInsertPreview.rect, theme, 1)
  }

  if (state.selectionRect) drawSelectionRect(ctx, state.selectionRect, theme)

  return { total: layout.visibleItems.length, drawn, culled, durationMs: now() - t0 }
}
```

改成：

```js
  if (state.groupDrag) {
    drawNodeDragGhost(ctx, graph, state.groupDrag, theme, renderers, viewport, selectedIds, highlightedIds, dimmedIds)
  }

  if (state.attachPreview) {
    if (state.attachPreview.parentRect) {
      drawAttachPreviewLine(ctx, state.attachPreview.parentRect, state.attachPreview.rect, mainAxis, theme)
    }
    drawDropSlot(ctx, state.attachPreview.rect, theme, 1)
  }

  if (state.selectionRect) drawSelectionRect(ctx, state.selectionRect, theme)

  return { total: layout.visibleItems.length, drawn, culled, durationMs: now() - t0 }
}
```

（`mainAxis` 在第491行已经算好，`renderScene` 函数体内直接可用，不需要重新计算或额外传参。）

- [ ] **Step 11: 运行测试，确认全部通过**

```bash
npm test -- test/minimap-node-move.test.js
```

预期：本文件全部测试通过，包括 Step 2/3/4 改写和新增的部分。

- [ ] **Step 12: 跑全量测试**

```bash
npm test
```

预期：全部通过。

- [ ] **Step 13: 跑构建确认没有语法问题**

```bash
npm run build
```

预期：构建成功。

- [ ] **Step 14: Commit**

```bash
git add src/minimap/Minimap.vue src/minimap/renderer.js test/minimap-node-move.test.js
git commit -m "feat: replace whole-node attach highlight with preview box + connector line"
```
