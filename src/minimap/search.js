// Phase 4 切片 2：搜索节点。纯函数，不依赖 Vue/DOM。
// 见 docs/superpowers/specs/2026-06-20-phase-4-search-nodes.md

// 从 graph.rootIds 深度优先遍历 graph.nodes（按 children 顺序），
// 对 node.id / node.label 做忽略大小写的子串匹配；命中即按遍历顺序收集。
// keyword 为空或全空白时返回 []（不当作"匹配一切"）。
export function searchNodes(graph, keyword) {
  const trimmed = keyword.trim().toLowerCase()
  if (!trimmed) return []
  const matches = []
  const visit = (id) => {
    const node = graph.nodes.get(id)
    if (!node) return
    if (node.id.toLowerCase().includes(trimmed) || node.label.toLowerCase().includes(trimmed)) {
      matches.push(node.id)
    }
    for (const childId of node.children || []) visit(childId)
  }
  for (const rootId of graph.rootIds || []) visit(rootId)
  return matches
}
