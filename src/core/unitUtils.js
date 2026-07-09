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
 * @file Helpers for the scene's real-world unit system.
 *
 * A scene may define `unitName` (e.g. 'mm') and `unitSize` (the physical
 * length of one canvas unit, expressed in `unitName`). When `unitName` is
 * empty (the default), the scene is unitless and all displays keep the legacy
 * raw numbers, so existing scenes are unaffected.
 *
 * Power convention: 1 brightness-unit of detected power ≡ 1 mW (per unit of
 * depth of the 2D scene). This is a display convention only.
 */

/** Whether the scene has real units configured. */
export function hasUnits(scene) {
  return !!(scene && scene.unitName);
}

/** The physical size of one canvas unit (1 when the scene is unitless). */
export function unitSize(scene) {
  const s = scene && scene.unitSize;
  return (typeof s === 'number' && isFinite(s) && s > 0) ? s : 1;
}

/** Convert a canvas-unit length to physical units. */
export function toPhysical(scene, canvasUnits) {
  return canvasUnits * unitSize(scene);
}

/** Convert a physical length to canvas units. */
export function fromPhysical(scene, physical) {
  return physical / unitSize(scene);
}

/** ' (mm)' style label suffix, or '' when unitless. */
export function labelSuffix(scene) {
  return hasUnits(scene) ? ` (${scene.unitName})` : '';
}

/** Round away float noise for display (6 significant-ish decimals). */
export function roundDisplay(value) {
  return Math.round(value * 1000000) / 1000000;
}

/** Format a canvas-unit length as a physical quantity, e.g. '50 mm'. */
export function formatLength(scene, canvasUnits, decimals = 2) {
  const v = toPhysical(scene, canvasUnits);
  const s = decimals == null ? String(roundDisplay(v)) : v.toFixed(decimals);
  return hasUnits(scene) ? `${s} ${scene.unitName}` : s;
}

/** Format a detected power (brightness units ≡ mW) for display. */
export function formatPower(scene, power, decimals = 2) {
  const s = power.toFixed(decimals);
  return hasUnits(scene) ? `${s} mW` : s;
}

/** The unit label for irradiance along a line detector (power per length). */
export function irradianceUnit(scene) {
  return hasUnits(scene) ? `mW/${scene.unitName}` : '';
}
