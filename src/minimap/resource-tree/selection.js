function rowByKey(rows, key) {
  return rows.find((row) => row.key === key) || null
}

function selectable(row) {
  return row?.type === 'resource' && row.disabled !== true
}

function rangeKeys(rows, anchorKey, targetKey) {
  const anchorIndex = rows.findIndex((row) => row.key === anchorKey)
  const targetIndex = rows.findIndex((row) => row.key === targetKey)
  if (anchorIndex === -1 || targetIndex === -1) return []
  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return rows.slice(start, end + 1).filter(selectable).map((row) => row.key)
}

export function applyResourceRowClick({
  rows,
  selectedKeys,
  focusedKey,
  anchorKey,
  key,
  additive = false,
  range = false,
}) {
  const row = rowByKey(rows, key)
  if (!row) return { selectedKeys, focusedKey, anchorKey }
  if (!selectable(row)) return { selectedKeys, focusedKey: key, anchorKey }

  if (range) {
    const selected = new Set(rangeKeys(rows, anchorKey || key, key))
    return { selectedKeys: selected, focusedKey: key, anchorKey: anchorKey || key }
  }

  if (additive) {
    const selected = new Set(selectedKeys)
    if (selected.has(key)) selected.delete(key)
    else selected.add(key)
    return { selectedKeys: selected, focusedKey: key, anchorKey: key }
  }

  return { selectedKeys: new Set([key]), focusedKey: key, anchorKey: key }
}

export function moveResourceFocus(rows, focusedKey, delta) {
  if (rows.length === 0) return null
  const currentIndex = focusedKey ? rows.findIndex((row) => row.key === focusedKey) : -1
  const nextIndex = Math.max(0, Math.min(rows.length - 1, currentIndex === -1 ? 0 : currentIndex + delta))
  return rows[nextIndex]?.key ?? null
}

export function toggleFocusedResource({ rows, selectedKeys, focusedKey }) {
  const row = rowByKey(rows, focusedKey)
  if (!selectable(row)) return { selectedKeys, focusedKey, anchorKey: focusedKey }
  const selected = new Set(selectedKeys)
  if (selected.has(focusedKey)) selected.delete(focusedKey)
  else selected.add(focusedKey)
  return { selectedKeys: selected, focusedKey, anchorKey: focusedKey }
}
