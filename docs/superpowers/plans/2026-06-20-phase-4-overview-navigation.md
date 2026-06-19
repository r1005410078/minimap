# Phase 4 Overview 小地图导航 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `Minimap.vue` 加一个右下角的全局缩略图子组件 `Overview.vue`：显示全图内容和当前主视口框，点击/拖动缩略图任意位置即让主视口平移过去。

**Architecture:** 新建 `src/minimap/overview.js` 三个纯函数（缩略图自己的"完整显示全部内容"视口变换、主视口框在缩略图坐标系下的屏幕矩形、视口框的视觉裁剪）。新建独立子组件 `src/minimap/Overview.vue`：不声明任何 Vue `props`，所有绘制数据通过 `defineExpose` 暴露的 `render(...)` 方法实时传入——`Minimap.vue` 在自己已有的 `renderCurrent()` 函数末尾调用它，跟主画布的命令式渲染哲学保持一致（不把 `layout`/`cssWidth`/`cssHeight` 这些既有的模块级 `let` 状态改造成响应式 `ref`）。反方向（缩略图点击/拖拽 → 主视口平移）走 Vue 标准 `emit('navigate', worldPoint)`，`Minimap.vue` 接到后复用已有的 `centerViewportOn` + `applyViewport`。

**Tech Stack:** 纯 JavaScript（无 DOM 依赖的几何计算）+ Vue 2.7 `<script setup>`（无 props 的命令式子组件）+ Node 内置 `node:test`/`node:assert/strict` + `@vue/test-utils` v1 + 现有 `test/helpers/{dom-env,canvas-env}.js`。无新依赖。

## 进度

- [ ] Task 1：`overview.js` 三个纯函数
- [ ] Task 2：`Overview.vue` 子组件
- [ ] Task 3：`Minimap.vue` 集成
- [ ] Task 4：回归校验 + ROADMAP 同步

## Global Constraints

- 不引入新的第三方运行时或开发依赖。
- 缩略图固定尺寸 200×140px，不做可配置项（YAGNI）。
- `computeOverviewViewport` 不夹限缩放范围（必须完整显示全部内容，不能用主视口的 `minScale`/`maxScale`）。
- `Overview.vue` 不声明 Vue `props`；绘制数据通过暴露的 `render({ layout, viewport, mainWidth, mainHeight, theme })` 方法实时传入；反方向用 `emit('navigate', worldPoint)`。
- 点击缩略图任意位置即跳转，按住拖拽持续跟随；不区分"点击"和"拖拽"两套逻辑，`pointerdown` 时立即导航一次，`pointermove`（capture 期间）持续导航。
- `options.enableOverview` 默认 `true`；设为 `false` 时不渲染 `<Overview>`（不挂载，不创建第二个 canvas）。
- 不画选中态高亮；缩略图内容只画 `layout.visibleItems` 的纯色矩形，不画文字、不画连线、不接自定义绘制器。
- 每个任务完成后必须跑 `npm test`，Task 4 额外跑 `npm run build`，确认通过才能提交。
- 字段/函数命名以 [spec](../specs/2026-06-20-phase-4-overview-navigation.md) 为准。

---

## 文件落点

- 新建：`src/minimap/overview.js`——`computeOverviewViewport(bounds, width, height, padding = 20)`、`mainViewportFrameRect(mainViewport, mainWidth, mainHeight, overviewViewport)`、`clampRectToCanvas(rect, width, height)`。
- 新建：`src/minimap/Overview.vue`——独立子组件，无 props，`defineExpose({ render })`，`defineEmits(['navigate'])`。
- 修改：`src/minimap/Minimap.vue`——新增 `import Overview`、`overviewRef`、`renderCurrent()` 末尾追加 overview 渲染调用、新增 `handleOverviewNavigate`、模板新增 `<Overview>`、样式新增 `.minimap-overview`。
- 新建：`test/minimap-overview.test.js`——`overview.js` 纯函数用例。
- 新建：`test/minimap-overview-ui.test.js`——`Overview.vue` 组件级用例（绘制断言 + pointer 手势）。
- 新建：`test/minimap-overview-integration.test.js`——`Minimap.vue` 集成用例（`navigate` 联动主视口、受控模式、渲染联动、`enableOverview` 开关）。
- 修改：`ROADMAP.md`——勾选第四阶段切片 3，第四阶段整体勾选完成，「当前进度」块指向第五阶段待规划。

---

## Task 1: `overview.js` 三个纯函数

**Files:**
- Create: `src/minimap/overview.js`
- Test: `test/minimap-overview.test.js`

**Interfaces:**
- Consumes：`fitViewportToBounds`（`./viewport.js`，已有，签名 `fitViewportToBounds(bounds, viewportWidth, viewportHeight, options = null, padding = 40)`）、`screenToWorld`（`./coords.js`，已有，签名 `screenToWorld(point, viewport)` → `{x,y}`）、`worldRectToScreen`（`./renderer.js`，已有，签名 `worldRectToScreen(rect, viewport)` → `{x,y,width,height}`）。
- Produces：`computeOverviewViewport(bounds, width, height, padding = 20)` → `{x,y,scale}`；`mainViewportFrameRect(mainViewport, mainWidth, mainHeight, overviewViewport)` → `{x,y,width,height}`；`clampRectToCanvas(rect, width, height)` → `{x,y,width,height}`。Task 2 会原样导入这三个函数名，不要改名。

- [ ] **Step 1: 写失败测试**

新建 `test/minimap-overview.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_VIEWPORT } from '../src/minimap/viewport.js'
import { computeOverviewViewport, mainViewportFrameRect, clampRectToCanvas } from '../src/minimap/overview.js'

test('computeOverviewViewport does not clamp scale below the main viewport minScale', () => {
  const bounds = { minX: 0, maxX: 10000, minY: 0, maxY: 10000 }
  const result = computeOverviewViewport(bounds, 200, 140)
  assert.deepEqual(result, { x: 50, y: 20, scale: 0.01 })
})

test('computeOverviewViewport fits normal-sized content with the default 20px padding', () => {
  const bounds = { minX: 0, maxX: 200, minY: 0, maxY: 100 }
  const result = computeOverviewViewport(bounds, 200, 140, 20)
  assert.deepEqual(result, { x: 20, y: 30, scale: 0.8 })
})

test('computeOverviewViewport falls back to DEFAULT_VIEWPORT for degenerate bounds', () => {
  const bounds = { minX: NaN, maxX: 10, minY: 0, maxY: 10 }
  assert.deepEqual(computeOverviewViewport(bounds, 200, 140), DEFAULT_VIEWPORT)
})

test('mainViewportFrameRect maps an identity main viewport to the overview screen rect', () => {
  const mainViewport = { x: 0, y: 0, scale: 1 }
  const overviewViewport = { x: 10, y: 5, scale: 0.02 }
  const result = mainViewportFrameRect(mainViewport, 800, 600, overviewViewport)
  assert.deepEqual(result, { x: 10, y: 5, width: 16, height: 12 })
})

test('mainViewportFrameRect maps a panned and zoomed main viewport correctly', () => {
  const mainViewport = { x: -100, y: -50, scale: 2 }
  const overviewViewport = { x: 10, y: 5, scale: 0.02 }
  const result = mainViewportFrameRect(mainViewport, 800, 600, overviewViewport)
  assert.deepEqual(result, { x: 11, y: 5.5, width: 8, height: 6 })
})

test('clampRectToCanvas leaves a rect that fully fits unchanged', () => {
  const rect = { x: 10, y: 10, width: 50, height: 30 }
  assert.deepEqual(clampRectToCanvas(rect, 200, 140), rect)
})

test('clampRectToCanvas clips a rect overflowing the right/bottom edges', () => {
  const rect = { x: 150, y: 100, width: 100, height: 80 }
  assert.deepEqual(clampRectToCanvas(rect, 200, 140), { x: 150, y: 100, width: 50, height: 40 })
})

test('clampRectToCanvas clips a rect overflowing the top/left edges', () => {
  const rect = { x: -30, y: -20, width: 80, height: 60 }
  assert.deepEqual(clampRectToCanvas(rect, 200, 140), { x: 0, y: 0, width: 50, height: 40 })
})

test('clampRectToCanvas zeroes out a rect entirely outside the canvas', () => {
  const rect = { x: 300, y: 300, width: 50, height: 50 }
  assert.deepEqual(clampRectToCanvas(rect, 200, 140), { x: 300, y: 300, width: 0, height: 0 })
})
```

数值推导（供核对，不需要抄进测试文件）：
- `computeOverviewViewport({minX:0,maxX:10000,minY:0,maxY:10000}, 200, 140)`：`availableWidth=160, availableHeight=100`，`rawScale=min(160/10000,100/10000)=0.01`（不夹限，因为 `0.01 < 0.25`，证明走的是无夹限路径）；`centerX=centerY=5000`；`x=100-5000*0.01=50`，`y=70-5000*0.01=20`。
- `computeOverviewViewport({minX:0,maxX:200,minY:0,maxY:100}, 200, 140, 20)`：`rawScale=min(160/200,100/100)=0.8`；`centerX=100,centerY=50`；`x=100-100*0.8=20`，`y=70-50*0.8=30`。
- `mainViewportFrameRect({x:0,y:0,scale:1}, 800, 600, {x:10,y:5,scale:0.02})`：主视口可见世界范围是 `{x:0,y:0,width:800,height:600}`（identity 变换）；`worldRectToScreen` 用 `overviewViewport` 转换：`x=0*0.02+10=10,y=5,width=800*0.02=16,height=600*0.02=12`。
- `mainViewportFrameRect({x:-100,y:-50,scale:2}, 800, 600, {x:10,y:5,scale:0.02})`：`screenToWorld({0,0},{x:-100,y:-50,scale:2})=(50,25)`，`screenToWorld({800,600},...)=(450,325)`，世界矩形 `{x:50,y:25,width:400,height:300}`；转屏幕：`x=50*0.02+10=11,y=25*0.02+5=5.5,width=400*0.02=8,height=300*0.02=6`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-overview.test.js`
Expected: FAIL（模块 `../src/minimap/overview.js` 不存在）

- [ ] **Step 3: 实现**

新建 `src/minimap/overview.js`：

```js
// Phase 4 切片 3：Overview 小地图导航。纯函数，不依赖 Vue/DOM。
// 见 docs/superpowers/specs/2026-06-20-phase-4-overview-navigation.md
import { fitViewportToBounds } from './viewport.js'
import { screenToWorld } from './coords.js'
import { worldRectToScreen } from './renderer.js'

// 缩略图自己的"完整显示全部内容"视口变换，不受主视口 minScale/maxScale 限制——
// 缩略图必须永远显示全图，哪怕需要的缩放比例比主视口允许的 minScale 还小。
export function computeOverviewViewport(bounds, width, height, padding = 20) {
  return fitViewportToBounds(bounds, width, height, { minScale: 0, maxScale: Infinity }, padding)
}

// 把主视口当前可见的世界坐标范围，转换成缩略图坐标系下的屏幕矩形（用于画视口框）。
export function mainViewportFrameRect(mainViewport, mainWidth, mainHeight, overviewViewport) {
  const topLeft = screenToWorld({ x: 0, y: 0 }, mainViewport)
  const bottomRight = screenToWorld({ x: mainWidth, y: mainHeight }, mainViewport)
  const worldRect = {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  }
  return worldRectToScreen(worldRect, overviewViewport)
}

// 把一个屏幕矩形裁剪到画布范围内，避免视口框跑出缩略图边界时画出明显越界的线条。
// 只做绘制前的视觉裁剪，不改变调用方持有的真实矩形数据。
export function clampRectToCanvas(rect, width, height) {
  const x = Math.max(0, rect.x)
  const y = Math.max(0, rect.y)
  const right = Math.min(width, rect.x + rect.width)
  const bottom = Math.min(height, rect.y + rect.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-overview.test.js`
Expected: PASS（9 个测试全过）

- [ ] **Step 5: 提交**

```bash
git add src/minimap/overview.js test/minimap-overview.test.js
git commit -m "$(cat <<'EOF'
feat: add overview viewport/frame-rect pure functions

computeOverviewViewport wraps fitViewportToBounds with an unclamped
scale range, since the thumbnail must always show the full content
even when that needs a scale below the main viewport's minScale.
mainViewportFrameRect composes the existing screenToWorld/
worldRectToScreen to map the main viewport's visible world rect into
the thumbnail's own screen coordinates. clampRectToCanvas is a small
drawing-time visual clip so an extremely zoomed-out frame doesn't
draw lines that run off the thumbnail canvas.
EOF
)"
```

---

## Task 2: `Overview.vue` 子组件

**Files:**
- Create: `src/minimap/Overview.vue`
- Test: `test/minimap-overview-ui.test.js`

**Interfaces:**
- Consumes：Task 1 的 `computeOverviewViewport`/`mainViewportFrameRect`/`clampRectToCanvas`；已有的 `screenToWorld`（`./coords.js`）、`worldRectToScreen`（`./renderer.js`）、`defaultTheme`（`./theme.js`，字段 `background`、`node.stroke`、`node.selectedStroke`）。
- Produces：`defineExpose({ render })`，`render({ layout, viewport, mainWidth, mainHeight, theme })` 接受 `layout.bounds`/`layout.visibleItems`（`visibleItems` 元素形状 `{type,id,x,y,width,height}`，跟 `layout.js` 现有输出一致）；`defineEmits(['navigate'])`，payload 是世界坐标点 `{x,y}`。Task 3 会原样使用这两个名字。

- [ ] **Step 1: 写失败测试**

新建 `test/minimap-overview-ui.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv } from './helpers/dom-env.js'
import { stubCanvasContext } from './helpers/canvas-env.js'

installDomEnv()
const contexts = stubCanvasContext()

const { mount } = await import('@vue/test-utils')
const Overview = (await import('../src/minimap/Overview.vue')).default

function dispatchPointer(wrapper, type, point) {
  const canvasEl = wrapper.find('canvas').element
  canvasEl.dispatchEvent(new PointerEvent(type, { clientX: point.x, clientY: point.y, pointerId: 10, bubbles: true }))
}

const layout = {
  bounds: { minX: 0, maxX: 1000, minY: 0, maxY: 500 },
  visibleItems: [
    { type: 'node', id: 'a', x: 0, y: 0, width: 100, height: 50 },
    { type: 'group', id: 'g', x: 200, y: 100, width: 300, height: 200 },
  ],
}

test('render draws the background, one fillRect per visible item, and the viewport frame', () => {
  const wrapper = mount(Overview)
  const ctx = contexts.at(-1)

  wrapper.vm.render({ layout, viewport: { x: 0, y: 0, scale: 1 }, mainWidth: 800, mainHeight: 600 })

  const fillRects = ctx.methodsOf('fillRect')
  assert.equal(fillRects.length, 3)
  assert.deepEqual(fillRects[0].args, [0, 0, 200, 140])
  assert.deepEqual(fillRects[1].args, [20, 30, 16, 8])
  assert.deepEqual(fillRects[2].args, [52, 46, 48, 32])

  const strokeRects = ctx.methodsOf('strokeRect')
  assert.equal(strokeRects.length, 1)
  assert.deepEqual(strokeRects[0].args, [20, 30, 128, 96])
  wrapper.destroy()
})

test('render clips the viewport frame to the canvas bounds when the main viewport is zoomed far out', () => {
  const wrapper = mount(Overview)
  const ctx = contexts.at(-1)

  wrapper.vm.render({ layout, viewport: { x: 0, y: 0, scale: 0.05 }, mainWidth: 800, mainHeight: 600 })

  const strokeRects = ctx.methodsOf('strokeRect')
  assert.equal(strokeRects.length, 1)
  assert.deepEqual(strokeRects[0].args, [20, 30, 180, 110])
  wrapper.destroy()
})

test('pointerdown emits navigate with the world point under the cursor', () => {
  const wrapper = mount(Overview)
  wrapper.vm.render({ layout, viewport: { x: 0, y: 0, scale: 1 }, mainWidth: 800, mainHeight: 600 })

  dispatchPointer(wrapper, 'pointerdown', { x: 40, y: 50 })

  assert.deepEqual(wrapper.emitted('navigate').at(-1)[0], { x: 125, y: 125 })
  wrapper.destroy()
})

test('pointermove while captured keeps emitting navigate with updated points', () => {
  const wrapper = mount(Overview)
  wrapper.vm.render({ layout, viewport: { x: 0, y: 0, scale: 1 }, mainWidth: 800, mainHeight: 600 })

  dispatchPointer(wrapper, 'pointerdown', { x: 40, y: 50 })
  dispatchPointer(wrapper, 'pointermove', { x: 60, y: 70 })

  assert.deepEqual(wrapper.emitted('navigate').at(-1)[0], { x: 250, y: 250 })
  wrapper.destroy()
})

test('pointermove after pointerup no longer emits navigate', () => {
  const wrapper = mount(Overview)
  wrapper.vm.render({ layout, viewport: { x: 0, y: 0, scale: 1 }, mainWidth: 800, mainHeight: 600 })

  dispatchPointer(wrapper, 'pointerdown', { x: 40, y: 50 })
  dispatchPointer(wrapper, 'pointerup', { x: 40, y: 50 })
  const countAfterUp = wrapper.emitted('navigate').length
  dispatchPointer(wrapper, 'pointermove', { x: 60, y: 70 })

  assert.equal(wrapper.emitted('navigate').length, countAfterUp)
  wrapper.destroy()
})

test('pointerdown before any render() call uses the identity viewport', () => {
  const wrapper = mount(Overview)

  dispatchPointer(wrapper, 'pointerdown', { x: 40, y: 50 })

  assert.deepEqual(wrapper.emitted('navigate').at(-1)[0], { x: 40, y: 50 })
  wrapper.destroy()
})
```

数值推导（供核对）：
- `layout.bounds={minX:0,maxX:1000,minY:0,maxY:500}` → `computeOverviewViewport(bounds,200,140)`：`rawScale=min(160/1000,100/500)=min(0.16,0.2)=0.16`；`centerX=500,centerY=250`；`x=100-500*0.16=20,y=70-250*0.16=30` → `overviewViewport={x:20,y:30,scale:0.16}`。
- 节点 `a` `{x:0,y:0,width:100,height:50}` → `worldRectToScreen` 得 `{x:20,y:30,width:16,height:8}`。
- 分组 `g` `{x:200,y:100,width:300,height:200}` → `{x:52,y:46,width:48,height:32}`。
- 主视口 `{x:0,y:0,scale:1}`、`mainWidth=800,mainHeight=600` → 可见世界范围 `{x:0,y:0,width:800,height:600}` → 转屏幕 `{x:20,y:30,width:128,height:96}`（128/96 都小于 200/140，不需要裁剪）。
- 主视口 `{x:0,y:0,scale:0.05}`（明显缩得比全图还广）→ 可见世界范围 `{x:0,y:0,width:16000,height:12000}` → 转屏幕 `{x:20,y:30,width:2560,height:1920}` → `clampRectToCanvas` 裁到 `{x:20,y:30,width:180,height:110}`（`200-20=180`，`140-30=110`）。
- `pointerdown` 在屏幕点 `(40,50)`：`screenToWorld({40,50},{x:20,y:30,scale:0.16})=((40-20)/0.16,(50-30)/0.16)=(125,125)`。
- 紧接着 `pointermove` 到 `(60,70)`：`((60-20)/0.16,(70-30)/0.16)=(250,250)`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-overview-ui.test.js`
Expected: FAIL（模块 `../src/minimap/Overview.vue` 不存在）

- [ ] **Step 3: 实现**

新建 `src/minimap/Overview.vue`：

```vue
<script setup>
// Phase 4 切片 3：Overview 小地图导航子组件。无 props，所有绘制数据通过
// 暴露的 render() 方法实时传入——跟 Minimap.vue 主画布一样，渲染是命令式的，
// 不挂 Vue 响应式 watch，由父组件在自己的 renderCurrent() 里显式调用。
// 固定尺寸 200×140px，不随容器变化，不需要 ResizeObserver。
// 见 docs/superpowers/specs/2026-06-20-phase-4-overview-navigation.md
import { ref, onMounted, onUnmounted } from 'vue'
import { screenToWorld } from './coords.js'
import { worldRectToScreen } from './renderer.js'
import { defaultTheme } from './theme.js'
import { computeOverviewViewport, mainViewportFrameRect, clampRectToCanvas } from './overview.js'

const OVERVIEW_WIDTH = 200
const OVERVIEW_HEIGHT = 140

const emit = defineEmits(['navigate'])

const canvasRef = ref(null)

let ctx = null
let dragging = false
let lastOverviewViewport = { x: 0, y: 0, scale: 1 }

function syncCanvasSize() {
  const canvas = canvasRef.value
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(OVERVIEW_WIDTH * dpr))
  canvas.height = Math.max(1, Math.round(OVERVIEW_HEIGHT * dpr))
  canvas.style.width = `${OVERVIEW_WIDTH}px`
  canvas.style.height = `${OVERVIEW_HEIGHT}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function pointFromEvent(event) {
  const rect = canvasRef.value.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function navigateFromScreenPoint(screenPoint) {
  emit('navigate', screenToWorld(screenPoint, lastOverviewViewport))
}

function handlePointerDown(event) {
  dragging = true
  canvasRef.value.setPointerCapture?.(event.pointerId)
  navigateFromScreenPoint(pointFromEvent(event))
}

function handlePointerMove(event) {
  if (!dragging) return
  navigateFromScreenPoint(pointFromEvent(event))
}

function handlePointerUp() {
  dragging = false
}

function render({ layout, viewport, mainWidth, mainHeight, theme = defaultTheme }) {
  if (!ctx) return
  ctx.clearRect(0, 0, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)

  const overviewViewport = computeOverviewViewport(layout.bounds, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)
  lastOverviewViewport = overviewViewport

  ctx.fillStyle = theme.node.stroke
  for (const item of layout.visibleItems) {
    const rect = worldRectToScreen(item, overviewViewport)
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  }

  const frame = mainViewportFrameRect(viewport, mainWidth, mainHeight, overviewViewport)
  const clipped = clampRectToCanvas(frame, OVERVIEW_WIDTH, OVERVIEW_HEIGHT)
  ctx.strokeStyle = theme.node.selectedStroke
  ctx.lineWidth = 1.5
  ctx.strokeRect(clipped.x, clipped.y, clipped.width, clipped.height)
}

defineExpose({ render })

onMounted(() => {
  const canvas = canvasRef.value
  ctx = canvas.getContext('2d')
  syncCanvasSize()
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('pointercancel', handlePointerUp)
  canvas.addEventListener('lostpointercapture', handlePointerUp)
})

onUnmounted(() => {
  const canvas = canvasRef.value
  if (canvas) {
    canvas.removeEventListener('pointerdown', handlePointerDown)
    canvas.removeEventListener('pointermove', handlePointerMove)
    canvas.removeEventListener('pointerup', handlePointerUp)
    canvas.removeEventListener('pointercancel', handlePointerUp)
    canvas.removeEventListener('lostpointercapture', handlePointerUp)
  }
})
</script>

<template>
  <canvas ref="canvasRef"></canvas>
</template>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-overview-ui.test.js`
Expected: PASS（6 个测试全过）

- [ ] **Step 5: 跑全量测试确认没有破坏其它文件**

Run: `npm test`
Expected: PASS（基线 233 + Task 1 的 9 个 + 本任务的 6 个 = 248）

- [ ] **Step 6: 提交**

```bash
git add src/minimap/Overview.vue test/minimap-overview-ui.test.js
git commit -m "$(cat <<'EOF'
feat: add Overview.vue thumbnail navigator component

No Vue props — render({ layout, viewport, mainWidth, mainHeight,
theme }) is exposed for the parent to call imperatively, matching
how the main canvas itself renders outside Vue's reactivity. Pointer
gestures (down + move-while-captured) emit 'navigate' with a world
point; clicking anywhere pans there, holding and dragging follows
continuously, mirroring the main canvas's existing blank-area pan.
EOF
)"
```

---

## Task 3: `Minimap.vue` 集成

**Files:**
- Modify: `src/minimap/Minimap.vue`
- Test (new): `test/minimap-overview-integration.test.js`

**Interfaces:**
- Consumes：Task 2 的 `Overview.vue`（导入后用作 `<Overview>`，`defineExpose` 的 `render`、`defineEmits` 的 `navigate`）；已有的 `centerViewportOn`（`./viewport.js`）、`applyViewport`、`currentViewport`、`cssWidth`/`cssHeight`（均已在 `Minimap.vue` 内部定义）。
- Produces：无新的 `defineExpose` 方法（这个切片不需要新的公开可编程方法）；模板新增 `<Overview>`，样式新增 `.minimap-overview`。

- [ ] **Step 1: 写失败测试**

新建 `test/minimap-overview-integration.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubAnimationFrame, stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout } from '../src/minimap/layout.js'
import { centerViewportOn } from '../src/minimap/viewport.js'
import { computeOverviewViewport, mainViewportFrameRect, clampRectToCanvas } from '../src/minimap/overview.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default
const Overview = (await import('../src/minimap/Overview.vue')).default

function settle() {
  frames.runNext(0)
  frames.runNext(200)
}

function referenceLayout() {
  return computeLayout(createDemoGraph(), { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
}

// Vue 先挂载子组件再触发父组件自己的 onMounted，所以紧跟在 mount(Minimap) 之后，
// contexts 数组里倒数第二个 ctx 属于 Overview 的画布，最后一个才是主画布。
function overviewCtxFor() {
  const ctx = contexts.at(-2)
  assert.equal(ctx.methodsOf('fillText').length, 0, '取到的应该是 Overview 的 ctx（不画文字），不是主画布')
  return ctx
}

test('navigating from the overview pans the main viewport and preserves scale', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  settle()

  wrapper.findComponent(Overview).vm.$emit('navigate', { x: 123, y: 456 })

  const expected = centerViewportOn({ x: 123, y: 456 }, { x: 0, y: 0, scale: 1 }, 800, 600)
  assert.deepEqual(wrapper.vm.getViewport(), expected)
  assert.deepEqual(wrapper.emitted('viewport-change').at(-1)[0], expected)
  wrapper.destroy()
})

test('controlled viewport: navigating from the overview only emits, never mutates the rendered viewport', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, viewport: { x: 0, y: 0, scale: 1 } } })
  settle()

  wrapper.findComponent(Overview).vm.$emit('navigate', { x: 123, y: 456 })

  const expected = centerViewportOn({ x: 123, y: 456 }, { x: 0, y: 0, scale: 1 }, 800, 600)
  assert.deepEqual(wrapper.emitted('viewport-change').at(-1)[0], expected)
  assert.deepEqual(wrapper.vm.getViewport(), { x: 0, y: 0, scale: 1 })
  wrapper.destroy()
})

test('renderCurrent feeds the overview the live layout/viewport so its frame tracks setViewport', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  settle()
  const ctx = overviewCtxFor()

  wrapper.vm.setViewport({ x: 0, y: 0, scale: 2 })

  const bounds = referenceLayout().bounds
  const overviewViewport = computeOverviewViewport(bounds, 200, 140)
  const frame = mainViewportFrameRect({ x: 0, y: 0, scale: 2 }, 800, 600, overviewViewport)
  const expected = clampRectToCanvas(frame, 200, 140)
  const strokeRects = ctx.methodsOf('strokeRect')
  assert.deepEqual(strokeRects.at(-1).args, [expected.x, expected.y, expected.width, expected.height])
  wrapper.destroy()
})

test('options.enableOverview false hides the overview', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, options: { enableOverview: false } } })
  settle()

  assert.equal(wrapper.findComponent(Overview).exists(), false)
  wrapper.destroy()
})

test('options.enableOverview defaults to true', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })
  settle()

  assert.equal(wrapper.findComponent(Overview).exists(), true)
  wrapper.destroy()
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-overview-integration.test.js`
Expected: FAIL（`wrapper.findComponent(Overview)` 找不到组件 / `Overview` 未被 `Minimap.vue` 使用）

- [ ] **Step 3: 实现**

在 `src/minimap/Minimap.vue` 做以下 6 处修改：

**3a. 新增 import。** 把

```js
import { searchNodes } from './search.js'
import ResourceTree from './ResourceTree.vue'
```

改成

```js
import { searchNodes } from './search.js'
import Overview from './Overview.vue'
import ResourceTree from './ResourceTree.vue'
```

**3b. 新增 `overviewRef`。** 把

```js
const containerRef = ref(null)
const canvasRef = ref(null)
const searchKeyword = ref('')
const searchMatches = ref([])
const searchCurrentIndex = ref(-1)
```

改成

```js
const containerRef = ref(null)
const canvasRef = ref(null)
const overviewRef = ref(null)
const searchKeyword = ref('')
const searchMatches = ref([])
const searchCurrentIndex = ref(-1)
```

**3c. `renderCurrent()` 末尾追加 overview 渲染调用。** 把

```js
function renderCurrent(currentLayout = layout, renderViewport = currentViewport()) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...renderViewport }
  const relations = buildSelectionRelations(props.graph, currentLayout, currentSelectedIds())
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
      highlightedIds: relations.highlightedIds,
      dimmedIds: relations.dimmedIds,
      highlightedEdgeIds: relations.highlightedEdgeIds,
      dimmedEdgeIds: relations.dimmedEdgeIds,
      groupDrag: dragRenderContext(),
      groupScrollbarHoverId: hoveredScrollbarGroupId,
      selectionRect: marqueeState?.active ? normalizeRect(marqueeState.rect) : null,
    },
    renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
  })
}
```

改成

```js
function renderCurrent(currentLayout = layout, renderViewport = currentViewport()) {
  if (!ctx || !currentLayout) return
  lastRenderedLayout = currentLayout
  lastRenderedViewport = { ...renderViewport }
  const relations = buildSelectionRelations(props.graph, currentLayout, currentSelectedIds())
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
      highlightedIds: relations.highlightedIds,
      dimmedIds: relations.dimmedIds,
      highlightedEdgeIds: relations.highlightedEdgeIds,
      dimmedEdgeIds: relations.dimmedEdgeIds,
      groupDrag: dragRenderContext(),
      groupScrollbarHoverId: hoveredScrollbarGroupId,
      selectionRect: marqueeState?.active ? normalizeRect(marqueeState.rect) : null,
    },
    renderers: { node: props.nodeRenderer, group: props.groupRenderer, edge: props.edgeRenderer },
  })
  overviewRef.value?.render({
    layout: currentLayout,
    viewport: renderViewport,
    mainWidth: cssWidth,
    mainHeight: cssHeight,
    theme: props.theme || defaultTheme,
  })
}
```

**3d. 新增 `handleOverviewNavigate`。** 把（这是文件里已有的 `searchPrevious`/`defineExpose` 那一段，本任务只在两者之间插入新内容，不改 `defineExpose` 本身）

```js
function searchPrevious() {
  if (searchMatches.value.length === 0) return
  const length = searchMatches.value.length
  searchCurrentIndex.value = (searchCurrentIndex.value - 1 + length) % length
  const id = searchMatches.value[searchCurrentIndex.value]
  jumpToSearchResult(id)
  emit('search', { keyword: searchKeyword.value, matches: searchMatches.value, current: id })
}

defineExpose({
```

改成

```js
function searchPrevious() {
  if (searchMatches.value.length === 0) return
  const length = searchMatches.value.length
  searchCurrentIndex.value = (searchCurrentIndex.value - 1 + length) % length
  const id = searchMatches.value[searchCurrentIndex.value]
  jumpToSearchResult(id)
  emit('search', { keyword: searchKeyword.value, matches: searchMatches.value, current: id })
}

function handleOverviewNavigate(worldPoint) {
  applyViewport(centerViewportOn(worldPoint, currentViewport(), cssWidth, cssHeight))
}

defineExpose({
```

**3e. 模板新增 `<Overview>`。** 把

```html
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

改成

```html
        <button
          class="minimap-search-btn minimap-search-next"
          :disabled="searchMatches.length === 0"
          @click="searchNext"
        >
          ›
        </button>
      </div>
      <Overview
        v-if="options?.enableOverview !== false"
        ref="overviewRef"
        class="minimap-overview"
        @navigate="handleOverviewNavigate"
      />
    </div>
  </div>
</template>
```

**3f. 样式新增 `.minimap-overview`。** 把

```css
.minimap-search-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
```

改成

```css
.minimap-search-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.minimap-overview {
  position: absolute;
  bottom: 8px;
  right: 8px;
  border: 1px solid #1b2530;
  border-radius: 4px;
  overflow: hidden;
}
.minimap-overview canvas {
  display: block;
  cursor: pointer;
}
</style>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import ./test/helpers/register-vue-sfc-loader.js --test test/minimap-overview-integration.test.js`
Expected: PASS（5 个测试全过）

- [ ] **Step 5: 跑全量测试确认没有破坏其它文件**

Run: `npm test`
Expected: PASS（基线 233 + Task 1 的 9 个 + Task 2 的 6 个 + 本任务的 5 个 = 253）

- [ ] **Step 6: 提交**

```bash
git add src/minimap/Minimap.vue test/minimap-overview-integration.test.js
git commit -m "$(cat <<'EOF'
feat: wire Overview into Minimap.vue's render loop and viewport

renderCurrent() now also calls the Overview child's render() with the
same layout/viewport/size it just used for the main canvas, so the
thumbnail and its frame stay in lockstep with every pan/zoom/layout
change for free. The overview's 'navigate' event reuses centerViewportOn
+ applyViewport directly (no tween), matching the main canvas's
existing blank-area pan, and automatically respects controlled-viewport
semantics since applyViewport already does. options.enableOverview
(default true) gates whether the child mounts at all.
EOF
)"
```

---

## Task 4: 回归校验 + ROADMAP 同步

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes：无新接口。
- Produces：无（文档收尾）。

- [ ] **Step 1: 跑全量测试**

Run: `npm test`
Expected: PASS，全部测试通过（基线 233 + Task 1/2/3 新增的 20 个 = 253）。记录最终测试数到 ROADMAP。

- [ ] **Step 2: 跑构建**

Run: `npm run build`
Expected: 构建成功，无报错。

- [ ] **Step 3: 更新 `ROADMAP.md` 的「路线图进度」**

把

```
- [ ] 第四阶段：导航和查找能力
```

改成

```
- [x] 第四阶段：导航和查找能力
```

- [ ] **Step 4: 更新 `ROADMAP.md` 的「当前进度」块**

把

```
- **当前阶段**：第四阶段（导航和查找能力）—— 切片 1、2 已完成，待规划切片 3
- **当前阶段 Spec**：切片 1 [视图定位方法](docs/superpowers/specs/2026-06-20-phase-4-view-positioning.md)、切片 2 [搜索节点](docs/superpowers/specs/2026-06-20-phase-4-search-nodes.md) 已完成；切片 3 待创建
- **当前阶段计划**：切片 1 [视图定位方法](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md)、切片 2 [搜索节点](docs/superpowers/plans/2026-06-20-phase-4-search-nodes.md) 已完成；切片 3 待创建
```

改成（`<N>` 替换成 Step 1 实际跑出来的测试总数）

```
- **当前阶段**：第四阶段（导航和查找能力）—— 已全部完成，待规划第五阶段
- **当前阶段 Spec**：切片 1 [视图定位方法](docs/superpowers/specs/2026-06-20-phase-4-view-positioning.md)、切片 2 [搜索节点](docs/superpowers/specs/2026-06-20-phase-4-search-nodes.md)、切片 3 [Overview 小地图导航](docs/superpowers/specs/2026-06-20-phase-4-overview-navigation.md) 均已完成
- **当前阶段计划**：切片 1 [视图定位方法](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md)、切片 2 [搜索节点](docs/superpowers/plans/2026-06-20-phase-4-search-nodes.md)、切片 3 [Overview 小地图导航](docs/superpowers/plans/2026-06-20-phase-4-overview-navigation.md) 均已完成
```

并在「已完成切片」列表末尾追加一行（紧跟在搜索节点那一行后面）：

```
  - Overview 小地图导航 `overview.js` 缩略图视口变换 + 视口框坐标转换 + 视觉裁剪 + `Overview.vue` 独立子组件（命令式 `render()`，无 props） + `Minimap.vue` 接入（`renderCurrent()` 联动绘制、`navigate` 事件联动主视口、`options.enableOverview` 开关） + 测试（[plan](docs/superpowers/plans/2026-06-20-phase-4-overview-navigation.md)，`npm test` <N> 全过，`npm run build` 通过；UI 用 jsdom + mock canvas ctx + Vue Test Utils 真实组件事件覆盖，没有真实浏览器可用，未做人工目测）
```

把

```
- **第四阶段切片**（overview 是独立 mini canvas 子组件，跟前两个切片的视口数学性质不同，拆开做；切片 3 会复用切片 1 的 `centerOnNode`/视口补动能力）：
  - [x] 切片 1：视图定位方法（`viewport.js`/`layout.js`/`selection.js` 纯函数 + `Minimap.vue` 首次 `defineExpose`：`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport`/`select`/`clearSelection`；[plan](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md)，`npm test` 214 全过，`npm run build` 通过）
  - [x] 切片 2：搜索节点（`search.js` + `Minimap.vue` 内建搜索框，复用切片 1 的 `centerOnNode`/`select` 跳转和高亮；[plan](docs/superpowers/plans/2026-06-20-phase-4-search-nodes.md)，`npm test` 233 全过，`npm run build` 通过）
  - [ ] 切片 3：Overview 小地图导航（独立 mini canvas 子组件，缩略图 + 视口框拖拽导航）
- **下一步**：开始第四阶段切片 3（Overview 小地图导航）的 brainstorm 和 spec。
```

改成

```
- **第四阶段切片**（overview 是独立 mini canvas 子组件，跟前两个切片的视口数学性质不同，拆开做）：
  - [x] 切片 1：视图定位方法（`viewport.js`/`layout.js`/`selection.js` 纯函数 + `Minimap.vue` 首次 `defineExpose`：`fitToScreen`/`centerOnNode`/`centerOnSelection`/`zoomTo`/`setViewport`/`getViewport`/`select`/`clearSelection`；[plan](docs/superpowers/plans/2026-06-20-phase-4-view-positioning.md)，`npm test` 214 全过，`npm run build` 通过）
  - [x] 切片 2：搜索节点（`search.js` + `Minimap.vue` 内建搜索框，复用切片 1 的 `centerOnNode`/`select` 跳转和高亮；[plan](docs/superpowers/plans/2026-06-20-phase-4-search-nodes.md)，`npm test` 233 全过，`npm run build` 通过）
  - [x] 切片 3：Overview 小地图导航（独立子组件 `Overview.vue`，命令式渲染 + `navigate` 事件联动主视口；[plan](docs/superpowers/plans/2026-06-20-phase-4-overview-navigation.md)，`npm test` <N> 全过，`npm run build` 通过）
- **下一步**：开始第五阶段（编辑和状态能力）的 brainstorm 和 spec。
```

- [ ] **Step 5: 把本 plan 文件顶部的「进度」checklist 4 项全部勾上**

把文件开头的

```
- [ ] Task 1：`overview.js` 三个纯函数
- [ ] Task 2：`Overview.vue` 子组件
- [ ] Task 3：`Minimap.vue` 集成
- [ ] Task 4：回归校验 + ROADMAP 同步
```

改成全部 `- [x]`。

- [ ] **Step 6: 提交**

```bash
git add ROADMAP.md docs/superpowers/plans/2026-06-20-phase-4-overview-navigation.md
git commit -m "$(cat <<'EOF'
docs: mark Phase 4 complete (slice 3: overview navigation)

npm test/npm run build both green; all three Phase 4 slices (view
positioning, search nodes, overview navigation) are now done, so the
roadmap's Phase 4 checkbox is ticked and the next-step pointer moves
to Phase 5 (editing and state capabilities).
EOF
)"
```
