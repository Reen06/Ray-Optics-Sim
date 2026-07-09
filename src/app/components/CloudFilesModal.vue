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
  <div class="modal fade" id="cloudFilesModal" data-bs-backdrop="false" data-bs-keyboard="false" tabindex="-1" aria-labelledby="staticBackdropLabel_cloudFiles" aria-hidden="true">
    <div class="modal-backdrop fade" :class="{ show: isModalOpen }" @click="close"></div>
    <div class="modal-dialog modal-dialog-centered modal-lg">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title" id="staticBackdropLabel_cloudFiles">
            {{ mode === 'save' ? 'Save to Server' : 'Open from Server' }}
          </h5>
          <button type="button" class="btn-close" aria-label="Close" @click="close"></button>
        </div>
        <div class="modal-body">
          <div class="mb-2 d-flex align-items-center gap-2">
            <select class="form-select form-select-sm w-auto" v-model="currentRoot" @change="onRootChange" :disabled="loading">
              <option v-for="r in roots" :key="r.id" :value="r.id">{{ r.label }}</option>
            </select>
            <nav class="cloud-breadcrumb flex-grow-1">
              <span class="cloud-breadcrumb-item" @click="navigateTo(0)">/</span>
              <template v-for="(seg, i) in pathParts" :key="i">
                <span class="cloud-breadcrumb-item" @click="navigateTo(i + 1)">{{ seg }}</span>
                <span v-if="i < pathParts.length - 1">/</span>
              </template>
            </nav>
            <button type="button" class="btn btn-sm btn-outline-secondary" @click="createFolder" :disabled="loading">
              + New Folder
            </button>
          </div>

          <div v-if="error" class="alert alert-danger py-2">{{ error }}</div>

          <div class="cloud-file-list">
            <div v-if="loading" class="text-muted text-center p-3">Loading…</div>
            <template v-else>
              <div
                v-for="entry in entries"
                :key="entry.name"
                class="cloud-file-row"
                :class="{ selected: !entry.is_dir && selectedName === entry.name }"
                @click="onEntryClick(entry)"
                @dblclick="onEntryDblClick(entry)"
              >
                <span class="cloud-file-icon">{{ entry.is_dir ? '📁' : '📄' }}</span>
                <span class="cloud-file-name flex-grow-1">{{ entry.name }}</span>
                <span class="cloud-file-actions">
                  <button type="button" class="btn btn-sm btn-link p-0 px-1" title="Rename" @click.stop="renameEntryPrompt(entry)">✏️</button>
                  <button type="button" class="btn btn-sm btn-link p-0 px-1" title="Delete" @click.stop="deleteEntryPrompt(entry)">🗑️</button>
                </span>
              </div>
              <div v-if="entries.length === 0" class="text-muted text-center p-3">This folder is empty.</div>
            </template>
          </div>

          <div v-if="mode === 'save'" class="mt-3">
            <label class="form-label">File name</label>
            <input type="text" class="form-control" v-model="saveFileName" @keydown.stop @keydown.enter="confirm">
          </div>
        </div>
        <div class="modal-footer">
          <div v-if="busy" class="text-muted small me-auto">{{ mode === 'save' ? 'Saving…' : 'Opening…' }}</div>
          <button type="button" class="btn btn-secondary" @click="close">Cancel</button>
          <button type="button" class="btn btn-primary" :disabled="!canConfirm || busy" @click="confirm">
            {{ mode === 'save' ? 'Save' : 'Open' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * @module CloudFilesModal
 * @description The Vue component for the "Save to Server" / "Open from Server"
 * file-picker modal, backed by cloudFiles.js. Opened dynamically via the
 * `cloudFiles:open` custom event (mirrors ImportShapesModal's pattern) so
 * FileBar never has to know about this component's internals.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import * as bootstrap from 'bootstrap'
import * as cloudFiles from '../services/cloudFiles'
import { app } from '../services/app'

export default {
  name: 'CloudFilesModal',
  setup() {
    const isModalOpen = ref(false)
    const mode = ref('open') // 'open' | 'save'
    const roots = ref([])
    const currentRoot = ref('home')
    const pathParts = ref([])
    const entries = ref([])
    const loading = ref(false)
    const busy = ref(false)
    const error = ref('')
    const selectedName = ref('')
    const saveFileName = ref('scene.json')

    const currentPath = computed(() => pathParts.value.join('/'))

    const canConfirm = computed(() => {
      if (mode.value === 'save') return saveFileName.value.trim().length > 0
      return selectedName.value.length > 0
    })

    const loadEntries = async () => {
      loading.value = true
      error.value = ''
      selectedName.value = ''
      try {
        entries.value = await cloudFiles.listDir(currentRoot.value, currentPath.value)
      } catch (e) {
        entries.value = []
        error.value = 'Could not list files: ' + e.message
      } finally {
        loading.value = false
      }
    }

    const onRootChange = () => {
      pathParts.value = []
      loadEntries()
    }

    const navigateTo = (depth) => {
      pathParts.value = pathParts.value.slice(0, depth)
      loadEntries()
    }

    const onEntryClick = (entry) => {
      if (entry.is_dir) return
      selectedName.value = entry.name
      if (mode.value === 'save') saveFileName.value = entry.name
    }

    const onEntryDblClick = (entry) => {
      if (entry.is_dir) {
        pathParts.value = [...pathParts.value, entry.name]
        loadEntries()
      } else if (mode.value === 'open') {
        selectedName.value = entry.name
        confirm()
      }
    }

    const createFolder = async () => {
      const name = window.prompt('New folder name:')
      if (!name) return
      try {
        await cloudFiles.makeDir(currentRoot.value, currentPath.value ? `${currentPath.value}/${name}` : name)
        await loadEntries()
      } catch (e) {
        error.value = 'Could not create folder: ' + e.message
      }
    }

    const entryPath = (entry) => currentPath.value ? `${currentPath.value}/${entry.name}` : entry.name

    const renameEntryPrompt = async (entry) => {
      const newName = window.prompt('Rename to:', entry.name)
      if (!newName || newName === entry.name) return
      const oldPath = entryPath(entry)
      const newPath = currentPath.value ? `${currentPath.value}/${newName}` : newName
      try {
        await cloudFiles.renameEntry(currentRoot.value, oldPath, newName)
        app.onCloudEntryRenamed(currentRoot.value, oldPath, newPath, newName)
        if (selectedName.value === entry.name) selectedName.value = newName
        if (mode.value === 'save' && saveFileName.value === entry.name) saveFileName.value = newName
        await loadEntries()
      } catch (e) {
        error.value = 'Could not rename: ' + e.message
      }
    }

    const deleteEntryPrompt = async (entry) => {
      const what = entry.is_dir ? 'folder (and everything inside it)' : 'file'
      if (!window.confirm(`Delete the ${what} "${entry.name}"? This cannot be undone.`)) return
      const path = entryPath(entry)
      try {
        await cloudFiles.deleteEntry(currentRoot.value, path)
        app.onCloudEntryDeleted(currentRoot.value, path)
        if (selectedName.value === entry.name) selectedName.value = ''
        await loadEntries()
      } catch (e) {
        error.value = 'Could not delete: ' + e.message
      }
    }

    // Always go through the REAL Bootstrap instance (not manual class/style
    // toggling) — Modal.show() no-ops if its internal _isShown flag is still
    // true, and only Modal.hide() clears it. Manually faking a "closed" look
    // left that flag stuck, so every show() after the first close silently
    // did nothing (fixed by always routing through the instance below).
    const closeBsModal = () => {
      const modalEl = document.getElementById('cloudFilesModal')
      const instance = bootstrap.Modal.getInstance(modalEl)
      if (instance) instance.hide()
    }

    const close = () => {
      closeBsModal()
    }

    const confirm = async () => {
      if (!canConfirm.value || busy.value) return
      busy.value = true
      error.value = ''
      try {
        if (mode.value === 'save') {
          let name = saveFileName.value.trim()
          if (!name.toLowerCase().endsWith('.json')) name += '.json'
          const fullPath = currentPath.value ? `${currentPath.value}/${name}` : name
          const check = await cloudFiles.pathExists(currentRoot.value, fullPath)
          if (check.exists) {
            const what = check.is_dir ? 'folder' : 'file'
            if (!window.confirm(`A ${what} named "${name}" already exists here. Overwrite it?`)) {
              busy.value = false
              return
            }
          }
          await app.saveToServer(currentRoot.value, fullPath)
        } else {
          const fullPath = currentPath.value ? `${currentPath.value}/${selectedName.value}` : selectedName.value
          const text = await cloudFiles.readFile(currentRoot.value, fullPath)
          app.openFromServerText(text, selectedName.value, currentRoot.value, fullPath)
        }
        closeBsModal()
      } catch (e) {
        error.value = (mode.value === 'save' ? 'Could not save: ' : 'Could not open: ') + e.message
      } finally {
        busy.value = false
      }
    }

    const onCloudFilesOpen = async (e) => {
      const detail = (e && e.detail) || {}
      mode.value = detail.mode === 'save' ? 'save' : 'open'
      saveFileName.value = detail.suggestedName || 'scene.json'
      error.value = ''
      // Save As prefills the currently-open document's location (if any) so
      // re-saving nearby is a couple of clicks; Open always starts fresh.
      pathParts.value = detail.folder ? detail.folder.split('/').filter(Boolean) : []
      if (detail.root) currentRoot.value = detail.root
      const modalEl = document.getElementById('cloudFilesModal')
      const instance = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl)
      instance.show()
      try {
        roots.value = await cloudFiles.listRoots()
        if (roots.value.length && !roots.value.some(r => r.id === currentRoot.value)) {
          currentRoot.value = roots.value[0].id
        }
        await loadEntries()
      } catch (e2) {
        error.value = 'Could not reach the server: ' + e2.message
      }
    }

    onMounted(() => {
      const modal = document.getElementById('cloudFilesModal')
      modal.addEventListener('show.bs.modal', () => { isModalOpen.value = true })
      modal.addEventListener('hide.bs.modal', () => { isModalOpen.value = false })
      document.addEventListener('cloudFiles:open', onCloudFilesOpen)
    })

    onBeforeUnmount(() => {
      document.removeEventListener('cloudFiles:open', onCloudFilesOpen)
    })

    return {
      isModalOpen, mode, roots, currentRoot, pathParts, entries, loading, busy, error,
      selectedName, saveFileName, canConfirm,
      onRootChange, navigateTo, onEntryClick, onEntryDblClick, createFolder, close, confirm,
      renameEntryPrompt, deleteEntryPrompt,
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

.cloud-breadcrumb {
  font-size: 0.9em;
  overflow-x: auto;
  white-space: nowrap;
}

.cloud-breadcrumb-item {
  cursor: pointer;
}

.cloud-breadcrumb-item:hover {
  text-decoration: underline;
}

.cloud-file-list {
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 4px;
  max-height: 40vh;
  min-height: 120px;
  overflow-y: auto;
}

.cloud-file-row {
  display: flex;
  align-items: center;
  gap: 0.5em;
  padding: 0.35em 0.6em;
  cursor: pointer;
  user-select: none;
}

.cloud-file-row:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.cloud-file-row.selected {
  background-color: rgba(13, 110, 253, 0.15);
}

.cloud-file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cloud-file-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  flex-shrink: 0;
}

.cloud-file-row:hover .cloud-file-actions,
.cloud-file-row:focus-within .cloud-file-actions {
  opacity: 1;
}

.cloud-file-actions button {
  font-size: 0.95em;
  line-height: 1;
  text-decoration: none;
}
</style>
