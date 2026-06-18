# Phase 1 Vue 组件壳 + 资源树拖入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 minimap 组件加上真实的 Vue 组件壳（挂载 canvas、DPR、ResizeObserver 驱动渲染、最小可用点击选中）和资源树拖入落图能力，把 `App.vue` 从 Vite 默认占位页换成可用的演示页。

**Architecture:** 新增一个纯函数模块 `src/minimap/interaction.js`（命中检测 + 插入下标），两个 Vue 组件 `src/minimap/ResourceTree.vue`（资源树展示）和 `src/minimap/Minimap.vue`（canvas 壳 + 交互，内部用 `ResourceTree`），全部通过已有的 `computeLayout`/`renderScene`/`coords` 纯函数驱动渲染。组件内部用手动调用 `render()` 的方式重绘（不依赖 Vue 监听 `graph.nodes` 这个 `Map` 的内部变更）。

**Tech Stack:** Vue 2.7.16 + `<script setup>`、Vite、Canvas 2D、原生 HTML 拖拽、原生 PointerEvent、`ResizeObserver`、Node 内置 `node --test`，新增开发依赖 `@vue/test-utils@^1.3.6` + `jsdom@^29` + 其 peer dep `vue-template-compiler@^2.7.16`，配合一个手写的 Node ESM loader 把 `.vue` SFC 编译成可执行 JS 供测试 `import`。

## Global Constraints

- 不引入新的第三方**运行时**依赖（layout / render / drag / graph 逻辑保持零运行时依赖）。
- 本计划新增的**开发**依赖仅限：`@vue/test-utils@^1.3.6`、`jsdom@^29.1.1`、`vue-template-compiler@^2.7.16`（用户已在 spec 头脑风暴阶段明确批准）。
- 测试运行器保持 `node --test`（内置测试运行器），不引入 Vitest；用 `node --import <loader>` 的方式给它接上一个手写的 `.vue` SFC loader。
- 高频/大规模图形渲染留在 Canvas，不进入 Vue DOM；纯逻辑（`hitTest`、`findInsertionIndex`）必须能在没有浏览器/DOM 的情况下被单测覆盖。
- `graph.nodes` 是 `Map`；Vue 2.7 的响应式系统不追踪 `Map` 内部的增删变更。所有图数据变更后必须手动调用组件内部 `render()`，不能依赖 `watch(() => props.graph, ..., { deep: true })` 自动感知。
- `selectedIds` 遵循受控/非受控双模式：外部传入时组件只发 `select` 事件、不自行持久化；未传入（默认 `null`）时组件内部维护状态。
- 每个任务做完都要跑 `npm test` 和 `npm run build` 并确认通过，才能进入下一个任务。
- 不修改 `dist/`；不依赖 `.superpowers/brainstorm` 产物作为产品代码。

## 进度

- [x] Task 1：纯函数 `interaction.js`（`hitTest` / `findInsertionIndex`）+ 测试（commit `0c50895`，review clean）
- [x] Task 2：Vue 组件测试基建（`@vue/test-utils` + `jsdom` + 自定义 SFC loader）+ smoke 测试（commit `b32e12b`，review clean；过程中发现 `node --test` 默认发现规则把 `test/helpers/*.js` 也当成测试文件计数，见 `e93b19d` 的修正）
- [x] Task 3：`ResourceTree.vue` + 测试（commit `a557001`，review clean）
- [x] Task 4：`Minimap.vue` 骨架（真实 canvas 挂载 / DPR / ResizeObserver 渲染）+ 测试（commit `f08b2fb`，review clean）
- [x] Task 5：`Minimap.vue` 最小可用点击选中（受控/非受控双模式）+ 测试（commit `ad9e199`；review 发现一个 Important——受控测试没真正隔离 `setSelected` 自身的写入门槛，只验证了渲染层的 `currentSelectedIds()` 短路；补测用例修复见 `3e8cbea`，复审时用注入 bug 的方式实测确认新用例能抓到回归）
- [x] Task 6：`Minimap.vue` 资源拖入落图 + 测试（commit `59cfaf4`，review clean）
- [x] Task 7：`App.vue` 演示页 + 清理占位资源 + 测试（commit `e4c451b`，review clean；浏览器手动验收清单由用户确认全部通过）
- [x] Task 8：全量验证 + 同步 ROADMAP / 本文档进度（`npm test` 49 全过、`npm run build` 通过）

切片完成：commit `0c50895`..`e4c451b`，`npm test` 49 passed、`npm run build` 通过。

---

### Task 1: 纯函数 `interaction.js`

**Files:**
- Create: `src/minimap/interaction.js`
- Test: `test/minimap-interaction.test.js`

**Interfaces:**
- Consumes：`computeLayout(graph, options)` 的产物（`layout.visibleItems`、`layout.nodes: Map<id, rect>`、`layout.groups: [{parentId, ...}]`），来自既有 `src/minimap/layout.js`；`graph.nodes: Map`、`node.children: string[]`，来自既有 `src/minimap/graph.js`。
- Produces：`hitTest(layout, point) -> { type: 'node'|'group', id: string } | null`；`findInsertionIndex(graph, layout, parentId, point, direction) -> number`。后续 Task 5（点击选中用 `hitTest`）、Task 6（拖入落图用 `findInsertionIndex`）都会 `import` 这两个函数。

- [ ] **Step 1: 写失败的测试**

创建 `test/minimap-interaction.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'
import { hitTest, findInsertionIndex } from '../src/minimap/interaction.js'

const VIEWPORT = { direction: 'horizontal', viewportWidth: 1200, viewportHeight: 760 }

test('hitTest finds the node under a point', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const rect = layout.nodes.get('energy-root')
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  assert.deepEqual(hitTest(layout, point), { type: 'node', id: 'energy-root' })
})

test('hitTest finds the group box for a folded parent', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const group = layout.groups.find((g) => g.parentId === 'heap-1')
  const point = { x: group.x + group.width / 2, y: group.y + group.height / 2 }
  assert.deepEqual(hitTest(layout, point), { type: 'group', id: 'heap-1' })
})

test('hitTest returns null when nothing is under the point', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  assert.equal(hitTest(layout, { x: -100000, y: -100000 }), null)
})

test('findInsertionIndex inserts before the first sibling when the point is above all of them', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const firstRect = layout.nodes.get('grid-tie')
  const point = { x: firstRect.x, y: firstRect.y - 1000 }
  assert.equal(findInsertionIndex(graph, layout, 'energy-root', point, 'horizontal'), 0)
})

test('findInsertionIndex inserts between two siblings', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const a = layout.nodes.get('grid-tie')
  const b = layout.nodes.get('heap-1')
  const midY = (a.y + a.height / 2 + b.y + b.height / 2) / 2
  const point = { x: a.x, y: midY }
  assert.equal(findInsertionIndex(graph, layout, 'energy-root', point, 'horizontal'), 1)
})

test('findInsertionIndex appends after the last sibling when the point is below all of them', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const lastRect = layout.nodes.get('cluster-25')
  const point = { x: lastRect.x, y: lastRect.y + lastRect.height + 1000 }
  assert.equal(findInsertionIndex(graph, layout, 'energy-root', point, 'horizontal'), 3)
})

test('findInsertionIndex falls back to appending when the parent is already folded into a group', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  const heap = graph.nodes.get('heap-1')
  assert.equal(findInsertionIndex(graph, layout, 'heap-1', { x: 0, y: 0 }, 'horizontal'), heap.children.length)
})

test('findInsertionIndex returns 0 for a parent with no children', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, VIEWPORT)
  assert.equal(findInsertionIndex(graph, layout, 'feeder-1', { x: 0, y: 0 }, 'horizontal'), 0)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/minimap/interaction.js'`（文件还不存在）。

- [ ] **Step 3: 写最小实现**

创建 `src/minimap/interaction.js`：

```js
// Phase 1 Vue 壳切片：命中检测 + 拖入插入下标，纯函数、不依赖 DOM。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md

// 在 layout.visibleItems 里找世界坐标包含 point 的项。
// 树布局下节点和分组框天然不重叠，找到第一个命中项就返回。
export function hitTest(layout, point) {
  for (const item of layout.visibleItems) {
    if (
      point.x >= item.x &&
      point.x <= item.x + item.width &&
      point.y >= item.y &&
      point.y <= item.y + item.height
    ) {
      return item.type === 'group' ? { type: 'group', id: item.parentId } : { type: 'node', id: item.id }
    }
  }
  return null
}

// parentId 的子节点已经折叠成分组框时没有逐个子节点的世界坐标，退化为追加末尾。
// 否则按 children 顺序比较交叉轴坐标，找第一个比 point 靠后的兄弟，插在它前面。
export function findInsertionIndex(graph, layout, parentId, point, direction) {
  const parent = graph.nodes.get(parentId)
  const children = (parent && parent.children) || []
  if (children.length === 0) return 0

  const isFolded = layout.groups.some((group) => group.parentId === parentId)
  if (isFolded) return children.length

  const pointCross = direction === 'vertical' ? point.x : point.y
  for (let i = 0; i < children.length; i++) {
    const rect = layout.nodes.get(children[i])
    if (!rect) continue
    const cross = direction === 'vertical' ? rect.x + rect.width / 2 : rect.y + rect.height / 2
    if (pointCross < cross) return i
  }
  return children.length
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 新增 8 个测试全部 PASS，既有 22 个测试不受影响（共 30 passed）。

- [ ] **Step 5: 跑 build 确认不破坏构建**

Run: `npm run build`
Expected: 构建成功（这一步还没碰 Vue 文件，构建产物应该和之前一样）。

- [ ] **Step 6: Commit**

```bash
git add src/minimap/interaction.js test/minimap-interaction.test.js
git commit -m "$(cat <<'EOF'
feat: 命中检测与拖入插入下标纯函数

hitTest 按 layout.visibleItems 做世界坐标包含判断；findInsertionIndex
按交叉轴位置在未折叠的兄弟节点间定位插入点，已折叠分组退化为追加末尾。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Vue 组件测试基建

**Files:**
- Modify: `package.json`（新增开发依赖，`test` 脚本接上自定义 loader）
- Create: `test/helpers/vue-sfc-loader.js`
- Create: `test/helpers/register-vue-sfc-loader.js`
- Create: `test/helpers/dom-env.js`
- Create: `test/fixtures/Probe.vue`
- Create: `test/minimap-test-infra.test.js`

**Interfaces:**
- Consumes：无（这是独立的测试基建任务）。
- Produces：`installDomEnv() -> JSDOM` 与 `stubElementSize(width, height)`，导出自 `test/helpers/dom-env.js`，后续 Task 3/4/5/6/7 的组件测试都会 `import` 它们；`node --import ./test/helpers/register-vue-sfc-loader.js --test` 这个新的 `npm test` 调用方式，让 `node --test` 能直接 `import` 真实的 `.vue` 文件。

**背景（为什么需要手写 loader）：** `node --test` 没有内置的 SFC 编译能力，`@vue/test-utils@1.x`+`jsdom` 只解决"有了编译后的 JS 怎么 mount"，没解决"`.vue` 文件怎么变成 JS"。`@vue/compiler-sfc`（`vue@2.7.16` 自带）可以现场编译，但它的 `parse`/`compileScript`/`compileTemplate` API 和 Vue 3 版本不同：`parse({source, filename})` 接收单个对象且直接返回 descriptor（不是 `{descriptor, errors}`）；`compileTemplate` 要用顶层的 `bindings` 选项（不是嵌套在 `compilerOptions.bindingMetadata` 里），否则编译出的模板会用 `_vm.xxx` 而不是 `_setup.xxx` 取值，导致 `<script setup>` 里定义的变量在模板里读不到。这些都已经手工验证过。

- [ ] **Step 1: 安装新开发依赖**

Run: `bun add -d @vue/test-utils@^1.3.6 jsdom@^29.1.1 vue-template-compiler@^2.7.16`
Expected: `package.json` 的 `devDependencies` 新增这三项，`bun.lock` 同步更新。

- [ ] **Step 2: 改 `test` 脚本接上自定义 loader**

`package.json` 里把：

```json
    "test": "node --test"
```

改成：

```json
    "test": "node --import ./test/helpers/register-vue-sfc-loader.js --test"
```

- [ ] **Step 3: 写 SFC loader（还没注册，先写文件）**

创建 `test/helpers/vue-sfc-loader.js`：

```js
// Node ESM loader 钩子：把 .vue SFC 用 @vue/compiler-sfc 现场编译成可执行 JS，
// 让 node --test 能直接 import 真实的 .vue 组件。只用于测试，不影响 Vite 构建路径。
// 只支持本项目统一使用的 <script setup> 写法，不是通用 Vue SFC 编译器。
import { readFile } from 'node:fs/promises'
import * as compiler from '@vue/compiler-sfc'

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.vue')) return nextLoad(url, context)

  const filename = url.replace('file://', '')
  const source = await readFile(filename, 'utf-8')
  const descriptor = compiler.parse({ source, filename })
  const id = Buffer.from(filename).toString('hex').slice(0, 8)

  const scriptResult = compiler.compileScript(descriptor, { id })
  const templateResult = compiler.compileTemplate({
    source: descriptor.template.content,
    filename,
    id,
    bindings: scriptResult.bindings,
  })

  const code = `
${scriptResult.content.replace('export default', 'const __default__ =')}
${templateResult.code.replace('export function render', 'function render')}
__default__.render = render
export default __default__
`
  return { format: 'module', source: code, shortCircuit: true }
}
```

创建 `test/helpers/register-vue-sfc-loader.js`：

```js
import { register } from 'node:module'

register('./vue-sfc-loader.js', import.meta.url)
```

- [ ] **Step 4: 写 jsdom 全局环境助手**

创建 `test/helpers/dom-env.js`：

```js
// 给 node --test 注入一个 jsdom 全局环境，供 @vue/test-utils mount 真实 .vue 组件使用。
// 用 EXCLUDE 名单排除 Node 已经原生提供的全局（尤其是定时器和 console）：
// 如果把 jsdom 的 window.setTimeout 也覆盖到 globalThis，会和 jsdom 内部实现互相递归导致栈溢出。
import { JSDOM } from 'jsdom'

const EXCLUDE = new Set([
  'window', 'document', 'navigator', 'location',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'clearImmediate', 'queueMicrotask',
  'console', 'process', 'global', 'globalThis', 'Buffer',
  'performance', 'fetch', 'Request', 'Response', 'Headers',
])

export function installDomEnv() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
  const { window } = dom

  globalThis.window = window
  globalThis.document = window.document
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })

  for (const key of Object.getOwnPropertyNames(window)) {
    if (EXCLUDE.has(key)) continue
    try {
      globalThis[key] = window[key]
    } catch {
      // 个别属性在 globalThis 上已经是只读的，跳过即可
    }
  }

  return dom
}

// jsdom 不跑真实排版，clientWidth/clientHeight 永远是 0；
// 需要非零容器尺寸的组件测试要调用这个函数打桩。
export function stubElementSize(width = 800, height = 600) {
  Object.defineProperty(globalThis.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(globalThis.HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    value: height,
  })
}
```

- [ ] **Step 5: 写一个最小 fixture 组件 + smoke 测试（先确认会失败/还没注册 loader）**

创建 `test/fixtures/Probe.vue`：

```vue
<script setup>
import { ref } from 'vue'

const message = ref('probe-ok')
</script>

<template>
  <div class="probe">{{ message }}</div>
</template>
```

创建 `test/minimap-test-infra.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv } from './helpers/dom-env.js'

installDomEnv()

// 用动态 import：必须等 installDomEnv() 跑完之后才能加载 @vue/test-utils 和 .vue 组件，
// 否则静态 import 的模块求值顺序会在 installDomEnv() 调用之前完成，jsdom 还没装好。
const { mount } = await import('@vue/test-utils')
const Probe = (await import('./fixtures/Probe.vue')).default

test('the vue-sfc-loader + jsdom env can mount a real .vue SFC under node --test', () => {
  const wrapper = mount(Probe)
  assert.equal(wrapper.text(), 'probe-ok')
  wrapper.destroy()
})
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test`
Expected: 全部 34 个测试 PASS（30 个既有真正的 `test()` 断言 + 这个新的 infra smoke test 1 个 + 这个任务新建的 3 个 `test/helpers/*.js` 文件，每个文件本身也被 `node --test` 的默认发现规则当成 1 个"测试"算进去）。如果失败，先确认 `package.json` 的 `test` 脚本已经改成 Step 2 的样子。

- [ ] **Step 7: 跑 build 确认不破坏构建**

Run: `npm run build`
Expected: 构建成功（这些改动都在 `test/` 和开发依赖里，不影响 Vite 构建产物）。

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock test/helpers/vue-sfc-loader.js test/helpers/register-vue-sfc-loader.js test/helpers/dom-env.js test/fixtures/Probe.vue test/minimap-test-infra.test.js
git commit -m "$(cat <<'EOF'
test: 接入 Vue 组件级测试基建（jsdom + @vue/test-utils + 自定义 SFC loader）

node --test 没有内置 SFC 编译能力，新增一个手写的 Node ESM loader 用
@vue/compiler-sfc 现场编译 .vue 文件；dom-env 给测试进程注入 jsdom 全局，
排除掉会和 Node 原生定时器/console 互相递归的属性。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `ResourceTree.vue`

**Files:**
- Create: `src/minimap/ResourceTree.vue`
- Test: `test/minimap-resource-tree.test.js`

**Interfaces:**
- Consumes：`installDomEnv()` from `test/helpers/dom-env.js`（Task 2）。
- Produces：`ResourceTree` 组件，prop `resources: [{ category: string, items: [{ id, label }] }]`；叶子项 `dragstart` 时把 `{id, label}` 通过 `event.dataTransfer.setData('application/json', json)` 写入。Task 4 会把它作为 `Minimap.vue` 内部子组件引入；Task 6 的拖入处理依赖这个 `application/json` payload 格式。

- [ ] **Step 1: 写失败的测试**

创建 `test/minimap-resource-tree.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv } from './helpers/dom-env.js'

installDomEnv()

const { mount } = await import('@vue/test-utils')
const ResourceTree = (await import('../src/minimap/ResourceTree.vue')).default

const resources = [
  {
    category: 'Generation',
    items: [
      { id: 'solar-array', label: 'Solar Array' },
      { id: 'wind-turbine', label: 'Wind Turbine' },
    ],
  },
  { category: 'Storage', items: [{ id: 'battery-bank', label: 'Battery Bank' }] },
]

test('renders categories and draggable leaf items', () => {
  const wrapper = mount(ResourceTree, { propsData: { resources } })
  const labels = wrapper.findAll('.resource-category-label').wrappers.map((w) => w.text())
  assert.deepEqual(labels, ['Generation', 'Storage'])
  const item = wrapper.find('[data-resource-id="battery-bank"]')
  assert.equal(item.text(), 'Battery Bank')
  assert.equal(item.attributes('draggable'), 'true')
  wrapper.destroy()
})

test('dragstart serializes the resource payload into dataTransfer', () => {
  const wrapper = mount(ResourceTree, { propsData: { resources } })
  const fakeDataTransfer = {
    data: {},
    setData(type, value) { this.data[type] = value },
    effectAllowed: null,
  }
  const itemEl = wrapper.find('[data-resource-id="solar-array"]').element
  const evt = new Event('dragstart', { bubbles: true })
  Object.defineProperty(evt, 'dataTransfer', { value: fakeDataTransfer })
  itemEl.dispatchEvent(evt)

  const payload = JSON.parse(fakeDataTransfer.data['application/json'])
  assert.deepEqual(payload, { id: 'solar-array', label: 'Solar Array' })
  assert.equal(fakeDataTransfer.effectAllowed, 'copy')
  wrapper.destroy()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL — 找不到 `../src/minimap/ResourceTree.vue`。

- [ ] **Step 3: 写最小实现**

创建 `src/minimap/ResourceTree.vue`：

```vue
<script setup>
// 资源树展示：两层——分类（不可拖）+ 叶子资源项（可拖）。
// 拖拽信息走原生 dataTransfer，由 Minimap.vue 的 drop 处理器读取。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
defineProps({
  resources: { type: Array, default: () => [] },
})

function onDragStart(item, event) {
  event.dataTransfer.setData('application/json', JSON.stringify(item))
  event.dataTransfer.effectAllowed = 'copy'
}
</script>

<template>
  <div class="resource-tree">
    <div v-for="category in resources" :key="category.category" class="resource-category">
      <div class="resource-category-label">{{ category.category }}</div>
      <div
        v-for="item in category.items"
        :key="item.id"
        class="resource-item"
        draggable="true"
        :data-resource-id="item.id"
        @dragstart="onDragStart(item, $event)"
      >
        {{ item.label }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.resource-tree {
  padding: 12px;
  font-size: 13px;
}
.resource-category-label {
  margin: 12px 0 6px;
  font-weight: 600;
  color: #9fb6cc;
}
.resource-item {
  padding: 6px 8px;
  margin-bottom: 4px;
  border-radius: 4px;
  background: #16202b;
  color: #cfe3f7;
  cursor: grab;
}
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全部 36 个测试 PASS。

（注：`node --test` 默认发现规则会把 `test/` 目录下**每一个** `.js` 文件都当成一个独立"测试"——哪怕它没有调用 `test()`，只是普通模块（比如 `test/helpers/dom-env.js`）。所以总数 = 真正的 `test()` 断言数 + `test/helpers/` 下的 `.js` 文件数。这是 Node 测试运行器的固有行为，不是 bug，后续每个任务的预期数字都已经把这部分算进去。）

- [ ] **Step 5: 跑 build 确认不破坏构建**

Run: `npm run build`
Expected: 构建成功（`ResourceTree.vue` 还没被任何地方引用，但要确认 Vite 能正常处理新 SFC 文件，不报编译错误——可以临时在 `src/App.vue` 顶部加一行 `import` 再删掉来验证，或者跳过，等 Task 4 真正引用它时一起验证）。

- [ ] **Step 6: Commit**

```bash
git add src/minimap/ResourceTree.vue test/minimap-resource-tree.test.js
git commit -m "$(cat <<'EOF'
feat: 资源树展示组件 ResourceTree.vue

两层结构：分类（不可拖）+ 叶子资源项（可拖，dragstart 把 {id,label}
写入 dataTransfer 的 application/json）。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `Minimap.vue` 骨架（canvas 挂载 / DPR / ResizeObserver 渲染）

**Files:**
- Create: `src/minimap/Minimap.vue`
- Modify: `test/helpers/mock-ctx.js`（新增 `'setTransform'` 到方法列表）
- Create: `test/helpers/canvas-env.js`
- Test: `test/minimap-shell.test.js`

**Interfaces:**
- Consumes：`ResourceTree.vue`（Task 3）；`computeLayout` from `../layout.js`；`renderScene`、`defaultTheme` from `../renderer.js`、`../theme.js`（既有）；`installDomEnv`/`stubElementSize`（Task 2）。
- Produces：`Minimap.vue` 组件，props `graph`（必填）、`resources`（默认 `[]`）、`layoutDirection`（默认 `'horizontal'`）、`theme`（默认 `null`）；内部 `render()`/`syncCanvasSize()` 函数（Task 5/6 会继续在这个文件里加点击选中和拖入逻辑）。`test/helpers/canvas-env.js` 导出 `stubCanvasContext()`（返回 `contexts` 数组，`contexts.at(-1)` 是最近一次挂载用的 mock ctx）和 `stubResizeObserver()`（返回 `instances` 数组，每个实例有 `.trigger()` 手动触发回调、`.disconnected` 标记是否被断开）——Task 5/6/7 的组件测试都会复用这两个 helper。

- [ ] **Step 1: 给 mock-ctx 加 `setTransform`**

`test/helpers/mock-ctx.js` 里把：

```js
  'translate',
  'scale',
]
```

改成：

```js
  'translate',
  'scale',
  'setTransform',
]
```

- [ ] **Step 2: 写 canvas/ResizeObserver 打桩 helper**

创建 `test/helpers/canvas-env.js`：

```js
// Minimap.vue 组件测试用的 canvas / ResizeObserver 打桩。
import { createMockCtx } from './mock-ctx.js'

// 每次有代码调用 canvas.getContext('2d')，就生成一个新的 mock ctx 并记下来；
// contexts.at(-1) 总是拿到"最近一次挂载"对应的 ctx。
export function stubCanvasContext() {
  const contexts = []
  globalThis.HTMLCanvasElement.prototype.getContext = function () {
    const ctx = createMockCtx()
    contexts.push(ctx)
    return ctx
  }
  return contexts
}

export function stubResizeObserver() {
  const instances = []
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      instances.push(this)
    }
    observe() {}
    disconnect() {
      this.disconnected = true
    }
    trigger() {
      this.callback([], this)
    }
  }
  globalThis.ResizeObserver = FakeResizeObserver
  return instances
}
```

- [ ] **Step 3: 写失败的测试**

创建 `test/minimap-shell.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
const observers = stubResizeObserver()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

test('mounting draws the initial graph onto the canvas', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'clearRect'))
  assert.ok(ctx.calls.some((call) => call.method === 'fillRect'))
  wrapper.destroy()
})

test('a ResizeObserver callback re-syncs canvas size and re-renders', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length
  observers.at(-1).trigger()
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})

test('changing layoutDirection triggers a re-render', async () => {
  const wrapper = mount(Minimap, {
    propsData: { graph: createDemoGraph(), layoutDirection: 'horizontal' },
  })
  const ctx = contexts.at(-1)
  const callsBefore = ctx.calls.length
  await wrapper.setProps({ layoutDirection: 'vertical' })
  await wrapper.vm.$nextTick()
  assert.ok(ctx.calls.length > callsBefore)
  wrapper.destroy()
})

test('unmounting disconnects the ResizeObserver', () => {
  const wrapper = mount(Minimap, { propsData: { graph: createDemoGraph() } })
  const observer = observers.at(-1)
  wrapper.destroy()
  assert.equal(observer.disconnected, true)
})
```

- [ ] **Step 4: 跑测试确认失败**

Run: `npm test`
Expected: FAIL — 找不到 `../src/minimap/Minimap.vue`。

- [ ] **Step 5: 写最小实现**

创建 `src/minimap/Minimap.vue`：

```vue
<script setup>
// Phase 1 Vue 组件壳骨架：挂载真实 canvas、DPR 适配、ResizeObserver 驱动的按需重渲染。
// 点击选中和资源拖入在后续切片（Task 5 / Task 6）里加到这个文件上。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { computeLayout } from './layout.js'
import { renderScene } from './renderer.js'
import { defaultTheme } from './theme.js'
import ResourceTree from './ResourceTree.vue'

const props = defineProps({
  graph: { type: Object, required: true },
  resources: { type: Array, default: () => [] },
  layoutDirection: { type: String, default: 'horizontal' },
  theme: { type: Object, default: null },
})

const containerRef = ref(null)
const canvasRef = ref(null)

let ctx = null
let resizeObserver = null
let layout = null
let cssWidth = 0
let cssHeight = 0

const viewport = { x: 0, y: 0, scale: 1 }

function render() {
  if (!ctx) return
  layout = computeLayout(props.graph, {
    direction: props.layoutDirection,
    viewportWidth: cssWidth,
    viewportHeight: cssHeight,
  })
  renderScene(ctx, {
    layout,
    graph: props.graph,
    viewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
  })
}

function syncCanvasSize() {
  const container = containerRef.value
  const canvas = canvasRef.value
  if (!container || !canvas) return
  cssWidth = container.clientWidth
  cssHeight = container.clientHeight
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas.height = Math.max(1, Math.round(cssHeight * dpr))
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`
  // setTransform 而不是 scale：避免每次 resize 后缩放重复叠加。
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

onMounted(() => {
  ctx = canvasRef.value.getContext('2d')
  syncCanvasSize()
  resizeObserver = new ResizeObserver(() => {
    syncCanvasSize()
    render()
  })
  resizeObserver.observe(containerRef.value)
  render()
})

onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect()
})

watch(() => props.layoutDirection, render)
</script>

<template>
  <div class="minimap">
    <ResourceTree class="minimap-resources" :resources="resources" />
    <div ref="containerRef" class="minimap-canvas-container">
      <canvas ref="canvasRef"></canvas>
    </div>
  </div>
</template>

<style scoped>
.minimap {
  display: flex;
  width: 100%;
  height: 100%;
}
.minimap-resources {
  flex: 0 0 220px;
  overflow-y: auto;
  border-right: 1px solid #1b2530;
}
.minimap-canvas-container {
  flex: 1 1 auto;
  position: relative;
}
.minimap-canvas-container canvas {
  display: block;
}
</style>
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test`
Expected: 全部 41 个测试 PASS（36 个既有 + `test/helpers/canvas-env.js` 这个新文件本身算 1 个 + 4 个新的 `test()` 断言）。

- [ ] **Step 7: 跑 build 确认不破坏构建**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 8: Commit**

```bash
git add src/minimap/Minimap.vue test/helpers/mock-ctx.js test/helpers/canvas-env.js test/minimap-shell.test.js
git commit -m "$(cat <<'EOF'
feat: Minimap.vue 骨架——真实 canvas 挂载 + DPR + ResizeObserver 渲染

ResizeObserver 驱动按需重渲染（不是 rAF 循环）；setTransform 而不是
scale 应用 DPR，避免多次 resize 后缩放叠加。内部用手动调用 render()
的方式重绘，不依赖 Vue 监听 graph.nodes 这个 Map 的内部变更。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `Minimap.vue` 最小可用点击选中

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Modify: `test/helpers/mock-ctx.js`（新增属性赋值追踪）
- Test: `test/minimap-select.test.js`

**Interfaces:**
- Consumes：`hitTest` from `./interaction.js`（Task 1）；`screenToWorld` from `./coords.js`（既有）；Task 4 的 `Minimap.vue` 骨架。
- Produces：`Minimap.vue` 新增 prop `selectedIds`（默认 `null`，受控/非受控双模式）、新增 `emit('select', ids)`；内部 `currentSelectedIds()` 函数——Task 6 的拖入逻辑会调用它来决定挂载父节点。

- [ ] **Step 1: 给 mock-ctx 加属性赋值追踪**

`test/helpers/mock-ctx.js` 整个文件替换成：

```js
// 记录调用的假 Canvas 2D ctx，用于在 node --test 下断言绘制行为（非像素断言）。

const METHODS = [
  'clearRect',
  'fillRect',
  'strokeRect',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'stroke',
  'fill',
  'fillText',
  'strokeText',
  'save',
  'restore',
  'rect',
  'arc',
  'roundRect',
  'setLineDash',
  'translate',
  'scale',
  'setTransform',
]

// 这几个属性会被赋值（不是方法调用），也记录进 calls，
// 方便测试判断"画某个节点时 strokeStyle 是不是选中色"。
const TRACKED_PROPERTIES = ['fillStyle', 'strokeStyle', 'font', 'lineWidth']

export function createMockCtx() {
  const calls = []
  const ctx = {
    calls,
    methodsOf(name) {
      return calls.filter((call) => call.method === name)
    },
    firstIndexOf(name) {
      return calls.findIndex((call) => call.method === name)
    },
  }
  for (const method of METHODS) {
    ctx[method] = (...args) => {
      calls.push({ method, args })
    }
  }
  for (const prop of TRACKED_PROPERTIES) {
    let value
    Object.defineProperty(ctx, prop, {
      get() {
        return value
      },
      set(v) {
        value = v
        calls.push({ method: `set:${prop}`, args: [v] })
      },
    })
  }
  return ctx
}
```

- [ ] **Step 2: 写失败的测试**

创建 `test/minimap-select.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'
import { defaultTheme } from '../src/minimap/theme.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

function dispatchPointerDown(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, bubbles: true }),
  )
}

// 只看最近一次 render()（最后一次 clearRect 之后）的绘制调用，
// 避免一个组件实例多次渲染的历史调用互相污染断言。
function selectedLabels(ctx, theme) {
  const lastClear = ctx.calls.map((c) => c.method).lastIndexOf('clearRect')
  const calls = ctx.calls.slice(lastClear + 1)
  const labels = []
  calls.forEach((call, i) => {
    if (call.method !== 'fillText') return
    for (let j = i - 1; j >= 0; j--) {
      if (calls[j].method === 'set:strokeStyle') {
        if (calls[j].args[0] === theme.node.selectedStroke) labels.push(call.args[0])
        break
      }
    }
  })
  return labels
}

test('clicking a node selects it (uncontrolled) and highlights it on the next render', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const rect = layout.nodes.get('grid-tie')
  const wrapper = mount(Minimap, { propsData: { graph } })

  dispatchPointerDown(wrapper, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

  assert.deepEqual(wrapper.emitted('select')[0][0], ['grid-tie'])
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), ['Grid Tie'])
  wrapper.destroy()
})

test('clicking blank space clears the selection', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const rect = layout.nodes.get('grid-tie')
  const wrapper = mount(Minimap, { propsData: { graph } })
  dispatchPointerDown(wrapper, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })

  dispatchPointerDown(wrapper, { x: -100000, y: -100000 })

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], [])
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), [])
  wrapper.destroy()
})

test('selectedIds prop puts the component in controlled mode', async () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const wrapper = mount(Minimap, { propsData: { graph, selectedIds: ['grid-tie'] } })
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), ['Grid Tie'])

  const rootRect = layout.nodes.get('energy-root')
  dispatchPointerDown(wrapper, { x: rootRect.x + rootRect.width / 2, y: rootRect.y + rootRect.height / 2 })

  assert.deepEqual(wrapper.emitted('select')[0][0], ['energy-root'])
  // 受控模式：prop 还没变，下一次渲染应该还是原来的选中状态
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), ['Grid Tie'])

  await wrapper.setProps({ selectedIds: ['energy-root'] })
  await wrapper.vm.$nextTick()
  assert.deepEqual(selectedLabels(contexts.at(-1), defaultTheme), ['Energy Root'])
  wrapper.destroy()
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test`
Expected: FAIL —— `select` 事件从未触发（`wrapper.emitted('select')` 是 `undefined`）。

- [ ] **Step 4: 写最小实现**

在 `src/minimap/Minimap.vue` 的 `<script setup>` 里：

把：

```js
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { computeLayout } from './layout.js'
import { renderScene } from './renderer.js'
import { defaultTheme } from './theme.js'
import ResourceTree from './ResourceTree.vue'

const props = defineProps({
  graph: { type: Object, required: true },
  resources: { type: Array, default: () => [] },
  layoutDirection: { type: String, default: 'horizontal' },
  theme: { type: Object, default: null },
})

const containerRef = ref(null)
const canvasRef = ref(null)

let ctx = null
let resizeObserver = null
let layout = null
let cssWidth = 0
let cssHeight = 0

const viewport = { x: 0, y: 0, scale: 1 }

function render() {
  if (!ctx) return
  layout = computeLayout(props.graph, {
    direction: props.layoutDirection,
    viewportWidth: cssWidth,
    viewportHeight: cssHeight,
  })
  renderScene(ctx, {
    layout,
    graph: props.graph,
    viewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
  })
}
```

改成：

```js
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { computeLayout } from './layout.js'
import { renderScene } from './renderer.js'
import { defaultTheme } from './theme.js'
import { screenToWorld } from './coords.js'
import { hitTest } from './interaction.js'
import ResourceTree from './ResourceTree.vue'

const props = defineProps({
  graph: { type: Object, required: true },
  resources: { type: Array, default: () => [] },
  layoutDirection: { type: String, default: 'horizontal' },
  selectedIds: { type: Array, default: null },
  theme: { type: Object, default: null },
})

const emit = defineEmits(['select'])

const containerRef = ref(null)
const canvasRef = ref(null)

let ctx = null
let resizeObserver = null
let layout = null
let cssWidth = 0
let cssHeight = 0
let internalSelectedId = null

const viewport = { x: 0, y: 0, scale: 1 }

function currentSelectedIds() {
  if (props.selectedIds !== null) return props.selectedIds
  return internalSelectedId ? [internalSelectedId] : []
}

function render() {
  if (!ctx) return
  layout = computeLayout(props.graph, {
    direction: props.layoutDirection,
    viewportWidth: cssWidth,
    viewportHeight: cssHeight,
  })
  renderScene(ctx, {
    layout,
    graph: props.graph,
    viewport,
    width: cssWidth,
    height: cssHeight,
    theme: props.theme || defaultTheme,
    state: { selectedIds: new Set(currentSelectedIds()) },
  })
}

function setSelected(ids) {
  if (props.selectedIds === null) internalSelectedId = ids[0] ?? null
  emit('select', ids)
  render()
}

function pointFromEvent(event) {
  const rect = canvasRef.value.getBoundingClientRect()
  return screenToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport)
}

function handlePointerDown(event) {
  if (!layout) return
  const hit = hitTest(layout, pointFromEvent(event))
  setSelected(hit ? [hit.id] : [])
}
```

然后把 `onMounted` 里：

```js
onMounted(() => {
  ctx = canvasRef.value.getContext('2d')
  syncCanvasSize()
  resizeObserver = new ResizeObserver(() => {
    syncCanvasSize()
    render()
  })
  resizeObserver.observe(containerRef.value)
  render()
})
```

改成：

```js
onMounted(() => {
  ctx = canvasRef.value.getContext('2d')
  syncCanvasSize()
  resizeObserver = new ResizeObserver(() => {
    syncCanvasSize()
    render()
  })
  resizeObserver.observe(containerRef.value)
  canvasRef.value.addEventListener('pointerdown', handlePointerDown)
  render()
})
```

最后在 `watch(() => props.layoutDirection, render)` 后面加一行：

```js
watch(() => props.layoutDirection, render)
watch(() => props.selectedIds, render)
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test`
Expected: 全部 44 个测试 PASS（41 个既有 + 3 个新的 `test()` 断言；这个任务只改 `mock-ctx.js` 内容、没新建 `test/helpers/` 下的文件，所以不增加文件级计数）。

- [ ] **Step 6: 跑 build 确认不破坏构建**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 7: Commit**

```bash
git add src/minimap/Minimap.vue test/helpers/mock-ctx.js test/minimap-select.test.js
git commit -m "$(cat <<'EOF'
feat: Minimap.vue 最小可用点击选中（受控/非受控双模式）

点击命中节点或分组框时单选并 emit('select')；点击空白清空。
selectedIds prop 受控时组件只发事件、不自行持久化选中状态。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `Minimap.vue` 资源拖入落图

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Test: `test/minimap-drop.test.js`

**Interfaces:**
- Consumes：`findInsertionIndex` from `./interaction.js`（Task 1）；Task 5 的 `currentSelectedIds()`；`ResourceTree.vue` 拖出的 `{id, label}` JSON payload（Task 3）。
- Produces：`Minimap.vue` 新增 `emit('node-drop', {resource, parentId, index})` 和 `emit('change', graph)`；图数据就地修改（`graph.nodes.set(...)` + `parent.children.splice(...)`）。

- [ ] **Step 1: 写失败的测试**

创建 `test/minimap-drop.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

function dispatchPointerDown(wrapper, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(
    new PointerEvent('pointerdown', { clientX: point.x, clientY: point.y, bubbles: true }),
  )
}

function dispatchDrop(wrapper, payload, point) {
  const canvasEl = wrapper.find('canvas').element
  const evt = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(evt, 'dataTransfer', { value: { getData: () => JSON.stringify(payload) } })
  Object.defineProperty(evt, 'clientX', { value: point.x, configurable: true })
  Object.defineProperty(evt, 'clientY', { value: point.y, configurable: true })
  canvasEl.dispatchEvent(evt)
}

test('dropping with no selection adds a child under graph.rootIds[0]', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  const sizeBefore = graph.nodes.size

  dispatchDrop(wrapper, { id: 'solar-array', label: 'Solar Array' }, { x: 0, y: -100000 })

  assert.equal(graph.nodes.size, sizeBefore + 1)
  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'energy-root')
  assert.equal(payload.index, 0)
  const root = graph.nodes.get('energy-root')
  assert.equal(root.children.length, 4)
  assert.ok(root.children[0].startsWith('res-solar-array-'))
  assert.ok(wrapper.emitted('change'))
  assert.equal(wrapper.emitted('change')[0][0], graph)
  wrapper.destroy()
})

test('dropping with a selection adds a child under the selected node, at the dropped position', () => {
  const graph = createDemoGraph()
  const layout = computeLayout(graph, { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
  const wrapper = mount(Minimap, { propsData: { graph } })

  const gridTieRect = layout.nodes.get('grid-tie')
  dispatchPointerDown(wrapper, {
    x: gridTieRect.x + gridTieRect.width / 2,
    y: gridTieRect.y + gridTieRect.height / 2,
  })

  const feeder1 = layout.nodes.get('feeder-1')
  const feeder2 = layout.nodes.get('feeder-2')
  const between = {
    x: feeder1.x,
    y: (feeder1.y + feeder1.height / 2 + feeder2.y + feeder2.height / 2) / 2,
  }
  dispatchDrop(wrapper, { id: 'wind-turbine', label: 'Wind Turbine' }, between)

  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'grid-tie')
  assert.equal(payload.index, 1)
  const gridTie = graph.nodes.get('grid-tie')
  assert.ok(gridTie.children[1].startsWith('res-wind-turbine-'))
  wrapper.destroy()
})

test('dropping onto a folded group appends the new node at the end', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, selectedIds: ['heap-1'] } })
  const heap = graph.nodes.get('heap-1')
  const sizeBefore = heap.children.length

  dispatchDrop(wrapper, { id: 'battery-bank', label: 'Battery Bank' }, { x: 0, y: 0 })

  const payload = wrapper.emitted('node-drop')[0][0]
  assert.equal(payload.parentId, 'heap-1')
  assert.equal(payload.index, sizeBefore)
  assert.equal(heap.children.length, sizeBefore + 1)
  wrapper.destroy()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL —— `node-drop`/`change` 从未触发，因为还没有 `drop` 处理器。

- [ ] **Step 3: 写最小实现**

在 `src/minimap/Minimap.vue` 的 `<script setup>` 里：

把：

```js
import { screenToWorld } from './coords.js'
import { hitTest } from './interaction.js'
import ResourceTree from './ResourceTree.vue'
```

改成：

```js
import { screenToWorld } from './coords.js'
import { hitTest, findInsertionIndex } from './interaction.js'
import ResourceTree from './ResourceTree.vue'
```

把：

```js
const emit = defineEmits(['select'])
```

改成：

```js
const emit = defineEmits(['select', 'node-drop', 'change'])
```

在 `handlePointerDown` 函数后面加：

```js
function handleDragOver(event) {
  event.preventDefault()
}

function handleDrop(event) {
  event.preventDefault()
  if (!layout) return
  const raw = event.dataTransfer.getData('application/json')
  if (!raw) return
  const resource = JSON.parse(raw)

  const point = pointFromEvent(event)
  const selected = currentSelectedIds()
  const parentId = selected[0] ?? props.graph.rootIds[0]
  const parent = props.graph.nodes.get(parentId)
  if (!parent) return

  const index = findInsertionIndex(props.graph, layout, parentId, point, props.layoutDirection)
  const id = `res-${resource.id}-${Date.now()}`
  props.graph.nodes.set(id, { id, label: resource.label, parentId, children: [] })
  parent.children.splice(index, 0, id)

  render()
  emit('node-drop', { resource, parentId, index })
  emit('change', props.graph)
}
```

把 `onMounted` 里：

```js
  canvasRef.value.addEventListener('pointerdown', handlePointerDown)
  render()
})
```

改成：

```js
  canvasRef.value.addEventListener('pointerdown', handlePointerDown)
  canvasRef.value.addEventListener('dragover', handleDragOver)
  canvasRef.value.addEventListener('drop', handleDrop)
  render()
})
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: 全部 47 个测试 PASS（44 个既有 + 3 个新的 `test()` 断言）。

- [ ] **Step 5: 跑 build 确认不破坏构建**

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 6: Commit**

```bash
git add src/minimap/Minimap.vue test/minimap-drop.test.js
git commit -m "$(cat <<'EOF'
feat: Minimap.vue 资源拖入落图

挂载父节点 = 当前选中节点（无选中挂 rootIds[0]）；插入位置按
findInsertionIndex 在未折叠兄弟间定位，已折叠分组追加末尾。
graph 就地修改后手动 render()，并 emit node-drop / change。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `App.vue` 演示页 + 清理占位资源

**Files:**
- Modify: `src/App.vue`
- Modify: `src/style.css`
- Delete: `src/components/HelloWorld.vue`
- Delete: `src/assets/vite.svg`
- Delete: `src/assets/hero.png`
- Delete: `src/assets/vue.svg`
- Delete: `public/icons.svg`
- Test: `test/app.test.js`

**Interfaces:**
- Consumes：`Minimap.vue`（Task 4/5/6 完整版）；`createDemoGraph` from `./minimap/graph.js`（既有）。
- Produces：可运行的演示页（`npm run dev` 后浏览器可见）。

- [ ] **Step 1: 写失败的测试**

创建 `test/app.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()

const { mount } = await import('@vue/test-utils')
const App = (await import('../src/App.vue')).default

test('App mounts the demo graph and resource tree without throwing', () => {
  const wrapper = mount(App)
  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'clearRect'))
  assert.ok(wrapper.find('.resource-category-label').exists())
  wrapper.destroy()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL —— 当前 `App.vue` 渲染的是 `HelloWorld`，找不到 `.resource-category-label`。

- [ ] **Step 3: 删除占位文件**

```bash
git rm src/components/HelloWorld.vue src/assets/vite.svg src/assets/hero.png src/assets/vue.svg public/icons.svg
```

- [ ] **Step 4: 重写 `App.vue`**

把 `src/App.vue` 整个文件替换成：

```vue
<script setup>
import Minimap from './minimap/Minimap.vue'
import { createDemoGraph } from './minimap/graph.js'

const graph = createDemoGraph()

const resources = [
  {
    category: 'Generation',
    items: [
      { id: 'solar-array', label: 'Solar Array' },
      { id: 'wind-turbine', label: 'Wind Turbine' },
    ],
  },
  {
    category: 'Storage',
    items: [{ id: 'battery-bank', label: 'Battery Bank' }],
  },
]
</script>

<template>
  <Minimap :graph="graph" :resources="resources" />
</template>
```

- [ ] **Step 5: 重写 `style.css`**

把 `src/style.css` 整个文件替换成：

```css
:root {
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  margin: 0;
  height: 100%;
  font: 14px/1.4 system-ui, 'Segoe UI', Roboto, sans-serif;
  background: #0f1419;
  color: #cfe3f7;
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm test`
Expected: 全部 48 个测试 PASS（47 个既有 + 1 个新的 `test()` 断言）。

- [ ] **Step 7: 跑 build 确认不破坏构建**

Run: `npm run build`
Expected: 构建成功，且产物里不再出现 `hero`/`vue.svg`/`vite.svg`（除了 favicon 相关）这些占位资源。

- [ ] **Step 8: 浏览器手动验收**

Run: `npm run dev`，在浏览器打开打印出来的本机地址，确认：
- 左侧能看到 "Generation" / "Storage" 两个分类和三个可拖拽资源项；
- 右侧 Canvas 上能看到能源系统示例图（深色背景、节点矩形、连线、`heap-1`/`cluster-25` 两个分组框）；
- 点击一个节点，它的描边会变成选中色；点击空白处，选中状态消失；
- 把一个资源项拖到画布上放开，画布上的图会多出一个新节点（如果当前有选中节点，新节点应该挂在选中节点下面；没有选中则挂在根节点下面）。

确认完成后用 `Ctrl+C` 停掉 `npm run dev`。

- [ ] **Step 9: Commit**

```bash
git add src/App.vue src/style.css test/app.test.js
git commit -m "$(cat <<'EOF'
feat: App.vue 改为 minimap 演示页，清理 Vite 默认占位资源

用 createDemoGraph() 的能源系统示例图 + 一份示例资源树挂载 Minimap，
删除 HelloWorld.vue 及其专属占位图片/图标，style.css 换成最小深色基础样式。

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 全量验证 + 同步 ROADMAP / 本文档进度

**Files:**
- Modify: `ROADMAP.md`
- Modify: `docs/superpowers/plans/2026-06-18-phase-1-vue-shell.md`（本文件的「进度」一节）

**Interfaces:**
- Consumes：Task 1-7 的全部产出。
- Produces：无新代码；只更新进度文档。

- [ ] **Step 1: 全量跑测试和构建**

Run: `npm test && npm run build`
Expected: 测试全部 PASS（48 个，含 `test/helpers/` 下文件级计数，见 Task 3 的注），构建成功。

- [ ] **Step 2: 更新 `ROADMAP.md` 的「当前进度」块**

把：

```markdown
- **当前阶段计划**：[逻辑层](docs/superpowers/plans/2026-06-18-phase-1-core-logic.md) ｜ [Canvas 渲染器](docs/superpowers/plans/2026-06-18-phase-1-canvas-renderer.md)（切片级进度在各 plan「进度」一节）
- **已完成切片**：
  - 逻辑层 `graph` / `layout` / `coords` + 测试（commit `893b6b7`）
  - Canvas 渲染器 `renderer` / `theme` + 测试（commit `1caccd8`，`npm test` 22 全过）
- **下一步**：第一阶段后续切片——Vue 组件壳 + 资源树拖入（按 brainstorm → spec → plan → implement 推进）
- **待办切片**：Vue 组件壳 + 资源树拖入 → 布局切换动画；二者验收点全绿后勾「第一阶段」
```

改成：

```markdown
- **当前阶段计划**：[逻辑层](docs/superpowers/plans/2026-06-18-phase-1-core-logic.md) ｜ [Canvas 渲染器](docs/superpowers/plans/2026-06-18-phase-1-canvas-renderer.md) ｜ [Vue 组件壳 + 资源树拖入](docs/superpowers/plans/2026-06-18-phase-1-vue-shell.md)（切片级进度在各 plan「进度」一节）
- **已完成切片**：
  - 逻辑层 `graph` / `layout` / `coords` + 测试（commit `893b6b7`）
  - Canvas 渲染器 `renderer` / `theme` + 测试（commit `1caccd8`，`npm test` 22 全过）
  - Vue 组件壳 `Minimap.vue` / `ResourceTree.vue` / `interaction.js` + 资源树拖入 + 测试（`npm test` 48 全过）
- **下一步**：第一阶段最后一个切片——布局切换动画（按 brainstorm → spec → plan → implement 推进）
- **待办切片**：布局切换动画；验收点全绿后勾「第一阶段」
```

（实际提交前把这里的占位提交说明换成 Task 1-7 真正落地的 commit hash。）

- [ ] **Step 3: 更新本文档顶部的「进度」一节**

把本文件「进度」一节的全部 checkbox 从 `- [ ]` 改成 `- [x]`，并在每一项后面补上对应的 commit hash（参考 `docs/superpowers/plans/2026-06-18-phase-1-canvas-renderer.md` 的格式）。

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md docs/superpowers/plans/2026-06-18-phase-1-vue-shell.md
git commit -m "$(cat <<'EOF'
docs: 持久化 Vue 组件壳 + 资源树拖入切片进度

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
