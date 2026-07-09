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
  <div class="modal fade" id="keybindsModal" data-bs-backdrop="false" data-bs-keyboard="false" tabindex="-1" aria-labelledby="staticBackdropLabel_keybinds" aria-hidden="true">
    <div class="modal-backdrop fade" :class="{ show: isModalOpen }" @click="closeModal"></div>
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="staticBackdropLabel_keybinds" v-html="$t('simulator:keybinds.title')"></h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <p class="keybinds-intro" v-html="$t('simulator:keybinds.description')"></p>
          <div class="keybind-row" v-for="action in actions" :key="action.id">
            <span class="keybind-label" v-html="$t(action.labelKey)"></span>
            <span class="keybind-current">
              <button
                type="button"
                class="btn btn-sm keybind-value-btn"
                :class="{ 'keybind-recording': recording === action.id }"
                @click="startRecording(action.id)"
              >{{ recording === action.id ? recordingPrompt(action) : describeBinding(bindings[action.id]) }}</button>
              <button
                type="button"
                class="btn btn-sm btn-link keybind-reset-btn"
                :title="$t('simulator:common.resetButton')"
                @click="reset(action.id)"
              >↺</button>
            </span>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" @click="resetAll" v-html="$t('simulator:keybinds.resetAll')"></button>
          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" v-html="$t('simulator:common.closeButton')"></button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * @module KeybindsModal
 * @description The Vue component for the pop-up modal for Settings ->
 * Keybinds: lists every user-configurable keyboard/mouse-button binding
 * (see `src/app/store/keybinds.js`) with a "click to rebind, then press the
 * key/mouse button you want" capture flow, plus per-action and global reset.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import i18next from 'i18next'
import {
  BINDABLE_ACTIONS,
  keybindsState,
  setBinding,
  resetBinding,
  resetAllBindings,
  describeBinding,
  bindingFromEvent
} from '../store/keybinds'

export default {
  name: 'KeybindsModal',
  setup() {
    const isModalOpen = ref(false)
    const recording = computed(() => keybindsState.recording)
    const bindings = computed(() => keybindsState.bindings)
    const actions = BINDABLE_ACTIONS

    let cleanupCapture = null

    const stopRecording = () => {
      keybindsState.recording = null
      if (cleanupCapture) {
        cleanupCapture()
        cleanupCapture = null
      }
    }

    const startRecording = (actionId) => {
      stopRecording()
      keybindsState.recording = actionId
      const action = actions.find(a => a.id === actionId)
      const type = action.default.type

      // Defer attaching the capture listener past the current click's own
      // event cycle, so the click on "Change" itself isn't immediately
      // captured as the new binding.
      const timer = setTimeout(() => {
        const onKey = (e) => {
          if (type !== 'key') return
          e.preventDefault()
          e.stopPropagation()
          if (e.keyCode === 27) { // Esc cancels without changing the binding
            stopRecording()
            return
          }
          const binding = bindingFromEvent('key', e)
          if (binding) {
            setBinding(actionId, binding)
            stopRecording()
          }
        }
        const onMouse = (e) => {
          if (type !== 'mouse') return
          // Only react to mousedown that lands outside the modal's own
          // reset/close controls so those stay clickable while recording;
          // clicking anywhere else (including the recording button again)
          // captures that button as the new binding.
          e.preventDefault()
          e.stopPropagation()
          setBinding(actionId, bindingFromEvent('mouse', e))
          stopRecording()
        }
        window.addEventListener('keydown', onKey, true)
        window.addEventListener('mousedown', onMouse, true)
        // Also let Escape (fired as a keydown regardless of binding type)
        // cancel a mouse-binding capture.
        const onEscForMouse = (e) => {
          if (type === 'mouse' && e.keyCode === 27) stopRecording()
        }
        window.addEventListener('keydown', onEscForMouse, true)
        cleanupCapture = () => {
          window.removeEventListener('keydown', onKey, true)
          window.removeEventListener('mousedown', onMouse, true)
          window.removeEventListener('keydown', onEscForMouse, true)
        }
      }, 0)
      cleanupCapture = () => clearTimeout(timer)
    }

    const recordingPrompt = (action) => {
      return action.default.type === 'mouse'
        ? i18next.t('simulator:keybinds.pressMouseButton')
        : i18next.t('simulator:keybinds.pressKey')
    }

    const reset = (actionId) => {
      stopRecording()
      resetBinding(actionId)
    }

    const resetAll = () => {
      stopRecording()
      resetAllBindings()
    }

    onMounted(() => {
      const modal = document.getElementById('keybindsModal')
      modal.addEventListener('show.bs.modal', () => {
        isModalOpen.value = true
      })
      modal.addEventListener('hide.bs.modal', () => {
        isModalOpen.value = false
        stopRecording()
      })
    })

    onBeforeUnmount(() => {
      stopRecording()
    })

    const closeModal = () => {
      const modal = document.getElementById('keybindsModal')
      modal.classList.remove('show')
      modal.setAttribute('aria-hidden', 'true')
      modal.style.display = 'none'
      isModalOpen.value = false
      stopRecording()
    }

    return {
      isModalOpen,
      recording,
      bindings,
      actions,
      startRecording,
      recordingPrompt,
      describeBinding,
      reset,
      resetAll,
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

.keybinds-intro {
  font-size: 0.9em;
  opacity: 0.75;
  margin-bottom: 1rem;
}

.keybind-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.35rem 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.keybind-row:last-child {
  border-bottom: none;
}

.keybind-current {
  display: flex;
  align-items: center;
  gap: 4px;
}

.keybind-value-btn {
  min-width: 130px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  background-color: transparent;
}

.keybind-value-btn.keybind-recording {
  border-color: #0d6efd;
  color: #0d6efd;
  animation: keybind-pulse 1s ease-in-out infinite;
}

@keyframes keybind-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.keybind-reset-btn {
  padding: 0 6px;
  text-decoration: none;
}
</style>
