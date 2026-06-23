# Minimap Preview Mode Design

## Background

`Minimap` is currently optimized for the full editing workspace: resource tree on the left, search, zoom/history controls, performance HUD, and overview panel. Some hosts need an embedded preview view that keeps navigation and search but removes management-heavy chrome.

This design adds a compact preview mode to `Minimap.vue` without changing graph rendering, layout, selection, or search behavior. Preview mode also disables graph editing so the canvas behaves like a navigable read-only view.

## Goals

- Add one public option for an embedded preview presentation.
- Keep search visible in preview mode.
- Keep the lower-left zoom controls visible in preview mode.
- Hide resource-management and diagnostics chrome in preview mode.
- Preserve existing behavior when preview mode is not enabled.
- Avoid new runtime dependencies.

## Non-Goals

- Do not change pointer panning, wheel zoom, search navigation, or canvas rendering.
- Do not add a new layout algorithm or preview-specific renderer.
- Do not remove existing granular options such as `enableSearch`, `enableOverview`, or `showPerformance`.

## Public API

Add a new option:

```js
options: {
  previewMode: true,
}
```

When `previewMode` is `true`, `Minimap` uses a compact embedded presentation and treats the canvas as read-only.

## Preview Mode Behavior

Preview mode keeps:

- the main canvas
- pointer panning and wheel zoom
- search, as long as `options.enableSearch !== false`
- the lower-left zoom controls: zoom out, scale label/reset, zoom in
- view/navigation context menu actions

Preview mode disables:

- resource drops into the canvas
- node move / reorder interactions
- delete, paste, import, and other graph-mutating edit actions
- any edit path that is already blocked by `readonly`

Preview mode hides:

- `ResourceTree`
- the collapsed resource-tree restore button
- lower-left undo/redo history controls
- the performance HUD, regardless of `showPerformance`
- the right-bottom `Overview`, regardless of `enableOverview`
- editing and configuration-heavy default context menu actions

The component should still honor explicit search disabling:

```js
options: {
  previewMode: true,
  enableSearch: false,
}
```

In that case, search remains hidden because `enableSearch` is more specific than preview mode's default presentation.

## Component Structure

`effectiveOptions` gains a default:

```js
previewMode: false
```

`Minimap.vue` derives template visibility directly from `effectiveOptions.previewMode`:

- `ResourceTree`: render only when not preview mode and not collapsed.
- resource restore button: render only when not preview mode and resource tree is collapsed.
- search: keep current `enableSearch !== false` condition.
- performance HUD: render only when not preview mode and `showPerformance` is true.
- overview panel: render only when not preview mode and `enableOverview !== false`.
- bottom controls wrapper: keep visible because it contains zoom.
- history pod: render only when not preview mode.

`effectiveReadonly` should become:

```js
this.internalReadonly || this.effectiveOptions.previewMode === true
```

No controller API changes are needed because the existing edit and drag controllers already respect `getReadonly()`.

## Context Menu

Preview mode should adjust the default context menu to match the compact presentation. The menu remains available, but default items are limited to view/navigation actions.

Keep these default actions when applicable:

- `fit-to-screen`
- `center-selection`
- `center-target`
- `toggle-group`

Hide these default actions in preview mode:

- edit and clipboard actions: `add-child`, `add-sibling`, `copy`, `paste`, `paste-into-target`, `delete`
- configuration toggles: `toggle-search`, `toggle-grid`, `toggle-performance`, `toggle-hide-text-during-interaction`, `toggle-readonly`

This keeps preview mode from exposing controls that either mutate graph data or configure chrome that preview mode intentionally hides. In particular, `toggle-performance` must not appear because the performance HUD is hidden regardless of `showPerformance`.

Custom `contextMenuItems` remains an escape hatch for host-specific preview actions. Custom item merging should receive the preview-filtered defaults so callers can append domain actions without first removing workspace-only defaults.

## Data Flow

The new option follows the existing options flow:

1. Caller passes `options.previewMode`.
2. `internalOptions` mirrors `options`.
3. `effectiveOptions` merges defaults with `internalOptions`.
4. Template conditions decide which chrome is rendered.
5. Existing watcher for `options` closes context menu and updates layout/rendering.

## Testing

Add Vue component tests that mount `Minimap` with `options.previewMode: true` and verify:

- search is still rendered by default.
- zoom controls are still rendered.
- resource tree is not rendered.
- overview panel is not rendered.
- history controls are not rendered.
- performance HUD is not rendered even if `showPerformance: true`.
- search is hidden when `enableSearch: false` is explicitly combined with preview mode.

Add context menu tests that verify preview mode:

- keeps view/navigation defaults: `fit-to-screen`, `center-selection`, `center-target`, `toggle-group`.
- removes edit, clipboard, and configuration defaults.
- passes preview-filtered defaults into `contextMenuItems`.

Run the focused test first, then the full project verification:

```bash
npm test -- test/minimap-context-menu.test.js test/minimap-context-menu-controller.test.js
npm test -- test/minimap-shell.test.js
npm test
npm run build
```

## Compatibility

Existing callers are unaffected because `previewMode` defaults to `false`. Existing options continue to work. The main behavior change is that preview mode now implies read-only editing rules instead of requiring callers to combine it with `readonly`.
