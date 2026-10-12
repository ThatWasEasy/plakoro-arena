<!-- Admin-only: "切換身份" in the tools menu, only visible while admin mode is switched on.
     Search any player by code or name, and see their current badge status read straight from
     the server — not a local draft, not the signed-in player's own session.

     Every asset is listed, owned or not, and tapping one toggles it. That's the only way the
     achievement titles (賽到的 / 九死一生 / 怎麼結束了？) can be awarded at all: they depend on
     battle detail nothing records, so unlike placement rewards there is nothing to derive them
     from — someone watched it happen and says so. -->
<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as adminApi from '../../data/adminApi'
import { adminToken } from '../../data/adminSession'
import { AVATAR_IDS, BACKGROUND_IDS, avatarUrl, backgroundUrl } from '../../data/nameplateAssets'
import { TITLE_GROUPS, resolveTitle } from '../../data/titleCatalogue'
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
  // Clearing it matters: a code left on screen after switching players reads as belonging to
  // whoever is shown now, and handing the wrong person's code over gives them that account.
  claimCode.value = ''
  claimError.value = ''
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

// Keyed rather than listed: the grid below asks "does this one row exist" once per asset, and
// three Sets answer that without re-scanning the array every time.
const owned = computed(() => {
  const out = { avatar: new Set(), background: new Set(), title: new Set() }
  detail.value?.unlocks.forEach(u => out[u.kind]?.add(u.asset))
  return out
})

// Where each grant came from, so the grid can tell "earned at an event" apart from "someone
// handed it over". They look identical on a banner and are not the same claim.
const srcOf = computed(() => {
  const out = {}
  detail.value?.unlocks.forEach(u => { out[`${u.kind}:${u.asset}`] = u.src })
  return out
})

// Always available, so there is no grant row to toggle and nothing a button could usefully do.
// Mirrors isAssetAllowed() on the server — if that rule changes, this has to follow.
function isFree(kind, asset) {
  return kind === 'title' ? asset === 'gen-rookie' : /-default$/.test(asset)
}

const TITLE_IDS = TITLE_GROUPS.map(g => ({ label: g.label, ids: g.titles.map(ti => ti.id) }))

const busyKey = ref(null)
const toggleError = ref('')

// Issued on demand rather than in advance. A player who never wants an account never needs a
// code, and a code that sits around unused is a credential waiting to be found — it can set
// the account handle and PIN for the player it names, with nothing else asked for.
const claimCode = ref('')
const claimBusy = ref(false)
const claimError = ref('')

async function mintClaim() {
  if (!selectedCode.value || claimBusy.value) return
  claimBusy.value = true
  claimCode.value = ''
  claimError.value = ''
  try {
    const r = await adminApi.mintClaimCode(adminToken.value, selectedCode.value)
    claimCode.value = r.claimCode
  } catch (e) {
    claimError.value = e.message
  } finally {
    claimBusy.value = false
  }
}

async function toggle(kind, asset) {
  if (!detail.value || isFree(kind, asset)) return
  const key = `${kind}:${asset}`
  if (busyKey.value) return
  busyKey.value = key
  toggleError.value = ''
  try {
    // Both endpoints answer with the whole player + unlocks after the change, so this replaces
    // what it holds instead of patching its own copy — which would quietly drift the moment the
    // server did something the client didn't predict (revoking also unequips, for one).
    detail.value = owned.value[kind].has(asset)
      ? await adminApi.revokeUnlock(adminToken.value, selectedCode.value, kind, asset)
      : await adminApi.grantUnlock(adminToken.value, selectedCode.value, kind, asset)
  } catch (e) {
    toggleError.value = e.message
  } finally {
    busyKey.value = null
  }
}
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

          <!-- Only for players who have no account yet. Someone already signed in has nothing
               to claim, and minting a code for them would be a way to take their account over. -->
          <div v-if="!detail.hasAccount" class="as-claim">
            <button class="btn secondary as-claim-btn" :disabled="claimBusy" @click="mintClaim">
              {{ claimBusy ? t('admin.claimMinting') : t('admin.claimMint') }}
            </button>
            <code v-if="claimCode" class="as-claim-code">{{ claimCode }}</code>
            <span v-if="claimCode" class="as-claim-note">{{ t('admin.claimHint') }}</span>
            <span v-if="claimError" class="as-error">{{ claimError }}</span>
          </div>

          <p class="as-hint">{{ t('admin.toggleHint') }}</p>
          <p v-if="toggleError" class="as-error">{{ toggleError }}</p>

          <div class="as-owned">
            <div class="as-owned-group">
              <span class="as-owned-label">{{ t('profile.avatar') }}</span>
              <div class="as-owned-grid">
                <button
                  v-for="id in AVATAR_IDS"
                  :key="id"
                  :class="['as-cell', { on: owned.avatar.has(id), free: isFree('avatar', id),
                                        busy: busyKey === `avatar:${id}` }]"
                  :title="srcOf[`avatar:${id}`] || id"
                  :disabled="isFree('avatar', id) || busyKey !== null"
                  @click="toggle('avatar', id)"
                >
                  <img :src="avatarUrl(id)" alt="" loading="lazy">
                </button>
              </div>
            </div>

            <div class="as-owned-group">
              <span class="as-owned-label">{{ t('profile.flag') }}</span>
              <div class="as-owned-grid wide">
                <button
                  v-for="id in BACKGROUND_IDS"
                  :key="id"
                  :class="['as-cell', 'flag', { on: owned.background.has(id), free: isFree('background', id),
                                                busy: busyKey === `background:${id}` }]"
                  :title="srcOf[`background:${id}`] || id"
                  :disabled="isFree('background', id) || busyKey !== null"
                  @click="toggle('background', id)"
                >
                  <img :src="backgroundUrl(id)" alt="" loading="lazy">
                </button>
              </div>
            </div>

            <!-- Grouped the way the catalogue groups them, because that is how someone looks for
                 one: "the Meetup#2 ones", "the achievements". -->
            <div v-for="g in TITLE_IDS" :key="g.label" class="as-owned-group">
              <span class="as-owned-label">{{ t('profile.titleLabel') }} · {{ g.label }}</span>
              <div class="as-owned-titles">
                <button
                  v-for="id in g.ids"
                  :key="id"
                  :class="['as-owned-title', { on: owned.title.has(id), free: isFree('title', id),
                                               busy: busyKey === `title:${id}` }]"
                  :title="srcOf[`title:${id}`] || id"
                  :disabled="isFree('title', id) || busyKey !== null"
                  @click="toggle('title', id)"
                >{{ resolveTitle(id)?.text || id }}</button>
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

.as-claim { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.as-claim-btn { padding: 0.3125rem 0.625rem; font-size: 0.6875rem; }
/* Monospace and spaced out, because this gets read aloud or retyped from a screenshot and
   O/0 and I/1 have to be told apart. */
.as-claim-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 0.1875rem 0.4375rem;
  border-radius: var(--radius-sm);
  background: #2A2A28;
  color: var(--accent-strong);
  user-select: all;
}
.as-claim-note { font-size: 0.5625rem; color: var(--sub); }

.as-hint { margin: 0; font-size: 0.625rem; font-weight: 600; color: var(--sub); line-height: 1.6; }

.as-owned { display: flex; flex-direction: column; gap: 0.5rem; }

/* Not-owned is the dimmed state rather than the hidden one: the whole point of listing every
   asset is being able to see what someone hasn't got yet and hand it over. */
.as-cell {
  padding: 0;
  border: 0.125rem solid transparent;
  border-radius: var(--radius-sm);
  background: var(--card);
  cursor: pointer;
  overflow: hidden;
  aspect-ratio: 1;
  opacity: 0.3;
  filter: grayscale(1);
  transition: opacity 0.12s, filter 0.12s;
}
.as-cell.flag { aspect-ratio: 8 / 3; }
.as-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.as-cell.on { opacity: 1; filter: none; border-color: var(--accent-strong); }
/* Free assets need no grant, so there is nothing to toggle — shown at full strength so they
   don't read as "missing", but not offered as a button. */
.as-cell.free { opacity: 1; filter: none; cursor: default; }
.as-cell.busy { opacity: 0.6; }
.as-cell:focus-visible { outline: 0.125rem solid var(--accent-strong); outline-offset: 0.125rem; }
.as-owned-label { font-size: 0.625rem; font-weight: 800; color: var(--sub); letter-spacing: 0.04em; }
.as-owned-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(3rem, 1fr)); gap: 0.375rem; margin-top: 0.25rem; }
.as-owned-grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius-sm); box-shadow: var(--shadow); display: block; }
.as-owned-grid.wide img { aspect-ratio: 8 / 3; }
.as-owned-titles { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.25rem; }
.as-owned-title {
  font-size: 0.625rem;
  font-weight: 700;
  padding: 0.1875rem 0.4375rem;
  border: 0.125rem solid transparent;
  border-radius: var(--radius-sm);
  background: #2A2A28;
  color: #fff;
  white-space: nowrap;
  cursor: pointer;
  font-family: inherit;
  /* Same convention as the asset cells above: dimmed means not held. */
  opacity: 0.35;
  transition: opacity 0.12s;
}
.as-owned-title.on { opacity: 1; border-color: var(--accent-strong); }
.as-owned-title.free { opacity: 1; cursor: default; }
.as-owned-title.busy { opacity: 0.6; }
.as-owned-title:focus-visible { outline: 0.125rem solid var(--accent-strong); outline-offset: 0.125rem; }
.as-error { font-size: 0.75rem; font-weight: 700; color: #C0392B; }

.as-foot { flex-shrink: 0; display: flex; justify-content: center; padding: 0.75rem 0 0.25rem; }
</style>
