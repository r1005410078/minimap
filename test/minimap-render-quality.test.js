import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRenderQuality } from '../src/minimap/render-quality.js'

test('full quality keeps text and group children at normal scale', () => {
  assert.deepEqual(resolveRenderQuality({ scale: 1, interacting: false }), {
    level: 'full',
    showText: true,
    showGroupChildren: true,
    simplifyEdges: false,
    simplifyChrome: false,
  })
})

test('compact quality hides text during small scale or active interactions', () => {
  assert.deepEqual(resolveRenderQuality({ scale: 0.3, interacting: false }), {
    level: 'compact',
    showText: false,
    showGroupChildren: true,
    simplifyEdges: false,
    simplifyChrome: true,
  })
  assert.equal(resolveRenderQuality({ scale: 1, interacting: true }).level, 'compact')
})

test('overview quality hides text and grouped child details at very small scale', () => {
  assert.deepEqual(resolveRenderQuality({ scale: 0.1, interacting: false }), {
    level: 'overview',
    showText: false,
    showGroupChildren: false,
    simplifyEdges: true,
    simplifyChrome: true,
  })
})
