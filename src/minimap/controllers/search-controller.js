import { searchNodes } from '../edit/search.js'

export function createSearchController(deps) {
  let keyword = ''
  let matches = []
  let currentIndex = -1

  function publish() {
    deps.onSearchStateChange({ keyword, matches, currentIndex })
  }

  function jumpTo(id) {
    deps.centerOnNode(id)
    deps.select([id])
  }

  function search(nextKeyword) {
    keyword = nextKeyword
    matches = searchNodes(deps.getGraph(), nextKeyword)
    currentIndex = matches.length > 0 ? 0 : -1
    publish()
    if (matches.length > 0) jumpTo(matches[0])
    const payload = { keyword, matches, current: matches[0] ?? null }
    deps.emitSearch(payload)
    return payload
  }

  function searchNext() {
    if (matches.length === 0) return
    currentIndex = (currentIndex + 1) % matches.length
    const id = matches[currentIndex]
    publish()
    jumpTo(id)
    deps.emitSearch({ keyword, matches, current: id })
  }

  function searchPrevious() {
    if (matches.length === 0) return
    currentIndex = (currentIndex - 1 + matches.length) % matches.length
    const id = matches[currentIndex]
    publish()
    jumpTo(id)
    deps.emitSearch({ keyword, matches, current: id })
  }

  function getCurrentMatchId() {
    return matches[currentIndex] ?? null
  }

  return { search, searchNext, searchPrevious, getCurrentMatchId }
}
