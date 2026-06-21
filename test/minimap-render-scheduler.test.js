import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderScheduler } from '../src/minimap/render-scheduler.js'

function createFrameHarness() {
  const frames = []
  const cancelled = []
  let nextId = 1
  return {
    frames,
    cancelled,
    requestFrame(callback) {
      const frame = { id: nextId++, callback, cancelled: false }
      frames.push(frame)
      return frame.id
    },
    cancelFrame(id) {
      cancelled.push(id)
      const frame = frames.find((item) => item.id === id)
      if (frame) frame.cancelled = true
    },
    runNext(time = 0) {
      const frame = frames.find((item) => !item.cancelled && !item.ran)
      if (!frame) return false
      frame.ran = true
      frame.callback(time)
      return true
    },
  }
}

test('schedule coalesces multiple render requests into one frame', () => {
  const harness = createFrameHarness()
  const reasons = []
  const scheduler = createRenderScheduler({
    render: (reason) => reasons.push(reason),
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame,
  })

  scheduler.schedule('pan')
  scheduler.schedule('marquee')
  scheduler.schedule('hover')

  assert.equal(harness.frames.length, 1)
  assert.equal(scheduler.isScheduled(), true)
  assert.equal(harness.runNext(16), true)
  assert.deepEqual(reasons, ['pan,marquee,hover'])
  assert.equal(scheduler.isScheduled(), false)
})

test('flush executes a pending render immediately and clears the scheduled frame', () => {
  const harness = createFrameHarness()
  const reasons = []
  const scheduler = createRenderScheduler({
    render: (reason) => reasons.push(reason),
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame,
  })

  scheduler.schedule('pan')
  scheduler.flush()

  assert.deepEqual(reasons, ['pan'])
  assert.equal(harness.cancelled.includes(1), true)
  assert.equal(harness.runNext(16), false)
})

test('cancel drops a pending render without calling render', () => {
  const harness = createFrameHarness()
  let renders = 0
  const scheduler = createRenderScheduler({
    render: () => {
      renders += 1
    },
    requestFrame: harness.requestFrame,
    cancelFrame: harness.cancelFrame,
  })

  scheduler.schedule('hover')
  scheduler.cancel()

  assert.equal(renders, 0)
  assert.equal(harness.cancelled.includes(1), true)
  assert.equal(scheduler.isScheduled(), false)
})
