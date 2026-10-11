<!-- Admin-only: "切換身份" in the tools menu, only visible once AdminPinModal has been passed.
     Search any player by code or name, and see their current badge status read straight from
     the server — not a local draft, not the signed-in player's own session. Read-only: this is
     for looking, not editing. -->
<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as adminApi from '../../data/adminApi'
import { adminToken } from '../../data/adminSession'
import { avatarUrl, backgroundUrl } from '../../data/nameplateAssets'
import { resolveTitle } from '../../data/titleCatalogue'
import PlayerBanner from '../tournament/PlayerBanner.vue'

const emit = defineEmits(['back'])
const { t } = useI18n()

const query = ref('')
const results = ref([])
const busySearch = ref(false)

const selectedCode = ref(null)
const detail = ref(null)
const busyDetail = ref(false)
const detailError = ref('')

async function runSearch() {
  busySearch.value = true
  try {
    const { players } = await adminApi.searchPlayers(adminToken.value, query.value.trim())
    results.value = players
  } catch (e) {
    results.value = []
  } finally {
    busySearch.value = false
  }
}

// Debounced rather than on every keystroke hitting the server, but still live — nobody wants to
// press a separate search button for an 8-player list.
let searchTimer = null
function onQueryInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 250)
}
runSearch()

async function select(code) {
  selectedCode.value = code
  detail.value = null
  detailError.value = ''
  busyDetail.value = true
  try {
    detail.value = await adminApi.getPlayer(adminToken.value, code)
  } catch (e) {
    detailError.value = e.message
  } finally {
    busyDetail.value = false
  }
}

// Same shape PlayerBanner already renders everywhere else — built from the fetched row rather
// than a draft, so what's shown is exactly what the server has on file for them right now.
const nameplate = computed(() => {
  if (!detail.value) return null
  const p = detail.value.player
  return {
    playerKey: `code:${p.code}`,
    name: p.name,
    code: p.code,
    avatar: p.avatar,
    background: p.background,
    title: resolveTitle(p.title_id),
    medals: { gold: p.gold, silver: p.silver, bronze: p.bronze },
    events: p.events,
    winRate: p.tour_win_rate !== null ? Math.round(p.tour_win_rate * 100) : null
  }
})

const ownedByKind = computed(() => {
  const out = { avatar: [], background: [], title: [] }
  if (!detail.value) return out
  detail.value.unlocks.forEach(u => { if (out[u.kind]) out[u.kind].push(u.asset) })
  return out
})
</script>

<template>
  <div class="board select-board as-board">
    <div class="modal-title">{{ t('admin.switchTitle') }}</div>

    <div class="as-search">
      <input
        v-model="query"
        class="as-input"
        :placeholder="t('admin.searchPlaceholder')"
        @input="onQueryInput"
      >
    </div>

    <div class="as-body">
      <div class="as-results">
        <button
          v-for="p in results"
          :key="p.code"
          :class="['as-result', { on: selectedCode === p.code }]"
          @click="select(p.code)"
        >
          <span class="as-result-name">{{ p.name }}</span>
          <span class="as-result-code">{{ p.code }}</span>
        </button>
        <p v-if="!busySearch && !results.length" class="as-empty">{{ t('admin.noResults') }}</p>
      </div>

      <div v-if="selectedCode" class="as-detail">
        <p v-if="detailError" class="as-error">{{ detailError }}</p>
        <template v-else-if="nameplate">
          <div class="as-preview"><PlayerBanner :nameplate="nameplate" /></div>

          <div class="as-stats">
            <span>{{ t('admin.statEvents') }} {{ detail.player.events }}</span>
            <span>{{ t('admin.statPodiums') }} {{ detail.player.podiums }}</span>
            <span v-if="detail.player.tour_win_rate !== null">
              {{ t('admin.statTourWinRate') }} {{ Math.round(detail.player.tour_win_rate * 100) }}%
            </span>
            <span v-if="detail.player.online_win_rate !== null">
              {{ t('admin.statOnlineWinRate') }} {{ Math.round(detail.player.online_win_rate * 100) }}%
            </span>
          </div>

          <div class="as-owned">
            <div class="as-owned-group">
              <span class="as-owned-label">{{ t('profile.avatar') }}</span>
              <div class="as-owned-grid">
                <img v-for="id in ownedByKind.avatar" :key="id" :src="avatarUrl(id)" :title="id" alt="" loading="lazy">
              </div>
            </div>
            <div class="as-owned-group">
              <span class="as-owned-label">{{ t('profile.flag') }}</span>
              <div class="as-owned-grid wide">
                <img v-for="id in ownedByKind.background" :key="id" :src="backgroundUrl(id)" :title="id" alt="" loading="lazy">
              </div>
            </div>
            <div class="as-owned-group">
              <span class="as-owned-label">{{ t('profile.titleLabel') }}</span>
              <div class="as-owned-titles">
                <span v-for="id in ownedByKind.title" :key="id" class="as-owned-title">{{ resolveTitle(id)?.text || id }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div class="as-foot">
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
.as-board { display: flex; flex-direction: column; min-height: 0; }

.as-search { flex-shrink: 0; padding: 0 0.75rem 0.5rem; }
.as-input {
  width: 100%;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--ink);
  padding: 0.4375rem 0.5rem;
  border: 0.125rem solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card);
  box-sizing: border-box;
  font-family: inherit;
}
.as-input:focus { outline: none; border-color: var(--accent-strong); }

.as-body { flex: 1; min-height: 0; display: flex; gap: 0.75rem; padding: 0 0.75rem; overflow: hidden; }

.as-results { width: 9rem; flex-shrink: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 0.25rem; }
.as-result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.0625rem;
  padding: 0.375rem 0.5rem;
  border: 0.0625rem solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.as-result.on { border-color: var(--accent-strong); background: var(--card); }
.as-result-name { font-size: 0.75rem; font-weight: 700; color: var(--ink); }
.as-result-code { font-size: 0.625rem; color: var(--sub); font-variant-numeric: tabular-nums; }
.as-empty { font-size: 0.6875rem; color: var(--sub); padding: 0.5rem 0.25rem; }

.as-detail { flex: 1; min-width: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 0.625rem; }
.as-preview { display: flex; justify-content: center; padding: 0.25rem 0; }
.as-stats { display: flex; flex-wrap: wrap; gap: 0.5rem; font-size: 0.6875rem; font-weight: 700; color: var(--sub); }

.as-owned { display: flex; flex-direction: column; gap: 0.5rem; }
.as-owned-label { font-size: 0.625rem; font-weight: 800; color: var(--sub); letter-spacing: 0.04em; }
.as-owned-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(3rem, 1fr)); gap: 0.375rem; margin-top: 0.25rem; }
.as-owned-grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius-sm); box-shadow: var(--shadow); display: block; }
.as-owned-grid.wide img { aspect-ratio: 8 / 3; }
.as-owned-titles { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.25rem; }
.as-owned-title {
  font-size: 0.625rem;
  font-weight: 700;
  padding: 0.1875rem 0.4375rem;
  border-radius: var(--radius-sm);
  background: #2A2A28;
  color: #fff;
  white-space: nowrap;
}
.as-error { font-size: 0.75rem; font-weight: 700; color: #C0392B; }

.as-foot { flex-shrink: 0; display: flex; justify-content: center; padding: 0.75rem 0 0.25rem; }
</style>
