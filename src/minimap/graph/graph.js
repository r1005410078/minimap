// Phase 1 数据模型层：图结构、示例/压力数据、框内换位。
// 见 docs/superpowers/specs/2026-06-18-phase-1-core-logic.md

const GRAPH_VERSION = 1

function makeNode(id, label, parentId, children = [], extra = {}) {
  return { id, label, parentId, children, ...extra }
}

// 能源系统示例图。
// energy-root 只挂 3 个直接子节点（≤ 阈值，根层不折叠）；
// heap-1 挂 24 个相邻子节点（含 cluster-8），cluster-25 挂 10 个，二者均会折叠成分组框。
export function createDemoGraph() {
  const nodes = new Map()
  const add = (...args) => {
    const node = makeNode(...args)
    nodes.set(node.id, node)
    return node
  }

  add('energy-root', 'Energy Root', null, ['grid-tie', 'heap-1', 'cluster-25'])

  add('grid-tie', 'Grid Tie', 'energy-root', ['feeder-1', 'feeder-2', 'feeder-3'])
  for (let i = 1; i <= 3; i++) add(`feeder-${i}`, `Feeder ${i}`, 'grid-tie', [])

  const heapChildren = []
  for (let i = 1; i <= 24; i++) heapChildren.push(`cluster-${i}`)
  add('heap-1', 'Storage Heap 1', 'energy-root', heapChildren)
  for (const id of heapChildren) add(id, id, 'heap-1', [])

  const smallChildren = []
  for (let i = 1; i <= 10; i++) smallChildren.push(`leaf-${i}`)
  add('cluster-25', 'Cluster 25', 'energy-root', smallChildren)
  for (const id of smallChildren) add(id, id, 'cluster-25', [])

  return {
    version: GRAPH_VERSION,
    nodes,
    rootIds: ['energy-root'],
    edges: [],
  }
}

// 压力测试图：根 + 1 个父 + childCount 个子，nodes.size === childCount + 2。
// 父节点的全部子节点会折叠成单个分组框。
export function createStressGraph(childCount = 10000) {
  const nodes = new Map()
  nodes.set('stress-root', makeNode('stress-root', 'Stress Root', null, ['stress-heap']))

  const children = []
  for (let i = 0; i < childCount; i++) {
    const id = `cell-${i}`
    children.push(id)
    nodes.set(id, makeNode(id, id, 'stress-heap', []))
  }
  nodes.set('stress-heap', makeNode('stress-heap', 'Stress Heap', 'stress-root', children))

  return { version: GRAPH_VERSION, nodes, rootIds: ['stress-root'], edges: [] }
}

// 框内换位：把 childId 移动到 parent.children 的 newIndex 位置，结果保持唯一。
// 改的是真实逻辑顺序，不只是视觉位置。
export function reorderGroupChild(graph, parentId, childId, newIndex) {
  const parent = graph.nodes.get(parentId)
  if (!parent || !parent.children.includes(childId)) return graph

  const children = parent.children.filter((id) => id !== childId)
  const index = Math.max(0, Math.min(newIndex, children.length))
  children.splice(index, 0, childId)
  parent.children = children
  return graph
}
