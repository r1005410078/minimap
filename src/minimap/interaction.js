// Phase 1 Vue 壳切片：命中检测 + 拖入插入下标，纯函数、不依赖 DOM。
// 见 docs/superpowers/specs/2026-06-18-phase-1-vue-shell.md

// 在 layout.visibleItems 里找世界坐标包含 point 的项。
// 树布局下节点和分组框天然不重叠，找到第一个命中项就返回。
export function hitTest(layout, point) {
  for (const item of layout.visibleItems) {
    if (
      point.x >= item.x &&
      point.x <= item.x + item.width &&
      point.y >= item.y &&
      point.y <= item.y + item.height
    ) {
      return item.type === 'group' ? { type: 'group', id: item.parentId } : { type: 'node', id: item.id }
    }
  }
  return null
}

// parentId 的子节点已经折叠成分组框时没有逐个子节点的世界坐标，退化为追加末尾。
// 否则按 children 顺序比较交叉轴坐标，找第一个比 point 靠后的兄弟，插在它前面。
export function findInsertionIndex(graph, layout, parentId, point, direction) {
  const parent = graph.nodes.get(parentId)
  const children = (parent && parent.children) || []
  if (children.length === 0) return 0

  const isFolded = layout.groups.some((group) => group.parentId === parentId)
  if (isFolded) return children.length

  const pointCross = direction === 'vertical' ? point.x : point.y
  for (let i = 0; i < children.length; i++) {
    const rect = layout.nodes.get(children[i])
    if (!rect) continue
    const cross = direction === 'vertical' ? rect.x + rect.width / 2 : rect.y + rect.height / 2
    if (pointCross < cross) return i
  }
  return children.length
}
