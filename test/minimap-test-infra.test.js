import test from 'node:test'
import assert from 'node:assert/strict'
import { installDomEnv } from './helpers/dom-env.js'

installDomEnv()

// 用动态 import：必须等 installDomEnv() 跑完之后才能加载 @vue/test-utils 和 .vue 组件，
// 否则静态 import 的模块求值顺序会在 installDomEnv() 调用之前完成，jsdom 还没装好。
const { mount } = await import('@vue/test-utils')
const Probe = (await import('./fixtures/Probe.vue')).default

test('the vue-sfc-loader + jsdom env can mount a real .vue SFC under node --test', () => {
  const wrapper = mount(Probe)
  assert.equal(wrapper.text(), 'probe-ok')
  wrapper.destroy()
})
