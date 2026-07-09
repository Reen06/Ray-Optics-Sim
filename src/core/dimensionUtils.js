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
 * @file Helpers for finding and tracking "feature points" (existing object
 * endpoints/centers) across the scene, used by the Distance Dimension tool
 * to snap onto an existing point rather than an arbitrary grid position, and
 * to keep tracking that point as its owning object is edited.
 *
 * Every scene object already declares its point-valued properties via its
 * static `getPropertySchema()` (`{ key, type: 'point' }` entries, used by
 * the sidebar's generic property editor) -- `key === ''` is the existing
 * convention for "the point is (obj.x, obj.y) directly" (e.g. PointSource),
 * otherwise it's `obj[key]` (e.g. `p1`/`p2` on line- and circle-based
 * objects). Reusing that schema means this file needs no per-type special
 * casing and automatically covers new object types as they add point
 * properties.
 */

import geometry from './geometry.js';

/**
 * Get every point-valued feature of a scene object, as reported by its own
 * `getPropertySchema()`.
 * @param {SceneObj} obj
 * @param {Scene} scene
 * @returns {Array<{key: string, point: {x: number, y: number}}>}
 */
export function getObjFeaturePoints(obj, scene) {
  if (!obj || !obj.constructor || typeof obj.constructor.getPropertySchema !== 'function') return [];
  let schema;
  try {
    schema = obj.constructor.getPropertySchema(obj, scene) || [];
  } catch (e) {
    return [];
  }
  const points = [];
  for (const d of schema) {
    if (d.type !== 'point') continue;
    const pt = d.key ? obj[d.key] : obj;
    if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
      points.push({ key: d.key || '', point: { x: pt.x, y: pt.y } });
    }
  }
  return points;
}

/**
 * Read the current position of a previously-found feature point, given its
 * owning object's index and key (as returned by `findNearestFeaturePoint`).
 * @param {Scene} scene
 * @param {number} objIndex
 * @param {string} key
 * @returns {{x: number, y: number}|null} `null` if the object or point no
 * longer exists (e.g. the object was deleted, or edited in a way that
 * removed that property).
 */
export function resolveFeaturePoint(scene, objIndex, key) {
  const obj = scene.objs && scene.objs[objIndex];
  if (!obj) return null;
  const pt = key ? obj[key] : obj;
  if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
    return { x: pt.x, y: pt.y };
  }
  return null;
}

/**
 * Find the nearest existing feature point to the mouse, within its normal
 * point click radius, excluding a specific (objIndex, key) pair (so a
 * dimension's second point can't snap back onto its own first point) and
 * excluding Distance Dimension objects themselves (dimensioning from a
 * dimension's own endpoints isn't meaningful here).
 * @param {Scene} scene
 * @param {Mouse} mouse
 * @param {{objIndex: number, key: string}|null} exclude
 * @returns {{objIndex: number, key: string, point: {x: number, y: number}}|null}
 */
export function findNearestFeaturePoint(scene, mouse, exclude = null) {
  let best = null;
  let bestDistSq = Infinity;
  const clickExtent = mouse.getClickExtent(true);
  const thresholdSq = clickExtent * clickExtent;
  scene.objs.forEach((obj, index) => {
    if (obj.constructor.type === 'DistanceDimension') return;
    for (const fp of getObjFeaturePoints(obj, scene)) {
      if (exclude && exclude.objIndex === index && exclude.key === fp.key) continue;
      const d2 = geometry.distanceSquared(mouse.pos, fp.point);
      if (d2 < thresholdSq && d2 < bestDistSq) {
        bestDistSq = d2;
        best = { objIndex: index, key: fp.key, point: fp.point };
      }
    }
  });
  return best;
}
