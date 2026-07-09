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
import LineObjMixin from '../LineObjMixin.js';
import i18next from 'i18next';
import geometry from '../../geometry.js';

/**
 * The image sensor (virtual camera) tool: a line-segment sensor that
 * accumulates the color image formed on it — each ray hit deposits its
 * (wavelength-derived) color into the pixel at the hit position, like a film
 * exposure. The developed strip is drawn alongside the sensor line and shown
 * in the sensor panel. Rays pass through unchanged.
 *
 * The exposure develops progressively; use the snapshot Compute for a
 * high-ray-count, low-noise image.
 *
 * Tools -> Other -> Image Sensor
 * @class
 * @extends BaseSceneObj
 * @memberof sceneObjs
 * @property {Point} p1 - The first endpoint of the sensor line.
 * @property {Point} p2 - The second endpoint of the sensor line.
 * @property {number} pixelCount - The number of pixels along the line.
 * @property {Array<number>} pixelData - Accumulated [R,G,B] per pixel (not serialized).
 */
class ImageSensor extends LineObjMixin(BaseSceneObj) {
  static type = 'ImageSensor';
  static isOptical = true;
  static serializableDefaults = {
    p1: null,
    p2: null,
    pixelCount: 64
  };

  constructor(scene, properties) {
    super(scene, properties);
    this.pixelData = null;
    this.power = 0;
  }

  static getDescription(objData, scene, detailed = false) {
    return i18next.t('main:tools.ImageSensor.title');
  }

  populateObjBar(objBar) {
    objBar.setTitle(i18next.t('main:tools.ImageSensor.title'));
    objBar.createInfoBox(i18next.t('simulator:sceneObjs.ImageSensor.info'));
    objBar.createNumber(i18next.t('simulator:sceneObjs.ImageSensor.pixelCount'), 8, 512, 8, this.pixelCount, function (obj, value) {
      obj.pixelCount = Math.max(1, Math.round(value));
      obj.pixelData = null;
    }, null, true);
    this.populateDimensionControls(objBar);
  }

  draw(canvasRenderer, isAboveLight, isHovered) {
    const ctx = canvasRenderer.ctx;
    const ls = canvasRenderer.lengthScale;

    if (this.p1.x == this.p2.x && this.p1.y == this.p2.y) {
      ctx.fillStyle = 'rgb(128,128,128)';
      ctx.fillRect(this.p1.x - 1.5 * ls, this.p1.y - 1.5 * ls, 3 * ls, 3 * ls);
      return;
    }

    if (!isAboveLight) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = isHovered ? this.scene.highlightColorCss : canvasRenderer.rgbaToCssColor(this.scene.theme.detector.color);
      ctx.lineWidth = this.scene.theme.detector.width * ls;
      ctx.beginPath();
      ctx.moveTo(this.p1.x, this.p1.y);
      ctx.lineTo(this.p2.x, this.p2.y);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    } else if (this.pixelData) {
      // Draw the developed strip alongside the sensor line (auto exposure:
      // normalized to the brightest channel).
      if (!this.scene.simulator?.isLightLayerSynced) {
        ctx.globalAlpha = 0.5;
      }
      const len = geometry.distance(this.p1, this.p2);
      const ux = (this.p2.x - this.p1.x) / len;
      const uy = (this.p2.y - this.p1.y) / len;
      const vx = uy;
      const vy = -ux;
      const offset = 5 * ls;
      const bandW = 8 * ls;
      let maxV = 0;
      for (let i = 0; i < this.pixelData.length; i++) {
        if (this.pixelData[i] > maxV) maxV = this.pixelData[i];
      }
      if (maxV > 0) {
        const n = this.pixelCount;
        const step = len / n;
        for (let i = 0; i < n; i++) {
          const r = Math.min(255, Math.round(this.pixelData[i * 3] / maxV * 255));
          const g = Math.min(255, Math.round(this.pixelData[i * 3 + 1] / maxV * 255));
          const b = Math.min(255, Math.round(this.pixelData[i * 3 + 2] / maxV * 255));
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          const x0 = this.p1.x + ux * i * step + vx * offset;
          const y0 = this.p1.y + uy * i * step + vy * offset;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + ux * step, y0 + uy * step);
          ctx.lineTo(x0 + ux * step + vx * bandW, y0 + uy * step + vy * bandW);
          ctx.lineTo(x0 + vx * bandW, y0 + vy * bandW);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  onSimulationStart() {
    this.pixelData = new Array(this.pixelCount * 3).fill(0);
    this.power = 0;
  }

  checkRayIntersects(ray) {
    return this.checkRayIntersectsShape(ray);
  }

  onRayIncident(ray, rayIndex, incidentPoint) {
    const brightness = ray.brightness_s + ray.brightness_p;
    this.power += brightness;

    if (this.pixelData) {
      const len = geometry.distance(this.p1, this.p2);
      const t = geometry.distance(this.p1, incidentPoint) / len;
      let i = Math.floor(t * this.pixelCount);
      if (i >= this.pixelCount) i = this.pixelCount - 1;
      if (i >= 0) {
        if (this.scene.simulateColors && ray.wavelength && this.scene.simulator) {
          const c = this.scene.simulator.wavelengthToColor(ray.wavelength, brightness, false);
          this.pixelData[i * 3] += c[0];
          this.pixelData[i * 3 + 1] += c[1];
          this.pixelData[i * 3 + 2] += c[2];
        } else {
          this.pixelData[i * 3] += brightness;
          this.pixelData[i * 3 + 1] += brightness;
          this.pixelData[i * 3 + 2] += brightness;
        }
      }
    }

    // Pass the ray through unchanged.
    ray.p2 = geometry.point(incidentPoint.x + ray.p2.x - ray.p1.x, incidentPoint.y + ray.p2.y - ray.p1.y);
    ray.p1 = geometry.point(incidentPoint.x, incidentPoint.y);
  }
};

export default ImageSensor;
