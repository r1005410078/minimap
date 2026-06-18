import test from 'node:test'
import assert from 'node:assert/strict'
import { orthogonalPath } from '../src/minimap/orthogonal.js'

test('orthogonalPath routes left-to-right boxes as horizontal-vertical-horizontal', () => {
  const from = { x: 0, y: 20, width: 100, height: 40 }
  const to = { x: 220, y: 100, width: 120, height: 40 }

  assert.deepEqual(orthogonalPath(from, to, 'x'), [
    { x: 100, y: 40 },
    { x: 160, y: 40 },
    { x: 160, y: 120 },
    { x: 220, y: 120 },
  ])
})

test('orthogonalPath routes right-to-left boxes toward each other', () => {
  const from = { x: 300, y: 20, width: 100, height: 40 }
  const to = { x: 40, y: 100, width: 120, height: 40 }

  assert.deepEqual(orthogonalPath(from, to, 'x'), [
    { x: 300, y: 40 },
    { x: 230, y: 40 },
    { x: 230, y: 120 },
    { x: 160, y: 120 },
  ])
})

test('orthogonalPath falls back to cross-axis routing when main-axis intervals overlap', () => {
  const from = { x: 100, y: 20, width: 100, height: 40 }
  const to = { x: 130, y: 120, width: 120, height: 40 }

  assert.deepEqual(orthogonalPath(from, to, 'x'), [
    { x: 150, y: 60 },
    { x: 150, y: 90 },
    { x: 190, y: 90 },
    { x: 190, y: 120 },
  ])
})

test('orthogonalPath keeps tied overlap routing outside both boxes on the horizontal axis', () => {
  const from = { x: 0, y: 0, width: 100, height: 100 }
  const to = { x: 50, y: 0, width: 100, height: 100 }

  assert.deepEqual(orthogonalPath(from, to, 'x'), [
    { x: 50, y: 100 },
    { x: 50, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 100 },
  ])
})

test('orthogonalPath treats touching main-axis intervals as overlap', () => {
  const from = { x: 0, y: 100, width: 100, height: 40 }
  const to = { x: 100, y: 20, width: 120, height: 40 }

  assert.deepEqual(orthogonalPath(from, to, 'x'), [
    { x: 50, y: 100 },
    { x: 50, y: 80 },
    { x: 160, y: 80 },
    { x: 160, y: 60 },
  ])
})

test('orthogonalPath routes top-to-bottom boxes as vertical-horizontal-vertical', () => {
  const from = { x: 20, y: 0, width: 100, height: 40 }
  const to = { x: 160, y: 180, width: 100, height: 40 }

  assert.deepEqual(orthogonalPath(from, to, 'y'), [
    { x: 70, y: 40 },
    { x: 70, y: 110 },
    { x: 210, y: 110 },
    { x: 210, y: 180 },
  ])
})

test('orthogonalPath keeps tied overlap routing outside both boxes on the vertical axis', () => {
  const from = { x: 0, y: 0, width: 100, height: 100 }
  const to = { x: 0, y: 50, width: 100, height: 100 }

  assert.deepEqual(orthogonalPath(from, to, 'y'), [
    { x: 100, y: 50 },
    { x: 100, y: 50 },
    { x: 100, y: 100 },
    { x: 100, y: 100 },
  ])
})

test('orthogonalPath gives siblings of the same parent a shared spine coordinate', () => {
  const parent = { x: 0, y: 100, width: 120, height: 40 }
  const childA = { x: 240, y: 40, width: 120, height: 40 }
  const childB = { x: 240, y: 180, width: 120, height: 40 }

  const pathA = orthogonalPath(parent, childA, 'x')
  const pathB = orthogonalPath(parent, childB, 'x')

  assert.equal(pathA[1].x, pathB[1].x)
  assert.equal(pathA[2].x, pathB[2].x)
  assert.equal(pathA[1].x, 180)
})
