function normalizeNode(node, fallbackId) {
  const id = String(node.id ?? node.category ?? fallbackId)
  const label = String(node.label ?? node.category ?? id)
  const rawChildren = Array.isArray(node.children)
    ? node.children
    : Array.isArray(node.items)
      ? node.items
      : null
  const type = node.type || (rawChildren ? 'folder' : 'resource')

  if (type === 'folder') {
    return {
      id,
      label,
      type: 'folder',
      expanded: node.expanded,
      children: (rawChildren || []).map((child, index) => normalizeNode(child, `${id}-${index}`)),
      resource: node,
    }
  }

  return {
    id,
    label,
    type: 'resource',
    resource: node,
  }
}

function rowKey(type, path) {
  return `${type}:${path.join('/')}`
}

export function normalizeResourceTree(resources = []) {
  return resources.map((item, index) => normalizeNode(item, `resource-${index}`))
}

export function resourceMatchesSearch(resource, keyword) {
  const query = String(keyword || '').trim().toLowerCase()
  if (!query) return true
  return String(resource.id ?? '').toLowerCase().includes(query) ||
    String(resource.label ?? '').toLowerCase().includes(query)
}

function includesSearchMatch(node, keyword) {
  if (!keyword) return true
  if (resourceMatchesSearch(node, keyword)) return true
  return (node.children || []).some((child) => includesSearchMatch(child, keyword))
}

function flattenNode(node, context, rows) {
  const { path, depth, expandedKeys, searchKeyword, usedResourceIds } = context
  if (searchKeyword && !includesSearchMatch(node, searchKeyword)) return

  const nextPath = [...path, node.id]
  const key = rowKey(node.type, nextPath)
  const isFolder = node.type === 'folder'
  const expanded = searchKeyword ? true : expandedKeys.has(key)
  const disabled = node.type === 'resource' && usedResourceIds.has(node.id)

  rows.push({
    key,
    id: node.id,
    label: node.label,
    type: node.type,
    depth,
    expanded,
    disabled,
    item: node.resource,
  })

  if (!isFolder || !expanded) return
  for (const child of node.children || []) {
    flattenNode(child, { ...context, path: nextPath, depth: depth + 1 }, rows)
  }
}

export function flattenResourceRows(resources = [], {
  expandedKeys = new Set(),
  searchKeyword = '',
  usedResourceIds = new Set(),
} = {}) {
  const roots = normalizeResourceTree(resources)
  const rows = []
  for (const root of roots) {
    flattenNode(root, {
      path: [],
      depth: 0,
      expandedKeys,
      searchKeyword: String(searchKeyword || '').trim(),
      usedResourceIds,
    }, rows)
  }
  return rows
}
