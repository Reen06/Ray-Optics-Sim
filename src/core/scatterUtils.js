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
 * @file Monte-Carlo surface scattering for "natural" light behavior.
 *
 * Surfaces gain three optional properties:
 * - `roughness` (degrees): Gaussian angular spread of the specular lobe.
 * - `diffuse` (0..1): probability that an incident ray scatters Lambertian
 *   (2D cosine-weighted about the surface normal) instead of specularly.
 * - `albedo` (0..1): fraction of incident power that leaves the surface
 *   (the rest is absorbed).
 *
 * One outgoing ray is sampled per incident ray (importance sampling), so ray
 * counts stay bounded and detector readings are unbiased; convergence comes
 * from the snapshot compute's high ray budget. Sampling uses `scene.rng`, so
 * a scene's `randomSeed` makes results reproducible run-to-run.
 *
 * The non-serialized `scene.disableScattering` flag turns all scattering into
 * pure specular reflection (and blocker re-emission off). It is currently not
 * set anywhere by default — both the live preview and the snapshot compute
 * scatter (the live preview is just a low-ray-count noisy version) — but it
 * provides a single switch for callers that need a deterministic pass.
 */

import geometry from './geometry.js';
import i18next from 'i18next';

/** Whether the object has any non-default scattering behavior. */
export function hasScattering(obj) {
  return (obj.roughness > 0) || (obj.diffuse > 0) || (obj.albedo != null && obj.albedo < 1);
}

/** One standard-Gaussian sample using the scene's seeded RNG (Box-Muller). */
function sampleGaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function rotateVec(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function normalizeVec(v) {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-12) return null;
  return { x: v.x / len, y: v.y / len };
}

/**
 * Sample an outgoing direction for a scattering surface.
 * @param {Scene} scene - The scene (for `rng` and `disableScattering`).
 * @param {Point} specularDir - The specular outgoing direction (unit or not).
 * @param {Point} normal - The surface normal, oriented toward the outgoing side (unit or not).
 * @param {number} roughness - Gaussian spread of the specular lobe in degrees.
 * @param {number} diffuse - Probability of Lambertian scattering.
 * @returns {Point|null} A unit outgoing direction, or null if scattering is
 * disabled / not applicable (caller keeps the specular direction).
 */
export function sampleScatteredDirection(scene, specularDir, normal, roughness, diffuse) {
  if (scene.disableScattering) return null;
  const spec = normalizeVec(specularDir);
  const n = normalizeVec(normal);
  if (!spec || !n) return null;
  const rng = scene.rng || Math.random;

  let out;
  if (diffuse > 0 && rng() < diffuse) {
    // 2D Lambertian (cosine-weighted): theta = asin(2u - 1) about the normal.
    const theta = Math.asin(2 * rng() - 1);
    out = rotateVec(n, theta);
  } else if (roughness > 0) {
    out = rotateVec(spec, sampleGaussian(rng) * roughness * Math.PI / 180);
  } else {
    return null;
  }

  // Keep the outgoing ray on the outgoing side of the surface: reflect
  // below-horizon samples back across the surface line.
  const d = out.x * n.x + out.y * n.y;
  if (d < 0) {
    out = { x: out.x - 2 * d * n.x, y: out.y - 2 * d * n.y };
  }
  return out;
}

/**
 * Apply scattering + absorption to a mirror-family ray AFTER the specular
 * reflection has been written into `ray` (`ray.p1` = incident point, `ray.p2`
 * along the specular direction). Works for any mirror shape: the surface
 * normal is recovered from the incident and specular directions.
 * @param {BaseSceneObj} obj - The surface (reads `roughness`, `diffuse`, `albedo`).
 * @param {Ray} ray - The reflected ray (mutated in place).
 * @param {Point} inDir - The incident direction (incidentPoint - original ray.p1).
 * @returns {undefined} (Absorption by albedo is a brightness reduction, not a
 * ray termination; ray counts stay bounded by maxRayDepth/rayCountLimit.)
 */
export function applyMirrorScattering(obj, ray, inDir) {
  const scene = obj.scene;
  const albedo = obj.albedo == null ? 1 : obj.albedo;

  if (!scene.disableScattering && albedo < 1) {
    ray.brightness_s *= albedo;
    ray.brightness_p *= albedo;
  }

  scatterRayDirection(obj, ray, inDir);
}

/**
 * Perturb the direction of a specularly-reflected ray (already written into
 * `ray`) according to the object's roughness/diffuse properties. The surface
 * normal is recovered from the incident and specular directions, so this works
 * for any mirror shape. Does not touch brightness.
 * @param {BaseSceneObj} obj - The surface (reads `roughness`, `diffuse`).
 * @param {Ray} ray - The reflected ray (mutated in place).
 * @param {Point} inDir - The incident direction.
 */
export function scatterRayDirection(obj, ray, inDir) {
  const scene = obj.scene;
  if (!(obj.roughness > 0 || obj.diffuse > 0) || scene.disableScattering) return;
  const spec = normalizeVec({ x: ray.p2.x - ray.p1.x, y: ray.p2.y - ray.p1.y });
  const inU = normalizeVec(inDir);
  if (!spec || !inU) return;
  // For specular reflection, out - in is along the surface normal (oriented
  // toward the outgoing side).
  const n = { x: spec.x - inU.x, y: spec.y - inU.y };
  if (Math.hypot(n.x, n.y) <= 1e-6) return;
  const out = sampleScatteredDirection(scene, spec, n, obj.roughness || 0, obj.diffuse || 0);
  if (out) {
    ray.p2 = geometry.point(ray.p1.x + out.x, ray.p1.y + out.y);
  }
}

/**
 * Handle a ray hitting a blocker that has a nonzero albedo ("matte wall"):
 * re-emit one Lambertian ray from the incident point instead of absorbing.
 * @param {BaseSceneObj} obj - The blocker (reads `diffuse` implicitly = 1, `albedo`).
 * @param {Ray} ray - The incident ray (mutated into the re-emitted ray).
 * @param {Point} incidentPoint - The hit point.
 * @param {Point} surfaceDir - A direction along the blocker surface.
 * @returns {Object|undefined} `{isAbsorbed: true}` when the ray is absorbed
 * (zero albedo, scattering disabled, or outgoing ray too dim); otherwise
 * undefined and the mutated ray continues.
 */
export function applyBlockerScattering(obj, ray, incidentPoint, surfaceDir) {
  const scene = obj.scene;
  const albedo = obj.albedo == null ? 0 : obj.albedo;
  if (albedo <= 0 || scene.disableScattering) {
    return { isAbsorbed: true };
  }

  const inDir = normalizeVec({ x: incidentPoint.x - ray.p1.x, y: incidentPoint.y - ray.p1.y });
  let n = normalizeVec({ x: -surfaceDir.y, y: surfaceDir.x });
  if (!inDir || !n) return { isAbsorbed: true };
  // Orient the normal against the incoming ray (the re-emission side).
  if (n.x * inDir.x + n.y * inDir.y > 0) {
    n = { x: -n.x, y: -n.y };
  }

  const newB_s = ray.brightness_s * albedo;
  const newB_p = ray.brightness_p * albedo;

  const rng = scene.rng || Math.random;
  const theta = Math.asin(2 * rng() - 1);
  const out = rotateVec(n, theta);

  ray.p1 = geometry.point(incidentPoint.x, incidentPoint.y);
  ray.p2 = geometry.point(incidentPoint.x + out.x, incidentPoint.y + out.y);
  ray.brightness_s = newB_s;
  ray.brightness_p = newB_p;
  // The absorbed fraction is genuine absorption, not simulation error, so it
  // is not reported as truncation.
  return undefined;
}

/**
 * Perturb a glass surface normal for a rough ("ground glass") interface.
 * @param {Scene} scene - The scene.
 * @param {number} roughness - Gaussian spread in degrees.
 * @param {Point} normal - The surface normal (any length).
 * @returns {Point} The (possibly rotated) normal.
 */
export function perturbGlassNormal(scene, roughness, normal) {
  if (!(roughness > 0) || scene.disableScattering) return normal;
  const rng = scene.rng || Math.random;
  return rotateVec(normal, sampleGaussian(rng) * roughness * Math.PI / 180);
}

/**
 * Populate the object bar with the scattering controls (roughness, diffuse,
 * albedo) inside the advanced section.
 * @param {BaseSceneObj} obj - The object being edited.
 * @param {ObjBar} objBar - The object bar.
 * @param {Object} [opts] - Which controls to include.
 * @param {boolean} [opts.includeDiffuse=true]
 * @param {boolean} [opts.blockerMode=false] - Blockers only get an albedo
 * control (0 = fully absorbing, >0 = Lambertian "matte wall").
 */
export function populateScatteringControls(obj, objBar, opts = {}) {
  const includeDiffuse = opts.includeDiffuse !== false && !opts.blockerMode;
  const blockerMode = !!opts.blockerMode;

  const albedoDefault = blockerMode ? 0 : 1;
  const albedoNonDefault = obj.albedo != null && obj.albedo !== albedoDefault;
  const nonDefault = (!blockerMode && obj.roughness > 0) || (includeDiffuse && obj.diffuse > 0) || albedoNonDefault;
  if (!objBar.showAdvanced(nonDefault)) return;

  if (!blockerMode) {
    objBar.createNumber(i18next.t('simulator:sceneObjs.common.scattering.roughness') + ' (°)', 0, 45, 1, obj.roughness || 0, function (o, value) {
      o.roughness = Math.max(0, value);
    }, i18next.t('simulator:sceneObjs.common.scattering.info'));
  }
  if (includeDiffuse) {
    objBar.createNumber(i18next.t('simulator:sceneObjs.common.scattering.diffuse'), 0, 1, 0.05, obj.diffuse || 0, function (o, value) {
      o.diffuse = Math.min(1, Math.max(0, value));
    }, i18next.t('simulator:sceneObjs.common.scattering.info'));
  }
  objBar.createNumber(i18next.t('simulator:sceneObjs.common.scattering.albedo'), 0, 1, 0.05, obj.albedo == null ? albedoDefault : obj.albedo, function (o, value) {
    o.albedo = Math.min(1, Math.max(0, value));
  }, i18next.t('simulator:sceneObjs.common.scattering.' + (blockerMode ? 'albedoBlockerInfo' : 'info')));
}
