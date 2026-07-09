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

/**
 * If a run is still going after this long, surface a "taking longer than
 * normal, keep going?" prompt (ComputeBar.vue) instead of just running to
 * SNAPSHOT_MAX_MS/the ray budget and silently truncating -- deliberately
 * well short of SNAPSHOT_MAX_MS so there's time left to actually extend it.
 */
const SLOW_PROMPT_MS = 8000;

/** Ray budget/wall-clock time granted per "Keep going" click. */
const EXTEND_RAY_BUDGET_MULTIPLIER = 2;
const EXTEND_MS = 20000;

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
  /** True while the "taking longer than normal, keep going?" prompt should show. */
  takingLong: false,
  error: null,
  warning: null,
});

let worker = null;
let runId = 0;
let prevManualLightRedraw = false;
let initialized = false;
/** Whether the current run has ever produced a bitmap ('frame' message). */
let receivedAnyFrame = false;
/** Once the user dismisses the slow-run prompt, don't immediately re-show it
 * for the rest of this run (it would otherwise reappear on the very next
 * progress tick, since elapsed time only grows). Reset per run. */
let slowPromptDismissed = false;
/** Watchdog: if the worker never responds at all (no progress/frame/done),
 * fail loudly instead of leaving the UI stuck on a frozen canvas forever. */
let watchdogTimer = null;
const WATCHDOG_MS = 15000;

function clearWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

/** (Re)arm the stuck-worker watchdog for the current run. */
function armWatchdog() {
  clearWatchdog();
  const watchedRunId = runId;
  watchdogTimer = setTimeout(() => {
    watchdogTimer = null;
    if (computeState.state !== 'computing' || watchedRunId !== runId) return;
    computeState.error = 'Compute did not respond — reverted to live preview.';
    exitToLive();
  }, WATCHDOG_MS);
}

/**
 * The viewport (origin/scale/dpr) that the current worker run was requested
 * with, and the most recent frame it produced. Kept around (instead of
 * discarding each bitmap after drawing) so the snapshot can be reprojected
 * onto the canvas whenever the user pans or zooms afterward, rather than
 * either staying frozen at its original screen position (visually drifting
 * out of alignment with the scene) or being wiped back to the live preview.
 */
let lastBitmap = null;
let capturedViewport = null;
let currentViewport = null;

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

function releaseBitmap() {
  if (lastBitmap) {
    lastBitmap.close();
    lastBitmap = null;
  }
  capturedViewport = null;
}

/**
 * Redraw the frozen snapshot bitmap onto the light canvas, reprojected from
 * the viewport it was captured at onto the scene's current origin/scale —
 * this is what lets the user pan/zoom around after a compute without losing
 * the result: the same scene point stays under the same screen pixel.
 */
function redrawSnapshot() {
  const canvasLight = app.canvasLight;
  const scene = app.scene;
  if (!lastBitmap || !capturedViewport || !canvasLight || !scene) return;
  const zoomRatio = scene.scale / capturedViewport.scale;
  const dpr = capturedViewport.dpr;
  const ctx = canvasLight.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, canvasLight.width, canvasLight.height);
  const tx = scene.origin.x * dpr - capturedViewport.originX * dpr * zoomRatio;
  const ty = scene.origin.y * dpr - capturedViewport.originY * dpr * zoomRatio;
  ctx.setTransform(zoomRatio, 0, 0, zoomRatio, tx, ty);
  ctx.drawImage(lastBitmap, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function blitFrame(bitmap) {
  const canvasLight = app.canvasLight;
  if (!canvasLight) {
    bitmap.close();
    return;
  }
  if (lastBitmap) lastBitmap.close();
  lastBitmap = bitmap;
  capturedViewport = currentViewport;
  // While a snapshot is displayed, the (unused) live WebGL layer is hidden so
  // it can't show stale content on top of / below the snapshot bitmap.
  if (app.canvasLightWebGL) {
    app.canvasLightWebGL.style.visibility = 'hidden';
  }
  canvasLight.style.display = '';
  canvasLight.style.opacity = 1;
  redrawSnapshot();
}

/**
 * Whether two `scene.toJSON()` strings differ in anything other than pure
 * view state (pan/zoom). Origin and scale are themselves part of the
 * serialized scene (panning/zooming are undoable), so a raw string/simulator
 * 'update' event can't tell "the user edited something" apart from "the user
 * panned" — this comparison can.
 */
function contentChanged(oldJSON, newJSON) {
  if (oldJSON === newJSON) return false;
  try {
    const a = JSON.parse(oldJSON || '{}');
    const b = JSON.parse(newJSON || '{}');
    delete a.origin; delete b.origin;
    delete a.scale; delete b.scale;
    return JSON.stringify(a) !== JSON.stringify(b);
  } catch (e) {
    return true; // can't tell: treat as a real change, fail toward correctness
  }
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
    } else if (d.type === 'ImageSensor') {
      obj.power = d.power;
      obj.pixelData = d.pixelData;
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

  // Any message at all proves the worker is alive; only a total silence
  // needs the watchdog.
  clearWatchdog();

  if (msg.type === 'frame') {
    if (computeState.state === 'computing' || computeState.state === 'snapshot') {
      receivedAnyFrame = true;
      blitFrame(msg.bitmap);
    } else {
      msg.bitmap.close();
    }
    if (computeState.state === 'computing') armWatchdog();
  } else if (msg.type === 'progress') {
    if (computeState.state !== 'computing') return;
    computeState.processedRayCount = msg.processedRayCount;
    computeState.elapsed = msg.elapsed;
    computeState.progress = Math.min(1, msg.processedRayCount / msg.rayCountLimit);
    applyDetectorData(msg);
    emitStatus(msg, true);
    armWatchdog();
    if (!computeState.takingLong && !slowPromptDismissed && computeState.progress < 1 && msg.elapsed > SLOW_PROMPT_MS) {
      computeState.takingLong = true;
    }
  } else if (msg.type === 'done') {
    if (computeState.state !== 'computing') return;
    computeState.takingLong = false;
    if (msg.cancelled) {
      exitToLive();
      return;
    }
    if (!receivedAnyFrame) {
      // The compute "succeeded" but no snapshot image was ever produced
      // (e.g. createImageBitmap failed in this browser) -- showing
      // "Snapshot complete" over a blank/stale canvas would be worse than
      // just reverting to live with a visible reason.
      computeState.error = msg.error || 'Snapshot image could not be created in this browser.';
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

  // Scale the source ray density by the full detail multiplier, same as the
  // ray-count budget, so "Detail x100" actually processes ~100x more rays --
  // that's the entire point of the slider. (A gentler sqrt-scaled + hard-
  // capped version was tried here, to tame a rendering artifact at extreme
  // density -- see the note on MAX_SAFETY_DENSITY below -- but it made the
  // ray count plateau at a few thousand regardless of the Detail setting,
  // which defeated the actual feature. Reverted to linear scaling.)
  //
  // Known trade-off, not fixed here: at VERY high ray density, the default
  // 2D-canvas renderer draws each ray at a proportionally lower alpha
  // (correct for physics/detector readings, since total brightness is
  // conserved), but plain source-over blending doesn't reconstruct constant
  // total visual brightness from many faint lines, so the render can look
  // dimmer at very high Detail; "Correct Brightness" color mode can show a
  // faint haze at extreme density for the same reason (gamma-boosted alpha
  // on near-zero background contributions). Both are pre-existing
  // characteristics of these renderers reachable in live mode too (e.g. by
  // manually cranking Ray Density) -- not something Compute introduces, just
  // something it can reach more easily. MAX_SAFETY_DENSITY only intervenes
  // for truly extreme combinations (an already very high live density
  // stacked with max Detail), not routine use.
  const densityMultiplier = multiplier;
  const MAX_SAFETY_DENSITY = 50;
  if (scene.mode === 'rays' || scene.mode === 'extended') {
    json.rayModeDensity = Math.min(MAX_SAFETY_DENSITY, (json.rayModeDensity ?? 0.1) * densityMultiplier);
  } else {
    json.imageModeDensity = Math.min(MAX_SAFETY_DENSITY, (json.imageModeDensity ?? 1) * densityMultiplier);
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
  receivedAnyFrame = false;
  slowPromptDismissed = false;
  computeState.state = 'computing';
  computeState.progress = 0;
  computeState.processedRayCount = 0;
  computeState.rayCountLimit = rayCountLimit;
  computeState.elapsed = 0;
  computeState.detailMultiplier = multiplier;
  computeState.reachedLimit = false;
  computeState.takingLong = false;
  computeState.error = null;
  computeState.warning = null;
  armWatchdog();

  const dpr = window.devicePixelRatio || 1;
  currentViewport = {
    originX: scene.origin.x,
    originY: scene.origin.y,
    scale: scene.scale,
    dpr
  };
  getWorker().postMessage({
    cmd: 'run',
    runId,
    sceneJSON: JSON.stringify(json),
    viewport: {
      ...currentViewport,
      width: app.canvasLight.width / dpr,
      height: app.canvasLight.height / dpr
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

/**
 * Respond to the "taking longer than normal, keep going?" prompt by raising
 * the run's ray budget and wall-clock deadline instead of letting it stop.
 * The run is still live at this point -- this just raises the ceiling it's
 * heading toward, no resume-from-stopped logic needed.
 */
export function keepComputing() {
  if (computeState.state !== 'computing') return;
  computeState.takingLong = false;
  const newLimit = Math.min(SNAPSHOT_MAX_RAY_BUDGET, Math.round(computeState.rayCountLimit * EXTEND_RAY_BUDGET_MULTIPLIER));
  computeState.rayCountLimit = newLimit;
  getWorker().postMessage({ cmd: 'extend', runId, rayCountLimit: newLimit, extraMs: EXTEND_MS });
  armWatchdog();
}

/** Dismiss the "taking longer than normal" prompt without extending; the run keeps going toward its original budget/deadline and won't re-prompt this run. */
export function dismissSlowPrompt() {
  computeState.takingLong = false;
  slowPromptDismissed = true;
}

/** Leave snapshot/computing mode and resume the live preview. */
export function exitToLive() {
  if (computeState.state === 'live') return;
  const wasComputing = computeState.state === 'computing';
  clearWatchdog();
  computeState.state = 'live';
  computeState.progress = 0;
  if (wasComputing) {
    // Make sure a still-running worker sim stops burning CPU.
    getWorker().postMessage({ cmd: 'stop', runId });
  }
  releaseBitmap();
  currentViewport = null;
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

  // `updateSimulation()` fires on every pan/zoom/fit-to-screen too (they're
  // plain scene.origin/scale mutations, not just object edits), not only on
  // real content edits. While a snapshot is displayed we don't want those to
  // wipe it back to the sparse live preview — instead just reproject the
  // frozen bitmap onto the new view so it stays visible and aligned.
  //
  // The redraw must happen on the NEXT frame, not synchronously inside this
  // listener: 'update' is emitted at the very top of updateSimulation(), but
  // whenever origin/scale actually changed (exactly the pan/zoom case) the
  // rest of that same call still clears/re-inits the light canvas further
  // down (`shouldClearLightLayer`) even though skipLight ends up forced true
  // — so a synchronous redraw here would just get wiped a moment later by
  // the same call.
  let redrawScheduled = false;
  app.simulator.on('update', ({ forceRedraw }) => {
    if (computeState.state === 'live') return;
    if (forceRedraw) return; // our own exitToLive/manual redraw call
    if (redrawScheduled) return;
    redrawScheduled = true;
    requestAnimationFrame(() => {
      redrawScheduled = false;
      if (computeState.state !== 'live') redrawSnapshot();
    });
  });

  // `manualLightRedraw` (which we keep set for the whole computing/snapshot
  // duration, to stop the live simulator from repainting over our bitmap)
  // also drives an upstream "results are stale, dim the canvas" indicator
  // for the unrelated "Auto Refresh off" feature. That doesn't apply to us —
  // our bitmap is never stale, it's just reprojected — so force it back to
  // full opacity whenever it fires during compute/snapshot.
  app.simulator.on('lightLayerSyncChange', ({ isSynced }) => {
    if (computeState.state === 'live') return;
    if (isSynced) return;
    if (app.canvasLightWebGL) app.canvasLightWebGL.style.opacity = 1;
    if (app.canvasLight) app.canvasLight.style.opacity = 1;
  });

  // The actual "did the user edit the scene" signal: Editor.onActionComplete
  // fires 'newAction' with the before/after JSON for every completed action,
  // including pan/zoom (origin/scale are serialized, undoable scene fields)
  // — so only exit to live when something other than the view changed.
  app.editor?.on('newAction', ({ newJSON, oldJSON }) => {
    if (computeState.state === 'live') return;
    if (contentChanged(oldJSON, newJSON)) exitToLive();
  });
}
