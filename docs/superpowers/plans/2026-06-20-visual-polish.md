# Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the minimap demo and default component visuals match the approved dark workstation direction, including resource tree mock data, toolbar shell, dotted canvas, card-like nodes/groups, and framed overview.

**Architecture:** Keep the visual work in the existing component boundaries: `App.vue` owns demo mock data, `ResourceTree.vue` owns the resource panel UI, `Minimap.vue` owns shell overlays, and `theme.js`/`renderer.js` own canvas defaults. No Phase 5 editing behavior is introduced; toolbar buttons are presentational and do not mutate graph state.

**Tech Stack:** Vue 2.7 SFCs, Canvas 2D, existing `node:test` + Vue Test Utils + mock canvas helpers, Vite build.

---

## File Map

- Modify: `src/App.vue`
  - Replace the demo `resources` mock with the reference resource tree categories and counts.
- Modify: `src/minimap/ResourceTree.vue`
  - Render title row, drag hint, expanded/collapsed category rows, counts, and resource items while preserving drag payloads.
- Modify: `src/minimap/Minimap.vue`
  - Add a presentational top toolbar shell, restyle search and overview wrappers, keep canvas focus and existing event listeners intact.
- Modify: `src/minimap/theme.js`
  - Refresh default color tokens and add compatible optional tokens for dotted grid, radius, shadows, accent, and panel surfaces.
- Modify: `src/minimap/renderer.js`
  - Draw dotted grid, rounded card nodes, rounded group containers, status dots, child counts, and card-like group children.
- Modify: `test/minimap-resource-tree.test.js`
  - Cover reference mock data rendering and unchanged drag payload.
- Modify: `test/minimap-shell.test.js`
  - Cover toolbar/search/overview shell rendering and options behavior.
- Modify: `test/minimap-renderer.test.js`
  - Cover dotted grid and rounded/card drawing behavior.
- Modify: `test/helpers/mock-ctx.js` if needed
  - Ensure the canvas mock records `roundRect`, `save`, `restore`, and shadow property assignments if renderer assertions need them.
- Modify: `ROADMAP.md`
  - Mark visual polish slice complete after implementation verification.

---

### Task 1: Resource Tree Mock Data And Panel UI

**Files:**
- Modify: `src/App.vue`
- Modify: `src/minimap/ResourceTree.vue`
- Modify: `test/minimap-resource-tree.test.js`

- [ ] **Step 1: Update the failing resource tree tests**

Replace the `resources` fixture in `test/minimap-resource-tree.test.js` with the reference data shape:

```js
const resources = [
  {
    category: '储能设备',
    expanded: true,
    items: [
      { id: 'site', label: '站点' },
      { id: 'subsystem', label: '子系统' },
      { id: 'bms-stack', label: 'BMS 堆' },
      { id: 'bms-cluster', label: 'BMS 簇' },
      { id: 'pcs-device', label: 'PCS 设备' },
      { id: 'metering', label: '电能计量' },
    ],
  },
  { category: '光伏设备', expanded: false, count: 5, items: [] },
  { category: '配电设备', expanded: false, count: 4, items: [] },
  { category: '监控设备', expanded: false, count: 4, items: [] },
]
```

Replace the first test with:

```js
test('renders the reference resource tree categories, counts, and draggable items', () => {
  const wrapper = mount(ResourceTree, { propsData: { resources } })

  assert.equal(wrapper.find('.resource-tree-title').text(), '资源树')
  assert.equal(wrapper.find('.resource-tree-hint').text(), '拖至画布')

  const categoryLabels = wrapper.findAll('.resource-category-label').wrappers.map((w) => w.text())
  assert.deepEqual(categoryLabels, ['储能设备', '光伏设备', '配电设备', '监控设备'])

  const counts = wrapper.findAll('.resource-category-count').wrappers.map((w) => w.text())
  assert.deepEqual(counts, ['6', '5', '4', '4'])

  const itemLabels = wrapper.findAll('.resource-item-label').wrappers.map((w) => w.text())
  assert.deepEqual(itemLabels, ['站点', '子系统', 'BMS 堆', 'BMS 簇', 'PCS 设备', '电能计量'])

  const item = wrapper.find('[data-resource-id="bms-cluster"]')
  assert.equal(item.attributes('draggable'), 'true')
  wrapper.destroy()
})
```

Update the drag test to use `site`:

```js
test('dragstart serializes the resource payload into dataTransfer', () => {
  const wrapper = mount(ResourceTree, { propsData: { resources } })
  const fakeDataTransfer = {
    data: {},
    setData(type, value) { this.data[type] = value },
    effectAllowed: null,
  }
  const itemEl = wrapper.find('[data-resource-id="site"]').element
  const evt = new Event('dragstart', { bubbles: true })
  Object.defineProperty(evt, 'dataTransfer', { value: fakeDataTransfer })
  itemEl.dispatchEvent(evt)

  const payload = JSON.parse(fakeDataTransfer.data['application/json'])
  assert.deepEqual(payload, { id: 'site', label: '站点' })
  assert.equal(fakeDataTransfer.effectAllowed, 'copy')
  wrapper.destroy()
})
```

- [ ] **Step 2: Run the resource tree test and verify it fails**

Run:

```bash
npm test -- test/minimap-resource-tree.test.js
```

Expected: FAIL because `.resource-tree-title`, `.resource-tree-hint`, `.resource-category-count`, and `.resource-item-label` do not exist yet.

- [ ] **Step 3: Implement `ResourceTree.vue` markup and styles**

Change `src/minimap/ResourceTree.vue` template to:

```vue
<template>
  <aside class="resource-tree">
    <div class="resource-tree-header">
      <h2 class="resource-tree-title">资源树</h2>
      <button class="resource-tree-hint" type="button" disabled>拖至画布</button>
    </div>
    <div class="resource-search" aria-hidden="true">
      <span class="resource-search-icon">⌕</span>
      <span class="resource-search-placeholder">搜索节点...</span>
    </div>
    <div v-for="category in resources" :key="category.category" class="resource-category">
      <div class="resource-category-row" :class="{ 'is-collapsed': category.expanded === false }">
        <span class="resource-category-caret">{{ category.expanded === false ? '›' : '⌄' }}</span>
        <span class="resource-category-label">{{ category.category }}</span>
        <span class="resource-category-count">{{ category.count ?? category.items.length }}</span>
      </div>
      <div v-if="category.expanded !== false" class="resource-items">
        <div
          v-for="item in category.items"
          :key="item.id"
          class="resource-item"
          draggable="true"
          :data-resource-id="item.id"
          @dragstart="onDragStart(item, $event)"
        >
          <span class="resource-item-dot" aria-hidden="true"></span>
          <span class="resource-item-label">{{ item.label }}</span>
          <span class="resource-item-handle" aria-hidden="true">⌘</span>
        </div>
      </div>
    </div>
  </aside>
</template>
```

Replace the scoped styles with dense dark panel styling:

```css
.resource-tree {
  height: 100%;
  padding: 14px 10px;
  color: #cfd6df;
  background: #101418;
  border: 1px solid #252a32;
  border-radius: 10px;
  font-size: 13px;
}
.resource-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  padding: 0 6px;
}
.resource-tree-title {
  margin: 0;
  color: #e7ebf0;
  font-size: 14px;
  font-weight: 700;
}
.resource-tree-hint {
  height: 28px;
  padding: 0 10px;
  color: #69717c;
  background: #171c22;
  border: 1px solid #2a3038;
  border-radius: 5px;
  font: inherit;
}
.resource-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  margin: 0 4px 16px;
  padding: 0 12px;
  color: #57616d;
  background: #12171d;
  border: 1px solid #252b34;
  border-radius: 6px;
}
.resource-category-row {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 8px;
  color: #87909c;
  font-weight: 700;
}
.resource-category-count {
  min-width: 22px;
  height: 20px;
  border: 1px solid #2a3038;
  border-radius: 5px;
  text-align: center;
  line-height: 18px;
}
.resource-item {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px 0 22px;
  border-radius: 5px;
  color: #cdd4de;
  cursor: grab;
}
.resource-item:hover,
.resource-item:focus {
  background: #1f2328;
}
.resource-item-dot {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: #2bdd7f;
  box-shadow: 0 0 12px rgba(43, 221, 127, 0.45);
}
.resource-item-handle {
  color: #535b65;
  font-size: 11px;
}
```

- [ ] **Step 4: Update `src/App.vue` demo mock data**

Replace the current English demo `resources` with the same reference data from Step 1.

- [ ] **Step 5: Run the resource tree test and verify it passes**

Run:

```bash
npm test -- test/minimap-resource-tree.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add src/App.vue src/minimap/ResourceTree.vue test/minimap-resource-tree.test.js
git commit -m "style: polish resource tree"
```

---

### Task 2: Minimap Workbench Shell And Toolbar

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/minimap-shell.test.js`
- Modify: `test/minimap-overview-ui.test.js` only if overview wrapper assertions require class changes

- [ ] **Step 1: Add failing shell tests**

Append this test to `test/minimap-shell.test.js`:

```js
test('renders the dark workbench toolbar shell without removing canvas, search, or overview', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })

  assert.equal(wrapper.find('.minimap-toolbar').exists(), true)
  assert.equal(wrapper.findAll('.minimap-toolbar-button').length >= 9, true)
  assert.equal(wrapper.find('.minimap-toolbar-button[aria-label="撤销"]').attributes('disabled'), 'disabled')
  assert.equal(wrapper.find('canvas').attributes('tabindex'), '0')
  assert.equal(wrapper.find('.minimap-search').exists(), true)
  assert.equal(wrapper.find('.minimap-overview-panel').exists(), true)

  wrapper.destroy()
})
```

Append this options test:

```js
test('search and overview options still hide their panels in the polished shell', () => {
  const wrapper = mount(Minimap, {
    propsData: {
      graph: createDemoGraph(),
      options: { enableSearch: false, enableOverview: false },
    },
  })

  assert.equal(wrapper.find('.minimap-search').exists(), false)
  assert.equal(wrapper.find('.minimap-overview-panel').exists(), false)
  assert.equal(wrapper.find('.minimap-toolbar').exists(), true)

  wrapper.destroy()
})
```

- [ ] **Step 2: Run the shell test and verify it fails**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: FAIL because `.minimap-toolbar` and `.minimap-overview-panel` do not exist yet.

- [ ] **Step 3: Update `Minimap.vue` template**

Inside `.minimap-canvas-container`, insert the toolbar before `<canvas>` and wrap overview:

```vue
<div class="minimap-toolbar" aria-label="画布工具栏">
  <button class="minimap-toolbar-button is-primary" type="button" aria-label="返回">◀</button>
  <span class="minimap-toolbar-separator"></span>
  <button class="minimap-toolbar-button" type="button" aria-label="撤销" disabled>↶</button>
  <button class="minimap-toolbar-button" type="button" aria-label="重做" disabled>↷</button>
  <span class="minimap-toolbar-separator"></span>
  <button class="minimap-toolbar-button" type="button" aria-label="选择">□</button>
  <button class="minimap-toolbar-button" type="button" aria-label="剪切" disabled>⌘</button>
  <button class="minimap-toolbar-button" type="button" aria-label="框选">▣</button>
  <span class="minimap-toolbar-separator"></span>
  <button class="minimap-toolbar-button" type="button" aria-label="定位">◎</button>
  <button class="minimap-toolbar-button" type="button" aria-label="缩小">⊖</button>
  <button class="minimap-toolbar-button" type="button" aria-label="放大">⊕</button>
  <span class="minimap-toolbar-spacer"></span>
  <button class="minimap-toolbar-button" type="button" aria-label="展开">↗</button>
  <button class="minimap-toolbar-button is-accent" type="button" aria-label="列表">▦</button>
  <button class="minimap-toolbar-button" type="button" aria-label="信息">ⓘ</button>
</div>
```

Change overview usage to:

```vue
<div v-if="options?.enableOverview !== false" class="minimap-overview-panel">
  <div class="minimap-overview-header">
    <span>MINIMAP</span>
    <span>拖入放置</span>
  </div>
  <Overview
    ref="overviewRef"
    class="minimap-overview"
    @navigate="handleOverviewNavigate"
  />
</div>
```

Keep the canvas as:

```vue
<canvas ref="canvasRef" tabindex="0"></canvas>
```

- [ ] **Step 4: Update `Minimap.vue` shell styles**

Replace the existing scoped styles with a dark workbench layout that preserves class names used by existing tests:

```css
.minimap {
  display: flex;
  width: 100%;
  height: 100%;
  gap: 10px;
  padding: 8px;
  background: #0b0f14;
}
.minimap-resources {
  flex: 0 0 220px;
  overflow-y: auto;
}
.minimap-canvas-container {
  flex: 1 1 auto;
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid #252b34;
  border-radius: 10px;
  background: #0f1318;
}
.minimap-canvas-container canvas {
  display: block;
}
.minimap-toolbar {
  position: absolute;
  z-index: 3;
  top: 8px;
  left: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 12px;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: rgba(22, 26, 32, 0.96);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.32);
}
.minimap-toolbar-button {
  width: 28px;
  height: 28px;
  color: #9aa3af;
  background: transparent;
  border: 0;
  border-radius: 5px;
  font: 16px/1 system-ui, sans-serif;
}
.minimap-toolbar-button:hover:not(:disabled) {
  color: #d8dee8;
  background: #232930;
}
.minimap-toolbar-button:disabled {
  opacity: 0.45;
}
.minimap-toolbar-button.is-accent {
  color: #2bdd7f;
}
.minimap-toolbar-separator {
  width: 1px;
  height: 24px;
  background: #2a3038;
}
.minimap-toolbar-spacer {
  flex: 1;
}
.minimap-search {
  position: absolute;
  z-index: 4;
  top: 68px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(18, 23, 29, 0.94);
  border: 1px solid #2a3038;
  border-radius: 7px;
}
.minimap-search-input {
  width: 150px;
  color: #d9e0ea;
  background: #0f141a;
  border: 1px solid #303741;
  border-radius: 5px;
  padding: 5px 7px;
  font-size: 12px;
}
.minimap-search-count {
  min-width: 36px;
  color: #87909c;
  font-size: 12px;
  text-align: center;
}
.minimap-search-btn {
  width: 22px;
  height: 22px;
  color: #cfd6df;
  background: #20262d;
  border: 1px solid #303741;
  border-radius: 4px;
}
.minimap-search-btn:disabled {
  opacity: 0.4;
}
.minimap-overview-panel {
  position: absolute;
  z-index: 4;
  right: 14px;
  bottom: 14px;
  padding: 8px;
  border: 1px solid #303741;
  border-radius: 9px;
  background: rgba(18, 23, 29, 0.92);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.38);
}
.minimap-overview-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  color: #68727f;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
}
.minimap-overview {
  display: block;
  overflow: hidden;
  border-radius: 5px;
}
.minimap-overview canvas {
  display: block;
  cursor: pointer;
}
```

- [ ] **Step 5: Run shell tests and verify they pass**

Run:

```bash
npm test -- test/minimap-shell.test.js test/minimap-overview-ui.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/minimap/Minimap.vue test/minimap-shell.test.js test/minimap-overview-ui.test.js
git commit -m "style: add minimap workbench shell"
```

---

### Task 3: Theme And Canvas Renderer Polish

**Files:**
- Modify: `src/minimap/theme.js`
- Modify: `src/minimap/renderer.js`
- Modify: `test/minimap-renderer.test.js`
- Modify: `test/helpers/mock-ctx.js` if the mock does not record a canvas method/property used by the renderer

- [ ] **Step 1: Add failing renderer tests**

Append to `test/minimap-renderer.test.js`:

```js
test('default renderer uses dotted grid and rounded card primitives', () => {
  const ctx = createMockCtx()
  const scene = demoScene()

  renderScene(ctx, scene)

  assert.ok(ctx.methodsOf('arc').length > 0)
  assert.ok(ctx.methodsOf('roundRect').length > 0)
  assert.ok(ctx.calls.some((call) => call.method === 'fillText' && String(call.args[0]).includes('BMS CLUSTERS')))
})
```

If `createMockCtx()` does not yet record `arc` or `roundRect`, update `test/helpers/mock-ctx.js` first in Step 3.

- [ ] **Step 2: Run renderer test and verify it fails**

Run:

```bash
npm test -- test/minimap-renderer.test.js
```

Expected: FAIL because the current renderer uses line grid and square `fillRect`/`strokeRect` primitives for nodes/groups.

- [ ] **Step 3: Ensure mock ctx records required canvas APIs**

Open `test/helpers/mock-ctx.js`. If `roundRect`, `arc`, `quadraticCurveTo`, `save`, `restore`, `clip`, or property assignments are missing, add them using the existing helper pattern. The minimum method list must include:

```js
const METHODS = [
  'arc',
  'beginPath',
  'clearRect',
  'clip',
  'closePath',
  'fill',
  'fillRect',
  'fillText',
  'lineTo',
  'moveTo',
  'quadraticCurveTo',
  'rect',
  'restore',
  'roundRect',
  'save',
  'setLineDash',
  'setTransform',
  'stroke',
  'strokeRect',
]
```

Run:

```bash
npm test -- test/minimap-renderer.test.js
```

Expected after only mock changes: still FAIL on visual assertions, not on missing methods.

- [ ] **Step 4: Refresh `defaultTheme`**

Update `src/minimap/theme.js` so the exported shape remains compatible and adds optional tokens:

```js
export const defaultTheme = {
  background: '#0f1318',
  grid: { color: '#252c35', size: 24, dot: true, dotRadius: 1.1 },
  accent: '#2bdd7f',
  panel: {
    fill: '#151a20',
    stroke: '#303741',
    shadow: 'rgba(0, 0, 0, 0.32)',
  },
  node: {
    fill: '#252a31',
    stroke: '#3b424c',
    selectedStroke: '#3d9cff',
    text: '#d7dde6',
    font: '13px sans-serif',
    radius: 6,
  },
  group: {
    fill: 'rgba(21, 26, 32, 0.92)',
    stroke: '#303741',
    header: '#8f98a5',
    font: '13px sans-serif',
    radius: 12,
    scrollbar: { track: '#171d24', thumb: '#313945', thumbHover: '#687482' },
    dropSlot: { fill: '#233044', stroke: '#3d9cff' },
  },
  edge: { color: '#3a4350', width: 1, arrowSize: 6 },
}
```

- [ ] **Step 5: Update renderer helpers and drawing**

In `src/minimap/renderer.js`:

1. Change `drawGrid` to use dotted grid when `theme.grid.dot !== false`:

```js
function drawGrid(ctx, width, height, viewport, theme) {
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, width, height)
  const size = theme.grid.size * viewport.scale
  if (size < 4) return
  ctx.fillStyle = theme.grid.color
  const radius = Math.max(0.6, (theme.grid.dotRadius ?? 1) * viewport.scale)
  for (let x = viewport.x % size; x <= width; x += size) {
    for (let y = viewport.y % size; y <= height; y += size) {
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
```

2. Add rounded card helper:

```js
function roundedRect(ctx, rect, radius) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius)
    return
  }
  const r = Math.min(radius, rect.width / 2, rect.height / 2)
  ctx.moveTo(rect.x + r, rect.y)
  ctx.lineTo(rect.x + rect.width - r, rect.y)
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + r)
  ctx.lineTo(rect.x + rect.width, rect.y + rect.height - r)
  ctx.quadraticCurveTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - r, rect.y + rect.height)
  ctx.lineTo(rect.x + r, rect.y + rect.height)
  ctx.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - r)
  ctx.lineTo(rect.x, rect.y + r)
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y)
}
```

3. Update `drawNode` to use `roundedRect`, `fill`, `stroke`, selected/highlighted border, and existing text.

4. Update `drawGroup` to use rounded group frame, draw a small green status dot, draw uppercase-ish title from `group.parentId` or node label when available, and draw child count at top right. Use existing `group.parentId · count` only as a fallback if the parent node is unavailable.

5. Keep custom renderers untouched: all changes are in default draw helpers only.

- [ ] **Step 6: Run renderer tests and verify they pass**

Run:

```bash
npm test -- test/minimap-renderer.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add src/minimap/theme.js src/minimap/renderer.js test/minimap-renderer.test.js test/helpers/mock-ctx.js
git commit -m "style: polish canvas renderer"
```

---

### Task 4: Full Verification And Roadmap Closeout

**Files:**
- Modify: `ROADMAP.md`

- [ ] **Step 1: Run focused visual-polish tests**

Run:

```bash
npm test -- test/minimap-resource-tree.test.js test/minimap-shell.test.js test/minimap-renderer.test.js test/minimap-overview-ui.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: build completes successfully and writes Vite output.

- [ ] **Step 4: Update `ROADMAP.md`**

In `ROADMAP.md`:

1. Under current progress, change current stage back to:

```md
- **当前阶段**：第五阶段（编辑和状态能力）—— 已拆成 5 个切片，下一步创建切片 1 spec
- **当前阶段 Spec**：待创建；第五阶段总入口先写切片 1 [编辑操作底座]，后续按切片依次创建
- **当前阶段计划**：待创建；每个切片独立 spec + plan，完成后更新本块
```

2. Mark the visual polish slice complete:

```md
- **视觉整理切片**：
  - [x] 暗色工作台视觉优化（按参考图方向 B：资源树、顶部工具栏骨架、点阵画布、卡片式节点/分组、右下 overview 外框；只做视觉和结构，不引入第五阶段编辑行为）
```

3. Update next step:

```md
- **下一步**：创建第五阶段切片 1「编辑操作底座」spec 和 plan。
```

- [ ] **Step 5: Commit closeout**

Run:

```bash
git add ROADMAP.md
git commit -m "docs: close visual polish slice"
```

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: only known unrelated untracked files remain, such as `.claude/`, unless the user asked to track them.

---

## Self-Review

- Spec coverage:
  - Resource tree mock data and visual panel: Task 1.
  - Toolbar shell, search placement, overview frame, canvas focus: Task 2.
  - Dotted grid, card-like nodes/groups, status dots, theme refresh: Task 3.
  - Tests, build, ROADMAP closeout: Task 4.
- Scope guard:
  - No task adds undo/redo, delete/copy, cross-parent drag, readonly, import/export, or before hooks.
  - Toolbar buttons are presentational and disabled where they imply future editing.
- Placeholder scan:
  - No TBD/TODO steps. Each task has concrete files, code snippets, commands, and expected outcomes.
