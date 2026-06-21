import { mount } from '@vue/test-utils'
import Minimap from '../../src/minimap/components/Minimap.vue'

/** 测试 mount：默认关闭首次自动居中，避免大量交互测试依赖 viewport {0,0,1}。 */
export function mountMinimap(config = {}) {
  const propsData = { ...(config.propsData ?? {}) }
  if (propsData.viewport == null) {
    propsData.options = { disableInitialCenter: true, ...(propsData.options ?? {}) }
  }
  return mount(Minimap, { ...config, propsData })
}

export { Minimap }
