<!--
  Copyright 2026 The Ray Optics Simulation authors and contributors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->

<template>
  <div class="compute-error-banner" v-if="state === 'live' && lastError" @click="dismissError">
    ⚠ {{ lastError }} <span class="compute-error-dismiss">✕</span>
  </div>
  <div class="compute-slow-banner" v-if="state === 'computing' && takingLong">
    <span>{{ $t('simulator:computeBar.takingLong') }}</span>
    <div class="compute-slow-actions">
      <button class="btn compute-slow-btn" @click="handleKeepGoing">{{ $t('simulator:computeBar.keepGoing') }}</button>
      <span class="compute-slow-dismiss" @click="handleDismissSlow">✕</span>
    </div>
  </div>
  <div class="compute-bar" v-if="supported">
    <!-- Live state: detail slider + Compute button -->
    <template v-if="state === 'live'">
      <div class="detail-group" v-tooltip-popover="{ content: $t('simulator:computeBar.description') }">
        <span class="detail-label">{{ $t('simulator:computeBar.detail') }} ×{{ detailMultiplierLabel }}</span>
        <input type="range" class="form-range compute-range" min="0" max="2" step="0.1" v-model.number="snapshotDetail" @click="e => e.target.blur()">
      </div>
      <button class="btn compute-btn" @click="handleCompute">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-lightning-charge-fill" viewBox="0 0 16 16">
          <path d="M11.251.068a.5.5 0 0 1 .227.58L9.677 6.5H13a.5.5 0 0 1 .364.843l-8 8.5a.5.5 0 0 1-.842-.49L6.323 9.5H3a.5.5 0 0 1-.364-.843l8-8.5a.5.5 0 0 1 .615-.09z"/>
        </svg>
        {{ $t('simulator:computeBar.compute') }}
      </button>
    </template>

    <!-- Computing state: progress + cancel -->
    <template v-else-if="state === 'computing'">
      <div class="progress-group">
        <div class="progress-info">
          <span>{{ $t('simulator:computeBar.computing') }}</span>
          <span class="progress-stats">{{ rayCountLabel }} · {{ elapsedLabel }}</span>
        </div>
        <div class="progress compute-progress">
          <div class="progress-bar" role="progressbar" :style="{ width: (progress * 100).toFixed(1) + '%' }"></div>
        </div>
      </div>
      <button class="btn compute-btn" @click="handleCancel">{{ $t('simulator:computeBar.cancel') }}</button>
    </template>

    <!-- Snapshot state: result + recompute + back to live -->
    <template v-else>
      <span class="snapshot-label" :title="snapshotTitle">
        {{ $t('simulator:computeBar.snapshot') }} ×{{ lastMultiplierLabel }} · {{ rayCountLabel }} · {{ elapsedLabel }}
        <span v-if="reachedLimit" class="snapshot-truncated" :title="$t('simulator:computeBar.reachedLimitWarning')">⚠</span>
      </span>
      <button class="btn compute-btn" @click="handleCompute" v-tooltip-popover="{ title: $t('simulator:computeBar.recompute') }">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-arrow-clockwise" viewBox="0 0 16 16">
          <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
          <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
        </svg>
      </button>
      <button class="btn compute-btn live-btn" @click="handleLive">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="bi bi-play-fill" viewBox="0 0 16 16">
          <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>
        </svg>
        {{ $t('simulator:computeBar.live') }}
      </button>
    </template>
  </div>
</template>

<script>
/**
 * @module ComputeBar
 * @description The Vue component for the snapshot-compute controls: a detail
 * slider and Compute button (live state), a progress bar with Cancel
 * (computing), and Recompute / back-to-Live buttons (snapshot displayed).
 * Backed by the {@link module:compute} service.
 */
import { computed, toRef } from 'vue'
import { vTooltipPopover } from '../directives/tooltip-popover'
import { usePreferencesStore } from '../store/preferences'
import { computeState, startCompute, cancelCompute, exitToLive, keepComputing, dismissSlowPrompt } from '../services/compute'

export default {
  name: 'ComputeBar',
  directives: {
    'tooltip-popover': vTooltipPopover
  },
  setup() {
    const preferences = usePreferencesStore()
    const snapshotDetail = toRef(preferences, 'snapshotDetail')

    const state = computed(() => computeState.state)
    const supported = computed(() => computeState.supported)
    const progress = computed(() => computeState.progress)
    const takingLong = computed(() => computeState.takingLong)
    const reachedLimit = computed(() => computeState.reachedLimit)

    const detailMultiplierLabel = computed(() => Math.round(Math.pow(10, snapshotDetail.value)))
    const lastMultiplierLabel = computed(() => Math.round(computeState.detailMultiplier))

    const rayCountLabel = computed(() => {
      const n = computeState.processedRayCount
      if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M ' + 'rays'
      if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k ' + 'rays'
      return n + ' rays'
    })

    const elapsedLabel = computed(() => {
      const ms = computeState.elapsed
      return ms >= 10000 ? (ms / 1000).toFixed(0) + 's' : (ms / 1000).toFixed(1) + 's'
    })

    const snapshotTitle = computed(() => {
      return computeState.warning || computeState.error || ''
    })

    // Shown as a visible banner (not just a hover title) once back in the
    // live state after a failed compute (worker error, watchdog timeout, or
    // a snapshot that produced no image) -- a silently-swallowed failure
    // previously looked identical to "nothing happened".
    const lastError = computed(() => computeState.error)
    const dismissError = () => { computeState.error = null }

    const handleCompute = (event) => {
      event.target.blur()
      startCompute(snapshotDetail.value)
    }

    const handleCancel = (event) => {
      event.target.blur()
      cancelCompute()
    }

    const handleLive = (event) => {
      event.target.blur()
      exitToLive()
    }

    const handleKeepGoing = (event) => {
      event.target.blur()
      keepComputing()
    }

    const handleDismissSlow = () => {
      dismissSlowPrompt()
    }

    return {
      state,
      supported,
      progress,
      takingLong,
      reachedLimit,
      snapshotDetail,
      detailMultiplierLabel,
      lastMultiplierLabel,
      rayCountLabel,
      elapsedLabel,
      snapshotTitle,
      lastError,
      dismissError,
      handleCompute,
      handleCancel,
      handleLive,
      handleKeepGoing,
      handleDismissSlow
    }
  }
}
</script>

<style scoped>
.compute-bar {
  position: fixed;
  bottom: 23px;
  right: 75px;
  z-index: 100;
  background-color: rgba(168, 168, 168, 0.3);
  color: white;
  padding: 5px 12px;
  border-radius: 0.5em;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10pt;
}

.detail-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-label {
  white-space: nowrap;
  font-size: 9pt;
  opacity: 0.9;
}

.compute-range {
  width: 90px;
  padding-top: 3px;
}

.compute-range::-webkit-slider-thumb {
  background: gray;
  border: 2px solid darkgray;
}

.compute-range::-moz-range-thumb {
  background: rgb(96, 96, 96);
  border: 2px solid gray;
}

.compute-range::-webkit-slider-runnable-track {
  background: rgba(128, 128, 128, 0.5);
}

.compute-range::-moz-range-track {
  background-color: rgba(128, 128, 128, 0.5);
}

.compute-btn {
  background-color: rgba(192, 192, 192, 0.2);
  color: white;
  border: none;
  border-radius: 0.4em;
  padding: 4px 10px;
  font-size: 10pt;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.compute-btn:hover {
  background-color: rgba(168, 168, 168, 0.8);
  color: white;
  box-shadow: none;
}

.compute-btn:focus {
  box-shadow: none;
}

.progress-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 180px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 8.5pt;
  opacity: 0.9;
}

.progress-stats {
  font-variant-numeric: tabular-nums;
}

.compute-progress {
  height: 6px;
  background-color: rgba(128, 128, 128, 0.5);
}

.compute-progress .progress-bar {
  background-color: rgba(255, 255, 255, 0.85);
  transition: width 0.2s linear;
}

.snapshot-label {
  white-space: nowrap;
  font-size: 9pt;
  opacity: 0.95;
  font-variant-numeric: tabular-nums;
}

.compute-error-banner {
  position: fixed;
  bottom: 70px;
  right: 75px;
  z-index: 100;
  max-width: 340px;
  background-color: rgba(180, 40, 40, 0.92);
  color: white;
  padding: 8px 12px;
  border-radius: 0.5em;
  font-size: 9.5pt;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.compute-error-dismiss {
  float: right;
  opacity: 0.8;
  margin-left: 8px;
}

.compute-slow-banner {
  position: fixed;
  bottom: 70px;
  right: 75px;
  z-index: 100;
  max-width: 260px;
  background-color: rgba(60, 60, 60, 0.92);
  color: white;
  padding: 8px 10px;
  border-radius: 0.5em;
  font-size: 9.5pt;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.compute-slow-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.compute-slow-btn {
  background-color: rgba(255, 255, 255, 0.15);
  color: white;
  border: none;
  border-radius: 0.4em;
  padding: 3px 10px;
  font-size: 9pt;
}

.compute-slow-btn:hover {
  background-color: rgba(255, 255, 255, 0.3);
}

.compute-slow-dismiss {
  opacity: 0.8;
  cursor: pointer;
}

.snapshot-truncated {
  opacity: 0.9;
  cursor: default;
}
</style>
