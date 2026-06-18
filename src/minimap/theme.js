// 内置深色默认主题。渲染器与后续切片复用；业务方可通过 theme prop 覆盖。
// 见 docs/superpowers/specs/2026-06-18-phase-1-canvas-renderer.md

export const defaultTheme = {
  background: '#0f1419',
  grid: { color: '#1b2530', size: 40 },
  node: {
    fill: '#1e2a38',
    stroke: '#3a4f66',
    selectedStroke: '#5aa9ff',
    text: '#cfe3f7',
    font: '12px sans-serif',
  },
  group: {
    fill: '#16202b',
    stroke: '#3a4f66',
    header: '#9fb6cc',
    font: '12px sans-serif',
  },
  edge: { color: '#3a4f66', width: 1, arrowSize: 6 },
}
