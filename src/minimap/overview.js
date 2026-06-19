// Phase 4 切片 3：Overview 小地图导航。纯函数，不依赖 Vue/DOM。
// 见 docs/superpowers/specs/2026-06-20-phase-4-overview-navigation.md
import { fitViewportToBounds } from './viewport.js'
import { screenToWorld } from './coords.js'
import { worldRectToScreen } from './renderer.js'

// 缩略图自己的"完整显示全部内容"视口变换，不受主视口 minScale/maxScale 限制——
// 缩略图必须永远显示全图，哪怕需要的缩放比例比主视口允许的 minScale 还小。
export function computeOverviewViewport(bounds, width, height, padding = 20) {
  return fitViewportToBounds(bounds, width, height, { minScale: 0, maxScale: Infinity }, padding)
}

// 把主视口当前可见的世界坐标范围，转换成缩略图坐标系下的屏幕矩形（用于画视口框）。
export function mainViewportFrameRect(mainViewport, mainWidth, mainHeight, overviewViewport) {
  const topLeft = screenToWorld({ x: 0, y: 0 }, mainViewport)
  const bottomRight = screenToWorld({ x: mainWidth, y: mainHeight }, mainViewport)
  const worldRect = {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  }
  return worldRectToScreen(worldRect, overviewViewport)
}

// 把一个屏幕矩形裁剪到画布范围内，避免视口框跑出缩略图边界时画出明显越界的线条。
// 只做绘制前的视觉裁剪，不改变调用方持有的真实矩形数据。
export function clampRectToCanvas(rect, width, height) {
  const x = Math.max(0, rect.x)
  const y = Math.max(0, rect.y)
  const right = Math.min(width, rect.x + rect.width)
  const bottom = Math.min(height, rect.y + rect.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}
