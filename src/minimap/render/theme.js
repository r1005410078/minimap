// 内置深色默认主题。渲染器与后续切片复用；业务方可通过 theme prop 覆盖。
// 见 docs/superpowers/specs/2026-06-18-phase-1-canvas-renderer.md

export const defaultTheme = {
  background: '#0f1318',
  grid: { color: '#252c35', size: 24, dot: true, dotRadius: 1.1 },
  accent: '#2bdd7f',
  panel: {
    fill: '#151a20',
    stroke: '#303741',
    shadow: 'rgba(0, 0, 0, 0.32)',
  },
  node: {
    fill: '#252a31',
    stroke: '#3b424c',
    selectedStroke: '#3d9cff',
    text: '#d7dde6',
    font: '13px sans-serif',
    radius: 6,
  },
  group: {
    fill: 'rgba(21, 26, 32, 0.92)',
    stroke: '#303741',
    header: '#8f98a5',
    font: '13px sans-serif',
    radius: 12,
    scrollbar: { track: '#171d24', thumb: '#313945', thumbHover: '#687482' },
    dropSlot: { fill: '#233044', stroke: '#3d9cff' },
  },
  edge: { color: '#3a4350', width: 1, arrowSize: 6 },
}
