export const BUILT_IN_CONTEXT_MENU_ACTIONS = new Set([
  'add-child',
  'add-sibling',
  'copy',
  'paste-into-target',
  'delete',
  'center-target',
  'toggle-group',
  'paste',
  'fit-to-screen',
  'center-selection',
  'toggle-search',
  'toggle-grid',
  'toggle-performance',
  'toggle-hide-text-during-interaction',
  'toggle-readonly',
])

function normalizeBoolean(value, fallback) {
  return value === undefined ? fallback : value
}

function normalizeMenuItem(input) {
  return {
    id: input.id,
    label: input.label ?? '',
    type: input.type ?? 'item',
    visible: normalizeBoolean(input.visible, true),
    disabled: normalizeBoolean(input.disabled, false),
    checked: normalizeBoolean(input.checked, false),
    danger: normalizeBoolean(input.danger, false),
    action: input.action ?? input.id,
  }
}

function separator(id) {
  return normalizeMenuItem({ id, type: 'separator', label: '', disabled: true })
}

function optionEnabled(options, key, fallback) {
  return options && options[key] !== undefined ? options[key] : fallback
}

function commonItems(context) {
  const readonly = context.readonly === true
  const hasSelection = Array.isArray(context.selectedIds) && context.selectedIds.length > 0
  return [
    normalizeMenuItem({
      id: 'paste',
      label: '粘贴',
      disabled: readonly || !context.canPaste || !hasSelection,
    }),
    normalizeMenuItem({ id: 'fit-to-screen', label: '适配视图' }),
    normalizeMenuItem({ id: 'center-selection', label: '居中选中', disabled: !hasSelection }),
    separator('common-separator'),
    normalizeMenuItem({
      id: 'toggle-search',
      label: '显示搜索',
      type: 'checkbox',
      checked: optionEnabled(context.options, 'enableSearch', true),
    }),
    normalizeMenuItem({
      id: 'toggle-grid',
      label: '显示网格',
      type: 'checkbox',
      checked: optionEnabled(context.options, 'showGrid', true),
    }),
    normalizeMenuItem({
      id: 'toggle-performance',
      label: '显示性能信息',
      type: 'checkbox',
      checked: optionEnabled(context.options, 'showPerformance', true),
    }),
    normalizeMenuItem({
      id: 'toggle-hide-text-during-interaction',
      label: '拖动时隐藏文字',
      type: 'checkbox',
      checked: optionEnabled(context.options, 'hideTextDuringInteraction', false),
    }),
    normalizeMenuItem({
      id: 'toggle-readonly',
      label: '编辑/只读切换',
      type: 'checkbox',
      checked: readonly,
    }),
  ]
}

function targetItems(context) {
  const readonly = context.readonly === true
  const hasTarget = context.targetType === 'node' || context.targetType === 'group'
  const hasSelection = Array.isArray(context.selectedIds) && context.selectedIds.length > 0
  const canCopy = hasTarget || hasSelection
  return [
    normalizeMenuItem({ id: 'add-child', label: '添加子节点', disabled: true }),
    normalizeMenuItem({ id: 'add-sibling', label: '添加兄弟节点', disabled: true }),
    normalizeMenuItem({ id: 'copy', label: '复制', disabled: !canCopy }),
    normalizeMenuItem({
      id: 'paste-into-target',
      label: '粘贴到此节点下',
      disabled: readonly || !context.canPaste || !hasTarget,
    }),
    normalizeMenuItem({ id: 'delete', label: '删除', danger: true, disabled: readonly || !canCopy }),
    separator('target-separator'),
    normalizeMenuItem({ id: 'center-target', label: '居中到此节点', disabled: !hasTarget }),
    normalizeMenuItem({
      id: 'toggle-group',
      label: '展开/折叠子分组',
      disabled: !context.hasToggleableGroup,
    }),
    separator('target-common-separator'),
  ]
}

export function buildContextMenuItems(context) {
  const normalizedContext = {
    targetType: context.targetType ?? 'canvas',
    targetId: context.targetId ?? null,
    groupId: context.groupId ?? null,
    screenPoint: context.screenPoint ?? { x: 0, y: 0 },
    worldPoint: context.worldPoint ?? { x: 0, y: 0 },
    selectedIds: Array.isArray(context.selectedIds) ? context.selectedIds : [],
    readonly: context.readonly === true,
    canPaste: context.canPaste === true,
    canUndo: context.canUndo === true,
    canRedo: context.canRedo === true,
    options: context.options ?? {},
    hasToggleableGroup: context.hasToggleableGroup === true,
  }
  const defaults =
    normalizedContext.targetType === 'canvas'
      ? commonItems(normalizedContext)
      : [...targetItems(normalizedContext), ...commonItems(normalizedContext)]
  return defaults.filter((item) => item.visible !== false)
}

export function mergeContextMenuItems(context, defaults, customItems) {
  if (customItems == null) return defaults
  if (typeof customItems === 'function') {
    return customItems(context, defaults).map(normalizeMenuItem).filter((item) => item.visible !== false)
  }
  const result = [...defaults]
  for (const custom of customItems) {
    const normalized = normalizeMenuItem(custom)
    const index = result.findIndex((item) => item.id === normalized.id)
    if (index === -1) result.push(normalized)
    else result[index] = { ...result[index], ...normalized }
  }
  return result.filter((item) => item.visible !== false)
}
