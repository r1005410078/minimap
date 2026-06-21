import { applySelectionSet } from './selection.js'

export function createSelectionController(deps) {
  let internalSelectedIds = []

  function getSelectedIds() {
    return deps.getSelectedIdsProp() ?? internalSelectedIds
  }

  function setSelected(ids) {
    const nextIds = [...ids]
    if (deps.getSelectedIdsProp() == null) internalSelectedIds = nextIds
    deps.emitSelect(nextIds)
    deps.renderCurrent()
  }

  function select(ids, mode = 'replace') {
    setSelected(applySelectionSet(getSelectedIds(), ids, mode))
  }

  function clearSelection() {
    setSelected([])
  }

  return { getSelectedIds, setSelected, select, clearSelection }
}
