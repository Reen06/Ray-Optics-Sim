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

import BaseSceneObj from '../BaseSceneObj.js';
import CircleObjMixin from '../CircleObjMixin.js';
import i18next from 'i18next';
import geometry from '../../geometry.js';
import { formatPower } from '../../unitUtils.js';

/**
 * The point power meter tool: a circular sensor that reads the total power of
 * the rays entering it (like a photodiode). Rays pass through unchanged.
 *
 * Tools -> Other -> Power Meter
 * @class
 * @extends BaseSceneObj
 * @memberof sceneObjs
 * @property {Point} p1 - The center of the circle.
 * @property {Point} p2 - A point on the circumference.
 * @property {number} power - The measured total power entering the circle.
 */
class PowerMeter extends CircleObjMixin(BaseSceneObj) {
  static type = 'PowerMeter';
  static isOptical = true;
  static serializableDefaults = {
    p1: null,
    p2: null
  };

  constructor(scene, properties) {
    super(scene, properties);
    this.power = 0;
  }

  static getDescription(objData, scene, detailed = false) {
    return i18next.t('main:tools.PowerMeter.title');
  }

  populateObjBar(objBar) {
    objBar.setTitle(i18next.t('main:tools.PowerMeter.title'));
    objBar.createInfoBox(i18next.t('simulator:sceneObjs.PowerMeter.info'));
  }

  draw(canvasRenderer, isAboveLight, isHovered) {
    const ctx = canvasRenderer.ctx;
    const ls = canvasRenderer.lengthScale;

    if (!isAboveLight) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = isHovered ? this.scene.highlightColorCss : canvasRenderer.rgbaToCssColor(this.scene.theme.detector.color);
      ctx.lineWidth = this.scene.theme.detector.width * ls;
      ctx.setLineDash(this.scene.theme.detector.dash.map(d => d * ls));
      ctx.beginPath();
      ctx.arc(this.p1.x, this.p1.y, geometry.segmentLength(this), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      canvasRenderer.drawPoint(this.p1, this.scene.theme.centerPoint.color, this.scene.theme.centerPoint.size);
      ctx.globalCompositeOperation = 'source-over';
    } else {
      if (!this.scene.simulator?.isLightLayerSynced) {
        ctx.globalAlpha = 0.5;
      }
      ctx.globalCompositeOperation = 'lighter';
      const r = geometry.segmentLength(this);
      ctx.font = (this.scene.theme.detectorText.size * ls) + 'px ' + this.scene.theme.detectorText.font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isHovered ? this.scene.highlightColorCss : canvasRenderer.rgbaToCssColor(this.scene.theme.detectorText.color);
      ctx.fillText("P=" + formatPower(this.scene, this.power), this.p1.x + r * 0.75, this.p1.y + r * 0.75);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  onSimulationStart() {
    this.power = 0;
  }

  checkRayIntersects(ray) {
    return this.checkRayIntersectsShape(ray);
  }

  onRayIncident(ray, rayIndex, incidentPoint) {
    // Count power only when the ray enters the circle (radial component of
    // the ray direction points inward at the crossing).
    const radialX = incidentPoint.x - this.p1.x;
    const radialY = incidentPoint.y - this.p1.y;
    const dirX = ray.p2.x - ray.p1.x;
    const dirY = ray.p2.y - ray.p1.y;
    if (dirX * radialX + dirY * radialY < 0) {
      this.power += ray.brightness_s + ray.brightness_p;
    }

    // Pass the ray through unchanged (like the line Detector).
    ray.p2 = geometry.point(incidentPoint.x + dirX, incidentPoint.y + dirY);
    ray.p1 = geometry.point(incidentPoint.x, incidentPoint.y);
  }
};

export default PowerMeter;
