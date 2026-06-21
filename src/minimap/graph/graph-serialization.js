export const GRAPH_VERSION = 1

function cloneNode(node) {
  return {
    ...node,
    children: [...(node.children || [])],
  }
}

export function serializeGraph(graph) {
  return {
    version: graph.version ?? GRAPH_VERSION,
    nodes: [...graph.nodes.values()].map(cloneNode),
    rootIds: [...(graph.rootIds || [])],
    edges: [...(graph.edges || [])].map((edge) => ({ ...edge })),
  }
}

export function validateGraphVersion(data) {
  if (!data || data.version !== GRAPH_VERSION) return { valid: false, reason: 'invalid-version' }
  return { valid: true, reason: null }
}

export function deserializeGraph(input) {
  let data
  try {
    data = typeof input === 'string' ? JSON.parse(input) : input
  } catch {
    return { valid: false, reason: 'invalid', graph: null }
  }

  const version = validateGraphVersion(data)
  if (!version.valid) return { valid: false, reason: version.reason, graph: null }
  if (!Array.isArray(data.nodes) || !Array.isArray(data.rootIds)) {
    return { valid: false, reason: 'invalid', graph: null }
  }

  const nodes = new Map()
  for (const rawNode of data.nodes) {
    if (!rawNode || typeof rawNode.id !== 'string') {
      return { valid: false, reason: 'invalid', graph: null }
    }
    nodes.set(rawNode.id, {
      ...rawNode,
      children: Array.isArray(rawNode.children) ? [...rawNode.children] : [],
    })
  }

  return {
    valid: true,
    reason: null,
    graph: {
      version: data.version,
      nodes,
      rootIds: [...data.rootIds],
      edges: Array.isArray(data.edges) ? data.edges.map((edge) => ({ ...edge })) : [],
    },
  }
}
