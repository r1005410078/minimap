# Phase 1 自定义绘制 props 接通 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `<Minimap>` 的 `nodeRenderer`/`groupRenderer`/`edgeRenderer` props 真正生效，把组件公开契约和 `renderer.js` 已经实现好的 `renderScene({ renderers })` 钩子接上。

**Architecture:** 只改 `src/minimap/Minimap.vue` 一个文件：新增三个 `Function` 类型 props，在现有 `renderCurrent()` 调 `renderScene` 的地方多传一个 `renderers` 字段。`src/minimap/renderer.js`、`src/minimap/layout.js` 不变——`renderScene` 已经完整支持并测试过 `renderers.node/group/edge` 这三个钩子的回退逻辑（未提供时用默认绘制）。

**Tech Stack:** Vue 2.7 + Vite；纯 JS ESM；Node 内置 `node --test`；现有 `@vue/test-utils` + jsdom + mock Canvas ctx 测试环境（`test/helpers/canvas-env.js`、`test/helpers/mock-ctx.js`）。

## Global Constraints

- 不引入新的第三方运行时库或开发依赖。
- 不修改 `src/minimap/renderer.js` 或 `src/minimap/layout.js` 的任何行为或测试。
- 不在本切片里加 `measureNode`、`options` 相关 props——范围只限 `nodeRenderer`/`groupRenderer`/`edgeRenderer`。
- 三个新 props 都不传时，组件行为必须和现在完全一致（不能引入回归）。
- 每个任务跑完都要跑一次该任务相关的目标测试，最后一个任务跑全量 `npm test` 和 `npm run build`。

---

## Source Spec

- Spec: `docs/superpowers/specs/2026-06-19-phase-1-custom-renderer-props.md`
- 底层渲染钩子契约（已实现，不改）：`docs/superpowers/specs/2026-06-18-phase-1-canvas-renderer.md`，实现见 `src/minimap/renderer.js` 的 `renderScene(ctx, { renderers })`。
- 组件壳现有结构：`docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md`，实现见 `src/minimap/Minimap.vue`。

## File Structure

- Modify `src/minimap/Minimap.vue`：新增 `nodeRenderer`/`groupRenderer`/`edgeRenderer` props，`renderCurrent()` 里把它们打包成 `renderers` 传给 `renderScene`。
- Modify `test/minimap-shell.test.js`：新增三个组件级测试，分别验证三个自定义绘制 prop 生效且对应默认绘制被跳过。
- Modify `ROADMAP.md`：把"当前进度"块里"缺口 1（待实现）"换成新的"已完成切片"条目，去掉"待办切片"里对应内容。
- Modify `docs/superpowers/plans/2026-06-19-phase-1-custom-renderer-props.md`（本文件）：勾掉「进度」一节并补 commit hash。

## Progress

- [ ] Task 1: Minimap.vue 接通三个自定义绘制 props + 组件测试
- [ ] Task 2: 文档进度同步 + 全量验证 + commit

---

### Task 1: Minimap.vue 接通三个自定义绘制 props + 组件测试

**Files:**
- Modify: `src/minimap/Minimap.vue:20-26`（props 声明）
- Modify: `src/minimap/Minimap.vue:53-67`（`renderCurrent()`）
- Modify: `test/minimap-shell.test.js`

**Interfaces:**
- Consumes：`src/minimap/renderer.js` 已有的 `renderScene(ctx, { ..., renderers: { node, group, edge } })`——`renderers.node(ctx, { node, rect, state, theme, viewport })`、`renderers.group(ctx, { group, rect, state, theme, viewport })`、`renderers.edge(ctx, { edge, from, to, theme, viewport })`。这三个签名已经在 `renderer.js` 里固定，本任务不改。
- Produces：`Minimap.vue` 新增的公开 props `nodeRenderer`、`groupRenderer`、`edgeRenderer`（类型 `Function`，默认 `null`），后续切片（`measureNode`/`options`）如果要参考"怎么往 `Minimap.vue` 加一个透传到 `renderScene` 的 prop"可以照这个模式。

- [ ] **Step 1: 写失败的组件测试**

打开 `test/minimap-shell.test.js`，在文件顶部 import 区域补一个 import（其余 import 不变）：

```js
import { computeLayout, keepAnchorStable } from '../src/minimap/layout.js'
import { resolveEdges } from '../src/minimap/renderer.js'
```

把原来这一行：

```js
import { computeLayout, keepAnchorStable } from '../src/minimap/layout.js'
```

换成上面两行（即在它后面新增 `resolveEdges` 的 import）。

然后在文件末尾、`test('unmounting disconnects the ResizeObserver', ...)` 这个测试之后，新增三个测试：

```js
test('nodeRenderer prop replaces default node drawing', () => {
  let calls = 0
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), nodeRenderer: () => { calls++ } },
  })
  const ctx = contexts.at(-1)
  assert.ok(calls > 0)
  assert.equal(
    ctx.calls.some((call) => call.method === 'fillText' && call.args[0] === 'Energy Root'),
    false,
  )
  wrapper.destroy()
})

test('groupRenderer prop replaces default group drawing', () => {
  let calls = 0
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), groupRenderer: () => { calls++ } },
  })
  const ctx = contexts.at(-1)
  assert.ok(calls > 0)
  assert.equal(
    ctx.calls.some(
      (call) => call.method === 'fillText' && typeof call.args[0] === 'string' && call.args[0].startsWith('heap-1'),
    ),
    false,
  )
  wrapper.destroy()
})

test('edgeRenderer prop replaces default edge drawing', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const expectedEdgeCount = resolveEdges(graph, layout).length
  const payloads = []
  const wrapper = mount(Minimap, {
    propsData: { graph, edgeRenderer: (_ctx, payload) => payloads.push(payload) },
  })
  assert.equal(payloads.length, expectedEdgeCount)
  wrapper.destroy()
})

test('renderer props default to null and do not affect default drawing', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'fillText' && call.args[0] === 'Energy Root'))
  wrapper.destroy()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: 新增的 `nodeRenderer prop replaces default node drawing`、`groupRenderer prop replaces default group drawing`、`edgeRenderer prop replaces default edge drawing` 三个测试 FAIL（`calls`/`payloads` 始终是 0，或者默认 `fillText('Energy Root')` 仍然被调用），因为 `Minimap.vue` 还没声明这些 props 也没转发。`renderer props default to null...` 这个测试应该已经 PASS（现状本来就是默认绘制）。

- [ ] **Step 3: 在 Minimap.vue 里加 props**

打开 `src/minimap/Minimap.vue`，把：

```js
const props = defineProps({
  graph: { type: Object, required: true },
  resources: { type: Array, default: () => [] },
  layoutDirection: { type: String, default: 'horizontal' },
  selectedIds: { type: Array, default: null },
  theme: { type: Object, default: null },
})
```

换成：

```js
const props = defineProps({
  graph: { type: Object, required: true },
  resources: { type: Array, default: () => [] },
  layoutDirection: { type: String, default: 'horizontal' },
  selectedIds: { type: Array, default: null },
  theme: { type: Object, default: null },
  nodeRenderer: { type: Function, default: null },
  groupRenderer: { type: Function, default: null },
  edgeRenderer: { type: Function, default: null },
})
```

- [ ] **Step 4: 在 renderCurrent() 里把 props 转发给 renderScene**

把：

```js
function renderCurrent(currentLayout = layout, currentViewport = viewport) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...currentViewport }
  renderScene(ctx, {
    layout: currentLayout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport: currentViewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: { selectedIds: new Set(currentSelectedIds()) },
  })
}
```

换成：

```js
function renderCurrent(currentLayout = layout, currentViewport = viewport) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...currentViewport }
  renderScene(ctx, {
    layout: currentLayout,
    graph: props.graph,
    layoutDirection: props.layoutDirection,
    viewport: currentViewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: { selectedIds: new Set(currentSelectedIds()) },
    renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
  })
}
```

- [ ] **Step 5: 跑测试确认通过**

Run:

```bash
npm test -- test/minimap-shell.test.js
```

Expected: PASS。本文件全部测试（包括新增的 4 个）都通过。

- [ ] **Step 6: 跑全量测试确认没有破坏其它文件**

Run:

```bash
npm test
```

Expected: 全部测试 PASS（在本任务之前是 81 个，本任务新增 4 个，期望 85 个全过）。

- [ ] **Step 7: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-shell.test.js
git commit -m "$(cat <<'EOF'
feat: wire nodeRenderer/groupRenderer/edgeRenderer props through Minimap.vue

renderScene() already implemented and tested these custom drawing hooks;
Minimap.vue never declared the props or forwarded them, so passing
nodeRenderer etc. to <Minimap> silently had no effect.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 文档进度同步 + 全量验证 + commit

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/superpowers/plans/2026-06-19-phase-1-custom-renderer-props.md`（本文件）

**Interfaces:**
- Consumes：Task 1 的全部产出（已接通的三个 props + 测试）。
- Produces：无新代码；只更新进度文档，供下一次"第一阶段验收回归"复核时确认缺口 1 已关闭。

- [ ] **Step 1: 浏览器复核——确认自定义绘制真的在真实页面里生效**

组件测试已经证明钩子被调用、默认绘制被跳过，但这是上次验收回归实测发现问题的地方，值得用同样的手段在真实浏览器里复核一次，而不是只信单测。

创建一个临时挂载文件 `src/__verify_custom_renderer.js`（验证完在 Step 1 末尾删除，不提交）：

```js
import Vue from 'vue'
import Minimap from './minimap/Minimap.vue'
import { createDemoGraph } from './minimap/graph.js'

const ComponentClass = Vue.extend(Minimap)
const instance = new ComponentClass({
  propsData: {
    graph: createDemoGraph(),
    nodeRenderer(ctx, { rect }) {
      ctx.fillStyle = '#ff00ff'
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    },
  },
})
instance.$mount('#app')
```

创建一个临时 HTML `__verify_custom_renderer.html` 在项目根目录：

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>verify custom renderer</title>
    <style>
      html, body { margin: 0; width: 900px; height: 600px; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/__verify_custom_renderer.js"></script>
  </body>
</html>
```

Run（在两个终端里，或者后台启动第一个）：

```bash
npm run dev
```

记下打印出来的本机地址（例如 `http://localhost:5173`），用浏览器打开 `<地址>/__verify_custom_renderer.html`。

Expected: 画面上的节点矩形是洋红色（`#ff00ff`），不是默认的深色矩形；如果看到默认深色节点，说明 prop 没接通，回去检查 Task 1。

确认完成后：

```bash
rm src/__verify_custom_renderer.js __verify_custom_renderer.html
```

停掉 `npm run dev`（`Ctrl+C`），并用 `git status --short` 确认这两个临时文件已经不存在、没有被加进 git。

- [ ] **Step 2: 找到 Task 1 的实现 commit hash**

Run:

```bash
git log -1 --format=%h
```

Expected: 输出一个短 hash（即 Task 1 Step 7 刚提交的那个 commit）。记下这个 hash，下面步骤里替换占位符 `<commit-hash>` 时要用它。

- [ ] **Step 3: 更新 ROADMAP.md 的"当前进度"块**

打开 `ROADMAP.md`，把"当前进度"一节里的这一行：

```markdown
- **当前阶段**：第一阶段（核心可用能力）—— 进行中（验收回归发现 2 个缺口，缺口 2 已改验收文字解决，缺口 1 待实现）
```

换成：

```markdown
- **当前阶段**：第一阶段（核心可用能力）—— 进行中（验收回归发现的 2 个缺口已全部处理，待重新跑一次验收回归确认全绿）
```

把"已完成切片"列表：

```markdown
- **已完成切片**：
  - 逻辑层 `graph` / `layout` / `coords` + 测试（commit `893b6b7`）
  - Canvas 渲染器 `renderer` / `theme` + 测试（commit `1caccd8`，`npm test` 22 全过）
  - Vue 组件壳 `Minimap.vue` / `ResourceTree.vue` / `interaction.js` + 资源树拖入 + 测试（commit `0c50895`..`e4c451b`，`npm test` 49 全过，浏览器手动验收通过）
  - 正交连线 `orthogonalPath` / `resolveEdges` endpoint boxes / 折线 + 箭头绘制 + 测试（commit `7902000`..`0d4b711`，`npm test` 与 `npm run build` 通过）
  - 布局切换动画 + 视口锚点稳定 `layout-transition` / `Minimap.vue` raf 动画 + 测试（commit `8ab447a..5ee9672`，`npm test` 与 `npm run build` 通过）
```

换成（在末尾加一条，把 `<commit-hash>` 换成 Step 1 记下的真实 hash）：

```markdown
- **已完成切片**：
  - 逻辑层 `graph` / `layout` / `coords` + 测试（commit `893b6b7`）
  - Canvas 渲染器 `renderer` / `theme` + 测试（commit `1caccd8`，`npm test` 22 全过）
  - Vue 组件壳 `Minimap.vue` / `ResourceTree.vue` / `interaction.js` + 资源树拖入 + 测试（commit `0c50895`..`e4c451b`，`npm test` 49 全过，浏览器手动验收通过）
  - 正交连线 `orthogonalPath` / `resolveEdges` endpoint boxes / 折线 + 箭头绘制 + 测试（commit `7902000`..`0d4b711`，`npm test` 与 `npm run build` 通过）
  - 布局切换动画 + 视口锚点稳定 `layout-transition` / `Minimap.vue` raf 动画 + 测试（commit `8ab447a..5ee9672`，`npm test` 与 `npm run build` 通过）
  - 自定义绘制 props 接通 `nodeRenderer`/`groupRenderer`/`edgeRenderer` + 测试（commit `<commit-hash>`，`npm test` 与 `npm run build` 通过）
```

把"下一步"和"待办切片"：

```markdown
- **下一步**：按 brainstorm → spec → plan → implement 落地缺口 1（自定义绘制 props 接通），完成后重新跑一次验收回归，全绿后勾「第一阶段」，进入第二阶段「分组框能力」
- **待办切片**：
  - 缺口 1（组件契约缺失，待实现）：`renderer.js` 的 `renderers.node/group/edge` 自定义绘制钩子只在底层渲染函数里实现并测试，`Minimap.vue` 并未声明 `nodeRenderer`/`groupRenderer`/`edgeRenderer` props 或转发给 `renderScene`；实测对 `<Minimap>` 传入 `nodeRenderer` 完全不生效。需要补一个小切片把这三个 props 接上。
  - 缺口 2（验收点与范围矛盾，已解决）：第一阶段验收原文假设缩放/框选/overview 已存在，但这些功能按功能列表都排在第三、四阶段，`Minimap.vue` 也明确注释"Phase 1 固定视口，平移/缩放是第三阶段才做"。已把对应两条验收点的文字改成只覆盖第一阶段已有功能（拖入复用坐标转换、10000 节点挂载与交互响应），缩放/框选/overview 的验收文字挪到第三、四阶段。
```

换成：

```markdown
- **下一步**：重新跑一次第一阶段验收回归（真实浏览器驱动逐条核对「第一阶段验收」），全绿后勾「第一阶段」，进入第二阶段「分组框能力」
- **待办切片**：
  - 缺口 1（组件契约缺失，已解决）：`Minimap.vue` 已新增 `nodeRenderer`/`groupRenderer`/`edgeRenderer` props 并转发给 `renderScene`，对应组件级测试通过。
  - 缺口 2（验收点与范围矛盾，已解决）：第一阶段验收原文假设缩放/框选/overview 已存在，但这些功能按功能列表都排在第三、四阶段，`Minimap.vue` 也明确注释"Phase 1 固定视口，平移/缩放是第三阶段才做"。已把对应两条验收点的文字改成只覆盖第一阶段已有功能（拖入复用坐标转换、10000 节点挂载与交互响应），缩放/框选/overview 的验收文字挪到第三、四阶段。
```

- [ ] **Step 3: 跑全量验证**

Run:

```bash
npm test
npm run build
```

Expected: 两个命令都 exit 0；`npm test` 输出 85 个测试全过。

- [ ] **Step 4: 更新本文件的「进度」一节**

把本文件顶部「进度」一节的两个 checkbox 从 `- [ ]` 改成 `- [x]`，并在下面追加一行完成说明（把 `<task1-hash>` 换成 Task 1 Step 7 的 commit hash，`<task2-hash>` 在 commit 完成后用 `git log -1 --format=%h` 取得，再补一次小的 docs commit 或者直接在 Step 5 一次性提交时取用同一个 hash 区间写法）：

```markdown
## Progress

- [x] Task 1: Minimap.vue 接通三个自定义绘制 props + 组件测试
- [x] Task 2: 文档进度同步 + 全量验证 + commit

切片完成：commit `<task1-hash>..<task2-hash>`，`npm test` 全过、`npm run build` 通过。
```

- [ ] **Step 5: Commit**

```bash
git add ROADMAP.md docs/superpowers/plans/2026-06-19-phase-1-custom-renderer-props.md
git commit -m "$(cat <<'EOF'
docs: close custom renderer props gap in Phase 1 acceptance tracking

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: 最终状态检查**

Run:

```bash
git status --short
```

Expected: 没有被修改的已跟踪文件残留（未跟踪的本地配置如 `.claude/` 如果之前就存在可以保留）。
