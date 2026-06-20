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

function applyOperation(graph, operation) {
  if (operation.type === 'drop-node') return applyDropNode(graph, operation)
  if (operation.type === 'remove-dropped-node') return applyRemoveDroppedNode(graph, operation)
  if (operation.type === 'reorder-group-child') return applyReorderGroupChild(graph, operation)
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
