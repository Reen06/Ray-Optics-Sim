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
 * @module compute
 * @description The snapshot-compute service. The live simulation always runs at a
 * capped "preview" ray budget so editing stays responsive; this service runs a
 * full high-detail simulation of the current scene in a Web Worker
 * ({@link module:simulationWorker}) and displays the progressively-rendered
 * result on the light canvas. Editing the scene (or pressing "Live") returns to
 * the live preview.
 *
 * States: 'live' -> 'computing' -> 'snapshot' -> (edit or Live button) -> 'live'.
 */

import { reactive } from 'vue';
import { app } from './app.js';
import { statusEmitter, STATUS_EVENT_NAMES } from '../composables/useStatus.js';

/**
 * Ray budget for the always-on live preview simulation. Keeps dragging smooth
 * even at high ray density; the snapshot compute is the way to get full detail.
 */
export const LIVE_PREVIEW_RAY_BUDGET = 50000;

/** Base snapshot ray budget at detail x1. */
const SNAPSHOT_BASE_RAY_BUDGET = 200000;

/** Hard cap on the snapshot ray budget (keeps worst-case runtime bounded). */
const SNAPSHOT_MAX_RAY_BUDGET = 20000000;

/**
 * Wall-clock cap on a snapshot run. Guards against scenes whose rays never
 * terminate (e.g. trapped between perfect facing mirrors) and would otherwise
 * crawl toward the ray budget for hours.
 */
const SNAPSHOT_MAX_MS = 30000;

/**
 * Default random seed for snapshot runs of scenes that don't set one. Using a
 * fixed seed makes snapshot detector readings reproducible run-to-run, so
 * design iterations can be compared quantitatively. (Live preview keeps the
 * scene's own seeding behavior.)
 */
const SNAPSHOT_DEFAULT_SEED = 'snapshot';

export const computeState = reactive({
  /** 'live' | 'computing' | 'snapshot' */
  state: 'live',
  supported: typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined',
  progress: 0,
  processedRayCount: 0,
  rayCountLimit: 0,
  elapsed: 0,
  /** Detail multiplier of the last/current snapshot run. */
  detailMultiplier: 1,
  reachedLimit: false,
  error: null,
  warning: null,
});

let worker = null;
let runId = 0;
let prevManualLightRedraw = false;
let initialized = false;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../workers/simulationWorker.js', import.meta.url));
    worker.onmessage = onWorkerMessage;
    worker.onerror = (e) => {
      if (computeState.state === 'computing') {
        computeState.error = e.message || 'Worker error';
        exitToLive();
      }
    };
  }
  return worker;
}

function blitFrame(bitmap) {
  const canvasLight = app.canvasLight;
  if (!canvasLight) {
    bitmap.close();
    return;
  }
  // While a snapshot is displayed, the (unused) live WebGL layer is hidden so
  // it can't show stale content on top of / below the snapshot bitmap.
  if (app.canvasLightWebGL) {
    app.canvasLightWebGL.style.visibility = 'hidden';
  }
  canvasLight.style.display = '';
  canvasLight.style.opacity = 1;
  const ctx = canvasLight.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, canvasLight.width, canvasLight.height);
  ctx.drawImage(bitmap, 0, 0, canvasLight.width, canvasLight.height);
  bitmap.close();
}

function applyDetectorData(msg) {
  if (!app.scene || !app.simulator) return;
  // The worker's truncation estimate is what the detector "±" readout should
  // show alongside the snapshot readings.
  app.simulator.totalTruncation = msg.totalTruncation;
  if (msg.brightnessScale) {
    app.simulator.brightnessScale = msg.brightnessScale;
  }
  for (const d of msg.detectors || []) {
    const obj = app.scene.objs[d.objIndex];
    if (!obj || obj.constructor.type !== (d.type || 'Detector')) continue;
    if (d.type === 'PowerMeter') {
      obj.power = d.power;
    } else {
      obj.power = d.power;
      obj.normal = d.normal;
      obj.shear = d.shear;
      obj.binData = d.binData;
    }
  }
  // Redraw the above-light layer so detector readouts update.
  app.simulator.updateSimulation(true, true);
}

function emitStatus(msg, isRunning) {
  statusEmitter.emit(STATUS_EVENT_NAMES.SIMULATOR_STATUS, {
    rayCount: msg.processedRayCount,
    totalTruncation: msg.totalTruncation,
    brightnessScale: msg.brightnessScale,
    timeElapsed: msg.elapsed,
    isSimulatorRunning: isRunning,
    isForceStop: false
  });
}

function onWorkerMessage(event) {
  const msg = event.data;
  if (!msg || msg.runId !== runId) return;

  if (msg.type === 'frame') {
    if (computeState.state === 'computing' || computeState.state === 'snapshot') {
      blitFrame(msg.bitmap);
    } else {
      msg.bitmap.close();
    }
  } else if (msg.type === 'progress') {
    if (computeState.state !== 'computing') return;
    computeState.processedRayCount = msg.processedRayCount;
    computeState.elapsed = msg.elapsed;
    computeState.progress = Math.min(1, msg.processedRayCount / msg.rayCountLimit);
    applyDetectorData(msg);
    emitStatus(msg, true);
  } else if (msg.type === 'done') {
    if (computeState.state !== 'computing') return;
    if (msg.cancelled) {
      exitToLive();
      return;
    }
    computeState.state = 'snapshot';
    computeState.progress = 1;
    computeState.processedRayCount = msg.processedRayCount;
    computeState.elapsed = msg.elapsed;
    computeState.reachedLimit = msg.reachedLimit;
    computeState.error = msg.error;
    computeState.warning = msg.warning;
    applyDetectorData(msg);
    emitStatus(msg, false);
  } else if (msg.type === 'error') {
    if (computeState.state !== 'computing') return;
    computeState.error = msg.message;
    exitToLive();
  }
}

/**
 * Start a snapshot compute of the current scene.
 * @param {number} detail - Detail exponent (0..2); the ray density and ray
 * budget are multiplied by 10^detail relative to the base snapshot budget.
 */
export function startCompute(detail) {
  if (!computeState.supported || !app.simulator || !app.scene) return;
  if (computeState.state === 'computing') return;

  const multiplier = Math.pow(10, Math.max(0, Math.min(2, detail || 0)));
  const rayCountLimit = Math.min(SNAPSHOT_MAX_RAY_BUDGET, Math.round(SNAPSHOT_BASE_RAY_BUDGET * multiplier));

  const scene = app.scene;
  const json = JSON.parse(scene.toJSON());

  // Scale the source ray density by the detail multiplier so the extra ray
  // budget is actually used by denser emission rather than deeper truncation.
  if (scene.mode === 'rays' || scene.mode === 'extended') {
    json.rayModeDensity = (json.rayModeDensity ?? 0.1) * multiplier;
  } else {
    json.imageModeDensity = (json.imageModeDensity ?? 1) * multiplier;
  }

  if (!json.randomSeed) {
    json.randomSeed = SNAPSHOT_DEFAULT_SEED;
  }

  if (computeState.state === 'live') {
    prevManualLightRedraw = app.simulator.manualLightRedraw;
  }
  // Freeze the live light layer while the snapshot owns the canvas. Edits
  // during/after the compute fire lightLayerSyncChange -> dim (existing UX),
  // and our 'update' hook returns to live.
  app.simulator.manualLightRedraw = true;

  runId++;
  computeState.state = 'computing';
  computeState.progress = 0;
  computeState.processedRayCount = 0;
  computeState.rayCountLimit = rayCountLimit;
  computeState.elapsed = 0;
  computeState.detailMultiplier = multiplier;
  computeState.reachedLimit = false;
  computeState.error = null;
  computeState.warning = null;

  const dpr = window.devicePixelRatio || 1;
  getWorker().postMessage({
    cmd: 'run',
    runId,
    sceneJSON: JSON.stringify(json),
    viewport: {
      originX: scene.origin.x,
      originY: scene.origin.y,
      scale: scene.scale,
      width: app.canvasLight.width / dpr,
      height: app.canvasLight.height / dpr,
      dpr
    },
    rayCountLimit,
    maxMs: SNAPSHOT_MAX_MS
  });
}

/** Cancel a compute in progress (returns to live once the worker confirms). */
export function cancelCompute() {
  if (computeState.state !== 'computing') return;
  getWorker().postMessage({ cmd: 'stop', runId });
  // Don't wait for the worker's ack to unfreeze the UI.
  exitToLive();
}

/** Leave snapshot/computing mode and resume the live preview. */
export function exitToLive() {
  if (computeState.state === 'live') return;
  const wasComputing = computeState.state === 'computing';
  computeState.state = 'live';
  computeState.progress = 0;
  if (wasComputing) {
    // Make sure a still-running worker sim stops burning CPU.
    getWorker().postMessage({ cmd: 'stop', runId });
  }
  if (app.canvasLightWebGL) {
    app.canvasLightWebGL.style.visibility = '';
  }
  if (app.simulator) {
    app.simulator.manualLightRedraw = prevManualLightRedraw;
    // Redraw the live light layer (also correct in manual-refresh mode: this
    // is exactly a one-shot manual redraw).
    app.simulator.updateSimulation(false, true, true);
  }
}

/**
 * Wire the service to the app. Must be called after `app.initAppService()`.
 */
export function initComputeService() {
  if (initialized || !app.simulator) return;
  initialized = true;

  // Cap the live preview so the main thread never runs an unbounded
  // simulation; full detail is the snapshot compute's job.
  app.simulator.rayCountLimit = LIVE_PREVIEW_RAY_BUDGET;

  // Any update that would redraw the light layer means the scene (or view)
  // changed: leave the snapshot and go back to live so the canvas never shows
  // stale-but-undimmed results and editing always has immediate feedback.
  app.simulator.on('update', ({ skipLight, forceRedraw }) => {
    if (computeState.state === 'live') return;
    if (skipLight) return;
    if (forceRedraw) return; // our own exitToLive redraw
    exitToLive();
  });
}
