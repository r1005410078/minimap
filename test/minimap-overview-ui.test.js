import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv } from './helpers/dom-env.js'
import { stubCanvasContext } from './helpers/canvas-env.js'

installDomEnv()
const contexts = stubCanvasContext()

const { mount } = await import('@vue/test-utils')
const Overview = (await import('../src/minimap/components/Overview.vue')).default

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
