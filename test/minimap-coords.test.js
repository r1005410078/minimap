import test from 'node:test'
import assert from 'node:assert/strict'
import { worldToScreen, screenToWorld } from '../src/minimap/coords.js'

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
