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
 * Power convention: internally, 1 brightness-unit ALWAYS ≡ 1 mW (per unit of
 * depth of the 2D scene) -- this never changes, so scenes stay portable
 * regardless of a user's display preference. `scene.powerUnit` ('mW' or 'W',
 * default 'mW') only controls how that same underlying value is displayed
 * and typed on both ends (light source power inputs and detector/power-meter
 * readouts) -- e.g. so a light source's output can be entered directly in
 * Watts to match an LED/COB datasheet.
 */

const POWER_UNIT_MW_PER_UNIT = { mW: 1, W: 1000 };

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

/** The scene's chosen power display unit ('mW' or 'W'; 'mW' if unset/invalid). */
export function powerUnit(scene) {
  const u = scene && scene.powerUnit;
  return (u === 'W') ? 'W' : 'mW';
}

/** How many internal brightness-units (≡ mW) make up one of the display unit. */
export function powerUnitScale(scene) {
  return POWER_UNIT_MW_PER_UNIT[powerUnit(scene)];
}

/** Convert an internal brightness value (≡ mW) to the scene's display power unit. */
export function toPhysicalPower(scene, brightnessValue) {
  return brightnessValue / powerUnitScale(scene);
}

/** Convert a value typed in the scene's display power unit back to internal brightness (≡ mW). */
export function fromPhysicalPower(scene, displayValue) {
  return displayValue * powerUnitScale(scene);
}

/** Format a detected power (brightness units ≡ mW) for display, in the scene's chosen power unit. */
export function formatPower(scene, power, decimals = 2) {
  if (!hasUnits(scene)) return power.toFixed(decimals);
  return `${toPhysicalPower(scene, power).toFixed(decimals)} ${powerUnit(scene)}`;
}

/** The unit label for irradiance along a line detector (power per length). */
export function irradianceUnit(scene) {
  return hasUnits(scene) ? `${powerUnit(scene)}/${scene.unitName}` : '';
}
