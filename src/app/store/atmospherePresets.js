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
 * @module atmospherePresets
 * @description Named, reusable presets for the volumetric air-scattering
 * settings (see `AirScatterVolume.js` / `Scene.airScattering*`). The actual
 * current values always live on the scene (serialized with it, like any
 * other scene setting) -- presets are a browser-local convenience for
 * quickly applying a known-good combination, not scene data themselves.
 * Same plain-module `reactive()` pattern as `keybinds.js`.
 */

import { reactive } from 'vue';

const STORAGE_KEY = 'rayOpticsAtmospherePresets';

/**
 * @typedef {Object} AtmospherePreset
 * @property {number} meanFreePath - Average distance (scene units) between scatter events.
 * @property {number} strength - Gaussian angular spread per scatter event, in degrees.
 * @property {number} absorption - Fraction of brightness lost per scatter event (0-1).
 */

/** Built-in starting points, roughly ordered from clearest to thickest. */
export const BUILT_IN_PRESETS = [
  { id: 'off', builtIn: true, labelKey: 'simulator:atmosphere.presets.off', enabled: false, meanFreePath: 300, strength: 15, absorption: 0 },
  { id: 'clear', builtIn: true, labelKey: 'simulator:atmosphere.presets.clear', enabled: true, meanFreePath: 2000, strength: 3, absorption: 0 },
  { id: 'haze', builtIn: true, labelKey: 'simulator:atmosphere.presets.haze', enabled: true, meanFreePath: 600, strength: 8, absorption: 0.01 },
  { id: 'fog', builtIn: true, labelKey: 'simulator:atmosphere.presets.fog', enabled: true, meanFreePath: 150, strength: 20, absorption: 0.05 },
  { id: 'smoke', builtIn: true, labelKey: 'simulator:atmosphere.presets.smoke', enabled: true, meanFreePath: 40, strength: 45, absorption: 0.15 }
];

function loadCustom() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(atmospherePresetsState.custom));
}

export const atmospherePresetsState = reactive({
  /** User-saved presets: `{id, name, enabled, meanFreePath, strength, absorption}`. */
  custom: loadCustom()
});

/** All presets (built-in first, then custom), for a picker UI. */
export function allPresets() {
  return [...BUILT_IN_PRESETS, ...atmospherePresetsState.custom];
}

/**
 * Save the given settings as a new named custom preset (or overwrite an
 * existing custom preset with the same name).
 * @param {string} name
 * @param {{enabled:boolean, meanFreePath:number, strength:number, absorption:number}} settings
 */
export function savePreset(name, settings) {
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  const id = 'custom:' + trimmed;
  const preset = { id, name: trimmed, builtIn: false, ...settings };
  const idx = atmospherePresetsState.custom.findIndex(p => p.id === id);
  if (idx >= 0) {
    atmospherePresetsState.custom[idx] = preset;
  } else {
    atmospherePresetsState.custom.push(preset);
  }
  persist();
}

/** Delete a custom preset by id. No-op for built-in presets. */
export function deletePreset(id) {
  const idx = atmospherePresetsState.custom.findIndex(p => p.id === id);
  if (idx >= 0) {
    atmospherePresetsState.custom.splice(idx, 1);
    persist();
  }
}
