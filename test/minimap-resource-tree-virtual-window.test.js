import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveVirtualWindow } from '../src/minimap/resource-tree/virtual-window.js'

test('resolveVirtualWindow renders the top window with normal overscan', () => {
  assert.deepEqual(resolveVirtualWindow({
    rowCount: 1000,
    rowHeight: 28,
    viewportHeight: 280,
    scrollTop: 0,
  }), {
    start: 0,
    end: 30,
    offsetY: 0,
    totalHeight: 28000,
    overscan: 20,
  })
})

test('resolveVirtualWindow computes a middle window in O(1) fixed-row math', () => {
  assert.deepEqual(resolveVirtualWindow({
    rowCount: 1000,
    rowHeight: 28,
    viewportHeight: 280,
    scrollTop: 2800,
  }), {
    start: 80,
    end: 130,
    offsetY: 2240,
    totalHeight: 28000,
    overscan: 20,
  })
})

test('resolveVirtualWindow clamps near the bottom', () => {
  const window = resolveVirtualWindow({
    rowCount: 100,
    rowHeight: 30,
    viewportHeight: 300,
    scrollTop: 99999,
  })

  assert.equal(window.start, 70)
  assert.equal(window.end, 100)
  assert.equal(window.offsetY, 2100)
})

test('resolveVirtualWindow expands overscan for large scroll jumps', () => {
  const window = resolveVirtualWindow({
    rowCount: 10000,
    rowHeight: 28,
    viewportHeight: 280,
    scrollTop: 140000,
    previousScrollTop: 0,
  })

  assert.equal(window.overscan, 100)
  assert.equal(window.start, 4900)
  assert.equal(window.end, 5110)
})

test('resolveVirtualWindow returns an empty stable window for no rows', () => {
  assert.deepEqual(resolveVirtualWindow({
    rowCount: 0,
    rowHeight: 28,
    viewportHeight: 280,
    scrollTop: 100,
  }), {
    start: 0,
    end: 0,
    offsetY: 0,
    totalHeight: 0,
    overscan: 20,
  })
})
