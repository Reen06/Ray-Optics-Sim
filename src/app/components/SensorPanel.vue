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
  <div class="sensor-panel" v-if="visible">
    <div class="sensor-panel-header" @click="collapsed = !collapsed">
      <span>{{ title }}</span>
      <span class="sensor-panel-chevron">{{ collapsed ? '▸' : '▾' }}</span>
    </div>
    <div v-if="!collapsed" class="sensor-panel-body">
      <div class="sensor-readings">
        <div v-for="row in readings" :key="row.label" class="sensor-reading-row">
          <span class="sensor-reading-label">{{ row.label }}</span>
          <span class="sensor-reading-value">{{ row.value }}</span>
        </div>
      </div>
      <template v-if="isImageSensor">
        <canvas ref="stripCanvas" class="sensor-strip" width="320" height="34"></canvas>
        <div class="sensor-exposure-row">
          <span class="sensor-reading-label">{{ $t('simulator:sceneObjs.ImageSensor.exposure') }}</span>
          <input type="range" class="form-range sensor-exposure-range" min="-1" max="1" step="0.05" v-model.number="exposure">
        </div>
      </template>
      <template v-if="hasPlot">
        <canvas ref="plotCanvas" class="sensor-plot" width="320" height="130"></canvas>
        <div class="sensor-plot-caption">{{ plotCaption }}</div>
        <button v-if="!isImageSensor" class="btn sensor-export-btn" @click="exportCsv">{{ $t('simulator:sceneObjs.Detector.exportData') }}</button>
      </template>
    </div>
  </div>
</template>

<script>
/**
 * @module SensorPanel
 * @description A floating panel shown while a sensor (Detector / PowerMeter)
 * is selected: live numeric readings, an inline irradiance-profile chart of
 * the Detector's irradiance map (axes in the scene's real units), and CSV
 * export. Refreshes on every simulation progress tick, so it live-updates
 * during snapshot computes too.
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { app } from '../services/app'
import { statusEmitter, STATUS_EVENT_NAMES } from '../composables/useStatus.js'
import { hasUnits, unitSize, formatPower, irradianceUnit, formatLength } from '../../core/unitUtils.js'
import i18next from 'i18next'

export default {
  name: 'SensorPanel',
  setup() {
    const selectedIndex = ref(-1)
    const collapsed = ref(false)
    const plotCanvas = ref(null)
    const stripCanvas = ref(null)
    const exposure = ref(0)
    // Bumped on every simulation tick to re-read the (non-reactive) scene obj.
    const refreshTick = ref(0)

    const selectedObj = computed(() => {
      refreshTick.value
      if (selectedIndex.value < 0 || !app.scene) return null
      const obj = app.scene.objs[selectedIndex.value]
      if (!obj) return null
      const type = obj.constructor.type
      return (type === 'Detector' || type === 'PowerMeter' || type === 'ImageSensor') ? obj : null
    })

    const isImageSensor = computed(() => {
      const obj = selectedObj.value
      return !!(obj && obj.constructor.type === 'ImageSensor')
    })

    const visible = computed(() => !!selectedObj.value)

    const title = computed(() => {
      const obj = selectedObj.value
      if (!obj) return ''
      return i18next.t('main:tools.' + obj.constructor.type + '.title')
    })

    const readings = computed(() => {
      refreshTick.value
      const obj = selectedObj.value
      if (!obj) return []
      const scene = app.scene
      const trunc = app.simulator ? app.simulator.totalTruncation : 0
      const pm = (v) => formatPower(scene, v, 3) + (trunc > 0 ? ' ± ' + trunc.toFixed(3) : '')
      if (obj.constructor.type === 'PowerMeter' || obj.constructor.type === 'ImageSensor') {
        return [{ label: 'P', value: pm(obj.power) }]
      }
      const rows = [
        { label: 'P', value: pm(obj.power) },
        { label: 'F⊥', value: obj.normal.toFixed(3) },
        { label: 'F∥', value: obj.shear.toFixed(3) }
      ]
      if (hasUnits(scene)) {
        rows.push({ label: i18next.t('simulator:sceneObjs.common.dimensions.length'), value: formatLength(scene, obj.getSensorData().length) })
      }
      return rows
    })

    const hasPlot = computed(() => {
      refreshTick.value
      const obj = selectedObj.value
      if (!obj) return false
      if (obj.constructor.type === 'Detector') {
        return !!(obj.irradMap && obj.binData && obj.binData.length > 0)
      }
      if (obj.constructor.type === 'ImageSensor') {
        return !!(obj.pixelData && obj.pixelData.length > 0)
      }
      return false
    })

    const plotCaption = computed(() => {
      const scene = app.scene
      if (isImageSensor.value) {
        return i18next.t('simulator:sceneObjs.ImageSensor.pixelCount') + (hasUnits(scene) ? ` (vs ${scene.unitName})` : '')
      }
      const unit = irradianceUnit(scene)
      return unit
        ? `${i18next.t('simulator:sceneObjs.Detector.irradMap')} (${unit} vs ${scene.unitName})`
        : i18next.t('simulator:sceneObjs.Detector.irradMap')
    })

    const drawStrip = () => {
      const canvas = stripCanvas.value
      const obj = selectedObj.value
      if (!canvas || !obj || !isImageSensor.value || !obj.pixelData) return
      const ctx = canvas.getContext('2d')
      const W = canvas.width, H = canvas.height
      ctx.fillStyle = 'black'
      ctx.fillRect(0, 0, W, H)
      const n = obj.pixelCount
      let maxV = 0
      for (let i = 0; i < obj.pixelData.length; i++) {
        if (obj.pixelData[i] > maxV) maxV = obj.pixelData[i]
      }
      if (maxV <= 0) return
      const gain = Math.pow(10, exposure.value) / maxV
      const pw = W / n
      for (let i = 0; i < n; i++) {
        const r = Math.min(255, Math.round(obj.pixelData[i * 3] * gain * 255))
        const g = Math.min(255, Math.round(obj.pixelData[i * 3 + 1] * gain * 255))
        const b = Math.min(255, Math.round(obj.pixelData[i * 3 + 2] * gain * 255))
        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(i * pw, 0, Math.ceil(pw), H)
      }
    }

    const drawPlot = () => {
      const canvas = plotCanvas.value
      const obj = selectedObj.value
      if (!canvas || !obj || !hasPlot.value) return
      const ctx = canvas.getContext('2d')
      const W = canvas.width, H = canvas.height
      const padL = 34, padB = 18, padT = 6, padR = 6
      ctx.clearRect(0, 0, W, H)

      const us = unitSize(app.scene)
      let vals, totalLen
      if (isImageSensor.value) {
        // Per-pixel luminance profile.
        vals = []
        for (let i = 0; i < obj.pixelCount; i++) {
          vals.push((obj.pixelData[i * 3] + obj.pixelData[i * 3 + 1] + obj.pixelData[i * 3 + 2]) / 3)
        }
        totalLen = Math.hypot(obj.p2.x - obj.p1.x, obj.p2.y - obj.p1.y) * us
      } else {
        const bins = obj.binData
        const binSize = obj.binSize
        // Irradiance per unit (physical) length per bin.
        vals = bins.map(v => v / (binSize * us))
        totalLen = bins.length * binSize * us
      }
      const maxV = Math.max(1e-12, ...vals.map(v => Math.abs(v)))

      // Axes
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(padL, padT)
      ctx.lineTo(padL, H - padB)
      ctx.lineTo(W - padR, H - padB)
      ctx.stroke()

      // Bars
      const plotW = W - padL - padR
      const plotH = H - padT - padB
      ctx.fillStyle = 'rgba(96, 168, 255, 0.85)'
      const bw = plotW / vals.length
      for (let i = 0; i < vals.length; i++) {
        const h = Math.abs(vals[i]) / maxV * plotH
        ctx.fillRect(padL + i * bw, H - padB - h, Math.max(1, bw - 1), h)
      }

      // Labels
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.font = '9px sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(maxV.toPrecision(3), padL - 3, padT + 4)
      ctx.fillText('0', padL - 3, H - padB)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText('0', padL, H - padB + 3)
      ctx.fillText(totalLen.toPrecision(3), W - padR - 6, H - padB + 3)
    }

    const exportCsv = () => {
      const obj = selectedObj.value
      if (!obj || !obj.binData) return
      const scene = app.scene
      const us = unitSize(scene)
      let csv = 'data:text/csv;charset=utf-8,'
      csv += hasUnits(scene)
        ? `Position (${scene.unitName}),Irradiance (${irradianceUnit(scene)})\n`
        : 'Position,Irradiance\n'
      for (let i = 0; i < obj.binData.length; i++) {
        csv += (i * obj.binSize * us) + ',' + (obj.binData[i] / (obj.binSize * us)) + '\n'
      }
      const link = document.createElement('a')
      link.setAttribute('href', encodeURI(csv))
      link.setAttribute('download', (scene.name || 'irradiance_map') + '.csv')
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }

    const onSelectionChanged = (e) => {
      selectedIndex.value = (e && e.detail && Number.isInteger(e.detail.index)) ? e.detail.index : -1
      refreshTick.value++
    }
    const onSimStatus = () => {
      if (selectedIndex.value >= 0) refreshTick.value++
    }

    watch([hasPlot, refreshTick, collapsed, exposure], () => {
      nextTick(() => {
        drawPlot()
        drawStrip()
      })
    })

    onMounted(() => {
      document.addEventListener('sceneObjSelectionChanged', onSelectionChanged)
      statusEmitter.on(STATUS_EVENT_NAMES.SIMULATOR_STATUS, onSimStatus)
    })
    onUnmounted(() => {
      document.removeEventListener('sceneObjSelectionChanged', onSelectionChanged)
    })

    return {
      visible,
      collapsed,
      title,
      readings,
      hasPlot,
      isImageSensor,
      plotCanvas,
      stripCanvas,
      exposure,
      plotCaption,
      exportCsv
    }
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
  background-color: rgba(36, 41, 46, 0.92);
  color: rgba(255, 255, 255, 0.87);
  border-radius: 0.5em;
  font-size: 10pt;
  overflow: hidden;
}

.sensor-panel-header {
  padding: 6px 12px;
  background-color: rgba(168, 168, 168, 0.15);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.sensor-panel-body {
  padding: 8px 12px 10px;
}

.sensor-readings {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin-bottom: 6px;
}

.sensor-reading-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
}

.sensor-reading-label {
  opacity: 0.7;
  font-size: 9pt;
}

.sensor-reading-value {
  font-variant-numeric: tabular-nums;
}

.sensor-plot {
  width: 100%;
  background-color: rgba(0, 0, 0, 0.25);
  border-radius: 4px;
}

.sensor-strip {
  width: 100%;
  border-radius: 4px;
  margin-bottom: 4px;
}

.sensor-exposure-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.sensor-exposure-range {
  flex: 1;
  padding-top: 3px;
}

.sensor-plot-caption {
  font-size: 8.5pt;
  opacity: 0.65;
  text-align: center;
  margin-top: 2px;
}

.sensor-export-btn {
  margin-top: 6px;
  background-color: rgba(192, 192, 192, 0.2);
  color: white;
  border: none;
  font-size: 9pt;
  padding: 3px 10px;
}

.sensor-export-btn:hover {
  background-color: rgba(168, 168, 168, 0.8);
  color: white;
}
</style>
