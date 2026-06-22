import test from 'node:test'
import assert from 'node:assert/strict'
import { worldToScreen, screenToWorld, screenRectToWorld } from '../src/minimap/coords/coords.js'

test('worldToScreen applies viewport scale and offset', () => {
  const viewport = { x: -10, y: 5, scale: 2 }
  assert.deepEqual(worldToScreen({ x: 30, y: 40 }, viewport), { x: 50, y: 85 })
})

test('screenToWorld is the inverse of worldToScreen', () => {
  const viewport = { x: -10, y: 5, scale: 2 }
  const world = { x: 30, y: 40 }
  const screen = worldToScreen(world, viewport)
  assert.deepEqual(screenToWorld(screen, viewport), world)
})

test('screenRectToWorld converts a screen rect to world space using viewport scale and offset', () => {
  const viewport = { x: -10, y: 5, scale: 2 }
  assert.deepEqual(screenRectToWorld({ x: 50, y: 85, width: 60, height: 80 }, viewport), {
    x: 30, y: 40, width: 30, height: 40,
  })
})

test('screenRectToWorld normalizes a rect with negative width or height', () => {
  const viewport = { x: 0, y: 0, scale: 1 }
  assert.deepEqual(screenRectToWorld({ x: 100, y: 100, width: -50, height: -20 }, viewport), {
    x: 50, y: 80, width: 50, height: 20,
  })
})
