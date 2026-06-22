export const TREE_DATA_GRAPH_VERSION = 1

function normalizeTreeItems(data) {
  if (data === undefined || data === null) return []
  return Array.isArray(data) ? data : [data]
}

function copyNodePayload(item, parentId, children) {
  const { children: _children, ...payload } = item
  const node = {
    ...payload,
    parentId,
    children,
  }
  return node
}

function visitTreeItem(item, parentId, nodes) {
  if (!item || item.id === undefined || item.id === null || item.id === '') return null
  const id = String(item.id)
  const rawChildren = normalizeTreeItems(item.children)
  const childIds = []
  const node = copyNodePayload({ ...item, id }, parentId, childIds)
  nodes.set(id, node)

  for (const child of rawChildren) {
    const childId = visitTreeItem(child, id, nodes)
    if (childId) childIds.push(childId)
  }

  return id
}

export function treeDataToGraph(data, options = {}) {
  const nodes = new Map()
  const rootIds = []
  for (const item of normalizeTreeItems(data)) {
    const id = visitTreeItem(item, null, nodes)
    if (id) rootIds.push(id)
  }
  return {
    version: options.version ?? TREE_DATA_GRAPH_VERSION,
    nodes,
    rootIds,
    edges: Array.isArray(options.edges) ? options.edges.map((edge) => ({ ...edge })) : [],
  }
}

function copyTreePayload(node, children) {
  const { parentId: _parentId, ...payload } = node
  return { ...payload, children }
}

function graphNodeToTreeItem(graph, id, seen = new Set()) {
  if (seen.has(id)) return null
  const node = graph.nodes.get(id)
  if (!node) return null
  seen.add(id)
  const children = []
  for (const childId of node.children || []) {
    const child = graphNodeToTreeItem(graph, childId, seen)
    if (child) children.push(child)
  }
  return copyTreePayload(node, children)
}

export function graphToTreeData(graph) {
  if (!graph?.nodes || !(graph.nodes instanceof Map)) return []
  const roots = Array.isArray(graph.rootIds) ? graph.rootIds : []
  return roots.map((id) => graphNodeToTreeItem(graph, id)).filter(Boolean)
}
