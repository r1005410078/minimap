import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv, stubElementSize } from './helpers/dom-env.js'
import { stubAnimationFrame, stubCanvasContext, stubResizeObserver } from './helpers/canvas-env.js'
import { createDemoGraph } from '../src/minimap/graph.js'
import { computeLayout, childRectInGroup, scrollTopToReveal } from '../src/minimap/layout.js'
import { centerViewportOn } from '../src/minimap/viewport.js'

installDomEnv()
stubElementSize(800, 600)
stubCanvasContext()
stubResizeObserver()
const frames = stubAnimationFrame()

const { mount } = await import('@vue/test-utils')
const Minimap = (await import('../src/minimap/Minimap.vue')).default

function settle() {
  frames.runNext(0)
  frames.runNext(200)
}

function referenceLayout() {
  return computeLayout(createDemoGraph(), { direction: 'horizontal', viewportWidth: 800, viewportHeight: 600 })
}

test('search jumps to and selects the first match', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  const result = wrapper.vm.search('feeder')
  settle()

  assert.deepEqual(result, { keyword: 'feeder', matches: ['feeder-1', 'feeder-2', 'feeder-3'], current: 'feeder-1' })
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])
  const rect = referenceLayout().nodes.get('feeder-1')
  const target = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  wrapper.destroy()
})

test('search reveals a grouped child scrolled out of a collapsed group', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.search('cluster-24')
  settle()

  const group = referenceLayout().groups.find((g) => g.id === 'heap-1::g0')
  const index = group.children.indexOf('cluster-24')
  const scrollTop = scrollTopToReveal(group, index)
  const rect = childRectInGroup({ ...group, scrollTop }, 'cluster-24')
  const target = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['cluster-24'])
  wrapper.destroy()
})

test('search with empty keyword does not jump or select, emits empty matches', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  const result = wrapper.vm.search('')
  settle()

  assert.deepEqual(result, { keyword: '', matches: [], current: null })
  assert.equal(wrapper.emitted('select'), undefined)
  assert.equal(wrapper.emitted('viewport-change'), undefined)
  wrapper.destroy()
})

test('search with no matches emits empty matches without jumping', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  const result = wrapper.vm.search('zzz-nope')
  settle()

  assert.deepEqual(result, { keyword: 'zzz-nope', matches: [], current: null })
  assert.equal(wrapper.emitted('select'), undefined)
  wrapper.destroy()
})

test('searchNext/searchPrevious cycle through matches and wrap around', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.search('feeder')
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])

  wrapper.vm.searchNext()
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-2'])

  wrapper.vm.searchNext()
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-3'])

  wrapper.vm.searchNext()
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])

  wrapper.vm.searchPrevious()
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-3'])
  wrapper.destroy()
})

test('searchNext/searchPrevious are no-ops without prior matches', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  wrapper.vm.searchNext()
  wrapper.vm.searchPrevious()
  settle()

  assert.equal(wrapper.emitted('search'), undefined)
  assert.equal(wrapper.emitted('select'), undefined)
  wrapper.destroy()
})

test('search box renders by default and reflects match count', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  await wrapper.find('.minimap-search-input').setValue('feeder')
  settle()
  await wrapper.vm.$nextTick()

  assert.equal(wrapper.find('.minimap-search-count').text(), '1/3')
  wrapper.destroy()
})

test('Enter key in the search input advances to the next match', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  await wrapper.find('.minimap-search-input').setValue('feeder')
  settle()
  await wrapper.find('.minimap-search-input').trigger('keydown.enter')
  settle()
  await wrapper.vm.$nextTick()

  assert.equal(wrapper.find('.minimap-search-count').text(), '2/3')
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-2'])
  wrapper.destroy()
})

test('next/previous buttons are disabled with no matches and enabled once there are', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  assert.equal(wrapper.find('.minimap-search-prev').attributes('disabled'), 'disabled')
  assert.equal(wrapper.find('.minimap-search-next').attributes('disabled'), 'disabled')

  await wrapper.find('.minimap-search-input').setValue('feeder')
  settle()
  await wrapper.vm.$nextTick()

  assert.equal(wrapper.find('.minimap-search-prev').attributes('disabled'), undefined)
  assert.equal(wrapper.find('.minimap-search-next').attributes('disabled'), undefined)
  wrapper.destroy()
})

test('clicking the next button advances the result and re-centers', async () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph } })

  await wrapper.find('.minimap-search-input').setValue('feeder')
  settle()
  await wrapper.find('.minimap-search-next').trigger('click')
  settle()

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-2'])
  wrapper.destroy()
})

test('options.enableSearch false hides the search box but methods still work', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, options: { enableSearch: false } } })

  assert.equal(wrapper.find('.minimap-search').exists(), false)
  wrapper.vm.search('feeder')
  settle()
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])
  wrapper.destroy()
})

test('controlled selectedIds: search only emits select', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, selectedIds: [] } })

  wrapper.vm.search('feeder')
  settle()

  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['feeder-1'])
  wrapper.destroy()
})

test('controlled viewport: search only emits viewport-change, never mutates rendered viewport', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, { propsData: { graph, viewport: { x: 0, y: 0, scale: 1 } } })

  wrapper.vm.search('feeder')
  settle()

  assert.ok(wrapper.emitted('viewport-change').length > 0)
  assert.deepEqual(wrapper.vm.getViewport(), { x: 0, y: 0, scale: 1 })
  wrapper.destroy()
})

test('controlled groupStates: search emits the scrollTop patch but targets the unrevealed position', () => {
  const graph = createDemoGraph()
  const wrapper = mount(Minimap, {
    propsData: { graph, groupStates: { 'heap-1::g0': { scrollTop: 0 } } },
  })

  wrapper.vm.search('cluster-24')
  settle()

  const group = referenceLayout().groups.find((g) => g.id === 'heap-1::g0')
  const index = group.children.indexOf('cluster-24')
  const expectedScrollTop = scrollTopToReveal(group, index)
  assert.equal(wrapper.emitted('group-state-change').at(-1)[0]['heap-1::g0'].scrollTop, expectedScrollTop)

  // 父级没有真正回写 prop，组件内部不会持久化这次滚动；search 实际算出的
  // 目标位置仍然是 group.scrollTop 维持在 0（未揭示）时 cluster-24 所在的矩形——
  // 跟切片 1 里 centerOnNode 的受控 groupStates 测试是同一套机制，这里只是验证
  // search 走的是同一条路径，不是重新实现了一遍。
  const staleRect = childRectInGroup(group, 'cluster-24')
  const target = { x: staleRect.x + staleRect.width / 2, y: staleRect.y + staleRect.height / 2 }
  assert.deepEqual(wrapper.vm.getViewport(), centerViewportOn(target, { x: 0, y: 0, scale: 1 }, 800, 600))
  assert.deepEqual(wrapper.emitted('select').at(-1)[0], ['cluster-24'])
  wrapper.destroy()
})
