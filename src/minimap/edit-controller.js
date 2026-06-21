import { createGraphOperationManager, captureSubtreeSnapshot } from './graph-operations.js'
import { getClipboard, setClipboard } from './clipboard.js'
import { deserializeGraph, serializeGraph } from './graph-serialization.js'

export function createEditController(deps) {
  let operationManager = createGraphOperationManager(deps.getGraph())

  function onGraphReplaced() {
    operationManager = createGraphOperationManager(deps.getGraph())
  }

  function applyOperation(operation, { before } = {}) {
    return operationManager.apply(operation, { readonly: deps.getReadonly(), before })
  }

  function emitChangeIfApplied(result) {
    if (!result.applied) return
    deps.emitChange({
      type: result.type,
      operation: result.operation,
      previousGraph: result.previousGraph,
      nextGraph: result.nextGraph,
      reason: result.reason,
    })
  }

  function undo() {
    const result = operationManager.undo()
    if (result.applied) {
      deps.updateLayout()
      emitChangeIfApplied(result)
    }
    return result
  }

  function redo() {
    const result = operationManager.redo()
    if (result.applied) {
      deps.updateLayout()
      emitChangeIfApplied(result)
    }
    return result
  }

  function canUndo() {
    return operationManager.canUndo()
  }

  function canRedo() {
    return operationManager.canRedo()
  }

  function selectedRealNodeIds() {
    const layout = deps.getLayout()
    if (!layout) return deps.getSelectedIds()
    const groupsById = new Map(layout.groups.map((group) => [group.id, group]))
    const ids = []
    for (const id of deps.getSelectedIds()) {
      const group = groupsById.get(id)
      if (group) ids.push(...group.children)
      else ids.push(id)
    }
    return [...new Set(ids)]
  }

  function selectionAfterDeleting(deletedIds) {
    const deleted = new Set(deletedIds)
    return deps.getSelectedIds().filter((id) => !deleted.has(id))
  }

  function deleteSelection() {
    const ids = deps.getSelectedIds()
    const expandedIds = selectedRealNodeIds()
    const operation = { type: 'delete-nodes', payload: { ids, expandedIds } }
    const result = applyOperation(operation, { before: deps.getBeforeDelete() })
    if (!result.applied) return result

    deps.updateLayout({ animate: false })
    deps.setSelected(selectionAfterDeleting(result.operation.payload.deletedIds || []))
    deps.emitDelete({ ids, deletedIds: result.operation.payload.deletedIds || [] })
    emitChangeIfApplied(result)
    return result
  }

  function copySelection() {
    const graph = deps.getGraph()
    const ids = deps.getSelectedIds()
    const expandedIds = selectedRealNodeIds()
    const payload = { ids, expandedIds }
    const unapplied = (reason) => ({
      applied: false,
      type: 'copy-selection',
      operation: { type: 'copy-selection', payload },
      inverse: null,
      previousGraph: graph,
      nextGraph: graph,
      reason,
    })

    if (expandedIds.length === 0) return unapplied('empty')
    const beforeCopy = deps.getBeforeCopy()
    if (beforeCopy && beforeCopy(payload) === false) return unapplied('blocked')

    const snapshot = captureSubtreeSnapshot(graph, expandedIds)
    setClipboard(snapshot)
    const capturedPayload = { ids, capturedIds: snapshot.nodes.map((node) => node.id) }
    deps.emitCopy(capturedPayload)
    return {
      applied: true,
      type: 'copy-selection',
      operation: { type: 'copy-selection', payload: capturedPayload },
      inverse: null,
      previousGraph: graph,
      nextGraph: graph,
      reason: null,
    }
  }

  function pasteTargetId() {
    const id = deps.getSelectedIds()[0] ?? null
    const layout = deps.getLayout()
    if (!id || !layout) return id
    const groupsById = new Map(layout.groups.map((group) => [group.id, group]))
    const group = groupsById.get(id)
    return group ? group.parentId : id
  }

  function nextPasteId(sourceId, usedIds) {
    let index = 1
    let id = `paste-${sourceId}-${index}`
    while (usedIds.has(id)) {
      index += 1
      id = `paste-${sourceId}-${index}`
    }
    usedIds.add(id)
    return id
  }

  function createPasteIdMap(snapshot) {
    const usedIds = new Set(deps.getGraph().nodes.keys())
    const idMap = {}
    for (const node of snapshot.nodes) idMap[node.id] = nextPasteId(node.id, usedIds)
    return idMap
  }

  function pasteInto(targetParentId = pasteTargetId()) {
    const snapshot = getClipboard() ?? { rootIds: [], nodes: [] }
    const idMap = createPasteIdMap(snapshot)
    const operation = { type: 'paste-nodes', payload: { targetParentId, snapshot, idMap } }
    const result = applyOperation(operation, { before: deps.getBeforePaste() })
    if (!result.applied) return result

    deps.updateLayout()
    deps.emitPaste({
      targetParentId,
      pastedIds: result.operation.payload.pastedIds || [],
      idMap,
    })
    emitChangeIfApplied(result)
    return result
  }

  function paste() {
    return pasteInto()
  }

  function exportGraph() {
    const graph = serializeGraph(deps.getGraph())
    deps.emitExport({ graph })
    return graph
  }

  function importGraph(data) {
    if (deps.getReadonly()) {
      const graph = deps.getGraph()
      return {
        applied: false,
        type: 'replace-graph',
        operation: { type: 'replace-graph', payload: { data } },
        inverse: null,
        previousGraph: graph,
        nextGraph: graph,
        reason: 'readonly',
      }
    }
    const parsed = deserializeGraph(data)
    if (!parsed.valid) {
      const graph = deps.getGraph()
      return {
        applied: false,
        type: 'replace-graph',
        operation: { type: 'replace-graph', payload: { data } },
        inverse: null,
        previousGraph: graph,
        nextGraph: graph,
        reason: parsed.reason,
      }
    }
    const operation = { type: 'replace-graph', payload: { graph: parsed.graph } }
    const result = applyOperation(operation, { before: deps.getBeforeImport() })
    if (!result.applied) return result

    deps.updateLayout({ animate: false })
    deps.setSelected([])
    deps.emitImport({ graph: deps.getGraph() })
    emitChangeIfApplied(result)
    return result
  }

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    deleteSelection,
    copySelection,
    paste,
    pasteInto,
    exportGraph,
    importGraph,
    applyOperation,
    onGraphReplaced,
  }
}
