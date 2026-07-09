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
  <div v-if="layout === 'desktop'" class="col-auto d-none d-xl-block">
    <div class="row justify-content-center">
      <div
        class="btn-group d-flex align-items-center"
        role="group"
        v-tooltip-popover:[tooltipType]="{
          content: $t('simulator:settings.brightnessGain.description'),
          offset: [0, 25]
        }"
      >
        <button class="btn shadow-none range-minus-btn" id="brightnessGainMinus" @click="(e) => { decreaseGain(); e.target.blur(); }">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-dash" viewBox="0 0 16 16">
            <path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z"/>
          </svg>
        </button>
        <input type="range"
          class="form-range toolbar-range"
          min="-3"
          max="3"
          step="0.0001"
          v-model="brightnessGain"
          @click="e => e.target.blur()"
        >
        <button class="btn shadow-none range-plus-btn" id="brightnessGainPlus" @click="(e) => { increaseGain(); e.target.blur(); }">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-plus" viewBox="0 0 16 16">
            <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="row justify-content-center title">{{ $t('simulator:settings.brightnessGain.title') }}</div>
  </div>

  <div v-if="layout === 'tablet'"
    class="row d-flex d-xl-none justify-content-between align-items-center"
    v-tooltip-popover:[tooltipType]="{
      content: $t('simulator:settings.brightnessGain.description'),
      placement: 'left',
      offset: [0, 20]
    }"
  >
    <div class="col-auto">{{ $t('simulator:settings.brightnessGain.title') }}</div>
    <div class="btn-group col-auto d-flex align-items-center" role="group">
      <button class="btn shadow-none range-minus-btn" id="brightnessGainMinus_more" @click="(e) => { decreaseGain(); e.target.blur(); }">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-dash" viewBox="0 0 16 16">
          <path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z"/>
        </svg>
      </button>
      <input type="range"
        class="form-range toolbar-range"
        min="-3"
        max="3"
        step="0.0001"
        v-model="brightnessGain"
        @click="e => e.target.blur()"
      >
      <button class="btn shadow-none range-plus-btn" id="brightnessGainPlus_more" @click="(e) => { increaseGain(); e.target.blur(); }">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-plus" viewBox="0 0 16 16">
          <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
        </svg>
      </button>
    </div>
    <hr class="dropdown-divider">
  </div>

  <div v-if="layout === 'mobile'" class="row d-flex justify-content-between align-items-center">
    <div class="col-auto settings-label">{{ $t('simulator:settings.brightnessGain.title') }}</div>
    <div class="col-auto d-flex align-items-center">
      <button class="btn range-minus-btn" id="brightnessGainMinus_mobile" @click="(e) => { decreaseGain(); e.target.blur(); }">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-dash" viewBox="0 0 16 16">
          <path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8z"/>
        </svg>
      </button>
      <input type="range"
        class="form-range toolbar-range"
        min="-3"
        max="3"
        step="0.0001"
        v-model="brightnessGain"
        @click="e => e.target.blur()"
      >
      <button class="btn range-plus-btn" id="brightnessGainPlus_mobile" @click="(e) => { increaseGain(); e.target.blur(); }">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-plus" viewBox="0 0 16 16">
          <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
        </svg>
      </button>
    </div>
  </div>
  <hr v-if="layout === 'mobile'" class="dropdown-divider">
</template>

<script>
/**
 * @module BrightnessGainBar
 * @description The vue component for the 'Brightness Gain' section of the toolbar (desktop) or the brightness gain controls in the SettingsBar component (mobile or tablet).
 *
 * Purely a VIEWING exposure control: it scales how bright rays are drawn on
 * screen (like a camera's exposure/gain), completely independent of the
 * physical brightness/power values on light sources -- detector, power
 * meter, and image sensor readings are computed from the ray's actual
 * brightness_s/brightness_p and are never touched by this. It exists
 * because a scene calibrated to real physical units (e.g. a 20 mW COB LED)
 * can be too dim to usefully SEE at a 1:1 visual mapping, while another
 * scene with much higher real power would be too bright -- this lets you
 * dial the display back into a comfortable viewing range without lying
 * about the physics.
 * @vue-prop {String} layout - The layout of the toolbar. Can be 'mobile', 'tablet', or 'desktop'. Here 'tablet' means middle-sized screen where this control is to be shown inside the SettingsBar component.
 */
import { vTooltipPopover } from '../../directives/tooltip-popover'
import { usePreferencesStore } from '../../store/preferences'
import { useSceneStore } from '../../store/scene'
import { computed, toRef } from 'vue'

export default {
  name: 'BrightnessGainBar',
  directives: {
    'tooltip-popover': vTooltipPopover
  },
  props: {
    layout: String
  },
  setup() {
    const preferences = usePreferencesStore()
    const scene = useSceneStore()
    const help = toRef(preferences, 'help')
    const brightnessGainModel = toRef(scene, 'brightnessGain')
    const tooltipType = computed(() => help.value ? 'popover' : null)

    const brightnessGain = computed({
      get: () => Math.log(brightnessGainModel.value ?? 1),
      set: (value) => {
        brightnessGainModel.value = Math.exp(value)
      }
    })

    const increaseGain = () => {
      brightnessGain.value = brightnessGain.value + 0.1
    }

    const decreaseGain = () => {
      brightnessGain.value = brightnessGain.value - 0.1
    }

    return {
      tooltipType,
      brightnessGain,
      increaseGain,
      decreaseGain
    }
  }
}
</script>

<style scoped>
.toolbar-range {
  width: 100px;
  padding-top: 3px;
}

.toolbar-range::-webkit-slider-thumb {
  background: gray;
  border: 2px solid darkgray;
}

.toolbar-range::-moz-range-thumb {
  background: rgb(96, 96, 96);
  border: 2px solid gray;
}

.toolbar-range::-webkit-slider-runnable-track {
  background: rgba(128,128,128,0.5);
}

.toolbar-range::-moz-range-track {
  background-color: rgba(128,128,128,0.5);
}

</style>
