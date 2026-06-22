import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSpatialIndex, queryPoint, queryRect, getSpatialIndex } from '../src/minimap/interaction/spatial-index.js'

// 默认网格 256x128；三个 item 故意分散到互不相邻的网格单元，
// 用来验证查询只命中各自所在的 bucket，不会漏检或跨格误检。
function sampleLayout() {
  return {
    visibleItems: [
      { type: 'node', id: 'origin-node', x: 0, y: 0, width: 100, height: 40 },
      { type: 'group', id: 'mid-group', x: 500, y: 500, width: 200, height: 200 },
      { type: 'node', id: 'far-node', x: 2000, y: 1500, width: 100, height: 40 },
    ],
  }
}

test('buildSpatialIndex buckets items by the grid cells their rect overlaps', () => {
  const index = buildSpatialIndex(sampleLayout())
  // mid-group 横跨 x:500-700 (col 1..2), y:500-700 (row 3..5)
  assert.ok(index.buckets.get('1:3').some((item) => item.id === 'mid-group'))
  assert.ok(index.buckets.get('2:5').some((item) => item.id === 'mid-group'))
  assert.equal(index.buckets.has('0:0'), true)
  assert.equal(index.buckets.get('0:0').length, 1)
})

test('queryPoint returns the item containing the point', () => {
  const index = buildSpatialIndex(sampleLayout())
  assert.deepEqual(queryPoint(index, { x: 50, y: 20 }), {
    type: 'node', id: 'origin-node', x: 0, y: 0, width: 100, height: 40,
  })
  assert.deepEqual(queryPoint(index, { x: 2050, y: 1520 }), {
    type: 'node', id: 'far-node', x: 2000, y: 1500, width: 100, height: 40,
  })
})

test('queryPoint returns null when no item contains the point', () => {
  const index = buildSpatialIndex(sampleLayout())
  assert.equal(queryPoint(index, { x: 1000, y: 1000 }), null)
  assert.equal(queryPoint(index, { x: 10000, y: 10000 }), null)
})

test('queryRect returns an empty array when the rect overlaps no item', () => {
  const index = buildSpatialIndex(sampleLayout())
  assert.deepEqual(queryRect(index, { x: 10000, y: 10000, width: 10, height: 10 }), [])
})

test('queryRect returns only items whose rect intersects, deduped across cells', () => {
  const index = buildSpatialIndex(sampleLayout())
  // 覆盖 origin-node 和 mid-group，够不到 far-node
  const ids = queryRect(index, { x: 0, y: 0, width: 700, height: 700 }).map((item) => item.id)
  assert.deepEqual(ids.sort(), ['mid-group', 'origin-node'])
})

test('queryRect returns a multi-cell item exactly once', () => {
  const index = buildSpatialIndex(sampleLayout())
  // far-node 横跨 col 7..8；矩形覆盖它整个范围，不应该因为跨两个 bucket 被算两次
  const matches = queryRect(index, { x: 1900, y: 1400, width: 300, height: 300 })
  assert.equal(matches.length, 1)
  assert.equal(matches[0].id, 'far-node')
})

test('getSpatialIndex memoizes per layout object identity', () => {
  const layout = sampleLayout()
  const first = getSpatialIndex(layout)
  const second = getSpatialIndex(layout)
  assert.equal(first, second)

  const otherLayout = sampleLayout()
  const third = getSpatialIndex(otherLayout)
  assert.notEqual(first, third)
})
