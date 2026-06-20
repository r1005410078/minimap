// Node ESM loader 钩子：把 .vue SFC 用 @vue/compiler-sfc 现场编译成可执行 JS，
// 让 node --test 能直接 import 真实的 .vue 组件。只用于测试，不影响 Vite 构建路径。
// 只支持本项目统一使用的 <script setup> 写法，不是通用 Vue SFC 编译器。
import { readFile } from 'node:fs/promises'
import * as compiler from '@vue/compiler-sfc'

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.vue')) return nextLoad(url, context)

  const filename = url.replace('file://', '')
  const source = await readFile(filename, 'utf-8')
  const descriptor = compiler.parse({ source, filename })
  const id = Buffer.from(filename).toString('hex').slice(0, 8)

  const scriptResult = compiler.compileScript(descriptor, { id })
  const templateResult = compiler.compileTemplate({
    source: descriptor.template.content,
    filename,
    id,
    bindings: scriptResult.bindings,
  })

  const code = `
${scriptResult.content.replace('export default', 'const __default__ =')}
${templateResult.code.replace('export function render', 'function render')}
__default__.render = render
if (typeof staticRenderFns !== 'undefined') __default__.staticRenderFns = staticRenderFns
export default __default__
`
  return { format: 'module', source: code, shortCircuit: true }
}
