// Phase 1 坐标转换层：世界坐标与屏幕坐标互转。
// screen = world * scale + viewport ；供拖入、缩放、框选、overview 复用。
// 见 docs/superpowers/specs/2026-06-18-phase-1-core-logic.md

export function worldToScreen(point, viewport) {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  }
}

export function screenToWorld(point, viewport) {
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  }
}

export function screenRectToWorld(rect, viewport) {
  const a = screenToWorld({ x: rect.x, y: rect.y }, viewport)
  const b = screenToWorld({ x: rect.x + rect.width, y: rect.y + rect.height }, viewport)
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}
