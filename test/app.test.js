import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'

installDomEnv()
stubElementSize(800, 600)
const contexts = stubCanvasContext()
stubResizeObserver()

const { mount } = await import('@vue/test-utils')
const App = (await import('../src/App.vue')).default
const Minimap = (await import('../src/minimap/components/Minimap.vue')).default

test('App mounts the demo graph and resource tree without throwing', () => {
  const wrapper = mount(App)
  const ctx = contexts.at(-1)
  assert.ok(ctx.calls.some((call) => call.method === 'clearRect'))
  assert.ok(wrapper.find('.resource-tree-title').exists())
  assert.ok(wrapper.find('.resource-row.resource-category-row').exists())
  const counts = wrapper.findComponent(Minimap).props('resources').map((category) => String(category.items.length))
  assert.deepEqual(counts, ['2500', '2200', '2300', '2400'])
  assert.equal(wrapper.find('[data-resource-id="site"]').classes().includes('is-disabled'), true)
  wrapper.destroy()
})

test('App center button calls centerGraph on the minimap ref', async () => {
  const wrapper = mount(App)
  const minimap = wrapper.findComponent(Minimap)
  let calls = 0
  minimap.vm.centerGraph = () => {
    calls += 1
  }

  await wrapper.find('[data-testid="center-graph"]').trigger('click')

  assert.equal(calls, 1)
  wrapper.destroy()
})
