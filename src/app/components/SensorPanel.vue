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
  <div class="sensor-panel" v-if="sensors.length > 0">
    <SensorCard
      v-for="s in sensors"
      :key="s.id"
      :obj="s.obj"
      :selected="s.index === selectedIndex"
    />
  </div>
</template>

<script>
/**
 * @module SensorPanel
 * @description A floating stack of {@link SensorCard}s — one per sensor
 * (Detector / PowerMeter / ImageSensor) currently in the scene, always
 * visible regardless of canvas selection so a scene with several sensors can
 * be monitored at a glance. Each card is independently collapsible and has
 * an editable name (organizing multiple sensors), both stable across
 * re-renders because cards are keyed by a stable per-object id, not list
 * index.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { app } from '../services/app'
import SensorCard from './SensorCard.vue'

const SENSOR_TYPES = new Set(['Detector', 'PowerMeter', 'ImageSensor'])

// Stable ids for v-for :key, so a SensorCard (and its collapsed/expanded
// state, exposure slider, etc) survives scene-objs-list churn elsewhere
// (reordering, adding/removing unrelated objects) as long as the sensor
// object itself isn't recreated (which only happens on a full scene load).
const idMap = new WeakMap()
let nextId = 1
function idFor(obj) {
  let id = idMap.get(obj)
  if (!id) {
    id = nextId++
    idMap.set(obj, id)
  }
  return id
}

export default {
  name: 'SensorPanel',
  components: { SensorCard },
  setup() {
    const selectedIndex = ref(-1)
    // Bumped whenever the scene's object list may have changed (add/remove/
    // reorder/load), to recompute which sensors exist.
    const listTick = ref(0)

    const sensors = computed(() => {
      listTick.value
      if (!app.scene) return []
      const list = []
      app.scene.objs.forEach((obj, index) => {
        if (obj && SENSOR_TYPES.has(obj.constructor.type)) {
          list.push({ id: idFor(obj), index, obj })
        }
      })
      return list
    })

    const onSelectionChanged = (e) => {
      selectedIndex.value = (e && e.detail && Number.isInteger(e.detail.index)) ? e.detail.index : -1
    }
    const onListChanged = () => { listTick.value++ }

    onMounted(() => {
      document.addEventListener('sceneObjSelectionChanged', onSelectionChanged)
      document.addEventListener('sceneObjsChanged', onListChanged)
      document.addEventListener('sceneChanged', onListChanged)
    })
    onUnmounted(() => {
      document.removeEventListener('sceneObjSelectionChanged', onSelectionChanged)
      document.removeEventListener('sceneObjsChanged', onListChanged)
      document.removeEventListener('sceneChanged', onListChanged)
    })

    return { sensors, selectedIndex }
  }
}
</script>

<style scoped>
.sensor-panel {
  position: fixed;
  left: 10px;
  bottom: 65px;
  z-index: 99;
  width: 340px;
  max-height: 60vh;
  overflow-y: auto;
  background-color: rgba(36, 41, 46, 0.92);
  color: rgba(255, 255, 255, 0.87);
  border-radius: 0.5em;
  font-size: 10pt;
}
</style>
