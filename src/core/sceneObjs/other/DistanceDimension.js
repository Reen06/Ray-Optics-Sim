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
import geometry from '../../geometry.js';
import i18next from 'i18next';
import { labelSuffix, toPhysical, fromPhysical, roundDisplay, formatLength } from '../../unitUtils.js';
import { findNearestFeaturePoint, resolveFeaturePoint } from '../../dimensionUtils.js';

/**
 * The Distance Dimension tool: a CAD-style "smart dimension" between two
 * existing points in the scene (endpoints of mirrors, lenses, sources,
 * detectors, etc., found automatically by the same click radius used for
 * dragging), rather than the free line of the Ruler tool.
 *
 * Click near an existing point to anchor the first end there (it stays
 * "live" -- tracked by object index + property key, so it follows that
 * object if it's later edited or moved); click again to set the second
 * end the same way. If a click doesn't land on any existing point, that
 * end falls back to a free grid-snapped point, exactly like the Ruler tool.
 *
 * Typing an exact distance moves the SECOND point's owning object as a
 * whole (via its own `move()`) so it satisfies the new distance -- if the
 * second end is a free point instead, that free point itself is moved.
 * Dragging either end manually detaches it from its live reference (it
 * becomes a free point at the drag location), matching the expectation
 * that a Ruler-like manual drag takes precedence over automatic tracking.
 *
 * Tools -> Other -> Distance Dimension
 * @class
 * @extends BaseSceneObj
 * @memberof sceneObjs
 * @property {Point} p1 - The first (live-tracked, or free) endpoint.
 * @property {Point} p2 - The second (live-tracked, or free) endpoint.
 * @property {number} obj1Index - Index into `scene.objs` of the object p1 tracks, or -1 if p1 is a free point.
 * @property {string} obj1Key - The point-valued property key on that object (see `dimensionUtils.js`), or '' if the point is the object's own (x, y).
 * @property {number} obj2Index - Same as `obj1Index` but for p2.
 * @property {string} obj2Key - Same as `obj1Key` but for p2.
 */
class DistanceDimension extends LineObjMixin(BaseSceneObj) {
  static type = 'DistanceDimension';
  static serializableDefaults = {
    p1: null,
    p2: null,
    obj1Index: -1,
    obj1Key: '',
    obj2Index: -1,
    obj2Key: ''
  };

  static getDescription(objData, scene, detailed = false) {
    return i18next.t('main:tools.DistanceDimension.title');
  }

  /** Pull p1/p2 from their live-tracked objects' current geometry, if any. Falls back to the last-known free point if a tracked object/property was deleted. */
  syncFromRefs() {
    const scene = this.scene;
    if (this.obj1Index >= 0) {
      const pt = resolveFeaturePoint(scene, this.obj1Index, this.obj1Key);
      if (pt) {
        this.p1 = geometry.point(pt.x, pt.y);
      } else {
        this.obj1Index = -1;
        this.obj1Key = '';
      }
    }
    if (this.obj2Index >= 0) {
      const pt = resolveFeaturePoint(scene, this.obj2Index, this.obj2Key);
      if (pt) {
        this.p2 = geometry.point(pt.x, pt.y);
      } else {
        this.obj2Index = -1;
        this.obj2Key = '';
      }
    }
  }

  populateObjBar(objBar) {
    this.syncFromRefs();
    objBar.setTitle(i18next.t('main:tools.DistanceDimension.title'));
    const len = geometry.distance(this.p1, this.p2);

    objBar.createNumber(i18next.t('simulator:sceneObjs.common.dimensions.length') + labelSuffix(this.scene), 0, 1000, 1, roundDisplay(toPhysical(this.scene, len)), function (obj, value) {
      const newLen = fromPhysical(obj.scene, value);
      if (!(newLen >= 0) || !isFinite(newLen)) return;
      obj.syncFromRefs();
      const curLen = geometry.distance(obj.p1, obj.p2);
      let dx, dy;
      if (curLen < 1e-9) {
        dx = 1;
        dy = 0;
      } else {
        dx = (obj.p2.x - obj.p1.x) / curLen;
        dy = (obj.p2.y - obj.p1.y) / curLen;
      }
      const targetX = obj.p1.x + dx * newLen;
      const targetY = obj.p1.y + dy * newLen;
      if (obj.obj2Index >= 0 && obj.scene.objs[obj.obj2Index]) {
        // Move the whole object that owns the second point, so its shape/other
        // points move rigidly with it -- not just this one tracked point.
        obj.scene.objs[obj.obj2Index].move(targetX - obj.p2.x, targetY - obj.p2.y);
        obj.syncFromRefs();
      } else {
        obj.p2 = geometry.point(targetX, targetY);
      }
    }, i18next.t('simulator:sceneObjs.DistanceDimension.distanceInfo'), true);
  }

  draw(canvasRenderer, isAboveLight, isHovered) {
    if (isAboveLight) return;
    this.syncFromRefs();

    const ctx = canvasRenderer.ctx;
    const ls = canvasRenderer.lengthScale;

    if (this.p1.x == this.p2.x && this.p1.y == this.p2.y) {
      ctx.fillStyle = 'rgb(128,128,128)';
      ctx.fillRect(this.p1.x - 1.5 * ls, this.p1.y - 1.5 * ls, 3 * ls, 3 * ls);
      return;
    }

    const len = geometry.distance(this.p1, this.p2);
    const par_x = (this.p2.x - this.p1.x) / len;
    const par_y = (this.p2.y - this.p1.y) / len;
    const per_x = par_y;
    const per_y = -par_x;
    const tickLen = 8 * ls;

    const strokeColor = isHovered ? this.scene.highlightColorCss : canvasRenderer.rgbaToCssColor(this.scene.theme.ruler.color);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = this.scene.theme.ruler.width * ls;
    ctx.setLineDash([4 * ls, 3 * ls]);
    ctx.beginPath();
    ctx.moveTo(this.p1.x, this.p1.y);
    ctx.lineTo(this.p2.x, this.p2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Small perpendicular tick marks at each tracked/anchored end.
    ctx.beginPath();
    ctx.moveTo(this.p1.x - per_x * tickLen, this.p1.y - per_y * tickLen);
    ctx.lineTo(this.p1.x + per_x * tickLen, this.p1.y + per_y * tickLen);
    ctx.moveTo(this.p2.x - per_x * tickLen, this.p2.y - per_y * tickLen);
    ctx.lineTo(this.p2.x + per_x * tickLen, this.p2.y + per_y * tickLen);
    ctx.stroke();

    // A filled dot at each end that's live-tracking an existing feature point,
    // so it's visually clear which ends are "smart" vs free.
    ctx.fillStyle = strokeColor;
    if (this.obj1Index >= 0) {
      ctx.beginPath();
      ctx.arc(this.p1.x, this.p1.y, 2.5 * ls, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (this.obj2Index >= 0) {
      ctx.beginPath();
      ctx.arc(this.p2.x, this.p2.y, 2.5 * ls, 0, 2 * Math.PI);
      ctx.fill();
    }

    const midX = (this.p1.x + this.p2.x) / 2;
    const midY = (this.p1.y + this.p2.y) / 2;
    const labelOffset = 12 * ls;
    ctx.font = (this.scene.theme.rulerText.size * ls) + 'px ' + this.scene.theme.rulerText.font;
    ctx.fillStyle = isHovered ? this.scene.highlightColorCss : canvasRenderer.rgbaToCssColor(this.scene.theme.rulerText.color);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatLength(this.scene, len), midX + per_x * labelOffset, midY + per_y * labelOffset);
  }

  onConstructMouseDown(mouse, ctrl, shift) {
    if (!this.constructionPoint) {
      const hit = findNearestFeaturePoint(this.scene, mouse, null);
      if (hit) {
        this.p1 = geometry.point(hit.point.x, hit.point.y);
        this.obj1Index = hit.objIndex;
        this.obj1Key = hit.key;
      } else {
        this.p1 = mouse.getPosSnappedToGrid();
        this.obj1Index = -1;
        this.obj1Key = '';
      }
      this.constructionPoint = this.p1;
      this.p2 = this.p1;
      this.obj2Index = -1;
      this.obj2Key = '';
      return;
    }
    this.updateP2(mouse, shift);
  }

  updateP2(mouse, shift) {
    const hit = findNearestFeaturePoint(this.scene, mouse, { objIndex: this.obj1Index, key: this.obj1Key });
    if (hit) {
      this.p2 = geometry.point(hit.point.x, hit.point.y);
      this.obj2Index = hit.objIndex;
      this.obj2Key = hit.key;
    } else {
      this.p2 = shift ? mouse.getPosSnappedToDirection(this.constructionPoint, [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: -1 }]) : mouse.getPosSnappedToGrid();
      this.obj2Index = -1;
      this.obj2Key = '';
    }
  }

  onConstructMouseMove(mouse, ctrl, shift) {
    if (!this.constructionPoint) return;
    this.updateP2(mouse, shift);
  }

  onConstructMouseUp(mouse, ctrl, shift) {
    if (!mouse.snapsOnPoint(this.p1)) {
      delete this.constructionPoint;
      // Unlike a plain Ruler, the objBar here shows an editable exact
      // distance -- worth the extra refresh so it doesn't show a stale
      // "0" (from when p1 == p2 at construction start) right after placing.
      return {
        isDone: true,
        requiresObjBarUpdate: true
      };
    }
  }

  onDrag(mouse, dragContext, ctrl, shift) {
    super.onDrag(mouse, dragContext, ctrl, shift);
    // A manual drag detaches that end from live tracking -- it becomes a
    // free point at wherever the user dropped it, like the Ruler tool.
    if (dragContext.part == 1) {
      this.obj1Index = -1;
      this.obj1Key = '';
    }
    if (dragContext.part == 2) {
      this.obj2Index = -1;
      this.obj2Key = '';
    }
    if (dragContext.part == 0) {
      this.obj1Index = -1;
      this.obj1Key = '';
      this.obj2Index = -1;
      this.obj2Key = '';
    }
  }
};

export default DistanceDimension;
