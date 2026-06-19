# Phase 4 搜索节点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `Minimap.vue` 加一个内建可见的搜索框（输入即搜 + 上一个/下一个循环导航），并打好支撑它的纯函数基础（深度优先遍历 + 子串匹配）。

**Architecture:** 新建 `src/minimap/search.js` 一个纯函数 `searchNodes(graph, keyword)`，只读 `graph.nodes`/`children`，跟分组是否折叠无关。`Minimap.vue` 新增三个响应式 `ref`（`searchKeyword`/`searchMatches`/`searchCurrentIndex`）——这是组件第一次引入响应式状态，因为搜索框是真实 DOM、需要 Vue 模板驱动，跟现有"画布交互状态用模块级 `let`"的约定并不冲突（那些状态从来不出现在模板里）。`search`/`searchNext`/`searchPrevious` 三个新方法直接复用切片 1 已经写好的 `centerOnNode`（含分组揭示）和 `select`（含受控判断），不重新实现定位/选中逻辑。

**Tech Stack:** 纯 JavaScript（无 DOM 依赖的遍历/匹配）+ Vue 2.7 `<script setup>`（`ref`、模板）+ Node 内置 `node:test`/`node:assert/strict` + `@vue/test-utils` v1 + 现有 `test/helpers/{dom-env,canvas-env}.js`。无新依赖。

## 进度

- [ ] Task 1：`search.js` 纯函数（`searchNodes`）
- [ ] Task 2：`Minimap.vue` 搜索状态、方法、UI、样式
- [ ] Task 3：回归校验 + ROADMAP 同步（含 Methods 契约补充）

## Global Constraints

- 不引入新的第三方运行时或开发依赖。
- 本切片只改 `src/minimap/Minimap.vue`，新建 `src/minimap/search.js`，新建测试文件 `test/minimap-search.test.js`、`test/minimap-search-ui.test.js`。不碰 `src/minimap/interaction.js`、`src/minimap/renderer.js`、`src/minimap/layout.js`、`src/minimap/viewport.js`、`src/minimap/selection.js`（那些都已在切片 1 完成，本切片只读它们已导出的函数，不修改）。
- `searchNodes(graph, keyword)`：`id`/`label` 子串包含、忽略大小写；按 `graph.rootIds` 深度优先遍历 `children` 的顺序收集匹配；`keyword` 为空或全空白返回 `[]`（不当作匹配一切）。
- 命中跳转的同时把目标节点设为选中（`select([id])`），跳转本身复用 `centerOnNode(id)`（含分组揭示）。
- `searchNext`/`searchPrevious` 越过末尾/开头时绕回（取模运算），在 `searchMatches` 为空时是 no-op。
- 搜索框输入即触发搜索（不需要显式提交）；输入框内按 `Enter` 触发 `searchNext`。
- `options.enableSearch` 默认 `true`；设为 `false` 时不渲染搜索框 DOM，但 `search`/`searchNext`/`searchPrevious` 三个方法始终可调用。
- `search`/`searchNext`/`searchPrevious` 都要加进 `defineExpose`；新增 `'search'` emit，payload 形状 `{ keyword, matches, current }`。
- 每个任务完成后必须跑 `npm test`，Task 3 额外跑 `npm run build`，确认通过才能提交。
- 字段/函数命名以 [spec](../specs/2026-06-20-phase-4-search-nodes.md) 为准。

---

## 文件落点

- 新建：`src/minimap/search.js`——`searchNodes(graph, keyword)`。
- 修改：`src/minimap/Minimap.vue`——新增 `search`/`searchKeyword`/`searchMatches`/`searchCurrentIndex` 响应式状态、`jumpToSearchResult`/`search`/`searchNext`/`searchPrevious` 函数、`defineExpose`/`defineEmits` 更新、模板新增搜索框、样式新增对应 CSS。
- 新建：`test/minimap-search.test.js`——`searchNodes` 纯函数用例。
- 新建：`test/minimap-search-ui.test.js`——搜索框 UI 交互 + `defineExpose` 三个方法的组件级用例。
- 修改：`ROADMAP.md`——Task 3 收尾时勾选切片 2，补充 Methods 契约的 `searchNext`/`searchPrevious`，更新「下一步」指向切片 3（Overview 导航）。

---

## Task 1: `search.js` 纯函数

**Files:**
- Create: `src/minimap/search.js`
- Test: `test/minimap-search.test.js`

**Interfaces:**
- Consumes: 无新依赖（只读 `graph.nodes: Map`、`graph.rootIds: string[]`，节点形状 `{ id, label, children }`，跟 `graph.js`/`layout.js` 已有用法一致）。
- Produces：`searchNodes(graph, keyword)` → `string[]`（匹配 id 数组，按深度优先遍历顺序）。Task 2 会原样导入这个函数名，不要改名。

- [ ] **Step 1: 写失败测试**

新建 `test/minimap-search.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph.js'
import { searchNodes } from '../src/minimap/search.js'

test('searchNodes matches id and label case-insensitively', () => {
  const graph = createDemoGraph()
  assert.deepEqual(searchNodes(graph, 'feeder'), ['feeder-1', 'feeder-2', 'feeder-3'])
  assert.deepEqual(searchNodes(graph, 'FEEDER'), ['feeder-1', 'feeder-2', 'feeder-3'])
})

test('searchNodes matches a grouped child by exact substring', () => {
  const graph = createDemoGraph()
  assert.deepEqual(searchNodes(graph, 'cluster-24'), ['cluster-24'])
})

test('searchNodes returns matches in depth-first document order', () => {
  const graph = createDemoGraph()
  const matches = searchNodes(graph, 'cluster')
  assert.equal(matches.length, 25)
  assert.deepEqual(matches.slice(0, 3), ['cluster-1', 'cluster-2', 'cluster-3'])
  assert.equal(matches.at(-1), 'cluster-25')
})

test('searchNodes returns empty array for empty or whitespace-only keyword', () => {
  const graph = createDemoGraph()
  assert.deepEqual(searchNodes(graph, ''), [])
  assert.deepEqual(searchNodes(graph, '   '), [])
})

test('searchNodes returns empty array when nothing matches', () => {
  const graph = createDemoGraph()
  assert.deepEqual(searchNodes(graph, 'zzz-nope'), [])
})
```

`createDemoGraph()`（`src/minimap/graph.js`）里 `energy-root` 的子节点顺序是 `['grid-tie', 'heap-1', 'cluster-25']`；`heap-1` 挂 `cluster-1`..`cluster-24`（24 个叶子）；`cluster-25` 自身也是一个节点（`label: 'Cluster 25'`），又挂了 `leaf-1`..`leaf-10`。所以关键词 `'cluster'` 会先深度优先走完 `heap-1` 子树（`cluster-1`..`cluster-24` 全部命中），再轮到 `cluster-25` 这个节点自己（id 包含 "cluster"，也命中），最后才是它的 `leaf-*` 子节点（不含 "cluster"，不命中）——所以总共 25 个匹配，最后一个是 `cluster-25`，这是上面断言的依据。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-search.test.js`
Expected: FAIL（`searchNodes` 不是函数 / 模块不存在）

- [ ] **Step 3: 实现**

新建 `src/minimap/search.js`：

```js
// Phase 4 切片 2：搜索节点。纯函数，不依赖 Vue/DOM。
// 见 docs/superpowers/specs/2026-06-20-phase-4-search-nodes.md

// 从 graph.rootIds 深度优先遍历 graph.nodes（按 children 顺序），
// 对 node.id / node.label 做忽略大小写的子串匹配；命中即按遍历顺序收集。
// keyword 为空或全空白时返回 []（不当作"匹配一切"）。
export function searchNodes(graph, keyword) {
  const trimmed = keyword.trim().toLowerCase()
  if (!trimmed) return []
  const matches = []
  const visit = (id) => {
    const node = graph.nodes.get(id)
    if (!node) return
    if (node.id.toLowerCase().includes(trimmed) || node.label.toLowerCase().includes(trimmed)) {
      matches.push(node.id)
    }
    for (const childId of node.children || []) visit(childId)
  }
  for (const rootId of graph.rootIds || []) visit(rootId)
  return matches
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-search.test.js`
Expected: PASS（5 个测试全过）

- [ ] **Step 5: 提交**

```bash
git add src/minimap/search.js test/minimap-search.test.js
git commit -m "$(cat <<'EOF'
feat: add searchNodes pure function

Depth-first traversal of graph.nodes from rootIds, case-insensitive
substring match against id/label. Matches grouped children too since
it only reads graph data, never layout's folding state. Empty/blank
keyword returns [] explicitly (JS string.includes('') is always true,
so this needed an explicit guard rather than matching everything).
EOF
)"
```

---

## Task 2: `Minimap.vue` 搜索状态、方法、UI、样式

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Test (new): `test/minimap-search-ui.test.js`

**Interfaces:**
- Consumes: Task 1 的 `searchNodes(graph, keyword)`；已有的 `centerOnNode(id)`、`select(ids, mode)`、`getViewport()`（均在 `Minimap.vue` 内部定义，切片 1 已完成）。
- Produces：`defineExpose` 新增 `search(keyword)`、`searchNext()`、`searchPrevious()`；`defineEmits` 新增 `'search'`。后续切片（Overview 导航）不依赖这三个方法，本任务是这条线的终点。

- [ ] **Step 1: 写失败测试**

新建 `test/minimap-search-ui.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubAnimationFrame, stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, childRectInGroup, scrollTopToReveal } from '../src/minimap/layout.js'
import { centerViewportOn } from '../src/minimap/viewport.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

function settle() {
  frames.runNext(0)
  frames.runNext(200)
}

function referenceLayout() {
  return computeLayout(createDemoGraph(), { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
}

test('search jumps to and selects the first match', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  const result = wrapper.vm.search('feeder')
  settle()

  assert.deepEqual(result, { keyword: 'feeder', matches: ['feeder-1', 'feeder-2', 'feeder-3'], current: 'feeder-1' })
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])
  const rect = referenceLayout().nodes.get('feeder-1')
  const target = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  wrapper.destroy()
})

test('search reveals a grouped child scrolled out of a collapsed group', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.search('cluster-24')
  settle()

  const group = referenceLayout().groups.find((g) => g.id === 'heap-1::g0')
  const index = group.children.indexOf('cluster-24')
  const scrollTop = scrollTopToReveal(group, index)
  const rect = childRectInGroup({ ...group, scrollTop }, 'cluster-24')
  const target = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['cluster-24'])
  wrapper.destroy()
})

test('search with empty keyword does not jump or select, emits empty matches', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  const result = wrapper.vm.search('')
  settle()

  assert.deepEqual(result, { keyword: '', matches: [], current: null })
  assert.equal(wrapper.emitted('select'), undefined)
  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

test('search with no matches emits empty matches without jumping', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  const result = wrapper.vm.search('zzz-nope')
  settle()

  assert.deepEqual(result, { keyword: 'zzz-nope', matches: [], current: null })
  assert.equal(wrapper.emitted('select'), undefined)
  wrapper.destroy()
})

test('searchNext/searchPrevious cycle through matches and wrap around', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.search('feeder')
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])

  wrapper.vm.searchNext()
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-2'])

  wrapper.vm.searchNext()
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-3'])

  wrapper.vm.searchNext()
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])

  wrapper.vm.searchPrevious()
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-3'])
  wrapper.destroy()
})

test('searchNext/searchPrevious are no-ops without prior matches', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.searchNext()
  wrapper.vm.searchPrevious()
  settle()

  assert.equal(wrapper.emitted('search'), undefined)
  assert.equal(wrapper.emitted('select'), undefined)
  wrapper.destroy()
})

test('search box renders by default and reflects match count', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  await wrapper.find('.minimap-search-input').setValue('feeder')
  settle()
  await wrapper.vm.$nextTick()

  assert.equal(wrapper.find('.minimap-search-count').text(), '1/3')
  wrapper.destroy()
})

test('Enter key in the search input advances to the next match', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  await wrapper.find('.minimap-search-input').setValue('feeder')
  settle()
  await wrapper.find('.minimap-search-input').trigger('keydown.enter')
  settle()
  await wrapper.vm.$nextTick()

  assert.equal(wrapper.find('.minimap-search-count').text(), '2/3')
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-2'])
  wrapper.destroy()
})

test('next/previous buttons are disabled with no matches and enabled once there are', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  assert.equal(wrapper.find('.minimap-search-prev').attributes('disabled'), 'disabled')
  assert.equal(wrapper.find('.minimap-search-next').attributes('disabled'), 'disabled')

  await wrapper.find('.minimap-search-input').setValue('feeder')
  settle()
  await wrapper.vm.$nextTick()

  assert.equal(wrapper.find('.minimap-search-prev').attributes('disabled'), undefined)
  assert.equal(wrapper.find('.minimap-search-next').attributes('disabled'), undefined)
  wrapper.destroy()
})

test('clicking the next button advances the result and re-centers', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  await wrapper.find('.minimap-search-input').setValue('feeder')
  settle()
  await wrapper.find('.minimap-search-next').trigger('click')
  settle()

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-2'])
  wrapper.destroy()
})

test('options.enableSearch false hides the search box but methods still work', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, options: { enableSearch: false } } })

  assert.equal(wrapper.find('.minimap-search').exists(), false)
  wrapper.vm.search('feeder')
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])
  wrapper.destroy()
})

test('controlled selectedIds: search only emits select', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, selectedIds: [] } })

  wrapper.vm.search('feeder')
  settle()

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])
  wrapper.destroy()
})

test('controlled viewport: search only emits viewport-change, never mutates rendered viewport', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, viewport: { x: 0, y: 0, scale: 1 } } })

  wrapper.vm.search('feeder')
  settle()

  assert.ok(wrapper.emitted('viewport-change').length > 0)
  assert.deepEqual(wrapper.vm.getViewport(), { x: 0, y: 0, scale: 1 })
  wrapper.destroy()
})

test('controlled groupStates: search emits the scrollTop patch but targets the unrevealed position', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, {
    propsData: { graph, groupStates: { 'heap-1::g0': { scrollTop: 0 } } },
  })

  wrapper.vm.search('cluster-24')
  settle()

  const group = referenceLayout().groups.find((g) => g.id === 'heap-1::g0')
  const index = group.children.indexOf('cluster-24')
  const expectedScrollTop = scrollTopToReveal(group, index)
  assert.equal(wrapper.emitted('group-state-change').at(-1)[0]['heap-1::g0'].scrollTop, expectedScrollTop)

  // 父级没有真正回写 prop，组件内部不会持久化这次滚动；search 实际算出的
  // 目标位置仍然是 group.scrollTop 维持在 0（未揭示）时 cluster-24 所在的矩形——
  // 跟切片 1 里 centerOnNode 的受控 groupStates 测试是同一套机制，这里只是验证
  // search 走的是同一条路径，不是重新实现了一遍。
  const staleRect = childRectInGroup(group, 'cluster-24')
  const target = { x: staleRect.x + staleRect.width / 2, y: staleRect.y + staleRect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['cluster-24'])
  wrapper.destroy()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-search-ui.test.js`
Expected: FAIL（`wrapper.vm.search` 是 `undefined`，找不到 `.minimap-search-input` 等元素）

- [ ] **Step 3: 实现**

在 `src/minimap/Minimap.vue` 的 `<script setup>` 里做以下 4 处修改：

**3a. 新增 import。** 把

```js
import {
  applySelectionClick,
  applySelectionSet,
  buildSelectionRelations,
  idsInSelectionRect,
  normalizeRect,
} from './selection.js'
import ResourceTree from './ResourceTree.vue'
```

改成

```js
import {
  applySelectionClick,
  applySelectionSet,
  buildSelectionRelations,
  idsInSelectionRect,
  normalizeRect,
} from './selection.js'
import { searchNodes } from './search.js'
import ResourceTree from './ResourceTree.vue'
```

**3b. `defineEmits` 加 `'search'`，新增三个响应式 `ref`。** 把

```js
const emit = defineEmits([
  'select',
  'node-drop',
  'change',
  'group-state-change',
  'group-reorder',
  'viewport-change',
])

const containerRef = ref(null)
const canvasRef = ref(null)
```

改成

```js
const emit = defineEmits([
  'select',
  'node-drop',
  'change',
  'group-state-change',
  'group-reorder',
  'viewport-change',
  'search',
])

const containerRef = ref(null)
const canvasRef = ref(null)
const searchKeyword = ref('')
const searchMatches = ref([])
const searchCurrentIndex = ref(-1)
```

**3c. 新增搜索方法 + `defineExpose` 更新。** 把（注意这是文件里已有的 `clearSelection`/`defineExpose` 那一段，本任务只在两者之间插入新内容、并往 `defineExpose` 里加三个名字）：

```js
function clearSelection() {
  setSelected([])
}

defineExpose({
  fitToScreen,
  centerOnNode,
  centerOnSelection,
  zoomTo,
  setViewport,
  getViewport,
  select,
  clearSelection,
})
```

改成

```js
function clearSelection() {
  setSelected([])
}

function jumpToSearchResult(id) {
  centerOnNode(id)
  select([id])
}

function search(keyword) {
  searchKeyword.value = keyword
  const matches = searchNodes(props.graph, keyword)
  searchMatches.value = matches
  searchCurrentIndex.value = matches.length > 0 ? 0 : -1
  if (matches.length > 0) jumpToSearchResult(matches[0])
  const payload = { keyword, matches, current: matches[0] ?? null }
  emit('search', payload)
  return payload
}

function searchNext() {
  if (searchMatches.value.length === 0) return
  searchCurrentIndex.value = (searchCurrentIndex.value + 1) % searchMatches.value.length
  const id = searchMatches.value[searchCurrentIndex.value]
  jumpToSearchResult(id)
  emit('search', { keyword: searchKeyword.value, matches: searchMatches.value, current: id })
}

function searchPrevious() {
  if (searchMatches.value.length === 0) return
  const length = searchMatches.value.length
  searchCurrentIndex.value = (searchCurrentIndex.value - 1 + length) % length
  const id = searchMatches.value[searchCurrentIndex.value]
  jumpToSearchResult(id)
  emit('search', { keyword: searchKeyword.value, matches: searchMatches.value, current: id })
}

defineExpose({
  fitToScreen,
  centerOnNode,
  centerOnSelection,
  zoomTo,
  setViewport,
  getViewport,
  select,
  clearSelection,
  search,
  searchNext,
  searchPrevious,
})
```

**3d. 模板新增搜索框，样式新增对应 CSS。** 把

```html
    <div ref="containerRef" class="minimap-canvas-container">
      <canvas ref="canvasRef" tabindex="0"></canvas>
    </div>
  </div>
</template>
```

改成

```html
    <div ref="containerRef" class="minimap-canvas-container">
      <canvas ref="canvasRef" tabindex="0"></canvas>
      <div v-if="options?.enableSearch !== false" class="minimap-search">
        <input
          :value="searchKeyword"
          class="minimap-search-input"
          placeholder="搜索节点..."
          @input="search($event.target.value)"
          @keydown.enter="searchNext"
        />
        <span class="minimap-search-count">{{ searchMatches.length ? `${searchCurrentIndex + 1}/${searchMatches.length}` : '0/0' }}</span>
        <button
          class="minimap-search-btn minimap-search-prev"
          :disabled="searchMatches.length === 0"
          @click="searchPrevious"
        >
          ‹
        </button>
        <button
          class="minimap-search-btn minimap-search-next"
          :disabled="searchMatches.length === 0"
          @click="searchNext"
        >
          ›
        </button>
      </div>
    </div>
  </div>
</template>
```

把

```css
.minimap-canvas-container canvas {
  display: block;
}
</style>
```

改成

```css
.minimap-canvas-container canvas {
  display: block;
}
.minimap-search {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #16202b;
  border: 1px solid #1b2530;
  border-radius: 4px;
}
.minimap-search-input {
  background: #0f1620;
  border: 1px solid #2a3a4a;
  color: #d8e3ec;
  border-radius: 3px;
  padding: 4px 6px;
  font-size: 12px;
  width: 140px;
}
.minimap-search-count {
  color: #9fb6cc;
  font-size: 12px;
  min-width: 36px;
  text-align: center;
}
.minimap-search-btn {
  background: #1f2c3a;
  border: 1px solid #2a3a4a;
  color: #d8e3ec;
  border-radius: 3px;
  width: 20px;
  height: 20px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.minimap-search-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-search-ui.test.js`
Expected: PASS（14 个测试全过）

- [ ] **Step 5: 跑全量测试确认没有破坏其它文件**

Run: `npm test`
Expected: PASS（全部测试通过，基线 214 + Task 1 的 5 个 + 本任务的 14 个 = 233）

- [ ] **Step 6: 提交**

```bash
git add src/minimap/Minimap.vue test/minimap-search-ui.test.js
git commit -m "$(cat <<'EOF'
feat: add built-in search box with next/previous navigation

search()/searchNext()/searchPrevious() are exposed via defineExpose
and reuse centerOnNode (grouped-child reveal included) + select for
jump+highlight, so this slice adds no new positioning/selection logic.
The search box is the project's first reactive (ref-backed) template
UI; options.enableSearch (default true) lets a host app hide it and
drive the same three methods from its own UI instead.
EOF
)"
```

---

## Task 3: 回归校验 + ROADMAP 同步

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: 无新接口。
- Produces: 无（文档收尾）。

- [ ] **Step 1: 跑全量测试**

Run: `npm test`
Expected: PASS，全部测试通过（基线 214 + Task 1/2 新增的 19 个 = 233）。记录最终测试数到 ROADMAP。

- [ ] **Step 2: 跑构建**

Run: `npm run build`
Expected: 构建成功，无报错。

- [ ] **Step 3: 更新 `ROADMAP.md` 的 Methods 契约**

把（`### Methods` 小节里）

```
- `search(keyword)`：按 `id` 或 `label` 搜索节点。
```

改成

```
- `search(keyword)`：按 `id` 或 `label` 搜索节点，跳转并选中第一个匹配项。
- `searchNext()`：跳转到下一个匹配项（绕回）。
- `searchPrevious()`：跳转到上一个匹配项（绕回）。
```

- [ ] **Step 4: 更新 `ROADMAP.md` 的「当前进度」块**

把

```
- **当前阶段**：第四阶段（导航和查找能力）—— 切片 1 已完成，待规划切片 2
- **当前阶段 Spec**：切片 1 [视图定位方法](docs/superpowers/specs/2026-06-20-phase-4-view-positioning.md) 已完成；切片 2、3 待创建
- **当前阶段计划**：切片 1 [视图定位方法](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md) 已完成；切片 2、3 待创建
```

改成（`<N>` 替换成 Step 1 实际跑出来的测试总数）

```
- **当前阶段**：第四阶段（导航和查找能力）—— 切片 1、2 已完成，待规划切片 3
- **当前阶段 Spec**：切片 1 [视图定位方法](docs/superpowers/specs/2026-06-20-phase-4-view-positioning.md)、切片 2 [搜索节点](docs/superpowers/specs/2026-06-20-phase-4-search-nodes.md) 已完成；切片 3 待创建
- **当前阶段计划**：切片 1 [视图定位方法](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md)、切片 2 [搜索节点](docs/superpowers/plans/2026-06-20-phase-4-search-nodes.md) 已完成；切片 3 待创建
```

并在「已完成切片」列表末尾追加一行（紧跟在视图定位方法那一行后面）：

```
  - 搜索节点 `search.js` 深度优先遍历 + 子串匹配 + `Minimap.vue` 内建搜索框（输入即搜、上一个/下一个循环导航、`options.enableSearch` 开关） + 测试（[plan](docs/superpowers/plans/2026-06-20-phase-4-search-nodes.md)，`npm test` <N> 全过，`npm run build` 通过；UI 用 jsdom + Vue Test Utils 真实组件事件覆盖，没有真实浏览器可用，未做人工目测）
```

把

```
- **第四阶段切片**（overview 是独立 mini canvas 子组件，跟前两个切片的视口数学性质不同，拆开做；后两个切片都会复用切片 1 的 `centerOnNode`/视口补动能力）：
  - [x] 切片 1：视图定位方法（`viewport.js`/`layout.js`/`selection.js` 纯函数 + `Minimap.vue` 首次 `defineExpose`：`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport`/`select`/`clearSelection`；[plan](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md)，`npm test` 214 全过，`npm run build` 通过）
  - [ ] 切片 2：搜索节点（按 `id`/`label` 搜索普通节点和分组框内子节点，复用切片 1 的定位能力跳转）
  - [ ] 切片 3：Overview 小地图导航（独立 mini canvas 子组件，缩略图 + 视口框拖拽导航）
- **下一步**：开始第四阶段切片 2（搜索节点）的 brainstorm 和 spec。
```

改成

```
- **第四阶段切片**（overview 是独立 mini canvas 子组件，跟前两个切片的视口数学性质不同，拆开做；切片 3 会复用切片 1 的 `centerOnNode`/视口补动能力）：
  - [x] 切片 1：视图定位方法（`viewport.js`/`layout.js`/`selection.js` 纯函数 + `Minimap.vue` 首次 `defineExpose`：`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport`/`select`/`clearSelection`；[plan](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md)，`npm test` 214 全过，`npm run build` 通过）
  - [x] 切片 2：搜索节点（`search.js` + `Minimap.vue` 内建搜索框，复用切片 1 的 `centerOnNode`/`select` 跳转和高亮；[plan](docs/superpowers/plans/2026-06-20-phase-4-search-nodes.md)，`npm test` <N> 全过，`npm run build` 通过）
  - [ ] 切片 3：Overview 小地图导航（独立 mini canvas 子组件，缩略图 + 视口框拖拽导航）
- **下一步**：开始第四阶段切片 3（Overview 小地图导航）的 brainstorm 和 spec。
```

- [ ] **Step 5: 把本 plan 文件顶部的「进度」checklist 3 项全部勾上**

把文件开头的

```
- [ ] Task 1：`search.js` 纯函数（`searchNodes`）
- [ ] Task 2：`Minimap.vue` 搜索状态、方法、UI、样式
- [ ] Task 3：回归校验 + ROADMAP 同步（含 Methods 契约补充）
```

改成全部 `- [x]`。

- [ ] **Step 6: 提交**

```bash
git add ROADMAP.md docs/superpowers/plans/2026-06-20-phase-4-search-nodes.md
git commit -m "$(cat <<'EOF'
docs: mark Phase 4 slice 2 (search nodes) complete

npm test/npm run build both green; Methods contract amended with
searchNext/searchPrevious (the original contract only listed
search(keyword), this slice's UI needed cycling); roadmap now points
at slice 3 (overview navigation) as the next step.
EOF
)"
```
