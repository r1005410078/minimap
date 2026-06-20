import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv } from './helpers/dom-env.js'

installDomEnv()

const { mount } = await import('@vue/test-utils')
const ResourceTree = (await import('../src/minimap/ResourceTree.vue')).default

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

  const labels = wrapper.findAll('.resource-category-label').wrappers.map((w) => w.text())
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
  const firstCategory = wrapper.findAll('.resource-category').at(0)

  assert.equal(firstCategory.find('[data-resource-id="site"]').exists(), true)

  await firstCategory.find('.resource-category-row').trigger('click')
  assert.equal(firstCategory.find('[data-resource-id="site"]').isVisible(), false)
  assert.equal(firstCategory.find('.resource-category-caret').text(), '▸')

  await firstCategory.find('.resource-category-row').trigger('click')
  assert.equal(firstCategory.find('[data-resource-id="site"]').isVisible(), true)
  assert.equal(firstCategory.find('.resource-category-caret').text(), '▾')
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
  assert.deepEqual(payload, { id: 'site', label: '站点' })
  assert.equal(fakeDataTransfer.effectAllowed, 'copy')
  wrapper.destroy()
})
