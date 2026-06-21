import test from 'node:test'
import assert from 'node:assert/strict'
import { screenToWorld } from '../src/minimap/coords/coords.js'
import { easeOutCubic } from '../src/minimap/graph/layout-transition.js'
import {
  DEFAULT_VIEWPORT,
  centerViewportOn,
  clampScale,
  fitViewportToBounds,
  normalizeViewport,
  panViewportBy,
  sameViewport,
  tweenViewport,
  viewportOptions,
  zoomViewportAt,
} from '../src/minimap/coords/viewport.js'

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

test('panViewportBy preserves scale allowed by custom options', () => {
  assert.deepEqual(
    panViewportBy({ x: 10, y: -5, scale: 5 }, { x: 30, y: -20 }, { minScale: 0.1, maxScale: 10 }),
    {
      x: 40,
      y: -25,
      scale: 5,
    },
  )
})

test('sameViewport compares x y and scale', () => {
  assert.equal(sameViewport({ x: 0, y: 0, scale: 1 }, { x: 0, y: 0, scale: 1 }), true)
  assert.equal(sameViewport({ x: 0, y: 0, scale: 1 }, { x: 0, y: 1, scale: 1 }), false)
})

test('tweenViewport eases x/y/scale independently from progress 0 to 1', () => {
  const from = { x: 0, y: 0, scale: 1 }
  const to = { x: 100, y: 200, scale: 2 }
  assert.deepEqual(tweenViewport(from, to, 0), { x: 0, y: 0, scale: 1 })
  assert.deepEqual(tweenViewport(from, to, 1), { x: 100, y: 200, scale: 2 })
  const mid = tweenViewport(from, to, 0.5)
  const eased = easeOutCubic(0.5)
  assertApprox(mid.x, 100 * eased)
  assertApprox(mid.y, 200 * eased)
  assertApprox(mid.scale, 1 + eased)
})

test('fitViewportToBounds fits content with 40px padding and clamps scale to options', () => {
  const bounds = { minX: 0, maxX: 200, minY: 0, maxY: 100 }
  const result = fitViewportToBounds(bounds, 800, 600, { minScale: 0.25, maxScale: 3 })
  assert.deepEqual(result, { x: 100, y: 150, scale: 3 })
})

test('fitViewportToBounds keeps the natural fit scale when it is within min/max', () => {
  const bounds = { minX: 0, maxX: 480, minY: 0, maxY: 260 }
  const result = fitViewportToBounds(bounds, 800, 600, { minScale: 0.25, maxScale: 3 })
  assert.deepEqual(result, { x: 40, y: 105, scale: 1.5 })
})

test('fitViewportToBounds falls back to DEFAULT_VIEWPORT for degenerate bounds', () => {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  assert.deepEqual(fitViewportToBounds(bounds, 800, 600, null), DEFAULT_VIEWPORT)
})

test('centerViewportOn pans to put worldPoint at screen center and preserves scale', () => {
  const result = centerViewportOn({ x: 50, y: 30 }, { x: 10, y: 20, scale: 2 }, 800, 600)
  assert.deepEqual(result, { x: 300, y: 240, scale: 2 })
})
