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
