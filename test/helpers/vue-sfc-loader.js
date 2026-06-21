// Node ESM loader 钩子：把 .vue SFC 用 @vue/compiler-sfc 现场编译成可执行 JS，
// 让 node --test 能直接 import 真实的 .vue 组件。只用于测试，不影响 Vite 构建路径。
// 支持 <script setup>（App.vue、Probe.vue）与 Options API <script>（minimap/components/）。
import { readFile } from 'node:fs/promises'
import * as compiler from '@vue/compiler-sfc'

function mergeScriptAndTemplate(scriptContent, templateResult) {
  return `
${scriptContent.replace('export default', 'const __default__ =')}
${templateResult.code.replace('export function render', 'function render')}
__default__.render = render
if (typeof staticRenderFns !== 'undefined') __default__.staticRenderFns = staticRenderFns
export default __default__
`
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.vue')) return nextLoad(url, context)

  const filename = url.replace('file://', '')
  const source = await readFile(filename, 'utf-8')
  const descriptor = compiler.parse({ source, filename })
  const id = Buffer.from(filename).toString('hex').slice(0, 8)

  const templateOptions = { source: descriptor.template.content, filename, id }
  let scriptContent

  if (descriptor.scriptSetup) {
    const scriptResult = compiler.compileScript(descriptor, { id })
    scriptContent = scriptResult.content
    templateOptions.bindings = scriptResult.bindings
  } else {
    scriptContent = descriptor.script.content
  }

  const templateResult = compiler.compileTemplate(templateOptions)

  const code = mergeScriptAndTemplate(scriptContent, templateResult)
  return { format: 'module', source: code, shortCircuit: true }
}
