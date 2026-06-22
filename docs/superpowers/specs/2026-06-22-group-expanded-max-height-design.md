# 展开态分组框默认最大高度设计

## 背景

分组框（把一段连续叶子兄弟折叠成的网格盒子）有两种高度状态，见 [layout.js:130-132](../../../src/minimap/graph/layout.js#L130)：

- **折叠态**（`expanded === false`）：高度 = `clamp(GROUP_MIN_HEIGHT, contentHeight, maxH)`，其中 `maxH = viewportHeight * GROUP_MAX_H_RATIO(0.42)`。超过即出滚动条。
- **展开态**（`expanded === true`）：高度 = `max(GROUP_MIN_HEIGHT, contentHeight)`，**不封顶**，长到容纳全部子节点为止。

子节点很多时，展开态分组框会无限变高，占满甚至超出画布。

## 目标

- 给**展开态**分组框加一个**默认最大高度**，超过即滚动；折叠态维持现状。
- 最大高度做成**对外可配置选项**，给一个默认值，业务方可覆盖。

## 关键事实：滚动机制只看 `overflowY`，不看 `expanded`

滚动条渲染（[renderer.js:359](../../../src/minimap/render/renderer.js#L359)）、命中（[interaction.js:484](../../../src/minimap/interaction/interaction.js#L484)）、滚轮/拖拽滚动（[drag-controller.js:760](../../../src/minimap/controllers/drag-controller.js#L760)）、可见窗口 overscan（[layout.js:69](../../../src/minimap/graph/layout.js#L69)）**全部以 `group.overflowY`（= `height < contentHeight`）为条件，没有任何一处判断 `group.expanded`**（仅 ▾/▸ 箭头看 `expanded`，纯装饰）。

因此只要给展开态高度封顶，`overflowY` 自动变 `true`，现有滚动机制原样复用——**render / interaction 层不需要任何改动**。改动集中在 `buildGroup` 与选项接线。

## 范围内

- 修改 `src/minimap/graph/layout.js`：新增常量 `GROUP_EXPANDED_MAX_HEIGHT`，`buildGroup` 给展开态高度封顶，`computeLayout` 接收并透传新选项。
- 修改 `src/minimap/controllers/core-controller.js`：`computeLayout(...)` 调用透传 `groupExpandedMaxHeight`。
- 修改 `src/minimap/components/Minimap.vue`：在 `MinimapOptions` typedef 文档化新选项。
- 修改 `test/minimap-layout.test.js`：补展开态封顶/滚动/自定义值/回退/高视口回归用例。
- 更新 `src/minimap/graph/README.md`、`ROADMAP.md`。

## 范围外

- 不改折叠态高度逻辑（`maxH = 0.42 * viewportHeight` 保持不变）。
- 不改 render / interaction 的滚动条、滚轮、拖拽滚动、overscan 任何代码（复用现有 `overflowY` 通路）。
- 不改 ▾/▸ 箭头语义（展开/折叠仍是两种独立状态，只是两者现在都可能滚动）。
- 不引入新的运行时依赖。

## 模块设计

### 新选项 `groupExpandedMaxHeight`

- 类型：`number`，单位 px（世界坐标 / 缩放前），表示**展开态分组框的整盒最大高度**（含 header + padding，与折叠态 `maxH` 同口径）。
- 默认值：`560`（约 10 行子节点可见；折叠态 @600 视口为 252，展开态明显更高又不至于占满画布）。
- 接线照搬现有 `groupThreshold`（[layout.js:156](../../../src/minimap/graph/layout.js#L156)、[core-controller.js:207](../../../src/minimap/controllers/core-controller.js#L207)）：默认值放在 `layout.js` 常量，`computeLayout` 用 `?? GROUP_EXPANDED_MAX_HEIGHT` 兜底；不塞进 `Minimap.vue` 的 `effectiveOptions` 默认表，仅在 typedef 文档化。

### `layout.js` 改动

新增常量：

```js
const GROUP_EXPANDED_MAX_HEIGHT = 560
```

`computeLayout` 解构并透传：

```js
const groupExpandedMaxHeight = normalizeExpandedMaxHeight(options.groupExpandedMaxHeight)
// ...
const group = buildGroup(groupId, node.id, segmentChildren, state, viewportWidth, viewportHeight, groupExpandedMaxHeight)
```

`normalizeExpandedMaxHeight(value)`：当 `value` 不是有限正数时回退到 `GROUP_EXPANDED_MAX_HEIGHT`。

`buildGroup` 签名增加 `groupExpandedMaxHeight` 参数，高度公式改为：

```diff
 const expanded = state.expanded === true
 const width = Math.max(GROUP_MIN_WIDTH, Math.min(contentWidth, maxW))
+// 展开态封顶值取 max(折叠态上限, 配置值)，保证展开态永远不矮于折叠态
+const expandedMax = Math.max(maxH, groupExpandedMaxHeight)
 const height = expanded
-  ? Math.max(GROUP_MIN_HEIGHT, contentHeight)
+  ? Math.max(GROUP_MIN_HEIGHT, Math.min(contentHeight, expandedMax))
   : Math.max(GROUP_MIN_HEIGHT, Math.min(contentHeight, maxH))
 const overflowY = height < contentHeight
```

`overflowY`、`scrollTop`（经 `clampGroupScroll`）、`contentHeight` 等字段计算不变，封顶后它们自动反映可滚动状态。

### `core-controller.js` 改动

```diff
 const nextLayout = computeLayout(deps.getGraph(), {
   direction: deps.getLayoutDirection(),
   viewportWidth: cssWidth,
   viewportHeight: cssHeight,
   groupThreshold: currentOptions().groupThreshold,
+  groupExpandedMaxHeight: currentOptions().groupExpandedMaxHeight,
   groupStates: new Map(Object.entries(currentGroupStates())),
 })
```

### `Minimap.vue` 改动

在 `MinimapOptions` typedef 增加一行：

```
 * @property {number} [groupExpandedMaxHeight=560] 展开态分组框的最大高度（px，世界坐标）；超过即滚动。
```

## 边界情况

- **展开态内容不足封顶**：`contentHeight < expandedMax` → 高度 = `contentHeight`，`overflowY = false`，不出滚动条（行为同今天）。
- **高视口反转**：`viewportHeight > GROUP_EXPANDED_MAX_HEIGHT / 0.42`（默认约 1333px）时 `maxH > 560`，`expandedMax = maxH`，展开态 = 折叠态高度（恰好不矮于折叠态）。
- **非法配置值**：`0` / 负数 / `NaN` / 非数字 → 回退默认 `560`。
- **`GROUP_MIN_HEIGHT` 兜底**：极小配置值仍不会让盒子矮于单行最小高度。
- **缩放无关**：封顶值是世界坐标高度；缩放在渲染时统一施加，索引/命中/滚动都在世界坐标，封顶不受缩放影响。

## 测试策略

纯 layout 单测（符合项目"纯逻辑必须单测、避免脆弱像素断言"约定），用足够多子节点构造溢出：

- 展开态内容 < 默认封顶 → `height === contentHeight`，`overflowY === false`。
- 展开态内容 > 默认封顶 → `height === max(maxH, 560)`，`overflowY === true`，`clampGroupScroll` 能把 `scrollTop` 夹到 `[0, contentHeight - height]`。
- 自定义 `groupExpandedMaxHeight: 300` 生效（更早溢出、盒子更矮）。
- 传 `0` / 负数 / 非法值 → 回退默认 `560`。
- 高视口（如 `viewportHeight: 1400`）下展开态高度 ≥ 折叠态高度（验证 `max(maxH, …)`）。
- 折叠态高度与现有用例一致（回归）。

不写计时/像素基准（与项目测试约定一致）。

## 验收标准

- 展开态分组框高度被封顶、超出可滚动；折叠态行为不变；现有测试全过。
- 新选项 `groupExpandedMaxHeight` 可覆盖默认值，默认 `560`。
- `npm test` 与 `npm run build` 全部通过。
- 手动验收：展开一个子节点很多的分组（如 demo 的 heap-1），分组框不再无限变高，出现滚动条且可滚动/滚轮/拖拽滚动正常。
