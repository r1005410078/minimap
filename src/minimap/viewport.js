import { screenToWorld } from './coords.js'
import { easeOutCubic } from './layout-transition.js'

export const DEFAULT_VIEWPORT = Object.freeze({ x: 0, y: 0, scale: 1 })

const DEFAULT_OPTIONS = Object.freeze({
  minScale: 0.25,
  maxScale: 3,
  zoomSensitivity: 0.0015,
})

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback
}

export function viewportOptions(options = null) {
  const rawMin = finiteOr(options?.minScale, DEFAULT_OPTIONS.minScale)
  const rawMax = finiteOr(options?.maxScale, DEFAULT_OPTIONS.maxScale)
  return {
    minScale: Math.min(rawMin, rawMax),
    maxScale: Math.max(rawMin, rawMax),
    zoomSensitivity: finiteOr(options?.zoomSensitivity, DEFAULT_OPTIONS.zoomSensitivity),
  }
}

export function clampScale(scale, options = DEFAULT_OPTIONS) {
  const normalized = viewportOptions(options)
  return Math.min(normalized.maxScale, Math.max(normalized.minScale, finiteOr(scale, DEFAULT_VIEWPORT.scale)))
}

export function normalizeViewport(viewport, options = DEFAULT_OPTIONS) {
  return {
    x: finiteOr(viewport?.x, DEFAULT_VIEWPORT.x),
    y: finiteOr(viewport?.y, DEFAULT_VIEWPORT.y),
    scale: clampScale(viewport?.scale, options),
  }
}

export function sameViewport(a, b) {
  return a.x === b.x && a.y === b.y && a.scale === b.scale
}

export function zoomViewportAt(viewport, screenPoint, deltaY, options = DEFAULT_OPTIONS) {
  const normalizedOptions = viewportOptions(options)
  const before = normalizeViewport(viewport, normalizedOptions)
  const worldPoint = screenToWorld(screenPoint, before)
  const zoomFactor = Math.exp(-deltaY * normalizedOptions.zoomSensitivity)
  const nextScale = clampScale(before.scale * zoomFactor, normalizedOptions)
  return {
    x: screenPoint.x - worldPoint.x * nextScale,
    y: screenPoint.y - worldPoint.y * nextScale,
    scale: nextScale,
  }
}

export function panViewportBy(viewport, delta, options = DEFAULT_OPTIONS) {
  const before = normalizeViewport(viewport, options)
  return {
    x: before.x + delta.x,
    y: before.y + delta.y,
    scale: before.scale,
  }
}

export function tweenViewport(from, to, progress) {
  const eased = easeOutCubic(progress)
  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
    scale: from.scale + (to.scale - from.scale) * eased,
  }
}

export function fitViewportToBounds(bounds, viewportWidth, viewportHeight, options = null, padding = 40) {
  const degenerate =
    !Number.isFinite(bounds?.minX) ||
    !Number.isFinite(bounds?.maxX) ||
    !Number.isFinite(bounds?.minY) ||
    !Number.isFinite(bounds?.maxY)
  if (degenerate) return DEFAULT_VIEWPORT

  const contentWidth = Math.max(1, bounds.maxX - bounds.minX)
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY)
  const availableWidth = Math.max(1, viewportWidth - 2 * padding)
  const availableHeight = Math.max(1, viewportHeight - 2 * padding)
  const rawScale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight)
  const scale = clampScale(rawScale, options)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return {
    x: viewportWidth / 2 - centerX * scale,
    y: viewportHeight / 2 - centerY * scale,
    scale,
  }
}

export function centerViewportOn(worldPoint, viewport, viewportWidth, viewportHeight) {
  return {
    x: viewportWidth / 2 - worldPoint.x * viewport.scale,
    y: viewportHeight / 2 - worldPoint.y * viewport.scale,
    scale: viewport.scale,
  }
}
