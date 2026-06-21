# Drag Hide Text Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add an opt-in right-click menu configuration for hiding canvas text during high-frequency drag/pan/marquee interaction, defaulting to disabled.

**Architecture:** Reuse the existing `options` and `config-change` pipeline. Keep quality policy in `render-quality.js` and menu shape in `context-menu.js`; `Minimap.vue` only passes the resolved option into quality calculation and handles the menu action.

**Tech Stack:** Vue 2.7 `<script setup>`, Canvas 2D, Node test runner.

---

## File Structure

- Modify `src/minimap/context-menu.js`
  - Add a built-in checkbox action `toggle-hide-text-during-interaction`.
  - Display the menu item in the common canvas configuration group.
- Modify `src/minimap/Minimap.vue`
  - Add `hideTextDuringInteraction: false` to effective options.
  - Pass interaction state to `resolveRenderQuality()` only when the option is enabled.
  - Handle the new context-menu action through `emitConfigChange`.
- Modify `test/minimap-context-menu.test.js`
  - Assert the new menu item exists and defaults unchecked.
- Modify `test/minimap-shell.test.js`
  - Assert right-click menu toggles the new option through `config-change`.
  - Assert default pan keeps labels, and enabled pan hides labels after the scheduled render.

## Task 1: Context Menu Option

- [x] **Step 1: Add failing menu tests**

Update `test/minimap-context-menu.test.js` to include `toggle-hide-text-during-interaction` in the default common item list and assert checked state follows `options.hideTextDuringInteraction`.

- [x] **Step 2: Implement menu item**

Update `src/minimap/context-menu.js`:

```js
BUILT_IN_CONTEXT_MENU_ACTIONS.add('toggle-hide-text-during-interaction')
```

and add a checkbox item labeled `拖动时隐藏文字`, checked from `options.hideTextDuringInteraction` with fallback `false`.

## Task 2: Minimap Option Wiring

- [x] **Step 1: Add failing shell tests**

Update `test/minimap-shell.test.js` to verify:

- clicking the menu item emits `config-change` with key `hideTextDuringInteraction`;
- default pan coalescing does not hide existing node labels;
- enabling the option hides labels during the scheduled pan render.

- [x] **Step 2: Implement Minimap wiring**

Update `src/minimap/Minimap.vue`:

```js
hideTextDuringInteraction: false
```

and:

```js
interacting: effectiveOptions.value.hideTextDuringInteraction === true && isHighFrequencyInteractionActive()
```

Add action handling:

```js
if (action === 'toggle-hide-text-during-interaction') {
  return emitConfigChange('hideTextDuringInteraction', !effectiveOptions.value.hideTextDuringInteraction, context)
}
```

## Task 3: Verification

- [x] **Step 1: Run focused tests**

```bash
npm test -- test/minimap-context-menu.test.js test/minimap-shell.test.js test/minimap-render-quality.test.js
```

- [x] **Step 2: Run full verification**

```bash
npm test
npm run build
```
