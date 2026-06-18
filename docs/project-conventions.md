# Project Conventions

## Scope

This project builds a Vue 2.7 + Vite minimap component. The component should render large graphs through Canvas, support up to 10000 nodes, and avoid new third-party runtime libraries unless the user explicitly approves them.

## Authoritative Docs

- Product and technical design / feature roadmap (含各阶段验收标准): [ROADMAP.md](../ROADMAP.md)

When implementation questions arise, check the design document first. If the design is missing a decision, update the design or ask the user before coding.

## Planning Rules

- Do not start implementation after a design-only approval. Start implementation only after the user explicitly approves the relevant plan or task.
- Keep feature scope aligned with the current design document.
- When adding or changing a user-facing capability, update the design and task split before implementation.
- Prefer small, reviewable tasks: data model, layout logic, renderer, interaction, shell, tests.

## Dependency Rules

- Do not add runtime dependencies for layout, rendering, dragging, graph logic, or icons.
- Use browser and platform APIs: Canvas 2D, pointer events, native drag and drop, ResizeObserver, requestAnimationFrame.
- Development-only dependencies, such as E2E tooling, require explicit user approval.

## Architecture Rules

- Keep high-volume graph rendering out of Vue DOM. Vue should own state, controls, and component composition; Canvas should own large-scale drawing.
- Keep pure logic separate from Vue components. Layout, grouping, hit testing, coordinate transforms, history, and search should be testable without a browser.
- Main layout uses stable layered tree layout. Extra `edges` are drawn and highlighted by default, but do not participate in the primary layout unless the design changes.
- Custom rendering hooks must receive stable public parameters and must not rely on private component state.

## Interaction Rules

- Preserve user focus during relayout by using the selected or dragged node as a viewport anchor.
- Support controlled and uncontrolled modes for selection, group state, and viewport.
- Editing operations should have before hooks so business code can block invalid drops, moves, reorders, deletes, or copies.
- Readonly mode must prevent all editing operations.

## Testing Rules

- Unit tests are required for pure logic: graph data, grouping, layout, coordinate transforms, selection, history, search, import/export.
- Browser behavior should be verified with a lightweight E2E smoke suite if dev dependencies are approved; otherwise keep an equivalent manual checklist.
- Avoid brittle full-canvas pixel assertions. Prefer state assertions, debug counters, viewport changes, selected counts, node counts, and non-empty canvas checks.
- Always run `npm test` and `npm run build` before claiming implementation work is complete.

## File Hygiene

- Do not edit generated output such as `dist` unless the user explicitly asks.
- Do not commit or rely on `.superpowers/brainstorm` artifacts as product source.
- Keep documentation links relative and update both design and task split when changing planned behavior.
