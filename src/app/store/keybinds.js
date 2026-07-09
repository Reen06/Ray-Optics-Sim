/*
 * Copyright 2026 The Ray Optics Simulation authors and contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @module keybinds
 * @description User-configurable keyboard/mouse-button bindings, persisted to
 * localStorage as a single JSON blob under `rayOpticsKeybinds`. A plain
 * module-scope `reactive()` store (same pattern as {@link module:compute}'s
 * `computeState`), not a `use*Store()` hook, so it's usable directly from
 * `services/app.js` (a plain JS module, not a Vue component) as well as from
 * Vue components like `KeybindsModal.vue`.
 *
 * Each action has a `type` of `'key'` (matched against `keydown` events:
 * `keyCode` + `ctrl`/`shift`/`alt`, where `ctrl` matches either Ctrl or Cmd
 * for cross-platform parity with the app's existing shortcuts) or `'mouse'`
 * (matched against `mousedown` events: `button`, the standard DOM
 * `MouseEvent.button` — 0 left, 1 middle, 2 right).
 */

import { reactive } from 'vue';

const STORAGE_KEY = 'rayOpticsKeybinds';

/**
 * @typedef {Object} KeyBinding
 * @property {'key'} type
 * @property {number} keyCode
 * @property {boolean} [ctrl]
 * @property {boolean} [shift]
 * @property {boolean} [alt]
 */

/**
 * @typedef {Object} MouseBinding
 * @property {'mouse'} type
 * @property {number} button - Standard `MouseEvent.button` (0 left, 1 middle, 2 right).
 */

/**
 * The bindable actions and their defaults, in display order. `keyCode` uses
 * the legacy numeric codes to match the rest of the app's existing keydown
 * handling (`src/app/services/app.js`); new bindings captured via the UI are
 * stored the same way for consistency.
 */
export const BINDABLE_ACTIONS = [
  {
    id: 'pan',
    labelKey: 'simulator:keybinds.actions.pan',
    default: { type: 'mouse', button: 1 } // middle click
  },
  {
    id: 'undo',
    labelKey: 'simulator:keybinds.actions.undo',
    default: { type: 'key', keyCode: 90, ctrl: true } // Ctrl/Cmd+Z
  },
  {
    id: 'redo',
    labelKey: 'simulator:keybinds.actions.redo',
    default: { type: 'key', keyCode: 89, ctrl: true } // Ctrl/Cmd+Y
  },
  {
    id: 'duplicate',
    labelKey: 'simulator:keybinds.actions.duplicate',
    default: { type: 'key', keyCode: 68, ctrl: true } // Ctrl/Cmd+D
  },
  {
    id: 'save',
    labelKey: 'simulator:keybinds.actions.save',
    default: { type: 'key', keyCode: 83, ctrl: true } // Ctrl/Cmd+S
  },
  {
    id: 'open',
    labelKey: 'simulator:keybinds.actions.open',
    default: { type: 'key', keyCode: 79, ctrl: true } // Ctrl/Cmd+O
  },
  {
    id: 'selectAll',
    labelKey: 'simulator:keybinds.actions.selectAll',
    default: { type: 'key', keyCode: 65, ctrl: true } // Ctrl/Cmd+A
  },
  {
    id: 'delete',
    labelKey: 'simulator:keybinds.actions.delete',
    default: { type: 'key', keyCode: 46 } // Delete
  },
  {
    id: 'rotateCW',
    labelKey: 'simulator:keybinds.actions.rotateCW',
    default: { type: 'key', keyCode: 187 } // '=' / '+'
  },
  {
    id: 'rotateCCW',
    labelKey: 'simulator:keybinds.actions.rotateCCW',
    default: { type: 'key', keyCode: 189 } // '-'
  }
];

const ACTIONS_BY_ID = Object.fromEntries(BINDABLE_ACTIONS.map(a => [a.id, a]));

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function persist() {
  const out = {};
  for (const action of BINDABLE_ACTIONS) {
    const b = keybindsState.bindings[action.id];
    // Only persist bindings that differ from default, so future default
    // changes (e.g. a new default for an action added later) still apply to
    // users who never touched that specific binding.
    if (b && JSON.stringify(b) !== JSON.stringify(action.default)) {
      out[action.id] = b;
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
}

function buildInitialBindings() {
  const stored = loadStored();
  const bindings = {};
  for (const action of BINDABLE_ACTIONS) {
    bindings[action.id] = stored[action.id] || { ...action.default };
  }
  return bindings;
}

export const keybindsState = reactive({
  bindings: buildInitialBindings(),
  /** The action id currently being rebound (waiting for the next key/click), or null. */
  recording: null
});

/** Set a new binding for an action and persist it. */
export function setBinding(actionId, binding) {
  if (!ACTIONS_BY_ID[actionId]) return;
  keybindsState.bindings[actionId] = binding;
  persist();
}

/** Reset one action back to its default binding. */
export function resetBinding(actionId) {
  const action = ACTIONS_BY_ID[actionId];
  if (!action) return;
  keybindsState.bindings[actionId] = { ...action.default };
  persist();
}

/** Reset every action back to its default binding. */
export function resetAllBindings() {
  for (const action of BINDABLE_ACTIONS) {
    keybindsState.bindings[action.id] = { ...action.default };
  }
  persist();
}

/**
 * Whether a `keydown` DOM event matches the given action's current binding.
 * No-ops (returns false) for mouse-type actions. `ctrl` matches either Ctrl
 * or Cmd (`e.ctrlKey || e.metaKey`), matching the app's pre-existing
 * cross-platform shortcut behavior.
 * @param {string} actionId
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
export function matchesKeyEvent(actionId, e) {
  const b = keybindsState.bindings[actionId];
  if (!b || b.type !== 'key') return false;
  if (e.keyCode !== b.keyCode) return false;
  const ctrlWanted = !!b.ctrl;
  const ctrlPressed = !!(e.ctrlKey || e.metaKey);
  if (ctrlWanted !== ctrlPressed) return false;
  if (!!b.shift !== !!e.shiftKey) return false;
  if (!!b.alt !== !!e.altKey) return false;
  return true;
}

/**
 * Whether a `mousedown` DOM event matches the given action's current
 * binding. No-ops (returns false) for key-type actions.
 * @param {string} actionId
 * @param {MouseEvent} e
 * @returns {boolean}
 */
export function matchesMouseEvent(actionId, e) {
  const b = keybindsState.bindings[actionId];
  if (!b || b.type !== 'mouse') return false;
  return e.button === b.button;
}

const KEY_NAMES = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 27: 'Esc', 32: 'Space',
  37: '←', 38: '↑', 39: '→', 40: '↓', 46: 'Delete',
  61: '=', 107: 'Num+', 109: 'Num-', 173: '-', 187: '=', 189: '-'
};
const MOUSE_NAMES = { 0: 'Left Click', 1: 'Middle Click', 2: 'Right Click' };

/**
 * A short human-readable label for a binding, e.g. "Ctrl+Z" or "Middle Click".
 * @param {KeyBinding|MouseBinding} binding
 * @returns {string}
 */
export function describeBinding(binding) {
  if (!binding) return '';
  if (binding.type === 'mouse') {
    return MOUSE_NAMES[binding.button] || `Mouse Button ${binding.button}`;
  }
  const parts = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  let keyName = KEY_NAMES[binding.keyCode];
  if (!keyName) {
    // A-Z / 0-9 keyCodes map directly to their printable character.
    if (binding.keyCode >= 65 && binding.keyCode <= 90) keyName = String.fromCharCode(binding.keyCode);
    else if (binding.keyCode >= 48 && binding.keyCode <= 57) keyName = String.fromCharCode(binding.keyCode);
    else keyName = `Key ${binding.keyCode}`;
  }
  parts.push(keyName);
  return parts.join('+');
}

/**
 * Build a binding object from a live `keydown`/`mousedown` DOM event, for
 * the rebind-capture UI. Modifier-only keypresses (Ctrl/Shift/Alt/Meta alone)
 * are not valid bindings on their own and return null.
 * @param {'key'|'mouse'} type
 * @param {KeyboardEvent|MouseEvent} e
 * @returns {KeyBinding|MouseBinding|null}
 */
export function bindingFromEvent(type, e) {
  if (type === 'mouse') {
    return { type: 'mouse', button: e.button };
  }
  const MODIFIER_KEYCODES = [16, 17, 18, 91, 92, 93, 224]; // Shift, Ctrl, Alt, Meta variants
  if (MODIFIER_KEYCODES.includes(e.keyCode)) return null;
  const binding = { type: 'key', keyCode: e.keyCode };
  if (e.ctrlKey || e.metaKey) binding.ctrl = true;
  if (e.shiftKey) binding.shift = true;
  if (e.altKey) binding.alt = true;
  return binding;
}
