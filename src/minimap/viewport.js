import { screenToWorld } from './coords.js'

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

export function panViewportBy(viewport, delta) {
  const before = normalizeViewport(viewport)
  return {
    x: before.x + delta.x,
    y: before.y + delta.y,
    scale: before.scale,
  }
}
