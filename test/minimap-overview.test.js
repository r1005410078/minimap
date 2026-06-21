import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_VIEWPORT } from '../src/minimap/coords/viewport.js'
import { computeOverviewViewport, mainViewportFrameRect, clampRectToCanvas } from '../src/minimap/render/overview.js'

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
