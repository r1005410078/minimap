import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv } from './helpers/dom-env.js'

installDomEnv()

const { mount } = await import('@vue/test-utils')
const ResourceTree = (await import('../src/minimap/ResourceTree.vue')).default

const resources = [
  {
    category: 'Generation',
    items: [
      { id: 'solar-array', label: 'Solar Array' },
      { id: 'wind-turbine', label: 'Wind Turbine' },
    ],
  },
  { category: 'Storage', items: [{ id: 'battery-bank', label: 'Battery Bank' }] },
]

test('renders categories and draggable leaf items', () => {
  const wrapper = mount(ResourceTree, { propsData: { resources } })
  const labels = wrapper.findAll('.resource-category-label').wrappers.map((w) => w.text())
  assert.deepEqual(labels, ['Generation', 'Storage'])
  const item = wrapper.find('[data-resource-id="battery-bank"]')
  assert.equal(item.text(), 'Battery Bank')
  assert.equal(item.attributes('draggable'), 'true')
  wrapper.destroy()
})

test('dragstart serializes the resource payload into dataTransfer', () => {
  const wrapper = mount(ResourceTree, { propsData: { resources } })
  const fakeDataTransfer = {
    data: {},
    setData(type, value) { this.data[type] = value },
    effectAllowed: null,
  }
  const itemEl = wrapper.find('[data-resource-id="solar-array"]').element
  const evt = new Event('dragstart', { bubbles: true })
  Object.defineProperty(evt, 'dataTransfer', { value: fakeDataTransfer })
  itemEl.dispatchEvent(evt)

  const payload = JSON.parse(fakeDataTransfer.data['application/json'])
  assert.deepEqual(payload, { id: 'solar-array', label: 'Solar Array' })
  assert.equal(fakeDataTransfer.effectAllowed, 'copy')
  wrapper.destroy()
})
