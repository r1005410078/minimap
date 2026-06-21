# Resource Tree Virtualization Design

## Background

The left resource tree currently renders every category and resource item through Vue DOM loops. That is fine for the demo data, but it will not hold up when the resource catalog contains 10000 items, especially once search, multi-select, disabled states, and drag payloads are added.

This design focuses only on the left resource tree. It does not change the main graph layout or Canvas renderer, except where batch resource drops need to create multiple graph nodes.

## Goals

- Support 10000 resource items in the left resource tree without creating 10000 DOM rows.
- Keep fast scrollbar dragging from showing blank space.
- Support nested folders, not only the current category plus item shape.
- Support desktop tree multi-select: click, Cmd/Ctrl-click, Shift-click, keyboard focus movement.
- Allow dragging multiple selected resources into the canvas in one action.
- Add a configuration that disables resource rows already present on the canvas.
- Keep the current `resources` prop shape compatible.
- Avoid new runtime dependencies.

## Non-Goals

- Do not render the resource tree with Canvas.
- Do not introduce async loading or remote paging in this slice.
- Do not support dragging folders into the canvas by default.
- Do not change graph layout, grouping, or canvas search behavior.
- Do not introduce a global store or pub-sub layer.

## Public API

`resources` remains compatible with the existing two-level shape:

```js
[
  {
    category: 'Storage',
    expanded: true,
    items: [
      { id: 'site', label: 'Site' },
    ],
  },
]
```

The resource tree also accepts a nested shape for future callers:

```js
[
  {
    id: 'storage',
    label: 'Storage',
    type: 'folder',
    expanded: true,
    children: [
      {
        id: 'bms',
        label: 'BMS',
        type: 'folder',
        children: [
          { id: 'bms-stack', label: 'BMS Stack', type: 'resource' },
        ],
      },
    ],
  },
]
```

If `type` is omitted, nodes with `children` are treated as folders and leaf nodes are treated as resources. The existing category shape is normalized into folder nodes whose children are resource nodes.

Add an option:

```js
options: {
  disableUsedResources: false,
}
```

When `disableUsedResources` is true, a resource row is disabled if its resource id appears in any graph node at `node.data.resourceId`.

`ResourceTree` receives a derived prop from `Minimap.vue`:

```js
usedResourceIds: Set<string>
```

The prop defaults to an empty set and is only populated when `options.disableUsedResources` is true.

## Data Model

Add pure resource-tree helpers under `src/minimap/resource-tree/`:

- `model.js`: normalize resources, flatten visible rows, filter rows for search, derive disabled flags.
- `selection.js`: calculate selection and focus changes independent of Vue.
- `virtual-window.js`: calculate visible row windows from scroll position and viewport height.

Internal normalized nodes:

```js
{
  id: string,
  label: string,
  type: 'folder' | 'resource',
  children?: NormalizedResourceNode[],
  resource?: object,
  expanded?: boolean,
}
```

Flattened visible rows:

```js
{
  key: string,
  id: string,
  label: string,
  type: 'folder' | 'resource',
  depth: number,
  expanded: boolean,
  disabled: boolean,
  item: object,
}
```

`key` is path-based, for example `folder:storage/bms` or `resource:storage/bms/bms-stack`, so duplicate ids in separate folders do not collide in the DOM. Selection identity uses row keys. Drag payloads use original resource objects.

## Flattening and Search

The resource tree keeps a cached `visibleRows` array. It is rebuilt only when one of these inputs changes:

- `resources`
- expanded folder keys
- search keyword
- `usedResourceIds`

Plain scrolling never rebuilds `visibleRows`.

Search is debounced by 100-150ms. While a new search is pending, the tree keeps rendering the previous `visibleRows` so typing cannot block scrolling. Search matches by `label` and `id`. Matching descendants keep their ancestor folders visible, even if those folders are collapsed in normal mode.

## Virtual Scrolling

Rows use a fixed height. The first implementation should use one row height for both folders and resources so `scrollTop -> startIndex` is O(1).

The virtual list renders:

- a spacer with total height: `visibleRows.length * rowHeight`
- an absolutely positioned row layer translated by `startIndex * rowHeight`
- only rows in `[startIndex - overscan, endIndex + overscan]`

Fast scrollbar dragging must not show blank content. To support that:

- Scroll handling synchronously computes the next window.
- Window calculation is O(1) plus O(rendered rows).
- Normal overscan is around 12-20 rows.
- When scroll delta is large, temporary overscan expands to around 80-120 rows.
- The render path never performs recursive flattening, search filtering, graph scanning, or payload construction.

## Multi-Select and Keyboard

Selection applies only to enabled resource rows. Folder rows can receive focus and support expand/collapse, but they are not part of the drag selection by default.

Supported interactions:

- Click resource: select only that resource.
- Cmd/Ctrl-click resource: toggle that resource.
- Shift-click resource: select the enabled resource range between the anchor and clicked row.
- Arrow up/down: move focus by visible row.
- Arrow right on folder: expand, or move into the first child if already expanded.
- Arrow left on folder: collapse, or move to parent if already collapsed.
- Space on resource: toggle selection.
- Enter on folder: toggle expansion.

The selection helper receives the current visible rows and returns next `selectedKeys`, `focusedKey`, and `anchorKey`. Vue owns the actual reactive state.

## Drag and Drop

`dragstart` on a resource row builds the payload at the last moment. If the dragged row is already selected, all selected enabled resource rows are included. Otherwise the dragged row becomes the only dragged resource.

Payload shape:

```js
{
  resources: [
    { id, label, kind, ...rest },
  ],
}
```

For backward compatibility, single-resource drag can still include the existing object fields at the top level, but the canvas drop path should prefer `payload.resources` when present.

When multiple resources are dropped into the canvas, they become consecutive siblings under the same target parent, in current visible row order. Dropping on a plain node appends all resources to that node's children. The batch drop is one undoable graph operation.

Graph nodes created from resources must store the source resource id:

```js
{
  id: generatedNodeId,
  label: resource.label,
  parentId,
  children: [],
  kind: resource.kind,
  data: {
    ...resource.data,
    resourceId: resource.id,
  },
}
```

If `disableUsedResources` is enabled, those resources become disabled in the tree after the graph change is emitted and the tree receives updated graph state.

## Canvas Integration

`Minimap.vue` passes the graph-derived `usedResourceIds` into `ResourceTree` when `effectiveOptions.disableUsedResources` is true. The set is built from `props.graph.nodes` by reading `node.data?.resourceId`.

`drag-controller` updates resource drop parsing to support both:

- legacy single-resource payload
- new batch payload with `resources`

`graph-operations.js` adds a new `drop-nodes` operation for batch resource drops. Existing `drop-node` remains available for legacy single-resource code paths, but `drag-controller` should use `drop-nodes` for both one-item and many-item resource payloads after this refactor. The operation produces one history entry and one `change` emit.

For event compatibility, `Minimap` continues emitting `node-drop` once per created node. Each payload includes the original `{ resource, parentId, index }` fields, plus `batchId`, `batchIndex`, and `batchSize` metadata so callers can distinguish one batch from separate drops.

## Rendering and Styling

The visual design should stay close to the existing dark workbench style:

- folder rows show a disclosure caret and optional count
- resource rows show icon/dot, label, and drag handle affordance
- selected rows use a clear active background
- focused row remains visible even when not selected
- disabled rows are muted, not draggable, and excluded from selection ranges
- search matches may use subtle text emphasis later, but that is optional for the first implementation

Rows must have stable dimensions and no layout shift on hover, selected, disabled, or focused states.

## Implementation Slices

Slice 1: pure resource-tree model and virtual window.

- Add `resource-tree/model.js` for normalization, flattening, nested expansion, search filtering, and disabled row derivation.
- Add `resource-tree/virtual-window.js` for fixed-height window calculation and fast-scroll overscan.
- Cover 10000-row data with pure tests before touching Vue rendering.

Slice 2: resource-tree selection model.

- Add `resource-tree/selection.js` for click, Cmd/Ctrl toggle, Shift range, keyboard focus movement, and disabled row exclusion.
- Keep folder focus and resource selection separate.
- Cover mouse and keyboard transitions with pure tests.

Slice 3: virtualized `ResourceTree.vue`.

- Replace full DOM loops with fixed-height virtual rows.
- Add nested folder expand/collapse, debounced search, fast-scroll overscan, stable row keys, selected/focused/disabled styles, and lazy drag payload construction.
- Keep existing two-level resource data and single-resource drag behavior compatible.

Slice 4: batch drop graph operation.

- Add `drop-nodes` to `graph-operations.js`.
- Preserve one undo/redo entry and one `change` emit for a batch.
- Ensure created graph nodes store `data.resourceId`.
- Keep legacy `drop-node` available, while resource drag uses `drop-nodes`.

Slice 5: canvas and Minimap integration.

- Pass `usedResourceIds` from `Minimap.vue` to `ResourceTree` when `options.disableUsedResources` is true.
- Update `drag-controller` to parse `payload.resources`.
- Emit compatible `node-drop` events with batch metadata.
- Add integration tests for batch drag, disabled resources, and undo/redo.

## Testing Strategy

Pure tests:

- Normalization supports existing category data and nested folder data.
- Flattening respects expanded state and arbitrary depth.
- Search keeps matching descendants and ancestors visible.
- Disabled rows derive from `usedResourceIds`.
- Virtual window calculates correct start/end rows for top, middle, bottom, and large jump scrolls.
- Fast-scroll overscan expands for large deltas.
- Selection supports click, Cmd/Ctrl toggle, Shift range, keyboard focus, and disabled row exclusion.

Component tests:

- 10000 resource items render only a small DOM row count.
- Jumping `scrollTop` near the bottom immediately renders non-empty rows from that region.
- Expanding and collapsing nested folders updates visible rows without losing focus incorrectly.
- Search input filters rows after debounce while preserving old rows before debounce completes.
- Multi-select drag emits a batch payload in visible row order.
- Disabled resources cannot be selected or dragged.

Integration tests:

- Batch resource drop creates consecutive graph siblings.
- Batch drop is undone and redone as one history action.
- Created graph nodes include `data.resourceId`.
- With `disableUsedResources`, resources already represented in the graph are disabled.

## Acceptance Criteria

- A resource catalog with 10000 resources does not create 10000 DOM nodes.
- Fast scroll jumps render real rows immediately and do not leave a blank viewport.
- Nested folders can expand, collapse, search, and virtualize correctly.
- Desktop multi-select works for mouse and keyboard.
- Dragging multiple selected resources into the canvas creates multiple graph nodes in one operation.
- Enabling `options.disableUsedResources` disables rows whose ids appear in `graph.nodes[*].data.resourceId`.
- Existing single-resource drag and existing two-level `resources` data continue to work.
