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
 * @file Volumetric ("air"/atmospheric) scattering: in real life, light
 * traveling through any medium (air, fog, water, ...) occasionally scatters
 * off molecules/particles along its path, not just at surfaces (Rayleigh/Mie
 * scattering) -- this is why real laser beams look like a soft, slightly
 * hazy line instead of an infinitely sharp one, and why headlight beams
 * become visible in fog. Every ray in this simulator otherwise travels in
 * perfectly straight lines between surface interactions.
 *
 * Implemented as a single "virtual" scene object (never drawn, never in
 * `scene.objs`, no toolbar entry -- it represents an ambient property of the
 * whole scene, not something placed at a location) that `Scene.opticalObjs`
 * appends when `scene.airScatteringEnabled` is true. This deliberately
 * requires ZERO changes to `Simulator.processRays()`: the existing
 * nearest-intersection search already compares every optical object's
 * `checkRayIntersects()` candidate and picks whichever is closest, so a
 * probabilistically-sampled "next scatter point" competes fairly against
 * real surfaces using the exact same mechanism, drawing, and ray-depth
 * bookkeeping as any other object.
 */

import geometry from './geometry.js';
import { sampleGaussian, rotateVec, normalizeVec } from './scatterUtils.js';

class AirScatterVolume {
  static type = 'AirScatterVolume';
  static isOptical = true;

  /**
   * Hard per-ray cap on the number of air-scatter events, independent of
   * `scene.maxRayDepth` (which defaults to Infinity and governs surface
   * bounces -- a different, user-tunable budget users shouldn't have to
   * touch just to use this feature safely). Without a cap of its own, a ray
   * that never hits a real surface never naturally reaches the "shoots off
   * to infinity, done" termination either (this object always offers a next
   * scatter point), so a single ray could scatter effectively forever and
   * silently consume the entire compute ray budget by itself.
   */
  static MAX_SCATTER_HOPS = 60;

  constructor(scene) {
    this.scene = scene;
  }

  /** No initial rays of its own; required by the same `opticalObjs` contract every other optical object follows. */
  onSimulationStart() {
    // Do nothing.
  }

  /** Never actually serialized as part of the scene (it's not in `scene.objs`); only implemented because Scene.validateDelayed() calls this on every entry of `opticalObjs` generically. */
  serialize() {
    return { type: this.constructor.type };
  }

  /**
   * Probabilistically sample the next scattering point along the ray,
   * using the mean free path (average distance between scatter events) as
   * an exponential ("Beer-Lambert") distribution -- the standard model for
   * how far light travels through a scattering medium before an event.
   * @param {Ray} ray
   * @returns {Point|null}
   */
  checkRayIntersects(ray) {
    const scene = this.scene;
    const meanFreePath = scene.airScatteringMeanFreePath;
    if (!(meanFreePath > 0)) return null;
    const dx = ray.p2.x - ray.p1.x;
    const dy = ray.p2.y - ray.p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!(len > 1e-9)) return null;

    const rng = scene.rng || Math.random;
    let u = rng();
    if (u >= 1) u = 0.9999999;
    const dist = -meanFreePath * Math.log(1 - u);

    const ux = dx / len, uy = dy / len;
    return geometry.point(ray.p1.x + ux * dist, ray.p1.y + uy * dist);
  }

  /**
   * Redirect the ray at the scatter point: a Gaussian angular deviation
   * from its incoming direction (0deg = ray keeps going straight,
   * 180deg-capable spread = fully isotropic-ish scattering), and an
   * optional brightness loss (absorption) to model a lossy medium (e.g.
   * smoke) rather than pure scattering (e.g. clean but hazy air).
   * @param {Ray} ray
   * @param {number} rayIndex
   * @param {Point} incidentPoint
   * @returns {SimulationReturn|undefined} `{isAbsorbed, truncation}` once
   * this ray has scattered `MAX_SCATTER_HOPS` times (see the class doc);
   * otherwise undefined (the ray continues, mutated in place).
   */
  onRayIncident(ray, rayIndex, incidentPoint) {
    const scene = this.scene;
    const rng = scene.rng || Math.random;

    ray.airScatterHops = (ray.airScatterHops || 0) + 1;
    if (ray.airScatterHops > AirScatterVolume.MAX_SCATTER_HOPS) {
      const b = ray.brightness_s + ray.brightness_p;
      return { isAbsorbed: true, truncation: b };
    }

    const absorption = scene.airScatteringAbsorption || 0;
    if (absorption > 0) {
      ray.brightness_s *= (1 - absorption);
      ray.brightness_p *= (1 - absorption);
    }

    const inDir = normalizeVec({ x: incidentPoint.x - ray.p1.x, y: incidentPoint.y - ray.p1.y });
    ray.p1 = geometry.point(incidentPoint.x, incidentPoint.y);
    if (!inDir) {
      ray.p2 = geometry.point(incidentPoint.x + 1, incidentPoint.y);
      return;
    }
    const strength = scene.airScatteringStrength || 0;
    const theta = sampleGaussian(rng) * strength * Math.PI / 180;
    const outDir = rotateVec(inDir, theta);
    ray.p2 = geometry.point(incidentPoint.x + outDir.x, incidentPoint.y + outDir.y);
  }
}

export default AirScatterVolume;
