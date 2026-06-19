import test from 'node:test'
import assert from 'node:assert/strict'
import { screenToWorld } from '../src/minimap/coords.js'
import {
  DEFAULT_VIEWPORT,
  clampScale,
  normalizeViewport,
  panViewportBy,
  sameViewport,
  viewportOptions,
  zoomViewportAt,
} from '../src/minimap/viewport.js'

function assertApprox(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)
}

test('viewportOptions returns defaults and accepts overrides', () => {
  assert.deepEqual(viewportOptions(null), { minScale: 0.25, maxScale: 3, zoomSensitivity: 0.0015 })
  assert.deepEqual(viewportOptions({ minScale: 0.5, maxScale: 2, zoomSensitivity: 0.002 }), {
    minScale: 0.5,
    maxScale: 2,
    zoomSensitivity: 0.002,
  })
})

test('normalizeViewport fills missing values and clamps scale', () => {
  assert.deepEqual(normalizeViewport(null), DEFAULT_VIEWPORT)
  assert.deepEqual(normalizeViewport({ x: 12 }), { x: 12, y: 0, scale: 1 })
  assert.deepEqual(normalizeViewport({ x: 1, y: 2, scale: 10 }, { minScale: 0.5, maxScale: 2 }), {
    x: 1,
    y: 2,
    scale: 2,
  })
})

test('clampScale respects min and max bounds even if options are reversed', () => {
  assert.equal(clampScale(0.1, { minScale: 0.25, maxScale: 3 }), 0.25)
  assert.equal(clampScale(5, { minScale: 0.25, maxScale: 3 }), 3)
  assert.equal(clampScale(0.1, { minScale: 3, maxScale: 0.25 }), 0.25)
})

test('zoomViewportAt keeps the cursor world point stable', () => {
  const beforeViewport = { x: -100, y: 50, scale: 1 }
  const screenPoint = { x: 300, y: 240 }
  const beforeWorld = screenToWorld(screenPoint, beforeViewport)
  const next = zoomViewportAt(beforeViewport, screenPoint, -200, {
    minScale: 0.25,
    maxScale: 3,
    zoomSensitivity: 0.0015,
  })
  const afterWorld = screenToWorld(screenPoint, next)

  assert.ok(next.scale > beforeViewport.scale)
  assertApprox(afterWorld.x, beforeWorld.x)
  assertApprox(afterWorld.y, beforeWorld.y)
})

test('zoomViewportAt clamps scale at both boundaries', () => {
  const point = { x: 100, y: 100 }
  assert.equal(zoomViewportAt({ x: 0, y: 0, scale: 2.9 }, point, -1000, { minScale: 0.25, maxScale: 3 }).scale, 3)
  assert.equal(zoomViewportAt({ x: 0, y: 0, scale: 0.3 }, point, 1000, { minScale: 0.25, maxScale: 3 }).scale, 0.25)
})

test('panViewportBy offsets x and y without changing scale', () => {
  assert.deepEqual(panViewportBy({ x: 10, y: -5, scale: 2 }, { x: 30, y: -20 }), {
    x: 40,
    y: -25,
    scale: 2,
  })
})

test('sameViewport compares x y and scale', () => {
  assert.equal(sameViewport({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0, scale: 1 }), true)
  assert.equal(sameViewport({ x: 0, y: 0, scale: 1 }, { x: 0, y: 1, scale: 1 }), false)
})
