# Node Tree Mode Design

## Goal

The minimap currently pairs a left resource tree with a right topology canvas. For graphs with tens of thousands of nodes, the topology canvas becomes hard to browse and edit. Add a second right-side main view named "节点树" (node tree) so users can switch between topology editing and tree editing. Only one right-side main view is mounted at a time.

## Non-Goals

- Do not replace the left resource tree. It remains the source of draggable resources.
- Do not maintain a separate node-tree data model. The graph remains the single source of truth.
- Do not implement a canvas-rendered tree. The node tree should use DOM rows with virtualization for text, keyboard, and drag/drop ergonomics.

## User Model

- Left panel: "资源树", showing available resources that can be dragged into the graph.
- Right panel mode `topology`: existing canvas topology editor with overview, zoom, pan, and topology-specific interactions.
- Right panel mode `node-tree`: virtualized graph node tree for large-data browsing and editing.

The mode switch should read as a segmented control with two options: "拓扑图" and "节点树". The default is "拓扑图" to preserve current behavior.

## View Mode State

Add a display mode option with values:

- `topology`
- `node-tree`

The component should support both uncontrolled and controlled usage:

- Uncontrolled: Minimap owns the current display mode internally and emits changes.
- Controlled: an external prop can provide the current display mode; Minimap emits a mode-change event instead of mutating internal mode.

Switching modes changes only the mounted right-side UI. It must not mutate the graph, selected ids, group state, history stacks, or viewport. Selection should remain shared between modes.

## Node Tree Component

Create a dedicated `NodeTree.vue` component and supporting pure modules. Do not fold this into `ResourceTree.vue`; the two trees have different responsibilities and drag semantics.

The node tree renders rows derived from `graph.rootIds` and `graph.nodes`. Each row includes:

- node id
- label
- depth
- expanded/collapsed state
- selected/focused state
- metadata needed for drag/drop target calculation

The row list is virtualized using the existing virtual-window pattern. The target behavior is that tens of thousands of graph nodes produce a small mounted row count proportional to viewport height plus overscan.

## Node Tree Browsing

The node tree supports:

- expand/collapse by click, Enter, ArrowRight, and ArrowLeft
- single selection by click
- additive and range multi-select
- keyboard focus with ArrowUp and ArrowDown
- search that keeps matching ancestors visible and auto-expands matches while filtering

Search in node-tree mode should search graph nodes. It may reuse search controller behavior where practical, but the visible filtering and ancestor retention should live in node-tree pure helpers so it is testable without Vue.

## Node Drag/Reorder

Node rows are draggable. A drop target resolves to one of:

- `inside`: make dragged node(s) children of the target node
- `before`: insert dragged node(s) before the target node under the target's parent
- `after`: insert dragged node(s) after the target node under the target's parent
- `root`: insert or move node(s) at root level

For multi-select drag, preserve the selected nodes in current tree order after removing descendants whose ancestor is also selected. Reject drops into the dragged node itself or any dragged node descendant.

The graph operation layer already supports `move-nodes` into a non-root parent. It must be extended to support root-level movement with `toParentId: null` and root insertion indexes. That operation should still produce undo/redo inverses through `replace-graph`, matching existing multi-node operations.

## Resource Drop Into Node Tree

The left resource tree can drag resources into the right node tree. A resource drop uses the same target resolution as node drag:

- `inside`: create child node(s) under target node
- `before` / `after`: create sibling node(s) under the target's parent
- `root`: create root node(s)

The graph operation layer already supports `drop-node` and `drop-nodes` into a non-root parent. It must be extended to support root-level creation with `parentId: null` and root insertion indexes.

Node ids generated from resources should follow the current drag controller's collision-avoidance behavior so repeated drops remain valid.

## Editing Commands

Node-tree mode supports the main editing commands:

- delete selected nodes
- copy selected nodes
- paste into focused/selected node
- undo
- redo
- drag selected node(s) to move/reorder
- drag resource(s) from the resource tree to create graph nodes

These commands must call controller/edit-controller methods and the graph operation manager. `change`, `data-change`, `select`, `node-drop`, `node-move`, and related before hooks should remain consistent with topology mode.

Topology-only commands such as fit-to-screen, center-on-selection, zoom, pan, and overview navigation should not appear inside the node-tree context menu.

## Controller API

Expose small controller methods for the node tree instead of letting `NodeTree.vue` mutate graph directly:

- select node ids
- move node ids to parent/index, including root
- drop resource payload into parent/index, including root
- delete/copy/paste using existing edit controller behavior
- undo/redo

The controller should close context menus and cancel canvas pointer interactions when switching modes.

## Layout And Chrome

In topology mode, keep the current canvas, search, overview, zoom controls, history controls, and performance HUD behavior.

In node-tree mode:

- hide the topology canvas and overview
- keep history controls available
- show node-tree search in the node-tree header or reuse the shared search area only if it clearly targets graph nodes
- keep left resource tree collapse/restore behavior unchanged
- keep preview mode behavior unchanged: preview mode should continue to hide workspace chrome and should not expose node-tree editing unless explicitly enabled later

## Error Handling

Invalid drops are ignored and should not mutate graph or history. Invalid cases include:

- dropping a node into itself
- dropping a node into its descendant
- moving or dropping with an unknown target id
- dropping malformed resource payloads
- editing while readonly or preview mode makes editing disabled

When a before hook returns `false`, the action is blocked with the same semantics as topology mode.

## Tests

Pure helper tests:

- flatten graph into virtual rows with roots, children, depth, expanded state, and search filtering
- virtual window renders a bounded row range for 10,000+ nodes
- drop-target calculation resolves inside/before/after/root from pointer position
- selected drag ids remove descendants whose ancestor is already selected
- invalid descendant drops are rejected
- root-level `move-nodes` and `drop-nodes` preserve undo/redo behavior

Component tests:

- `NodeTree.vue` renders only virtualized rows for a large graph
- expand/collapse and keyboard navigation update visible rows and focus
- click, additive click, and range selection emit selection changes
- node drag serializes selected node ids in visible tree order
- resource drop emits the resolved parent/index payload

Minimap integration tests:

- the mode switch mounts either topology canvas or node tree, never both
- switching modes preserves selection and history state
- resource drag into node tree creates graph nodes and emits `node-drop`, `change`, and `data-change`
- node drag inside node tree moves nodes and emits `node-move`, `change`, and `data-change`
- delete/copy/paste/undo/redo work in node-tree mode

## Open Implementation Notes

- The existing resource-tree virtual-window module can be reused as-is.
- Shared tree-selection helpers can be extracted only if it reduces duplication after `NodeTree.vue` tests make the behavior concrete.
- Root-level graph operations should be implemented in the operation layer before wiring the UI, because they are the riskiest semantic extension.
