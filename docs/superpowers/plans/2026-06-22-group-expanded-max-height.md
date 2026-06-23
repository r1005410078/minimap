# 展开态分组框默认最大高度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给展开态分组框加一个可配置的默认最大高度（默认 560px），超过即复用现有滚动机制，折叠态行为不变。

**Architecture:** 在 `layout.js` 的 `buildGroup` 里把展开态高度按 `max(折叠态视口上限, groupExpandedMaxHeight)` 封顶；封顶后 `overflowY` 自动为 true，现有滚动条/滚轮/拖拽滚动/overscan（全部只看 `overflowY`，不看 `expanded`）原样复用，render/interaction 不改。新选项 `groupExpandedMaxHeight` 照搬现有 `groupThreshold` 的接线，从组件 `options` 经 `core-controller` 透传进 `computeLayout`。

**Tech Stack:** 纯 JS，`node:test` + `node:assert/strict`，现有 `createDemoGraph`/`computeLayout`/`createCoreController` 测试设施。

## Global Constraints

- 不引入新的运行时依赖。
- 不改折叠态高度逻辑（`maxH = viewportHeight * 0.42` 保持不变）。
- 不改 render / interaction 的滚动条、滚轮、拖拽滚动、overscan 任何代码（复用现有 `overflowY` 通路）。
- 不改 ▾/▸ 箭头语义。
- 新选项默认值 `560`（px，世界坐标），业务方可覆盖；非法值回退默认。
- `npm test` 与 `npm run build` 必须全部通过。

Spec: [docs/superpowers/specs/2026-06-22-group-expanded-max-height-design.md](../specs/2026-06-22-group-expanded-max-height-design.md)

---

## File Structure

- Modify `src/minimap/graph/layout.js`
  - 新增常量 `GROUP_EXPANDED_MAX_HEIGHT = 560` 与 `normalizeExpandedMaxHeight`；`buildGroup` 增参并给展开态封顶；`computeLayout` 解构并透传新选项。
- Modify `test/minimap-layout.test.js`
  - 展开态封顶/滚动、不足封顶不滚动、自定义值、非法值回退、高视口不反转、scrollTop 夹紧。
- Modify `src/minimap/controllers/core-controller.js`
  - `computeLayout(...)` 调用透传 `groupExpandedMaxHeight: currentOptions().groupExpandedMaxHeight`。
- Modify `test/minimap-core-controller.test.js`
  - 集成用例：选项经组件 → 控制器 → 布局，封顶生效。
- Modify `src/minimap/components/Minimap.vue`
  - `MinimapOptions` typedef 文档化新选项。
- Modify `src/minimap/graph/README.md`、`ROADMAP.md`
  - 文档化新选项与记录本切片。

## Task 1: layout.js 展开态封顶 + 选项透传

**Files:**

- Modify: `src/minimap/graph/layout.js`
- Test: `test/minimap-layout.test.js`

**Interfaces:**

- Produces: `computeLayout(graph, { ..., groupExpandedMaxHeight })` 新增可选项 `groupExpandedMaxHeight?: number`（默认 `560`，非有限正数回退默认）。`layout.groups[i]` 仍是 `{ id, parentId, children, columns, rows, width, height, contentHeight, overflowY, expanded, scrollTop, x, y }`；展开态 `height = max(GROUP_MIN_HEIGHT, min(contentHeight, max(maxH, groupExpandedMaxHeight)))`。
- Consumes: 现有 `graphWithChildren(childSpecs)`、`leaves(prefix, count)` 测试 helper（已在 `test/minimap-layout.test.js` 顶部定义）。一个父节点 `p` 下挂 N 个叶子时生成分组 id `p::g0`。

- [ ] **Step 1: 写失败测试**

在 `test/minimap-layout.test.js` 末尾追加（`graphWithChildren`/`leaves` 已存在，直接用）：

```js
// 1200x760 视口下，p::g0 为 4 列；48 个叶子 -> 12 行，
// contentHeight = GROUP.header(28) + 2*padding(24) + 12*itemH(40) + 11*itemGap(10) = 642；
// 折叠态上限 maxH = 760*0.42 = 319.2；默认展开封顶 560。
test("caps an expanded group box at the default max height and enables scrolling", () => {
  const graph = graphWithChildren(leaves("c", 48));
  const layout = computeLayout(graph, {
    direction: "horizontal",
    viewportWidth: 1200,
    viewportHeight: 760,
    groupStates: new Map([["p::g0", { expanded: true }]]),
  });
  const group = layout.groups.find((g) => g.id === "p::g0");
  assert.equal(group.expanded, true);
  assert.equal(group.contentHeight, 642);
  assert.equal(group.height, 560);
  assert.equal(group.overflowY, true);
});

test("an expanded group shorter than the max keeps its content height and does not scroll", () => {
  // 8 个叶子 -> 2 行，contentHeight = 28+24+2*40+1*10 = 142 < 319.2 < 560
  const graph = graphWithChildren(leaves("c", 8));
  const layout = computeLayout(graph, {
    direction: "horizontal",
    viewportWidth: 1200,
    viewportHeight: 760,
    groupStates: new Map([["p::g0", { expanded: true }]]),
  });
  const group = layout.groups.find((g) => g.id === "p::g0");
  assert.equal(group.contentHeight, 142);
  assert.equal(group.height, 142);
  assert.equal(group.overflowY, false);
});

test("a custom groupExpandedMaxHeight overrides the default cap", () => {
  const graph = graphWithChildren(leaves("c", 48));
  const layout = computeLayout(graph, {
    direction: "horizontal",
    viewportWidth: 1200,
    viewportHeight: 760,
    groupExpandedMaxHeight: 400, // > maxH(319.2) 且 < contentHeight(642) -> 封顶取 400
    groupStates: new Map([["p::g0", { expanded: true }]]),
  });
  const group = layout.groups.find((g) => g.id === "p::g0");
  assert.equal(group.height, 400);
  assert.equal(group.overflowY, true);
});

test("an invalid groupExpandedMaxHeight falls back to the default", () => {
  const graph = graphWithChildren(leaves("c", 48));
  for (const bad of [0, -50, NaN, "tall", null]) {
    const layout = computeLayout(graph, {
      direction: "horizontal",
      viewportWidth: 1200,
      viewportHeight: 760,
      groupExpandedMaxHeight: bad,
      groupStates: new Map([["p::g0", { expanded: true }]]),
    });
    const group = layout.groups.find((g) => g.id === "p::g0");
    assert.equal(group.height, 560);
  }
});

test("on a tall viewport the expanded cap never drops below the collapsed height", () => {
  // viewportHeight 1400 -> maxH = 588 > 默认 560；expandedMax = max(588,560) = 588
  const graph = graphWithChildren(leaves("c", 48));
  const base = {
    direction: "horizontal",
    viewportWidth: 1200,
    viewportHeight: 1400,
  };
  const collapsed = computeLayout(graph, {
    ...base,
    groupStates: new Map([["p::g0", { expanded: false }]]),
  }).groups.find((g) => g.id === "p::g0");
  const expanded = computeLayout(graph, {
    ...base,
    groupStates: new Map([["p::g0", { expanded: true }]]),
  }).groups.find((g) => g.id === "p::g0");
  assert.ok(expanded.height >= collapsed.height);
  assert.equal(expanded.height, 588);
  assert.equal(collapsed.height, 588);
});

test("clamps scrollTop within the capped expanded group", () => {
  const graph = graphWithChildren(leaves("c", 48));
  const layout = computeLayout(graph, {
    direction: "horizontal",
    viewportWidth: 1200,
    viewportHeight: 760,
    groupStates: new Map([["p::g0", { expanded: true, scrollTop: 10000 }]]),
  });
  const group = layout.groups.find((g) => g.id === "p::g0");
  assert.equal(group.height, 560);
  assert.equal(group.scrollTop, group.contentHeight - group.height); // 642 - 560 = 82
});
```

- [ ] **Step 2: 运行验证失败**

```bash
npm test -- test/minimap-layout.test.js
```

Expected: 新增的 `caps an expanded group...`、`custom groupExpandedMaxHeight...`、`invalid groupExpandedMaxHeight...`、`clamps scrollTop...` 失败（当前展开态不封顶，`height === contentHeight(642)`，`overflowY === false`）。`shorter than the max` 与 `tall viewport` 两条可能已通过（现状即不溢出）——这正常，它们是回归守护。

- [ ] **Step 3: 实现 layout.js 封顶与透传**

在 `src/minimap/graph/layout.js`，紧接 `GROUP_MAX_H_RATIO` 那几个常量后新增：

```js
const GROUP_EXPANDED_MAX_HEIGHT = 560;

function normalizeExpandedMaxHeight(value) {
  return Number.isFinite(value) && value > 0
    ? value
    : GROUP_EXPANDED_MAX_HEIGHT;
}
```

把 `buildGroup` 的签名与高度公式改为（增加末位参数 `groupExpandedMaxHeight`）：

```diff
-function buildGroup(groupId, parentId, children, state, viewportWidth, viewportHeight) {
+function buildGroup(groupId, parentId, children, state, viewportWidth, viewportHeight, groupExpandedMaxHeight) {
   const maxW = viewportWidth * GROUP_MAX_W_RATIO
   const maxH = viewportHeight * GROUP_MAX_H_RATIO
   // ... columns / rows / contentWidth / contentHeight 不变 ...
   const expanded = state.expanded === true
   const width = Math.max(GROUP_MIN_WIDTH, Math.min(contentWidth, maxW))
+  // 展开态封顶值取 max(折叠态上限, 配置值)，保证展开态永远不矮于折叠态
+  const expandedMax = Math.max(maxH, groupExpandedMaxHeight)
   const height = expanded
-    ? Math.max(GROUP_MIN_HEIGHT, contentHeight)
+    ? Math.max(GROUP_MIN_HEIGHT, Math.min(contentHeight, expandedMax))
     : Math.max(GROUP_MIN_HEIGHT, Math.min(contentHeight, maxH))
   const overflowY = height < contentHeight
```

在 `computeLayout` 里解构新选项并透传给 `buildGroup`：

```diff
   const groupThreshold = options.groupThreshold ?? GROUP_THRESHOLD
+  const groupExpandedMaxHeight = normalizeExpandedMaxHeight(options.groupExpandedMaxHeight)
   const groupStates = options.groupStates ?? new Map()
```

```diff
-      const group = buildGroup(groupId, node.id, segmentChildren, state, viewportWidth, viewportHeight)
+      const group = buildGroup(groupId, node.id, segmentChildren, state, viewportWidth, viewportHeight, groupExpandedMaxHeight)
```

- [ ] **Step 4: 运行验证通过**

```bash
npm test -- test/minimap-layout.test.js
```

Expected: 全部通过（含新增 6 条与原有折叠态用例）。

- [ ] **Step 5: 提交**

```bash
git add src/minimap/graph/layout.js test/minimap-layout.test.js
git commit -m "feat: cap expanded group box height with a configurable default max"
```

## Task 2: 选项透传到控制器 + 文档

**Files:**

- Modify: `src/minimap/controllers/core-controller.js`
- Test: `test/minimap-core-controller.test.js`
- Modify: `src/minimap/components/Minimap.vue`
- Modify: `src/minimap/graph/README.md`
- Modify: `ROADMAP.md`

**Interfaces:**

- Consumes: Task 1 的 `computeLayout(graph, { ..., groupExpandedMaxHeight })`；`currentOptions()`（= `deps.getOptions() ?? {}`）。
- Produces: 组件 `options.groupExpandedMaxHeight` 经 `core-controller` 透传进 `computeLayout`，对外可用。

- [ ] **Step 1: 写失败的集成测试**

在 `test/minimap-core-controller.test.js` 末尾追加（`createDeps`/`mountController` 已存在；测试视口 800x600，`heap-1::g0` 为 2 列、24 子节点 -> 12 行、contentHeight 642）：

```js
test("groupExpandedMaxHeight option flows through the controller into the layout", () => {
  const deps = createDeps({
    getOptions: () => ({
      disableInitialCenter: true,
      groupExpandedMaxHeight: 400,
    }),
    getGroupStatesProp: () => new Map([["heap-1::g0", { expanded: true }]]),
  });
  const { controller } = mountController(deps);
  const group = controller
    .getLayout()
    .groups.find((g) => g.id === "heap-1::g0");
  assert.equal(group.expanded, true);
  assert.equal(group.height, 400); // 选项未透传时会是默认 560
  assert.equal(group.overflowY, true);
  controller.destroy();
});
```

- [ ] **Step 2: 运行验证失败**

```bash
npm test -- test/minimap-core-controller.test.js
```

Expected: 失败，`group.height === 560`（默认值，因为控制器还没透传选项）而非 `400`。

- [ ] **Step 3: 在 core-controller 透传选项**

在 `src/minimap/controllers/core-controller.js` 的 `updateLayout` 里 `computeLayout(...)` 调用补一行：

```diff
     const nextLayout = computeLayout(deps.getGraph(), {
       direction: deps.getLayoutDirection(),
       viewportWidth: cssWidth,
       viewportHeight: cssHeight,
       groupThreshold: currentOptions().groupThreshold,
+      groupExpandedMaxHeight: currentOptions().groupExpandedMaxHeight,
       groupStates: new Map(Object.entries(currentGroupStates())),
     })
```

- [ ] **Step 4: 运行验证通过**

```bash
npm test -- test/minimap-core-controller.test.js
```

Expected: 全部通过。

- [ ] **Step 5: 文档化新选项**

在 `src/minimap/components/Minimap.vue` 的 `MinimapOptions` typedef 块里，与其它 `@property` 行并列新增一行：

```
 * @property {number} [groupExpandedMaxHeight=560] 展开态分组框最大高度（px，世界坐标）；超过即出现滚动条，业务方可覆盖默认值。
```

在 `src/minimap/graph/README.md` 把 `layout.js` 那一行替换为：

```diff
-| `layout.js` | 树布局：节点/分组框定位、合并分组、展开折叠、滚动窗口；`GROUP`/`NODE`/`LEVEL_GAP` 常量 |
+| `layout.js` | 树布局：节点/分组框定位、合并分组、展开折叠、滚动窗口（折叠态按视口比例封顶、展开态按 `groupExpandedMaxHeight` 选项封顶，默认 560）；`GROUP`/`NODE`/`LEVEL_GAP` 常量 |
```

在 `ROADMAP.md` 的「第二阶段：分组框能力」小节里，新增一条子条目：

```
  - 展开态分组框默认最大高度（新增可配置选项 `groupExpandedMaxHeight`，默认 560px；展开态高度封顶后复用现有 `overflowY` 滚动通路，render/interaction 不变；[spec](docs/superpowers/specs/2026-06-22-group-expanded-max-height-design.md)，[plan](docs/superpowers/plans/2026-06-22-group-expanded-max-height.md)，`npm test` 全过，`npm run build` 通过）
```

- [ ] **Step 6: 全量验证**

```bash
npm test
npm run build
```

Expected: 全部测试通过（无计数回退），build 成功。

- [ ] **Step 7: 提交**

```bash
git add src/minimap/controllers/core-controller.js test/minimap-core-controller.test.js src/minimap/components/Minimap.vue src/minimap/graph/README.md ROADMAP.md
git commit -m "feat: expose groupExpandedMaxHeight option and document it"
```

## Self-Review

- **Spec coverage:** 新选项 + 默认 560（Task 1 常量、Task 2 透传/文档）✓；展开态封顶 + 复用 `overflowY` 滚动（Task 1 `buildGroup`）✓；`max(maxH, …)` 防反转（Task 1 高视口用例）✓；非法值回退（Task 1 用例）✓；折叠态不变（Task 1 沿用现有用例 + 高视口对比）✓；render/interaction 不改（设计层面，无任务触碰这些文件）✓；README/ROADMAP（Task 2 Step 5）✓。
- **Placeholder scan:** 无 TBD/TODO；每步含可运行代码与确切期望值。
- **Type consistency:** `groupExpandedMaxHeight: number` 在 Task 1（producer：`computeLayout`/`buildGroup`/`normalizeExpandedMaxHeight`）与 Task 2（consumer：`core-controller` 透传、typedef）命名一致；分组 id `p::g0`（Task 1 合成图）/`heap-1::g0`（Task 2 demo 图）与现有约定一致；数值（columns 4@1200、2@800；contentHeight 642/142；maxH 319.2@760、252@600、588@1400；默认 560）经手工核算一致。
