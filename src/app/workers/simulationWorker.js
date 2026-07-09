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
 * @file Web Worker that runs a full high-detail ("snapshot") simulation off the
 * main thread. It hosts its own {@link Scene} + {@link Simulator} pair rendering
 * into OffscreenCanvas layers, and streams progress, detector readings and
 * progressively-rendered frames (ImageBitmap) back to the main thread.
 *
 * Protocol (main -> worker):
 *   { cmd: 'run', runId, sceneJSON, viewport: { originX, originY, scale, width, height, dpr },
 *     rayCountLimit, maxMs }
 *   { cmd: 'stop', runId }
 *   { cmd: 'extend', runId, rayCountLimit, extraMs }  (raise the budget/deadline of the current run instead of letting it stop)
 *
 * Protocol (worker -> main):
 *   { type: 'progress', runId, processedRayCount, rayCountLimit, elapsed,
 *     totalTruncation, brightnessScale, detectors }
 *   { type: 'frame', runId, bitmap }              (bitmap is transferred)
 *   { type: 'done', runId, cancelled, reachedLimit, timedOut, processedRayCount, elapsed,
 *     totalTruncation, brightnessScale, detectors, error, warning }
 *   { type: 'error', runId, message }
 */

import Scene from '../../core/Scene.js';
import Simulator from '../../core/Simulator.js';
import i18next from 'i18next';
import simulatorEnLocale from '../../../locales/en/simulator.json';

// The core emits i18next-translated error/warning strings; initialize with the
// English resources inlined into this bundle (same pattern as core/index.js in
// Node environments).
if (!i18next.isInitialized) {
  i18next.init({
    lng: 'en',
    resources: {
      en: {
        simulator: simulatorEnLocale
      }
    },
    interpolation: {
      escapeValue: false
    }
  });
}

/** Minimum interval between progressive frames posted to the main thread. */
const FRAME_INTERVAL_MS = 200;

let currentRunId = null;
let currentSimulator = null;
let cancelled = false;
/** Mutable so a `cmd: 'extend'` message can raise them mid-run (see `self.onmessage` below). */
let currentRayCountLimit = 0;
let currentMaxMs = 0;
let lastFrameTime = 0;
let frameInFlight = false;

/**
 * Collect readings of top-level sensor objects (Detector, PowerMeter) so the
 * main thread can copy them onto its own scene objects. (Sensors nested
 * inside modules are not addressable by scene.objs index and are skipped.)
 */
function collectDetectors(scene) {
  const detectors = [];
  for (let i = 0; i < scene.objs.length; i++) {
    const obj = scene.objs[i];
    if (!obj) continue;
    const type = obj.constructor.type;
    if (type === 'Detector') {
      detectors.push({
        objIndex: i,
        type,
        power: obj.power,
        normal: obj.normal,
        shear: obj.shear,
        binData: obj.binData ? Array.from(obj.binData) : null
      });
    } else if (type === 'PowerMeter') {
      detectors.push({
        objIndex: i,
        type,
        power: obj.power
      });
    } else if (type === 'ImageSensor') {
      detectors.push({
        objIndex: i,
        type,
        power: obj.power,
        pixelData: obj.pixelData ? Array.from(obj.pixelData) : null
      });
    }
  }
  return detectors;
}

// Set whenever createImageBitmap() rejects, so a snapshot that never
// actually got any pixels onto the main thread's canvas still surfaces a
// visible error instead of silently reporting a successful, blank result
// (this previously failed silently — a caught-and-dropped rejection here
// left the main thread believing the compute succeeded with nothing drawn).
let lastFrameError = null;

function postFrame(runId, sourceCanvas) {
  if (frameInFlight) return;
  frameInFlight = true;
  createImageBitmap(sourceCanvas).then((bitmap) => {
    frameInFlight = false;
    if (runId !== currentRunId) {
      bitmap.close();
      return;
    }
    self.postMessage({ type: 'frame', runId, bitmap }, [bitmap]);
  }).catch((e) => {
    frameInFlight = false;
    lastFrameError = String(e && e.message ? e.message : e);
  });
}

/** Post the final frame, waiting for the bitmap (not throttled). */
function postFinalFrame(runId, sourceCanvas) {
  return createImageBitmap(sourceCanvas).then((bitmap) => {
    if (runId !== currentRunId) {
      bitmap.close();
      return;
    }
    self.postMessage({ type: 'frame', runId, bitmap }, [bitmap]);
  }).catch((e) => {
    lastFrameError = String(e && e.message ? e.message : e);
  });
}

function run(msg) {
  const { runId, sceneJSON, viewport } = msg;
  currentRayCountLimit = msg.rayCountLimit;
  currentMaxMs = msg.maxMs;

  // Invalidate any previous run; its pending timer callbacks will see the stale
  // generation and stop at their next 50ms slice boundary.
  if (currentSimulator) {
    currentSimulator.stopSimulation();
  }
  currentRunId = runId;
  cancelled = false;
  lastFrameTime = 0;
  frameInFlight = false;
  lastFrameError = null;

  const scene = new Scene();
  scene.loadJSON(sceneJSON, () => { });
  if (scene.error) {
    self.postMessage({ type: 'error', runId, message: scene.error });
    return;
  }

  // Match the main thread's current view exactly (toJSON approximates size).
  scene.origin = { x: viewport.originX, y: viewport.originY };
  scene.scale = viewport.scale;
  scene.setViewportSize(viewport.width, viewport.height);

  const dpr = viewport.dpr || 1;
  const pxWidth = Math.max(1, Math.round(viewport.width * dpr));
  const pxHeight = Math.max(1, Math.round(viewport.height * dpr));

  const lightCanvas = new OffscreenCanvas(pxWidth, pxHeight);
  const belowCanvas = new OffscreenCanvas(pxWidth, pxHeight);
  const aboveCanvas = new OffscreenCanvas(pxWidth, pxHeight);
  const virtualCanvas = new OffscreenCanvas(300, 150);

  // Non-default color modes need WebGL (FloatColorRenderer). Try to get a
  // float-texture-capable context on an OffscreenCanvas; otherwise fall back
  // to the default color mode for this snapshot.
  let gl = null;
  let glCanvas = null;
  if (scene.colorMode !== 'default') {
    try {
      glCanvas = new OffscreenCanvas(pxWidth, pxHeight);
      const contextAttributes = {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        preserveDrawingBuffer: true
      };
      gl = glCanvas.getContext('webgl', contextAttributes);
      if (!gl || !gl.getExtension('OES_texture_float')) {
        gl = null;
      }
    } catch (e) {
      gl = null;
    }
    if (!gl) {
      glCanvas = null;
      scene.colorMode = 'default';
    }
  }

  const frameSource = gl ? glCanvas : lightCanvas;

  const simulator = new Simulator(
    scene,
    lightCanvas.getContext('2d'),
    belowCanvas.getContext('2d'),
    aboveCanvas.getContext('2d'),
    null,
    virtualCanvas.getContext('2d'),
    true,
    currentRayCountLimit,
    gl,
    null,
    (width, height) => new OffscreenCanvas(width, height)
  );
  simulator.dpr = dpr;
  currentSimulator = simulator;

  const postProgress = () => {
    self.postMessage({
      type: 'progress',
      runId,
      processedRayCount: simulator.processedRayCount,
      rayCountLimit: currentRayCountLimit,
      elapsed: simulator.simulationStartTime ? (new Date() - simulator.simulationStartTime) : 0,
      totalTruncation: simulator.totalTruncation,
      brightnessScale: simulator.brightnessScale,
      detectors: collectDetectors(scene)
    });
  };

  const finish = (reachedLimit) => {
    if (runId !== currentRunId) return;
    const wasCancelled = cancelled;
    const done = () => {
      if (runId !== currentRunId) return;
      self.postMessage({
        type: 'done',
        runId,
        cancelled: wasCancelled,
        reachedLimit: reachedLimit && !wasCancelled,
        timedOut,
        processedRayCount: simulator.processedRayCount,
        elapsed: simulator.simulationStartTime ? (new Date() - simulator.simulationStartTime) : 0,
        totalTruncation: simulator.totalTruncation,
        brightnessScale: simulator.brightnessScale,
        detectors: collectDetectors(scene),
        error: simulator.error || scene.error || (lastFrameError ? `Snapshot image failed: ${lastFrameError}` : null),
        warning: simulator.warning || scene.warning || null
      });
    };
    if (wasCancelled) {
      done();
    } else {
      postFinalFrame(runId, frameSource).then(done);
    }
  };

  let timedOut = false;

  simulator.on('simulationPause', () => {
    if (runId !== currentRunId) return;
    // Wall-clock cap: some scenes (e.g. rays trapped between perfect facing
    // mirrors with unlimited ray depth) never terminate and process rays very
    // slowly; the budget alone doesn't bound their runtime.
    if (currentMaxMs && simulator.simulationStartTime && (new Date() - simulator.simulationStartTime) > currentMaxMs) {
      timedOut = true;
      simulator.stopSimulation();
    }
    postProgress();
    const now = Date.now();
    if (now - lastFrameTime >= FRAME_INTERVAL_MS) {
      lastFrameTime = now;
      postFrame(runId, frameSource);
    }
  });

  // 'simulationStop' fires both when the ray-count budget is reached and when
  // the run is cancelled; 'simulationComplete' when all rays are processed.
  simulator.on('simulationStop', () => finish(true));
  simulator.on('simulationComplete', () => finish(false));

  try {
    simulator.updateSimulation(false, true);
  } catch (e) {
    self.postMessage({ type: 'error', runId, message: String(e && e.message ? e.message : e) });
  }
}

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg || !msg.cmd) return;
  if (msg.cmd === 'run') {
    run(msg);
  } else if (msg.cmd === 'stop') {
    if (msg.runId === currentRunId && currentSimulator) {
      cancelled = true;
      currentSimulator.stopSimulation();
    }
  } else if (msg.cmd === 'extend') {
    // The main thread offered a "taking longer than normal, keep going?"
    // prompt and the user chose to continue: raise the ray budget and push
    // the wall-clock deadline `extraMs` out from now (not from the original
    // start, so it reliably grants fresh runway regardless of how much time
    // has already elapsed). The run is still live at this point (it only
    // reaches `rayCountLimit`/`maxMs` at its next check), so this just
    // raises the ceiling out from under it rather than needing to resume a
    // stopped simulation.
    if (msg.runId === currentRunId && currentSimulator) {
      if (msg.rayCountLimit > currentRayCountLimit) {
        currentRayCountLimit = msg.rayCountLimit;
        currentSimulator.rayCountLimit = currentRayCountLimit;
      }
      if (msg.extraMs) {
        const elapsed = currentSimulator.simulationStartTime ? (new Date() - currentSimulator.simulationStartTime) : 0;
        currentMaxMs = elapsed + msg.extraMs;
      }
    }
  }
};
