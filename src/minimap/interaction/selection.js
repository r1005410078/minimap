import { visibleGroupChildren } from '../graph/layout.js'
import { resolveEdges, worldRectToScreen } from '../render/renderer.js'

export function normalizeRect(rect) {
  const x = Math.min(rect.x, rect.x + rect.width)
  const y = Math.min(rect.y, rect.y + rect.height)
  return {
    x,
    y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  }
}

export function intersectsRect(a, b) {
  const ra = normalizeRect(a)
  const rb = normalizeRect(b)
  return (
    ra.x <= rb.x + rb.width &&
    ra.x + ra.width >= rb.x &&
    ra.y <= rb.y + rb.height &&
    ra.y + ra.height >= rb.y
  )
}

export function applySelectionClick(currentIds, id, { additive = false } = {}) {
  if (!additive) return [id]
  return currentIds.includes(id) ? currentIds.filter((item) => item !== id) : [...currentIds, id]
}

export function applySelectionSet(currentIds, ids, mode = 'replace') {
  if (mode === 'add') return [...new Set([...currentIds, ...ids])]
  if (mode === 'remove') {
    const removeSet = new Set(ids)
    return currentIds.filter((id) => !removeSet.has(id))
  }
  if (mode === 'toggle') {
    const result = [...currentIds]
    for (const id of ids) {
      const index = result.indexOf(id)
      if (index === -1) result.push(id)
      else result.splice(index, 1)
    }
    return result
  }
  return [...ids]
}

function visibleSelectableItems(layout) {
  const items = layout.visibleItems.filter((item) => item.type === 'node')
  for (const group of layout.groups) {
    for (const child of visibleGroupChildren(group)) {
      items.push({ ...child.rect, id: child.id, type: 'node' })
    }
  }
  return items
}

export function stripRedundantGroupSelection(selectedIds, layout) {
  const selected = new Set(selectedIds)
  for (const group of layout.groups) {
    if (selected.has(group.id) && group.children.some((childId) => selected.has(childId))) {
      selected.delete(group.id)
    }
  }
  return [...selected]
}

export function expandSelectedNodeIds(selectedIds, layout) {
  if (!layout) return [...new Set(selectedIds)]
  const groupsById = new Map(layout.groups.map((group) => [group.id, group]))
  const selected = new Set(selectedIds)
  const ids = []
  for (const id of selectedIds) {
    const group = groupsById.get(id)
    if (group) {
      const anyChildSelected = group.children.some((childId) => selected.has(childId))
      if (!anyChildSelected) ids.push(...group.children)
      continue
    }
    ids.push(id)
  }
  return [...new Set(ids)]
}

/** 多选拖动时实际参与拖动的节点 id；点击未选中节点时只拖该节点。 */
export function resolveDragNodeIds(primaryId, selectedIds, graph, layout) {
  const groupsById = new Map(layout?.groups?.map((group) => [group.id, group]) ?? [])
  const nodeIds = selectedIds.filter((id) => graph.nodes.has(id) && !groupsById.has(id))
  if (nodeIds.length <= 1 || !nodeIds.includes(primaryId)) return [primaryId]

  const selectedSet = new Set(nodeIds)
  const parentId = graph.nodes.get(primaryId)?.parentId ?? null
  if (parentId && nodeIds.every((id) => graph.nodes.get(id)?.parentId === parentId)) {
    return graph.nodes.get(parentId).children.filter((id) => selectedSet.has(id))
  }
  return nodeIds
}

export function idsInSelectionRect(layout, screenRect, viewport) {
  const ids = []
  for (const item of visibleSelectableItems(layout)) {
    if (intersectsRect(screenRect, worldRectToScreen(item, viewport))) ids.push(item.id)
  }
  return ids
}

function addNodeRelations(graph, id, relatedIds) {
  const node = graph.nodes.get(id)
  if (!node) return
  if (node.parentId) relatedIds.add(node.parentId)
  for (const childId of node.children || []) relatedIds.add(childId)
}

function addGroupRelations(group, relatedIds) {
  if (group.parentId) relatedIds.add(group.parentId)
  for (const childId of group.children) relatedIds.add(childId)
}

function itemIds(layout) {
  return visibleSelectableItems(layout).map((item) => item.id)
}

function boxForId(layout, id) {
  return layout.nodes.get(id) || layout.groups.find((group) => group.id === id) || null
}

function edgeTouchesSelected(edge, relatedBoxes) {
  return relatedBoxes.has(edge.fromBox) || relatedBoxes.has(edge.toBox)
}

export function buildSelectionRelations(graph, layout, selectedIds) {
  const selected = new Set(stripRedundantGroupSelection(selectedIds, layout))
  const highlightedIds = new Set()
  const highlightedEdgeIds = new Set()
  const dimmedIds = new Set()
  const dimmedEdgeIds = new Set()

  if (selected.size === 0) {
    return { selectedIds: selected, highlightedIds, dimmedIds, highlightedEdgeIds, dimmedEdgeIds }
  }

  const groupsById = new Map(layout.groups.map((group) => [group.id, group]))
  for (const id of selected) {
    const group = groupsById.get(id)
    if (group) addGroupRelations(group, highlightedIds)
    else addNodeRelations(graph, id, highlightedIds)
  }

  const relatedBoxes = new Set()
  for (const id of [...selected, ...highlightedIds]) {
    const box = boxForId(layout, id)
    if (box) relatedBoxes.add(box)
  }

  for (const edge of resolveEdges(graph, layout)) {
    if (edgeTouchesSelected(edge, relatedBoxes)) highlightedEdgeIds.add(edge.id)
    else dimmedEdgeIds.add(edge.id)
  }

  for (const id of itemIds(layout)) {
    if (!selected.has(id) && !highlightedIds.has(id)) dimmedIds.add(id)
  }

  return { selectedIds: selected, highlightedIds, dimmedIds, highlightedEdgeIds, dimmedEdgeIds }
}
