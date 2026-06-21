export function resolveRenderQuality({ scale = 1, interacting = false } = {}) {
  if (scale < 0.18) {
    return {
      level: 'overview',
      showText: false,
      showGroupChildren: false,
      simplifyEdges: true,
      simplifyChrome: true,
    }
  }

  if (scale < 0.45 || interacting) {
    return {
      level: 'compact',
      showText: false,
      showGroupChildren: true,
      simplifyEdges: false,
      simplifyChrome: true,
    }
  }

  return {
    level: 'full',
    showText: true,
    showGroupChildren: true,
    simplifyEdges: false,
    simplifyChrome: false,
  }
}
