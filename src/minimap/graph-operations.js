import { serializeGraph } from './graph-serialization.js'

function result({ applied, type, operation, inverse = null, graph, reason = null }) {
  return {
    applied,
    type,
    operation,
    inverse,
    previousGraph: graph,
    nextGraph: graph,
    reason,
  }
}

function blockedResult(graph, operation, reason) {
  return result({ applied: false, type: operation?.type, operation, graph, reason })
}

function clampIndex(index, length) {
  return Math.max(0, Math.min(index, length))
}

function applyDropNode(graph, operation) {
  const { resource, parentId, index, id } = operation.payload
  const parent = graph.nodes.get(parentId)
  if (!parent || !id || graph.nodes.has(id)) return blockedResult(graph, operation, 'invalid')

  const insertIndex = clampIndex(index, parent.children.length)
  const node = { id, label: resource.label, parentId, children: [] }
  graph.nodes.set(id, node)
  parent.children.splice(insertIndex, 0, id)

  return result({
    applied: true,
    type: operation.type,
    operation: { ...operation, payload: { ...operation.payload, index: insertIndex } },
    inverse: {
      type: 'remove-dropped-node',
      payload: { parentId, childId: id, index: insertIndex, node },
    },
    graph,
  })
}

function applyRemoveDroppedNode(graph, operation) {
  const { parentId, childId, index, node } = operation.payload
  const parent = graph.nodes.get(parentId)
  if (!parent || !graph.nodes.has(childId)) return blockedResult(graph, operation, 'invalid')

  parent.children = parent.children.filter((id) => id !== childId)
  graph.nodes.delete(childId)

  return result({
    applied: true,
    type: operation.type,
    operation,
    inverse: {
      type: 'drop-node',
      payload: {
        resource: { id: node.id, label: node.label },
        parentId,
        index,
        id: childId,
      },
    },
    graph,
  })
}

function applyReorderGroupChild(graph, operation) {
  const { parentId, childId, index } = operation.payload
  const parent = graph.nodes.get(parentId)
  const currentIndex = parent?.children.indexOf(childId) ?? -1
  if (!parent || currentIndex === -1) return blockedResult(graph, operation, 'invalid')

  const children = parent.children.filter((id) => id !== childId)
  const insertIndex = clampIndex(index, children.length)
  children.splice(insertIndex, 0, childId)
  parent.children = children

  return result({
    applied: true,
    type: operation.type,
    operation: { ...operation, payload: { ...operation.payload, index: insertIndex } },
    inverse: {
      type: 'reorder-group-child',
      payload: { ...operation.payload, index: currentIndex },
    },
    graph,
  })
}

function cloneGraphData(graph) {
  const data = serializeGraph(graph)
  return {
    version: data.version,
    nodes: new Map(data.nodes.map((node) => [node.id, { ...node, children: [...(node.children || [])] }])),
    rootIds: [...data.rootIds],
    edges: data.edges.map((edge) => ({ ...edge })),
  }
}

function replaceGraphContents(target, source) {
  target.version = source.version
  target.nodes.clear()
  for (const [id, node] of source.nodes) target.nodes.set(id, { ...node, children: [...(node.children || [])] })
  target.rootIds = [...source.rootIds]
  target.edges = source.edges.map((edge) => ({ ...edge }))
}

function collectDescendants(graph, id, result = new Set()) {
  if (result.has(id)) return result
  const node = graph.nodes.get(id)
  if (!node) return result
  result.add(id)
  for (const childId of node.children || []) collectDescendants(graph, childId, result)
  return result
}

function highestExistingIds(graph, ids) {
  const unique = [...new Set(ids)].filter((id) => graph.nodes.has(id))
  const selected = new Set(unique)
  return unique.filter((id) => {
    let parentId = graph.nodes.get(id)?.parentId
    while (parentId) {
      if (selected.has(parentId)) return false
      parentId = graph.nodes.get(parentId)?.parentId
    }
    return true
  })
}

function applyDeleteNodes(graph, operation) {
  const ids = highestExistingIds(graph, operation.payload.expandedIds || operation.payload.ids || [])
  if (ids.length === 0) return blockedResult(graph, operation, 'empty')
  const before = cloneGraphData(graph)
  const deleted = new Set()
  for (const id of ids) collectDescendants(graph, id, deleted)
  if (deleted.size === 0) return blockedResult(graph, operation, 'empty')

  for (const node of graph.nodes.values()) {
    node.children = (node.children || []).filter((id) => !deleted.has(id))
  }
  for (const id of deleted) graph.nodes.delete(id)
  graph.rootIds = graph.rootIds.filter((id) => !deleted.has(id))
  graph.edges = (graph.edges || []).filter((edge) => !deleted.has(edge.source) && !deleted.has(edge.target))

  return result({
    applied: true,
    type: operation.type,
    operation: { ...operation, payload: { ...operation.payload, deletedIds: [...deleted] } },
    inverse: { type: 'replace-graph', payload: { graph: before } },
    graph,
  })
}

function cloneSubtree(graph, sourceId, idMap, copiedNodes) {
  const source = graph.nodes.get(sourceId)
  const copyId = idMap[sourceId]
  if (!source || !copyId || graph.nodes.has(copyId)) return false
  const childCopies = []
  for (const childId of source.children || []) {
    if (!cloneSubtree(graph, childId, idMap, copiedNodes)) return false
    childCopies.push(idMap[childId])
  }
  copiedNodes.set(copyId, {
    ...source,
    id: copyId,
    parentId: source.parentId && idMap[source.parentId] ? idMap[source.parentId] : source.parentId,
    children: childCopies,
  })
  return true
}

function applyCopyNodes(graph, operation) {
  const ids = highestExistingIds(graph, operation.payload.expandedIds || operation.payload.ids || [])
  if (ids.length === 0) return blockedResult(graph, operation, 'empty')
  const before = cloneGraphData(graph)
  const copiedNodes = new Map()
  const idMap = operation.payload.idMap || {}
  for (const id of ids) {
    if (!cloneSubtree(graph, id, idMap, copiedNodes)) return blockedResult(graph, operation, 'invalid')
  }

  for (const [id, node] of copiedNodes) graph.nodes.set(id, node)
  for (const sourceId of ids) {
    const source = graph.nodes.get(sourceId)
    const copyId = idMap[sourceId]
    if (source.parentId) {
      const parent = graph.nodes.get(source.parentId)
      const sourceIndex = parent.children.indexOf(sourceId)
      parent.children.splice(sourceIndex + 1, 0, copyId)
    } else {
      const sourceIndex = graph.rootIds.indexOf(sourceId)
      graph.rootIds.splice(sourceIndex + 1, 0, copyId)
    }
  }

  return result({
    applied: true,
    type: operation.type,
    operation: { ...operation, payload: { ...operation.payload, copiedIds: [...copiedNodes.keys()] } },
    inverse: { type: 'replace-graph', payload: { graph: before } },
    graph,
  })
}

function applyReplaceGraph(graph, operation) {
  const nextGraph = operation.payload.graph
  if (!nextGraph?.nodes || !(nextGraph.nodes instanceof Map) || !Array.isArray(nextGraph.rootIds) || !Array.isArray(nextGraph.edges)) {
    return blockedResult(graph, operation, operation.payload.reason || 'invalid')
  }
  const before = cloneGraphData(graph)
  replaceGraphContents(graph, nextGraph)
  return result({
    applied: true,
    type: operation.type,
    operation,
    inverse: { type: 'replace-graph', payload: { graph: before } },
    graph,
  })
}

function applyOperation(graph, operation) {
  if (operation.type === 'drop-node') return applyDropNode(graph, operation)
  if (operation.type === 'remove-dropped-node') return applyRemoveDroppedNode(graph, operation)
  if (operation.type === 'reorder-group-child') return applyReorderGroupChild(graph, operation)
  if (operation.type === 'delete-nodes') return applyDeleteNodes(graph, operation)
  if (operation.type === 'copy-nodes') return applyCopyNodes(graph, operation)
  if (operation.type === 'replace-graph') return applyReplaceGraph(graph, operation)
  return blockedResult(graph, operation, 'invalid')
}

export function createGraphOperationManager(graph) {
  const undoStack = []
  const redoStack = []

  const apply = (operation, options = {}) => {
    if (options.readonly) return blockedResult(graph, operation, 'readonly')
    if (options.before && options.before(operation.payload) === false) {
      return blockedResult(graph, operation, 'blocked')
    }

    const applied = applyOperation(graph, operation)
    if (!applied.applied) return applied

    undoStack.push({ operation: applied.operation, inverse: applied.inverse })
    redoStack.length = 0
    return applied
  }

  const undo = () => {
    const entry = undoStack.pop()
    if (!entry) return blockedResult(graph, { type: 'undo', payload: {} }, 'empty')
    const applied = applyOperation(graph, entry.inverse)
    if (applied.applied) {
      redoStack.push(entry)
      return { ...applied, type: 'undo', operation: entry.operation, inverse: entry.inverse }
    }
    undoStack.push(entry)
    return applied
  }

  const redo = () => {
    const entry = redoStack.pop()
    if (!entry) return blockedResult(graph, { type: 'redo', payload: {} }, 'empty')
    const applied = applyOperation(graph, entry.operation)
    if (applied.applied) {
      undoStack.push({ operation: applied.operation, inverse: applied.inverse })
      return { ...applied, type: 'redo', operation: applied.operation, inverse: applied.inverse }
    }
    redoStack.push(entry)
    return applied
  }

  return {
    apply,
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  }
}
