<!-- Admin-only: define what each placement tier (1st/2nd/3rd/participant) of a tournament
     actually earns — any mix of avatar/background/title — so TournamentUploadModal.vue can grant
     real rewards by picking a package here instead of a hardcoded season-naming convention.
     Reached from the tools menu only once admin mode is on (see ModeSelect.vue's adminOnly). -->
<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as adminApi from '../../data/adminApi'
import { adminToken } from '../../data/adminSession'
import { AVATAR_IDS, BACKGROUND_IDS, avatarUrl, backgroundUrl } from '../../data/nameplateAssets'
import { TITLE_GROUPS, resolveTitle } from '../../data/titleCatalogue'

const emit = defineEmits(['back'])
const { t } = useI18n()

const PLACES = [
  { key: '1', label: '冠軍 / 1st' },
  { key: '2', label: '亞軍 / 2nd' },
  { key: '3', label: '季軍 / 3rd' },
  { key: 'participant', label: '參與獎 / Participant' }
]
const KINDS = [
  { key: 'avatar', label: '頭像 / Avatar' },
  { key: 'background', label: '旗幟 / Flag' },
  { key: 'title', label: '稱號 / Title' }
]

// 'list' | 'edit'
const view = ref('list')
const packages = ref([])
const busy = ref(false)
const error = ref('')

async function loadList() {
  busy.value = true
  error.value = ''
  try {
    const { packages: rows } = await adminApi.listRewardPackages(adminToken.value)
    packages.value = rows
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
loadList()

function emptyDraft() {
  return {
    id: '',
    name: '',
    items: { '1': {}, '2': {}, '3': {}, participant: {} }
  }
}

const draft = ref(emptyDraft())
const isNew = ref(true)

function openNew() {
  draft.value = emptyDraft()
  isNew.value = true
  error.value = ''
  view.value = 'edit'
}

// Shared by the editor and the read-only preview below — both just want "what's in each
// place", grouped the same way.
function itemsByPlace(items) {
  const out = { '1': {}, '2': {}, '3': {}, participant: {} }
  items.forEach(it => { out[it.place][it.kind] = it.asset })
  return out
}

async function openEdit(id) {
  busy.value = true
  error.value = ''
  try {
    const data = await adminApi.getRewardPackage(adminToken.value, id)
    draft.value = { id: data.id, name: data.name, items: itemsByPlace(data.items) }
    isNew.value = false
    view.value = 'edit'
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

// Read-only — for "I just want to see what this grants" without going into edit mode, which
// also happens to be the only mode that lets you change anything.
const previewPkg = ref(null)
async function openPreview(id) {
  error.value = ''
  try {
    const data = await adminApi.getRewardPackage(adminToken.value, id)
    previewPkg.value = { id: data.id, name: data.name, items: itemsByPlace(data.items) }
  } catch (e) {
    error.value = e.message
  }
}
function placeHasAny(items) {
  return !!(items.avatar || items.background || items.title)
}

function pick(place, kind, asset) {
  const current = draft.value.items[place][kind]
  draft.value.items[place][kind] = current === asset ? undefined : asset
}

const confirmDeleteId = ref(null)
async function doDelete() {
  busy.value = true
  try {
    await adminApi.deleteRewardPackage(adminToken.value, confirmDeleteId.value)
    confirmDeleteId.value = null
    await loadList()
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

async function save() {
  // ID is only there for whoever wants a memorable one (e.g. "202609") — everything else about
  // a package is keyed off it internally, but nothing requires it to be human-chosen, so leaving
  // it blank just mints one.
  const id = draft.value.id.trim() || crypto.randomUUID()
  const name = draft.value.name.trim()
  if (!name) { error.value = t('admin.rewardsNameRequired'); return }
  const items = []
  for (const place of Object.keys(draft.value.items)) {
    for (const kind of Object.keys(draft.value.items[place])) {
      const asset = draft.value.items[place][kind]
      if (asset) items.push({ place, kind, asset })
    }
  }
  busy.value = true
  error.value = ''
  try {
    await adminApi.saveRewardPackage(adminToken.value, id, { name, items })
    await loadList()
    view.value = 'list'
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}

const titleOptions = computed(() => TITLE_GROUPS.flatMap(g => g.titles.map(ti => ({ ...ti, group: g.label }))))
</script>

<template>
  <div class="board select-board ar-board">
    <div class="modal-title">{{ t('admin.rewardsTitle') }}</div>

    <template v-if="view === 'list'">
      <div class="ar-list">
        <p v-if="error" class="ar-error">{{ error }}</p>
        <p v-if="!busy && !packages.length && !error" class="ar-empty">{{ t('admin.rewardsEmpty') }}</p>
        <div v-for="pkg in packages" :key="pkg.id" class="ar-row">
          <button class="ar-row-main" @click="openEdit(pkg.id)">
            <span class="ar-row-name">{{ pkg.name }}</span>
            <span class="ar-row-id">{{ pkg.id }}</span>
          </button>
          <button class="btn secondary ar-row-preview" @click="openPreview(pkg.id)">{{ t('admin.rewardsPreview') }}</button>
          <button class="btn secondary ar-row-delete" @click="confirmDeleteId = pkg.id">{{ t('tournament.delete') }}</button>
        </div>
      </div>

      <div class="ar-foot">
        <button class="btn" @click="openNew">{{ t('admin.rewardsNew') }}</button>
        <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
      </div>

      <div v-if="confirmDeleteId" class="modal-overlay" style="align-items:center;" @click.self="confirmDeleteId = null">
        <div class="ar-confirm">
          <div class="ar-confirm-text">{{ t('tournament.deleteConfirm', { name: confirmDeleteId }) }}</div>
          <div class="ar-confirm-actions">
            <button class="btn secondary" @click="confirmDeleteId = null">{{ t('common.cancel') }}</button>
            <button class="btn fail" @click="doDelete">{{ t('tournament.delete') }}</button>
          </div>
        </div>
      </div>

      <div v-if="previewPkg" class="modal-overlay" style="align-items:center;" @click.self="previewPkg = null">
        <div class="modal-sheet" style="max-height:88%; position:relative; display:flex; flex-direction:column;">
          <button
            @click="previewPkg = null"
            style="position:absolute; top:0.625rem; right:0.625rem; width:1.75rem; height:1.75rem; border:none; border-radius:50%; background:rgba(0,0,0,.08); color:var(--ink); font-size:0.9375rem; font-weight:800; line-height:1; cursor:pointer; z-index:1;"
          >✕</button>
          <div class="modal-title" style="padding-right:2rem;">{{ previewPkg.name }}</div>

          <div class="ar-preview-body">
            <div v-for="place in PLACES" :key="place.key" class="ar-preview-place">
              <div class="ar-place-label">{{ place.label }}</div>
              <div v-if="placeHasAny(previewPkg.items[place.key])" class="ar-preview-row">
                <img v-if="previewPkg.items[place.key].avatar" class="ar-preview-thumb" :src="avatarUrl(previewPkg.items[place.key].avatar)" alt="">
                <img v-if="previewPkg.items[place.key].background" class="ar-preview-thumb wide" :src="backgroundUrl(previewPkg.items[place.key].background)" alt="">
                <span v-if="previewPkg.items[place.key].title" class="ar-title-chip on">
                  {{ resolveTitle(previewPkg.items[place.key].title)?.text || previewPkg.items[place.key].title }}
                </span>
              </div>
              <div v-else class="ar-preview-none">{{ t('admin.rewardsNone') }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="ar-edit">
        <label class="ar-field">
          <span class="ar-label">ID — {{ isNew ? t('admin.rewardsIdOptional') : '' }}</span>
          <input v-model="draft.id" class="ar-input" :disabled="!isNew" placeholder="e.g. 202609">
        </label>
        <label class="ar-field">
          <span class="ar-label">{{ t('admin.rewardsName') }}</span>
          <input v-model="draft.name" class="ar-input" placeholder="e.g. 2026年9月賽事獎品">
        </label>

        <p v-if="error" class="ar-error">{{ error }}</p>

        <div v-for="place in PLACES" :key="place.key" class="ar-place">
          <div class="ar-place-label">{{ place.label }}</div>

          <div class="ar-kind">
            <span class="ar-kind-label">{{ KINDS[0].label }}</span>
            <div class="ar-grid">
              <button
                v-for="id in AVATAR_IDS" :key="id"
                :class="['ar-swatch', { on: draft.items[place.key].avatar === id }]"
                :title="id"
                @click="pick(place.key, 'avatar', id)"
              ><img :src="avatarUrl(id)" alt="" loading="lazy"></button>
            </div>
          </div>

          <div class="ar-kind">
            <span class="ar-kind-label">{{ KINDS[1].label }}</span>
            <div class="ar-grid wide">
              <button
                v-for="id in BACKGROUND_IDS" :key="id"
                :class="['ar-swatch', 'flag', { on: draft.items[place.key].background === id }]"
                :title="id"
                @click="pick(place.key, 'background', id)"
              ><img :src="backgroundUrl(id)" alt="" loading="lazy"></button>
            </div>
          </div>

          <div class="ar-kind">
            <span class="ar-kind-label">{{ KINDS[2].label }}</span>
            <div class="ar-titles">
              <button
                v-for="ti in titleOptions" :key="ti.id"
                :class="['ar-title-chip', { on: draft.items[place.key].title === ti.id }]"
                @click="pick(place.key, 'title', ti.id)"
              >{{ ti.text }}</button>
            </div>
          </div>
        </div>
      </div>

      <div class="ar-foot">
        <button class="btn" :disabled="busy" @click="save">{{ t('profile.save') }}</button>
        <button class="btn secondary" @click="view = 'list'">{{ t('common.back') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ar-board { display: flex; flex-direction: column; min-height: 0; }

.ar-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; padding: 0 0.75rem; }
.ar-row { display: flex; align-items: center; gap: 0.5rem; }
.ar-row-main {
  flex: 1; min-width: 0; text-align: left; display: flex; flex-direction: column; gap: 0.0625rem;
  padding: 0.5rem 0.625rem; border-radius: 0.5rem; background: var(--card); box-shadow: var(--shadow);
  border: none; cursor: pointer; font-family: inherit;
}
.ar-row-name { font-size: 0.8125rem; font-weight: 800; color: var(--ink); }
.ar-row-id { font-size: 0.625rem; color: var(--sub); font-family: ui-monospace, monospace; }
.ar-row-preview, .ar-row-delete { padding: 0.375rem 0.625rem; font-size: 0.75rem; flex-shrink: 0; }
.ar-empty { font-size: 0.75rem; color: var(--sub); text-align: center; padding: 1rem; }
.ar-error { font-size: 0.75rem; font-weight: 700; color: #C0392B; }

.ar-edit { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; padding: 0 0.75rem; }
.ar-field { display: flex; flex-direction: column; gap: 0.1875rem; }
.ar-label { font-size: 0.625rem; font-weight: 800; color: var(--sub); letter-spacing: 0.04em; }
.ar-input {
  font-size: 0.8125rem; font-weight: 700; color: var(--ink); padding: 0.4375rem 0.5rem;
  border: 0.125rem solid var(--line); border-radius: var(--radius-sm); background: #fff; box-sizing: border-box;
}
.ar-input:disabled { background: var(--card); color: var(--sub); }

.ar-place { display: flex; flex-direction: column; gap: 0.375rem; padding-top: 0.25rem; border-top: 0.0625rem solid var(--line); }
.ar-place-label { font-size: 0.875rem; font-weight: 800; color: var(--ink); }
.ar-kind { display: flex; flex-direction: column; gap: 0.25rem; }
.ar-kind-label { font-size: 0.625rem; font-weight: 800; color: var(--sub); letter-spacing: 0.04em; }

.ar-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(3.25rem, 1fr)); gap: 0.375rem; }
.ar-grid.wide { grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr)); }
.ar-swatch {
  position: relative; padding: 0; border: 0.125rem solid transparent; border-radius: var(--radius-sm);
  background: var(--card); cursor: pointer; overflow: hidden; aspect-ratio: 1; box-shadow: var(--shadow);
}
.ar-swatch.flag { aspect-ratio: 8 / 3; }
.ar-swatch img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ar-swatch.on { border-color: var(--accent-strong); box-shadow: 0 0 0 0.1875rem var(--accent-strong); }

.ar-titles { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.ar-title-chip {
  font-size: 0.625rem; font-weight: 700; padding: 0.1875rem 0.4375rem; border-radius: var(--radius-sm);
  border: 0.125rem solid transparent; background: #2A2A28; color: #fff; cursor: pointer; font-family: inherit; white-space: nowrap;
}
.ar-title-chip.on { border-color: var(--accent-strong); }

.ar-confirm {
  background: var(--bg); border-radius: 1.125rem; box-shadow: var(--shadow); padding: 1.25rem 1.5rem;
  max-width: 22rem; display: flex; flex-direction: column; align-items: center; gap: 0.75rem; text-align: center;
}
.ar-confirm-text { font-size: 0.75rem; color: var(--sub); line-height: 1.6; }
.ar-confirm-actions { display: flex; gap: 0.625rem; justify-content: center; }

.ar-foot { flex-shrink: 0; display: flex; gap: 0.625rem; justify-content: center; padding: 0.75rem 0 0.25rem; }

.ar-preview-body { display: flex; flex-direction: column; gap: 0.625rem; overflow-y: auto; }
.ar-preview-place { display: flex; flex-direction: column; gap: 0.25rem; padding-top: 0.25rem; border-top: 0.0625rem solid var(--line); }
.ar-preview-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.ar-preview-thumb { width: 2.75rem; height: 2.75rem; border-radius: var(--radius-sm); object-fit: cover; box-shadow: var(--shadow); }
.ar-preview-thumb.wide { width: 5rem; height: 1.875rem; }
.ar-preview-none { font-size: 0.6875rem; color: var(--sub); }
</style>
