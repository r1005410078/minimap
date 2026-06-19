# Phase 2 分组逻辑 Spec

> 对应 [ROADMAP.md](../../../ROADMAP.md) 第二阶段：分组框能力。
> 本 spec 只覆盖第二阶段的**第一个切片：纯逻辑层**（`layout.js` 的分段/分组算法 + 虚拟绘制窗口计算），不含 Canvas 渲染与 Vue 交互。
> 依赖 [Phase 1 核心逻辑层 spec](2026-06-18-phase-1-core-logic.md) 的 `computeLayout` 既有结构（`itemOf`/`crossSizeOf`/`place` 递归、`visibleItems`、`bounds`）。

## 头脑风暴决策记录

- **现状缺口**：现有 `layout.js` 的分组逻辑是简化版——只要 `node.children.length > GROUP_THRESHOLD` 就把该父节点的全部子节点折成一个分组框，不区分子节点是否带自己的子节点，一个父节点也只可能产生一个分组框。这跟 ROADMAP 第二阶段"带子节点的兄弟节点永远不参与合并，并截断序列"的规则不一致，需要替换。
- **展开效果**：展开 = 分组框长高到能放下全部子节点（不再受 `GROUP_MAX_H_RATIO` 限制、不出现滚动条）；折叠 = 恢复最大高度限制 + 滚动。框始终存在（不会展开成散落的普通节点），列数（`columns`，由最大宽度决定）展开/折叠不变，只有高度/行数可见范围变化。
- **多分组身份**：一个父节点下因为被带子节点的兄弟截断，可能产生多个独立分组框。每个分组框的 id 用 `${parentId}::g${segmentIndex}` 表示，`segmentIndex` 是这个父节点下"够资格折叠的分段"按子节点顺序出现的序号（0, 1, 2…）。框内换位只在同一分段内部移动，不会跨越截断边界，因此 `segmentIndex` 不会因换位而改变；只有树结构变化导致分段方式改变时才会变，这种情况下旧的展开/滚动状态失效是预期行为。
- **状态注入点**：`expanded`/`scrollTop` 通过 `options.groupStates`（`Map<groupId, { expanded?, scrollTop? }>`）传入 `computeLayout`，缺省（未传或某个 id 查不到）时该分组按 `{ expanded: false, scrollTop: 0 }` 处理，跟现状（折叠 + 不滚动）保持一致。`groupStates` 的受控/非受控、Vue 层怎么维护，是切片 3（Vue 壳交互）的范围。
- **不引入新依赖**：依旧是纯 JS 计算，不碰 Canvas/DOM；本切片之后渲染器和交互层照常通过 `layout.groups`/`layout.nodes`/`visibleItems` 消费结果。
- **向后兼容约束**：现有 demo 图（`heap-1` 24 个纯叶子子节点、`cluster-25` 10 个纯叶子子节点）和压力图（`stress-heap` 全是叶子）都不含"叶子兄弟被带子节点兄弟打断"的场景，新算法对这些 fixture 的输出（`children.length`、`overflowY`、宽高）要跟现状完全一致，本切片不应让任何现有测试变红。

## 范围

### 目标（本切片交付）

- `src/minimap/layout.js`：
  - 分段算法：同一父节点下，连续叶子兄弟按 `groupThreshold` 分段折叠，带子节点的兄弟永远单独参与布局并截断序列。
  - 多分组身份：`group.id`，支持一个父节点产生 0 个、1 个或多个分组框。
  - 尺寸：维持现有 `GROUP_MAX_W_RATIO`/`GROUP_MAX_H_RATIO`，新增最小宽高下限；展开态高度不再被最大高度夹住。
  - `options.groupThreshold` 覆盖默认阈值（默认仍是 `GROUP_THRESHOLD = 5`）。
  - `options.groupStates` 注入每个分组的 `expanded`/`scrollTop`，并对 `scrollTop` 做越界夹紧。
  - 新增纯函数 `visibleGroupChildren(group)`：根据 `group.scrollTop`/`columns`/`rows` 算出当前应该绘制的子节点 id + 它们在世界坐标下的格子位置，供切片 2（渲染器）和切片 3（交互/命中检测）复用，本切片不消费它，只保证其正确性。
  - 新增纯函数 `clampGroupScroll(group, scrollTop)`：把任意 `scrollTop` 夹到 `[0, contentHeight - height]`（非 `overflowY` 时恒为 0）。
- 测试：扩展 `test/minimap-layout.test.js` / `test/minimap-graph.test.js`，覆盖新分段规则、多分组、阈值覆盖、最小尺寸、展开态、`visibleGroupChildren`、`clampGroupScroll`；`npm test` 全绿，`npm run build` 通过。

### 非目标（后续切片）

- Canvas 绘制（分组框 chrome、子节点格子绘制、滚动条视觉）——切片 2。
- `layout-transition.js` 的动画 key 从 `parentId` 改成 `group.id`，`renderer.js` 的 `resolveEdges`/`drawGroup` 适配多分组——切片 2。
- 命中检测细分（header/item/body）、滚轮、拖拽换位、`groupStates` 受控/非受控 prop——切片 3。
- 本切片产出的 `group.id`/`expanded`/`scrollTop`/`contentHeight` 字段在切片 2/3 落地前，现有消费者（`renderer.js`、`layout-transition.js`、`interaction.js`）会继续按字段名访问 `parentId`/`children`/`x`/`y`/`width`/`height`/`overflowY`，这些字段保持不变，所以现状行为不受影响；它们尚未读取新字段，属于预期的"契约已扩展、消费者未跟进"，会在切片 2/3 中补上。

## Group 数据契约

```
Group = {
  id: string,            // `${parentId}::g${segmentIndex}`
  parentId: string,
  children: string[],    // 这个分组折叠的子节点 id，保持原始兄弟顺序
  columns: number,
  rows: number,
  width: number,          // [minWidth, maxWidth] 之间
  height: number,         // 折叠：[minHeight, maxHeight]；展开：max(minHeight, contentHeight)
  contentHeight: number,  // 不受最大高度限制的真实内容高度，用于判断 overflow 和夹紧 scrollTop
  overflowY: boolean,     // height < contentHeight（展开态恒为 false）
  expanded: boolean,
  scrollTop: number,      // 折叠且 overflowY 时落在 [0, contentHeight - height]，否则恒为 0
  x: number,
  y: number,
}
```

尺寸推导维持现有 `GROUP` 网格常量（`padding`/`header`/`itemW`/`itemH`/`itemGap`）：

- `maxWidth = viewportWidth * GROUP_MAX_W_RATIO`，`maxHeight = viewportHeight * GROUP_MAX_H_RATIO`（不变）。
- `minWidth = 2*padding + itemW`（够放 1 列），`minHeight = header + 2*padding + itemH`（够放 1 行）。
- `columns` 只由 `maxWidth` 决定，展开/折叠不变；`contentWidth = 2*padding + columns*itemW + (columns-1)*itemGap`。
- `width = max(minWidth, min(contentWidth, maxWidth))`。
- 折叠时 `height = max(minHeight, min(contentHeight, maxHeight))`；展开时 `height = max(minHeight, contentHeight)`（不夹最大值）。
- **最小值优先**：当视口过小导致 `maxWidth < minWidth` 或 `maxHeight < minHeight` 时，以 `minWidth`/`minHeight` 为准——分组框允许超过按比例算出的最大值，因为再小就放不下一个最小可用网格。这是故意的下限保护，不是 bug。

## 模块 API 契约

### `src/minimap/layout.js`

```js
export const GROUP_THRESHOLD = 5 // 默认阈值，可被 options.groupThreshold 覆盖

export function computeLayout(graph, options = {}) {
  // options: { direction, viewportWidth, viewportHeight, groupThreshold?, groupStates? }
  // groupThreshold: number，默认 GROUP_THRESHOLD
  // groupStates: Map<groupId, { expanded?: boolean, scrollTop?: number }>，默认空 Map
  // 返回值结构不变：{ nodes, groups, visibleItems, bounds }，Group 形状见上节
}

export function visibleGroupChildren(group) {
  // 返回 Array<{ id, index, rect: { x, y, width, height } }>（世界坐标，已加上 group.x/y）
  // 只包含当前 scrollTop 下应该绘制的行（含可能半露出的首尾行，避免滚动时露白）
}

export function clampGroupScroll(group, scrollTop) {
  // 返回夹紧后的 scrollTop；group.overflowY 为 false 时恒返回 0
}
```

**分段算法**（取代现有的"子节点数 > 阈值就整体折叠"）：

1. 遍历父节点 `children`，把连续的「叶子兄弟」（`!child.children || child.children.length === 0`）划成若干 run；遇到带子节点的兄弟就结束当前 run（这个兄弟自己始终是普通节点，参与正常递归布局，不计入任何 run）。
2. 每个 run 独立判断：`run.length > groupThreshold` 才会变成一个分组；不够长的 run 里的节点各自以普通节点身份参与布局（跟现状 ≤5 不分组一致）。
3. 把这个父节点下"够资格"的 run 按出现顺序编号 `segmentIndex`（0, 1, 2…），生成 `group.id = \`${parentId}::g${segmentIndex}\``。
4. 在递归构建子项列表时，按 `children` 原始顺序遍历：命中某个分组的子节点时，只在该分组第一次出现的位置插入一个 `{ type: 'group', group }` 项，之后属于同一分组的子节点跳过；其余子节点（不够资格的 run 成员、带子节点的兄弟）按原顺序各自递归生成普通节点项。

## 验收标准

- 同一父节点下，6 个及以上连续叶子兄弟合并为一个分组框；5 个及以下不合并。
- 带子节点的兄弟节点永不参与合并；它会把原本连续的叶子兄弟序列从这里截断成两段，每段独立按长度判断是否折叠（可能一段折叠一段不折叠、也可能两段都折叠成两个独立分组框）。
- 调整 `options.groupThreshold` 后，折叠结果同步变化（边界值：`run.length === groupThreshold` 不折叠，`run.length === groupThreshold + 1` 折叠）。
- 极小视口下分组框宽高不会低于 `minWidth`/`minHeight`；正常视口下最大宽高仍受 48%/42% 比例约束。
- `expanded: true` 的分组：`height === max(minHeight, contentHeight)`、`overflowY === false`、`scrollTop === 0`，且 `columns` 跟同一分组折叠态时一致。
- `visibleGroupChildren(group)` 返回的子集随 `group.scrollTop` 变化；`scrollTop = 0` 时从第一行开始；增大 `scrollTop` 后已经滚出可视区域的子节点不再出现在返回结果里。
- `clampGroupScroll` 对越界输入（负数、超过内容高度）夹紧到合法范围；非 overflow 分组恒返回 0。
- 现有 `npm test` 用例（分组阈值、左右/上下方向、框内换位、锚点补偿、压力图、`edges` 不影响主布局、父节点居中线）保持通过，不需要改断言。
- `npm test`、`npm run build` 通过。

## 测试清单

- 新增 fixture：父节点下叶子兄弟序列中间插入一个带子节点的兄弟（如 `[leaf×6, parentish, leaf×6]`），验证截断成两个独立分组框、各自 `id` 不同、互不包含对方的子节点。
- 新增 fixture：截断后一段超过阈值、另一段不超过，验证只有一段变成分组框，另一段子节点各自是普通节点。
- `options.groupThreshold` 覆盖测试：同一份 6 个叶子兄弟的图，`groupThreshold=5`（默认）折叠，`groupThreshold=6` 不折叠。
- 极小 `viewportWidth`/`viewportHeight` 下分组框宽高不低于推导出的 `minWidth`/`minHeight`。
- `options.groupStates` 注入 `{ expanded: true }`：对应分组 `height===contentHeight`、`overflowY===false`。
- `visibleGroupChildren`：`scrollTop=0` 返回的 id 集合 vs. `scrollTop` 增加一整行高度后返回的 id 集合，验证窗口随之滑动且不重复包含已滚出的首行。
- `clampGroupScroll`：传入负数夹到 0，传入超大值夹到 `contentHeight-height`，非 overflow 分组传入任意值都回 0。
- 回归：`test/minimap-layout.test.js`、`test/minimap-graph.test.js` 现有用例原样通过（无需修改断言）。
