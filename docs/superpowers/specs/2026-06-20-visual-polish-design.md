# Visual Polish Design

## Context

Phase 4 is complete and Phase 5 has been split into editing/state slices. Before starting Phase 5, the component needs a visual pass to better match the provided dark workstation reference:

- left resource tree with a dense operational feel;
- top toolbar shell;
- dark dotted canvas;
- rounded node and group cards;
- floating overview in the lower right.

This is a visual polish slice only. It must not introduce Phase 5 editing behavior such as undo/redo, deletion, copy, cross-parent drag, readonly mode, or before hooks.

## Selected Direction

Use option B from the visual companion: **visual polish plus toolbar shell**.

The toolbar exists as layout and visual structure, with button affordances and disabled states where needed. It does not perform new editing mutations. Existing interactions, including pan/zoom, selection, marquee selection, search, resource drop, group scrolling, group reorder, and overview navigation, must keep their current semantics.

## Scope

### In Scope

- Refresh `defaultTheme` to a darker, higher-polish visual language:
  - dotted-grid background instead of heavy square-grid emphasis;
  - brighter but restrained text;
  - green accent for status indicators;
  - softer node/group borders;
  - rounded nodes, rounded groups, and subtle shadows in the default renderer.
- Update `renderer.js` default drawing:
  - draw dotted grid;
  - draw rounded node cards;
  - draw group containers with rounded borders, header status dot, label, and child count;
  - draw group children as card-like items consistent with standalone nodes;
  - keep selection/highlight/dim behavior readable.
- Update `Minimap.vue` shell:
  - add a top toolbar overlay above the canvas area;
  - move/reshape built-in search to fit the workbench surface;
  - keep overview floating in the lower right with a framed panel style;
  - ensure the canvas remains focusable and receives pointer/keyboard events as before.
- Update `ResourceTree.vue`:
  - add resource tree title and a disabled-looking "拖至画布" affordance;
  - make categories and resources closer to the reference;
  - keep resource drag data format unchanged.
- Keep the component dependency-free. Use text/icon glyphs or CSS shapes, not a new icon package.
- Add focused tests for:
  - toolbar shell renders;
  - resource items remain draggable and emit the same drag payload;
  - search and overview switches still hide/show their UI;
  - renderer still calls expected canvas APIs without throwing.

### Out of Scope

- Real toolbar commands for undo/redo/delete/copy/layout editing.
- New graph mutation APIs.
- Cross-parent node drag.
- Readonly/edit mode.
- Import/export.
- Accessibility status area and keyboard option switches planned for Phase 5 slice 4.
- Pixel-perfect matching of the reference screenshot.

## Component Design

### `Minimap.vue`

The top-level structure remains a flex layout:

- left `ResourceTree`;
- right canvas workbench area;
- inside the workbench:
  - toolbar overlay at the top;
  - canvas fills the full remaining surface;
  - search panel floats near the top-right or inside the toolbar-adjacent surface;
  - overview panel floats at the bottom-right.

The toolbar is intentionally presentational in this slice. Buttons can show disabled visual states for future-only actions. Existing operations that already exist, such as fit/center/search/overview navigation, should keep their current public methods and UI surfaces; wiring those operations into toolbar buttons is outside this slice unless it is needed for visual affordance only and does not change behavior.

### `ResourceTree.vue`

The resource tree gets a title row and a drag hint. Resource categories remain data-driven from the existing `resources` prop. Each item remains the draggable leaf node, using the same `application/json` data transfer payload.

### `renderer.js` and `theme.js`

Renderer changes are visual-only. The public `theme` override shape should remain compatible. Existing custom renderers still take precedence over default node/group/edge drawing.

The renderer can add small helper functions for rounded rectangles, clipped text, and status dots, but should keep drawing behavior local to `renderer.js`.

## Data Flow

No new graph fields or events are introduced.

Existing props and events keep their current behavior:

- `graph`, `resources`, `layoutDirection`, `selectedIds`, `groupStates`, `viewport`, `options`, `theme`;
- `select`, `node-drop`, `change`, `group-state-change`, `group-reorder`, `viewport-change`, `search`.

## Error Handling

This slice does not introduce new error states. Existing rendering should still be defensive around missing nodes inside groups, as it is today.

## Testing

Use existing Node/Vue test infrastructure.

Required checks:

- Component shell test: toolbar exists, canvas still exists, resource tree still exists.
- Options test: `enableSearch: false` and `enableOverview: false` still remove those panels.
- Resource tree test: drag payload remains unchanged.
- Renderer test: default render path succeeds with the refreshed theme and draws rounded/card primitives where the mock context supports them.
- Full suite and build should pass after implementation.

## Acceptance Criteria

- The app visually reads as a dark workstation matching the provided reference direction.
- Left resource tree, top toolbar shell, canvas, search, and overview have a coherent shared visual language.
- Existing interactions are not intentionally changed.
- No Phase 5 editing/state behavior is introduced.
- Tests and build pass.
