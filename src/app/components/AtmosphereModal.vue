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
  <div class="modal fade" id="atmosphereModal" data-bs-backdrop="false" data-bs-keyboard="false" tabindex="-1" aria-labelledby="staticBackdropLabel_atmosphere" aria-hidden="true">
    <div class="modal-backdrop fade" :class="{ show: isModalOpen }" @click="closeModal"></div>
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="staticBackdropLabel_atmosphere" v-html="$t('simulator:atmosphere.title')"></h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <p class="atmosphere-intro" v-html="$t('simulator:atmosphere.description')"></p>

          <div class="form-check form-switch atmosphere-enable-row">
            <input class="form-check-input" type="checkbox" role="switch" id="atmosphereEnabled" v-model="enabled">
            <label class="form-check-label" for="atmosphereEnabled">{{ $t('simulator:atmosphere.enable') }}</label>
          </div>

          <div class="atmosphere-controls" :class="{ 'atmosphere-controls--disabled': !enabled }">
            <div class="atmosphere-row">
              <label>{{ $t('simulator:atmosphere.meanFreePath') }}{{ unitSuffix }}</label>
              <input type="number" class="form-control form-control-sm" min="1" step="1" v-model.number="meanFreePath" :disabled="!enabled">
            </div>
            <div class="atmosphere-hint">{{ $t('simulator:atmosphere.meanFreePathHint') }}</div>

            <div class="atmosphere-row">
              <label>{{ $t('simulator:atmosphere.strength') }} (°)</label>
              <input type="number" class="form-control form-control-sm" min="0" max="180" step="1" v-model.number="strength" :disabled="!enabled">
            </div>
            <div class="atmosphere-hint">{{ $t('simulator:atmosphere.strengthHint') }}</div>

            <div class="atmosphere-row">
              <label>{{ $t('simulator:atmosphere.absorption') }}</label>
              <input type="number" class="form-control form-control-sm" min="0" max="1" step="0.01" v-model.number="absorption" :disabled="!enabled">
            </div>
            <div class="atmosphere-hint">{{ $t('simulator:atmosphere.absorptionHint') }}</div>
          </div>

          <hr>

          <div class="atmosphere-presets">
            <label class="atmosphere-presets-label">{{ $t('simulator:atmosphere.presetsTitle') }}</label>
            <div class="atmosphere-preset-list">
              <div v-for="p in presets" :key="p.id" class="atmosphere-preset-row">
                <button type="button" class="btn btn-sm btn-outline-secondary atmosphere-preset-btn" @click="applyPreset(p)">
                  {{ p.builtIn ? $t(p.labelKey) : p.name }}
                </button>
                <button v-if="!p.builtIn" type="button" class="btn btn-sm btn-link atmosphere-preset-delete" :title="$t('simulator:common.resetButton')" @click="removePreset(p.id)">✕</button>
              </div>
            </div>
            <div class="atmosphere-save-row">
              <input type="text" class="form-control form-control-sm" :placeholder="$t('simulator:atmosphere.newPresetName')" v-model="newPresetName" @keydown.stop @keydown.enter="saveCurrentAsPreset">
              <button type="button" class="btn btn-sm btn-outline-primary" @click="saveCurrentAsPreset" :disabled="!newPresetName.trim()">{{ $t('simulator:atmosphere.savePreset') }}</button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" v-html="$t('simulator:common.closeButton')"></button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * @module AtmosphereModal
 * @description Settings -> Atmosphere: volumetric air-scattering controls
 * (mean free path, angular spread, absorption) bound directly to the
 * current scene, plus a preset picker (built-in + user-saved) backed by
 * {@link module:atmospherePresets}.
 */
import { ref, computed, onMounted } from 'vue'
import { useSceneStore } from '../store/scene'
import { allPresets, savePreset, deletePreset } from '../store/atmospherePresets'
import { hasUnits, labelSuffix } from '../../core/unitUtils'
import { app } from '../services/app'

export default {
  name: 'AtmosphereModal',
  setup() {
    const isModalOpen = ref(false)
    const scene = useSceneStore()
    const newPresetName = ref('')

    const enabled = scene.airScatteringEnabled
    const meanFreePath = scene.airScatteringMeanFreePath
    const strength = scene.airScatteringStrength
    const absorption = scene.airScatteringAbsorption

    const presets = computed(() => allPresets())
    const unitSuffix = computed(() => hasUnits(app.scene) ? labelSuffix(app.scene) : '')

    const applyPreset = (p) => {
      enabled.value = p.enabled
      meanFreePath.value = p.meanFreePath
      strength.value = p.strength
      absorption.value = p.absorption
    }

    const saveCurrentAsPreset = () => {
      const name = newPresetName.value.trim()
      if (!name) return
      savePreset(name, {
        enabled: enabled.value,
        meanFreePath: meanFreePath.value,
        strength: strength.value,
        absorption: absorption.value
      })
      newPresetName.value = ''
    }

    const removePreset = (id) => {
      deletePreset(id)
    }

    onMounted(() => {
      const modal = document.getElementById('atmosphereModal')
      modal.addEventListener('show.bs.modal', () => { isModalOpen.value = true })
      modal.addEventListener('hide.bs.modal', () => { isModalOpen.value = false })
    })

    const closeModal = () => {
      const modal = document.getElementById('atmosphereModal')
      modal.classList.remove('show')
      modal.setAttribute('aria-hidden', 'true')
      modal.style.display = 'none'
      isModalOpen.value = false
    }

    return {
      isModalOpen,
      enabled,
      meanFreePath,
      strength,
      absorption,
      unitSuffix,
      presets,
      newPresetName,
      applyPreset,
      saveCurrentAsPreset,
      removePreset,
      closeModal
    }
  }
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.3);
  z-index: 1040;
}

.modal-backdrop.show {
  opacity: 1;
}

.modal-dialog {
  z-index: 1045;
}

.atmosphere-intro {
  font-size: 0.9em;
  opacity: 0.75;
  margin-bottom: 0.75rem;
}

.atmosphere-enable-row {
  margin-bottom: 0.75rem;
}

.atmosphere-controls {
  transition: opacity 0.15s;
}

.atmosphere-controls--disabled {
  opacity: 0.5;
}

.atmosphere-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 2px;
}

.atmosphere-row label {
  flex: 1;
  font-size: 0.92em;
}

.atmosphere-row input {
  width: 100px;
  flex: none;
}

.atmosphere-hint {
  font-size: 0.78em;
  opacity: 0.6;
  margin-bottom: 10px;
}

.atmosphere-presets-label {
  font-weight: 600;
  font-size: 0.92em;
  display: block;
  margin-bottom: 6px;
}

.atmosphere-preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.atmosphere-preset-row {
  display: flex;
  align-items: center;
}

.atmosphere-preset-delete {
  padding: 0 4px;
  text-decoration: none;
  color: #b42828;
}

.atmosphere-save-row {
  display: flex;
  gap: 6px;
}

.atmosphere-save-row input {
  flex: 1;
}
</style>
