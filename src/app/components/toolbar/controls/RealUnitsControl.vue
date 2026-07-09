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
  <div
    class="row settings-control-row d-flex justify-content-between align-items-center"
    v-tooltip-popover:[tooltipType]="layout === 'desktop' ? {
      content: $t('simulator:settings.realUnits.description'),
      html: true,
      placement: 'left',
      offset: [0, 20]
    } : undefined"
  >
    <div class="col-auto settings-label">{{ $t('simulator:settings.realUnits.title') }}</div>
    <div class="col-auto d-flex align-items-center">
      <select class="units-select" v-model="unitNameModel">
        <option value="">{{ $t('simulator:common.noneOption') }}</option>
        <option value="mm">mm</option>
        <option value="cm">cm</option>
        <option value="µm">µm</option>
        <option value="in">in</option>
      </select>
    </div>
  </div>
  <div
    v-if="unitNameModel"
    class="row settings-control-row d-flex justify-content-between align-items-center"
  >
    <div class="col-auto settings-label">{{ $t('simulator:settings.realUnits.unitSize', { unit: unitNameModel }) }}</div>
    <div class="col-auto d-flex align-items-center">
      <input
        type="text"
        class="settings-number"
        v-model="unitSizeInput"
        @keyup.enter="commitUnitSize"
        @keydown.stop
        @blur="commitUnitSize"
        @click="$event.target.select()"
      >
    </div>
  </div>
</template>

<script>
/**
 * @module RealUnitsControl
 * @description Settings control for the scene's real-world unit system:
 * pick a unit name (or none for legacy unitless scenes) and the physical size
 * of one canvas unit.
 */
import { computed, ref, toRef, watch } from 'vue'
import { vTooltipPopover } from '../../../directives/tooltip-popover'
import { usePreferencesStore } from '../../../store/preferences'
import { useSceneStore } from '../../../store/scene'

export default {
  name: 'RealUnitsControl',
  directives: {
    'tooltip-popover': vTooltipPopover
  },
  props: {
    layout: {
      type: String,
      required: true
    }
  },
  setup() {
    const preferences = usePreferencesStore()
    const scene = useSceneStore()
    const help = toRef(preferences, 'help')
    const tooltipType = computed(() => help.value ? 'popover' : null)

    const unitNameModel = toRef(scene, 'unitName')
    const unitSizeModel = toRef(scene, 'unitSize')

    const unitSizeInput = ref(String(unitSizeModel.value ?? 1))
    watch(unitSizeModel, (v) => { unitSizeInput.value = String(v ?? 1) })

    const commitUnitSize = () => {
      const v = parseFloat(unitSizeInput.value)
      if (isFinite(v) && v > 0) {
        unitSizeModel.value = v
      } else {
        unitSizeInput.value = String(unitSizeModel.value ?? 1)
      }
    }

    return {
      tooltipType,
      unitNameModel,
      unitSizeInput,
      commitUnitSize
    }
  }
}
</script>

<style scoped>
.settings-number {
  background-color: transparent;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.5);
  width: 40px;
  height: 23px;
  text-align: center;
  margin-right: 4px;
}

.units-select {
  background-color: transparent;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.5);
  height: 23px;
  margin-right: 4px;
}
</style>
