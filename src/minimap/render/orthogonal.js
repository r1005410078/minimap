// Phase 1 正交连线：根据两个世界坐标包围盒生成固定四点的三段折线路径。
// 不做避障；不依赖 Canvas / Vue / graph。

function axisConfig(mainAxis) {
  return mainAxis === 'y'
    ? {
        main: 'y',
        cross: 'x',
        mainSize: 'height',
        crossSize: 'width',
      }
    : {
        main: 'x',
        cross: 'y',
        mainSize: 'width',
        crossSize: 'height',
      }
}

function center(box, axis, sizeKey) {
  return box[axis] + box[sizeKey] / 2
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd
}

function point(mainAxis, mainValue, crossValue) {
  return mainAxis === 'x' ? { x: mainValue, y: crossValue } : { x: crossValue, y: mainValue }
}

export function orthogonalPath(fromBox, toBox, mainAxis = 'x') {
  const axis = axisConfig(mainAxis)
  const fromMainStart = fromBox[axis.main]
  const fromMainEnd = fromMainStart + fromBox[axis.mainSize]
  const toMainStart = toBox[axis.main]
  const toMainEnd = toMainStart + toBox[axis.mainSize]
  const mainOverlaps = rangesOverlap(fromMainStart, fromMainEnd, toMainStart, toMainEnd)

  const routeAxis = mainOverlaps
    ? {
        main: axis.cross,
        cross: axis.main,
        mainSize: axis.crossSize,
        crossSize: axis.mainSize,
      }
    : axis

  const fromCenter = center(fromBox, routeAxis.main, routeAxis.mainSize)
  const toCenter = center(toBox, routeAxis.main, routeAxis.mainSize)
  const fromCross = center(fromBox, routeAxis.cross, routeAxis.crossSize)
  const toCross = center(toBox, routeAxis.cross, routeAxis.crossSize)
  const fromBeforeTo = fromCenter <= toCenter

  let fromExitMain
  let toEntryMain
  let bendMain

  if (fromCenter === toCenter) {
    if (fromCross <= toCross) {
      fromExitMain = fromBox[routeAxis.main] + fromBox[routeAxis.mainSize]
      toEntryMain = toBox[routeAxis.main] + toBox[routeAxis.mainSize]
      bendMain = Math.max(fromExitMain, toEntryMain)
    } else {
      fromExitMain = fromBox[routeAxis.main]
      toEntryMain = toBox[routeAxis.main]
      bendMain = Math.min(fromExitMain, toEntryMain)
    }
  } else {
    fromExitMain = fromBeforeTo ? fromBox[routeAxis.main] + fromBox[routeAxis.mainSize] : fromBox[routeAxis.main]
    toEntryMain = fromBeforeTo ? toBox[routeAxis.main] : toBox[routeAxis.main] + toBox[routeAxis.mainSize]
    bendMain = (fromExitMain + toEntryMain) / 2
  }

  return [
    point(routeAxis.main, fromExitMain, fromCross),
    point(routeAxis.main, bendMain, fromCross),
    point(routeAxis.main, bendMain, toCross),
    point(routeAxis.main, toEntryMain, toCross),
  ]
}
