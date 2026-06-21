import { hitTest } from './interaction.js'
import { hasClipboard } from './clipboard.js'
import { BUILT_IN_CONTEXT_MENU_ACTIONS, buildContextMenuItems, mergeContextMenuItems } from './context-menu.js'

const CONTEXT_MENU_WIDTH = 190
const CONTEXT_MENU_MAX_HEIGHT = 360

export function createContextMenuController(deps) {
  let state = null
  let documentListener = null

  function groupForHit(hit) {
    const layout = deps.getLayout()
    if (!hit || hit.type !== 'group' || !layout) return null
    return layout.groups.find((group) => group.id === hit.id) ?? null
  }

  function contextFromHit(hit, event) {
    const screenPoint = deps.screenPointFromClient(event.clientX, event.clientY)
    const worldPoint = deps.pointFromClient(event.clientX, event.clientY)
    const base = {
      screenPoint,
      worldPoint,
      selectedIds: deps.getSelectedIds(),
      readonly: deps.getReadonly(),
      canPaste: hasClipboard(),
      canUndo: deps.canUndo(),
      canRedo: deps.canRedo(),
      options: deps.getOptions(),
    }
    if (hit?.type === 'node') {
      const node = deps.getGraph().nodes.get(hit.id)
      return { ...base, targetType: 'node', targetId: hit.id, groupId: null, hasToggleableGroup: !!node?.children?.length }
    }
    if (hit?.type === 'group') {
      const group = groupForHit(hit)
      return {
        ...base,
        targetType: 'group',
        targetId: group?.parentId ?? hit.childId ?? null,
        groupId: hit.id,
        hasToggleableGroup: !!group,
      }
    }
    return { ...base, targetType: 'canvas', targetId: null, groupId: null, hasToggleableGroup: false }
  }

  function clampPosition(screenPoint, items) {
    const itemCount = items.filter((item) => item.type !== 'separator').length
    const separatorCount = items.filter((item) => item.type === 'separator').length
    const estimatedHeight = Math.min(CONTEXT_MENU_MAX_HEIGHT, 16 + itemCount * 30 + separatorCount * 8)
    const { width: cssWidth, height: cssHeight } = deps.getCssSize()
    return {
      x: Math.max(8, Math.min(screenPoint.x, cssWidth - CONTEXT_MENU_WIDTH - 8)),
      y: Math.max(8, Math.min(screenPoint.y, cssHeight - estimatedHeight - 8)),
    }
  }

  function publish() {
    deps.onMenuStateChange(state)
  }

  function close() {
    state = null
    publish()
    if (documentListener) {
      document.removeEventListener('pointerdown', documentListener, true)
      documentListener = null
    }
  }

  function open(event) {
    const layout = deps.getLayout()
    if (!layout) return
    event.preventDefault()
    event.stopPropagation()
    close()
    deps.cancelPointerInteractions()
    deps.getCanvasEl()?.focus?.()
    const hit = hitTest(layout, deps.pointFromClient(event.clientX, event.clientY))
    const context = contextFromHit(hit, event)
    const defaults = buildContextMenuItems(context)
    const items = mergeContextMenuItems(context, defaults, deps.getContextMenuItemsProp())
    state = { context, items, position: clampPosition(context.screenPoint, items) }
    publish()
    if (!documentListener) {
      documentListener = (event) => {
        const menuEl = deps.getMenuEl()
        if (menuEl && menuEl.contains(event.target)) return
        close()
      }
      document.addEventListener('pointerdown', documentListener, true)
    }
  }

  function targetIdsForContext(context) {
    if (!context) return []
    const targetId = context.targetType === 'group' ? context.groupId : context.targetId
    if (!targetId) return []
    const selected = deps.getSelectedIds()
    return selected.includes(targetId) ? selected : [targetId]
  }

  function runWithTemporarySelection(ids, command) {
    const previous = deps.getSelectedIds()
    const shouldSwap = ids.length > 0 && !ids.every((id) => previous.includes(id))
    if (shouldSwap) deps.setSelected(ids)
    const result = command()
    if (shouldSwap) deps.setSelected(previous)
    return result
  }

  function executeAction(action, context) {
    if (action === 'copy') return runWithTemporarySelection(targetIdsForContext(context), deps.copySelection)
    if (action === 'delete') return runWithTemporarySelection(targetIdsForContext(context), deps.deleteSelection)
    if (action === 'paste-into-target') return deps.pasteInto(context.targetType === 'group' ? context.targetId : context.targetId)
    if (action === 'paste') return deps.paste()
    if (action === 'fit-to-screen') return deps.fitToScreen()
    if (action === 'center-selection') return deps.centerOnSelection()
    if (action === 'center-target' && context.targetId) return deps.centerOnNode(context.targetId)
    if (action === 'toggle-group' && context.groupId) {
      const group = deps.getLayout()?.groups.find((item) => item.id === context.groupId)
      if (!group) return
      deps.setGroupExpanded(context.groupId, !group.expanded)
      return
    }
    if (action === 'toggle-search') return deps.emitConfigChange('enableSearch', !deps.getOptions().enableSearch, context)
    if (action === 'toggle-grid') return deps.emitConfigChange('showGrid', !deps.getOptions().showGrid, context)
    if (action === 'toggle-performance') return deps.emitConfigChange('showPerformance', !deps.getOptions().showPerformance, context)
    if (action === 'toggle-hide-text-during-interaction') {
      return deps.emitConfigChange('hideTextDuringInteraction', !deps.getOptions().hideTextDuringInteraction, context)
    }
    if (action === 'toggle-readonly') return deps.emitConfigChange('readonly', !deps.getReadonly(), context)
  }

  function runItem(item) {
    if (!state || item.disabled) return
    const context = state.context
    deps.emitContextMenuAction({ action: item.action, item, context })
    if (BUILT_IN_CONTEXT_MENU_ACTIONS.has(item.action)) executeAction(item.action, context)
    close()
  }

  return { open, close, runItem, isOpen: () => state !== null }
}
