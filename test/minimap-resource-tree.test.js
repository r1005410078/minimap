import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv } from './helpers/dom-env.js'

installDomEnv()

const { mount } = await import('@vue/test-utils')
const ResourceTree = (await import('../src/minimap/components/ResourceTree.vue')).default

const resources = [
  {
    category: '储能设备',
    expanded: true,
    items: [
      { id: 'site', label: '站点' },
      { id: 'subsystem', label: '子系统' },
      { id: 'bms-stack', label: 'BMS 堆' },
      { id: 'bms-cluster', label: 'BMS 簇' },
      { id: 'pcs-device', label: 'PCS 设备' },
      { id: 'metering', label: '电能计量' },
    ],
  },
  { category: '光伏设备', expanded: false, items: [] },
  { category: '配电设备', expanded: false, items: [] },
  { category: '监控设备', expanded: false, items: [] },
]

test('renders the reference resource tree categories, counts, and draggable items', () => {
  const wrapper = mount(ResourceTree, { propsData: { resources } })

  assert.equal(wrapper.find('.resource-tree-title').text(), '资源树')
  assert.equal(wrapper.find('.resource-tree-hint').text(), '拖至画布')

  const labels = wrapper.findAll('.resource-row.resource-category-row .resource-item-label').wrappers.map((w) => w.text())
  assert.deepEqual(labels, ['储能设备', '光伏设备', '配电设备', '监控设备'])

  const counts = wrapper.findAll('.resource-category-count').wrappers.map((w) => w.text())
  assert.deepEqual(counts, ['6', '0', '0', '0'])

  const item = wrapper.find('[data-resource-id="bms-cluster"]')
  assert.equal(item.text().includes('BMS 簇'), true)
  assert.equal(item.attributes('draggable'), 'true')
  wrapper.destroy()
})

test('clicking a category row toggles its expanded state locally', async () => {
  const wrapper = mount(ResourceTree, { propsData: { resources } })

  assert.equal(wrapper.find('[data-resource-id="site"]').exists(), true)

  await wrapper.find('[data-row-key="folder:储能设备"]').trigger('click')
  assert.equal(wrapper.find('[data-resource-id="site"]').exists(), false)
  assert.equal(wrapper.find('[data-row-key="folder:储能设备"]').classes().includes('is-collapsed'), true)

  await wrapper.find('[data-row-key="folder:储能设备"]').trigger('click')
  assert.equal(wrapper.find('[data-resource-id="site"]').exists(), true)
  assert.equal(wrapper.find('[data-row-key="folder:储能设备"]').classes().includes('is-collapsed'), false)
  wrapper.destroy()
})

test('dragstart serializes the resource payload into dataTransfer', () => {
  const wrapper = mount(ResourceTree, { propsData: { resources } })
  const fakeDataTransfer = {
    data: {},
    setData(type, value) { this.data[type] = value },
    effectAllowed: null,
  }
  const itemEl = wrapper.find('[data-resource-id="site"]').element
  const evt = new Event('dragstart', { bubbles: true })
  Object.defineProperty(evt, 'dataTransfer', { value: fakeDataTransfer })
  itemEl.dispatchEvent(evt)

  const payload = JSON.parse(fakeDataTransfer.data['application/json'])
  assert.deepEqual(payload, {
    id: 'site',
    label: '站点',
    resources: [{ id: 'site', label: '站点' }],
  })
  assert.equal(fakeDataTransfer.effectAllowed, 'copy')
  wrapper.destroy()
})

function makeLargeResources(count = 10000) {
  return [{ category: '大量资源', expanded: true, items: Array.from({ length: count }, (_, index) => ({ id: `res-${index}`, label: `Resource ${index}` })) }]
}

test('virtualized tree renders a small row count for 10000 resources', async () => {
  const wrapper = mount(ResourceTree, { propsData: { resources: makeLargeResources() }, attachTo: document.body })
  await wrapper.vm.$nextTick()
  const rows = wrapper.findAll('.resource-row')
  assert.ok(rows.length > 0)
  assert.ok(rows.length < 160)
  assert.equal(wrapper.find('[data-resource-id="res-9999"]').exists(), false)
  wrapper.destroy()
})

test('jumping scrollTop near the bottom immediately renders bottom rows', async () => {
  const wrapper = mount(ResourceTree, { propsData: { resources: makeLargeResources() }, attachTo: document.body })
  Object.defineProperty(wrapper.vm.$refs.scroller, 'clientHeight', { value: 280, configurable: true })
  wrapper.vm.$refs.scroller.scrollTop = 339754
  await wrapper.find('.resource-tree-scroll').trigger('scroll')
  await wrapper.vm.$nextTick()
  assert.equal(wrapper.text().includes('Resource 999'), true)
  assert.ok(wrapper.findAll('.resource-row').length > 0)
  wrapper.destroy()
})

test('nested folders expand and collapse without rendering hidden descendants', async () => {
  const wrapper = mount(ResourceTree, { propsData: { resources: [{ id: 'root', label: 'Root', type: 'folder', expanded: true, children: [{ id: 'folder', label: 'Folder', type: 'folder', children: [{ id: 'leaf', label: 'Leaf', type: 'resource' }] }] }] } })
  assert.equal(wrapper.text().includes('Leaf'), false)
  await wrapper.find('[data-row-key="folder:root/folder"]').trigger('click')
  assert.equal(wrapper.text().includes('Leaf'), true)
  wrapper.destroy()
})

test('search filters after debounce and keeps matching ancestors visible', async () => {
  const wrapper = mount(ResourceTree, { propsData: { searchDelay: 1, resources: [{ id: 'root', label: 'Root', type: 'folder', children: [{ id: 'leaf', label: 'Target Leaf', type: 'resource' }] }] } })
  await wrapper.find('.resource-search-input').setValue('target')
  await new Promise((resolve) => setTimeout(resolve, 5))
  await wrapper.vm.$nextTick()
  assert.equal(wrapper.text().includes('Root'), true)
  assert.equal(wrapper.text().includes('Target Leaf'), true)
  wrapper.destroy()
})

test('multi-select drag serializes selected resources in visible order', async () => {
  const wrapper = mount(ResourceTree, { propsData: { resources: makeLargeResources(5) } })
  await wrapper.find('[data-resource-id="res-1"]').trigger('click')
  await wrapper.find('[data-resource-id="res-3"]').trigger('click', { shiftKey: true })
  const fakeDataTransfer = { data: {}, setData(type, value) { this.data[type] = value }, effectAllowed: null }
  const evt = new Event('dragstart', { bubbles: true })
  Object.defineProperty(evt, 'dataTransfer', { value: fakeDataTransfer })
  wrapper.find('[data-resource-id="res-2"]').element.dispatchEvent(evt)
  assert.deepEqual(JSON.parse(fakeDataTransfer.data['application/json']).resources.map((item) => item.id), ['res-1', 'res-2', 'res-3'])
  wrapper.destroy()
})

test('disabled used resources cannot be selected or dragged', async () => {
  const wrapper = mount(ResourceTree, { propsData: { resources: makeLargeResources(3), usedResourceIds: new Set(['res-1']) } })
  const disabled = wrapper.find('[data-resource-id="res-1"]')
  assert.equal(disabled.classes().includes('is-disabled'), true)
  await disabled.trigger('click')
  assert.equal(disabled.classes().includes('is-selected'), false)
  assert.equal(disabled.attributes('draggable'), undefined)
  wrapper.destroy()
})

test('ArrowRight expands a focused folder and ArrowLeft collapses it', async () => {
  const wrapper = mount(ResourceTree, {
    propsData: {
      resources: [{
        id: 'root',
        label: 'Root',
        type: 'folder',
        expanded: true,
        children: [{
          id: 'folder',
          label: 'Folder',
          type: 'folder',
          children: [{ id: 'leaf', label: 'Leaf', type: 'resource' }],
        }],
      }],
    },
  })

  await wrapper.find('[data-row-key="folder:root/folder"]').trigger('click')
  assert.equal(wrapper.find('[data-resource-id="leaf"]').exists(), true)
  await wrapper.find('[data-row-key="folder:root/folder"]').trigger('click')
  assert.equal(wrapper.find('[data-resource-id="leaf"]').exists(), false)

  wrapper.vm.focusedKey = 'folder:root/folder'
  await wrapper.find('.resource-tree-scroll').trigger('keydown', { key: 'ArrowRight' })
  assert.equal(wrapper.find('[data-resource-id="leaf"]').exists(), true)

  await wrapper.find('.resource-tree-scroll').trigger('keydown', { key: 'ArrowLeft' })
  assert.equal(wrapper.find('[data-resource-id="leaf"]').exists(), false)
  wrapper.destroy()
})

test('ArrowRight moves focus to first child when a focused folder is already expanded', async () => {
  const wrapper = mount(ResourceTree, {
    propsData: {
      resources: [{
        id: 'root',
        label: 'Root',
        type: 'folder',
        expanded: true,
        children: [{ id: 'leaf', label: 'Leaf', type: 'resource' }],
      }],
    },
  })

  wrapper.vm.focusedKey = 'folder:root'
  await wrapper.find('.resource-tree-scroll').trigger('keydown', { key: 'ArrowRight' })

  assert.equal(wrapper.vm.focusedKey, 'resource:root/leaf')
  wrapper.destroy()
})

test('updating resources applies default expanded state from the new tree', async () => {
  const wrapper = mount(ResourceTree, {
    propsData: {
      resources: [{
        id: 'old',
        label: 'Old',
        type: 'folder',
        expanded: false,
        children: [{ id: 'hidden', label: 'Hidden', type: 'resource' }],
      }],
    },
  })

  assert.equal(wrapper.find('[data-resource-id="hidden"]').exists(), false)
  await wrapper.setProps({
    resources: [{
      id: 'next',
      label: 'Next',
      type: 'folder',
      expanded: true,
      children: [{ id: 'visible', label: 'Visible', type: 'resource' }],
    }],
  })

  assert.equal(wrapper.find('[data-resource-id="visible"]').exists(), true)
  wrapper.destroy()
})
