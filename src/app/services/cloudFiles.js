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
 * @module cloudFiles
 * @description Talks to the SandOS Hub's cloud file picker
 * (`/api/fleet/files/*`), which saves/opens scenes into the signed-in user's
 * own NAS home folder (or a shared folder they belong to) — the "save into
 * your profile, share like FreeCAD" feature. This only exists when the app is
 * running embedded in the Hub (same origin as the dashboard); running
 * standalone (e.g. the public phydemo.app site), the endpoint is absent and
 * every call below rejects, so callers should feature-detect with
 * `isAvailable()` before showing any cloud UI.
 */

const BASE = '/api/fleet/files';

let availabilityCache = null;
let csrfCache = null;

/**
 * The Hub's CSRF token, needed on every mutating (non-GET) request — mirrors
 * the Hub's own frontend (api.js's setCsrf/getCsrf, populated from the same
 * field), but Ray Optics has no login flow of its own to read it from, so it
 * fetches it straight from the already-authenticated session via /api/auth/me
 * (a same-origin Hub route, reachable from inside the app iframe without the
 * /apps prefix). Cached after the first fetch.
 */
async function getCsrf() {
  if (csrfCache !== null) return csrfCache;
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const data = await res.json();
    csrfCache = data.csrf || '';
  } catch (e) {
    csrfCache = '';
  }
  return csrfCache;
}

async function request(method, path, { params, body, json } = {}) {
  let url = BASE + path;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += '?' + qs;
  }
  const headers = {};
  if (method !== 'GET') {
    const csrf = await getCsrf();
    if (csrf) headers['X-Hub-CSRF'] = csrf;
  }
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers,
    body,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.clone().json();
      message = data.error || data.detail || message;
    } catch (e) { /* not JSON */ }
    throw new Error(message || `request failed (${res.status})`);
  }
  return res;
}

/**
 * Whether the cloud file picker is available in this deployment. Cached after
 * the first check (the answer can't change during a session).
 */
export async function isAvailable() {
  if (availabilityCache !== null) return availabilityCache;
  try {
    const res = await request('GET', '/roots');
    const data = await res.json();
    availabilityCache = Array.isArray(data.roots);
  } catch (e) {
    availabilityCache = false;
  }
  return availabilityCache;
}

/** The folders the current user may browse: their home + any shared folder they're in. */
export async function listRoots() {
  const res = await request('GET', '/roots');
  return (await res.json()).roots;
}

/** Entries `{name, is_dir, size, mtime}` in `path` (relative) under `root`. */
export async function listDir(root, path) {
  const res = await request('GET', '/list', { params: { root, path } });
  return (await res.json()).entries;
}

/** The text content of the file at `root`/`path`. */
export async function readFile(root, path) {
  const res = await request('GET', '/read', { params: { root, path } });
  return res.text();
}

/** Write `content` (string) to `root`/`path`, creating parent folders as needed. */
export async function writeFile(root, path, content) {
  await request('PUT', '/write', { params: { root, path }, body: content });
}

/** Create a folder at `root`/`path` (and any missing parents). */
export async function makeDir(root, path) {
  await request('POST', '/mkdir', { params: { root, path } });
}

/** Whether `root`/`path` already exists — `{exists, is_dir}`. Used to warn
 * before a Save silently overwrites a different file. */
export async function pathExists(root, path) {
  const res = await request('GET', '/exists', { params: { root, path } });
  return res.json();
}

/** Rename the file/folder at `root`/`path` to `newName`, within the same parent folder. */
export async function renameEntry(root, path, newName) {
  await request('POST', '/rename', { params: { root, path }, json: { new_name: newName } });
}

/** Delete the file/folder at `root`/`path` (folders are removed recursively). */
export async function deleteEntry(root, path) {
  await request('DELETE', '/delete', { params: { root, path } });
}
