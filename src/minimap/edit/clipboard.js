let clipboard = null

export function getClipboard() {
  return clipboard
}

export function setClipboard(snapshot) {
  clipboard = snapshot
}

export function hasClipboard() {
  return !!clipboard?.nodes?.length
}

export function clearClipboard() {
  clipboard = null
}
