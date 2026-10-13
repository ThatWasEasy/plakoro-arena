<script setup>
// Your own player profile: the face, the flag, and the name you go by.
//
// Only the things a player chooses. Medals, titles and win rates are not here and will never
// be — those are read off the tournament records, and a profile screen that could set them
// would make every badge in the app worthless. Avatars and flags are a softer version of the
// same rule: picking is free, but only among tiers this record has actually reached — the
// pickers below are gated by live stats, not left wide open the way a mock account would be.
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as authApi from '../data/authApi'
import { audioSettings, setVolume } from '../data/audioSettings'
import { sfxSettings, setSfxVolume } from '../data/sfxSettings'
import { currentIdentity, setCurrentPlayer, signOut } from '../data/currentPlayer'
import { isAdminAccount, isAdminMode, setAdminMode } from '../data/adminSession'
import { AVATAR_IDS, BACKGROUND_IDS, avatarUrl, backgroundUrl, tierOfAsset } from '../data/nameplateAssets'
import { getToken } from '../data/session'
import { TITLE_GROUPS, resolveTitle } from '../data/assetCatalogue'
import PlayerBanner from './tournament/PlayerBanner.vue'
import VolumeBar from './VolumeBar.vue'

// Reached only while signed in — the chip sends a guest to LoginApp instead, and signing out
// below leaves this screen immediately rather than reverting it to a guest state in place.
const emit = defineEmits(['back'])
const { t } = useI18n()

const tab = ref('badge')

// Starts empty rather than waiting on the fetch below, so the pickers never flash
// everything-unlocked before narrowing — the safe default is "nothing earned yet."
const ownedAvatars = ref(new Set())
const ownedBackgrounds = ref(new Set())
const ownedTitles = ref(new Set())

onMounted(async () => {
  const token = getToken()
  if (!token) return
  try {
    const profile = await authApi.me(token)
    ownedAvatars.value = new Set(profile.unlocks.filter(u => u.kind === 'avatar').map(u => u.asset))
    ownedBackgrounds.value = new Set(profile.unlocks.filter(u => u.kind === 'background').map(u => u.asset))
    ownedTitles.value = new Set(profile.unlocks.filter(u => u.kind === 'title').map(u => u.asset))
  } catch (e) {
    // Stats/unlocks just didn't load this time — stay locked down rather than guessing.
  }
})

// Exactly what the server will accept: a `-default` flag, which every season gives away, or a
// row in player_unlocks. Nothing is inferred.
//
// There used to be a tier ladder here — placing anywhere was taken to unlock every lower tier
// too. It was wrong twice over. It ignored the season, so one third place opened every event's
// `-winner`, including events the player never attended; and even within a season it was
// backwards, because the tiers are not a ladder. A reward package gives 1st `-champion`,
// 2nd and 3rd `-winner`, and everyone `-participants` — so `-winner` means "came 2nd or 3rd",
// and a champion is not entitled to it. The one case the ladder was meant to serve, a champion
// wanting the plainer flag, is already covered: the participant grant goes to the whole entry
// list, champion included.
//
// Deciding what someone gets belongs in the reward package, which is admin-editable. A rule
// here could only ever drift from it — and did.
function isUnlocked(id, kind) {
  if (tierOfAsset(id) === 'default') return true
  const owned = kind === 'avatar' ? ownedAvatars.value : ownedBackgrounds.value
  return owned.has(id)
}

// The free starter title aside, a title is unlocked only if player_unlocks actually has it —
// titles don't ride the tier ladder the way avatars/flags do, so there's no tier shortcut here.
function isTitleUnlocked(id, groupKey) {
  return groupKey === 'general' || ownedTitles.value.has(id)
}

// Buttons stay enabled (not :disabled) even when locked, purely so a tap still registers as a
// deliberate "no" rather than doing nothing at all — but what that tap should show is still
// undecided (probably what it actually takes to unlock, once that's tracked), so for now it just
// declines the pick silently rather than showing a placeholder message.
function pickAvatar(id) {
  if (!isUnlocked(id, 'avatar')) return
  draft.value.avatar = id
}
function pickBackground(id) {
  if (!isUnlocked(id, 'background')) return
  draft.value.background = id
}
function pickTitle(id, groupKey) {
  if (!isTitleUnlocked(id, groupKey)) return
  draft.value.titleId = id
}

// Owned-only by default — a wall of mostly-locked artwork isn't a useful way to meet this
// screen the first time. "Show all" is there for whoever wants to see what's out there to aim
// for; it doesn't change what's pickable, only what's shown.
const showAll = ref(false)
const visibleAvatarIds = computed(() => AVATAR_IDS.filter(id => showAll.value || isUnlocked(id, 'avatar')))
const visibleBackgroundIds = computed(() => BACKGROUND_IDS.filter(id => showAll.value || isUnlocked(id, 'background')))
const visibleTitleGroups = computed(() =>
  TITLE_GROUPS
    .map(g => ({ ...g, titles: g.titles.filter(ti => showAll.value || isTitleUnlocked(ti.id, g.key)) }))
    .filter(g => g.titles.length > 0))

// A draft, so backing out leaves the saved profile alone.
const draft = ref({
  code: currentIdentity.value.code,
  name: currentIdentity.value.name || '',
  avatar: currentIdentity.value.avatar,
  background: currentIdentity.value.background || BACKGROUND_IDS[0],
  titleId: currentIdentity.value.titleId || null
})

// The real nameplate component, fed the draft — so what is being previewed is the thing that
// will appear beside this player's name at an event, not an approximation of it.
const preview = computed(() => ({
  playerKey: draft.value.code ? `code:${draft.value.code}` : 'local',
  name: draft.value.name.trim() || t('player.guest'),
  code: draft.value.code,
  avatar: draft.value.avatar,
  background: draft.value.background,
  title: resolveTitle(draft.value.titleId),
  // Earned, so the preview shows them as they really are: empty, until an event says otherwise.
  medals: { gold: 0, silver: 0, bronze: 0 },
  events: 0,
  winRate: null
}))

const dirty = computed(() =>
  draft.value.name.trim() !== (currentIdentity.value.name || '') ||
  draft.value.avatar !== currentIdentity.value.avatar ||
  draft.value.background !== (currentIdentity.value.background || BACKGROUND_IDS[0]) ||
  draft.value.titleId !== (currentIdentity.value.titleId || null))

const saving = ref(false)
const saveError = ref('')

async function save() {
  if (saving.value) return
  saveError.value = ''
  saving.value = true
  try {
    const token = getToken()
    const profile = await authApi.updateMe(token, {
      name: draft.value.name.trim(),
      avatar: draft.value.avatar,
      background: draft.value.background,
      titleId: draft.value.titleId
    })
    setCurrentPlayer({
      code: profile.code,
      name: profile.name,
      avatar: profile.avatar,
      background: profile.background,
      titleId: profile.title_id
    })
    emit('back')
  } catch (e) {
    saveError.value = e.message || t('profile.saveError')
  } finally {
    saving.value = false
  }
}

// Nothing left to edit once signed out, so this leaves the screen rather than reverting it to a
// guest state in place — back to the chip, which now routes a guest to LoginApp instead.
function handleSignOut() {
  signOut()
  emit('back')
}
</script>

<template>
  <div class="board select-board pp-board">
    <div class="pp-tabs">
      <button :class="['pp-tab', { on: tab === 'badge' }]" @click="tab = 'badge'">{{ t('profile.tabBadge') }}</button>
      <button :class="['pp-tab', { on: tab === 'settings' }]" @click="tab = 'settings'">{{ t('profile.tabSettings') }}</button>
    </div>

    <template v-if="tab === 'badge'">
      <!-- Outside the scroller: the preview is what every choice below is being judged against,
           so scrolling it away would mean picking a flag with nothing to check it on. -->
      <div class="pp-preview">
        <PlayerBanner :nameplate="preview" size="lg" />
      </div>

      <div class="pp-body">
        <div class="pp-field">
          <span class="pp-label">{{ t('profile.avatar') }}</span>
          <div class="pp-grid">
            <button
              v-for="id in visibleAvatarIds"
              :key="id"
              :class="['pp-swatch', { on: draft.avatar === id, locked: !isUnlocked(id, 'avatar') }]"
              :title="isUnlocked(id, 'avatar') ? id : t('profile.locked')"
              @click="pickAvatar(id)"
            >
              <img :src="avatarUrl(id)" alt="" loading="lazy">
            </button>
          </div>
        </div>

        <div class="pp-field">
          <span class="pp-label">{{ t('profile.flag') }}</span>
          <div class="pp-grid wide">
            <button
              v-for="id in visibleBackgroundIds"
              :key="id"
              :class="['pp-swatch', 'flag', { on: draft.background === id, locked: !isUnlocked(id, 'background') }]"
              :title="isUnlocked(id, 'background') ? id : t('profile.locked')"
              @click="pickBackground(id)"
            >
              <img :src="backgroundUrl(id)" alt="" loading="lazy">
            </button>
          </div>
        </div>

        <div class="pp-field">
          <span class="pp-label">{{ t('profile.titleLabel') }}</span>
          <div class="pp-titles">
            <button
              :class="['pp-title-chip', 'plain', { on: draft.titleId === null }]"
              @click="draft.titleId = null"
            >{{ t('profile.noTitle') }}</button>
          </div>
          <!-- Grouped by the event that awards them, because that is how a player thinks of
               what they hold: "the ones I got at Meetup#2". -->
          <div v-for="g in visibleTitleGroups" :key="g.key" class="pp-series">
            <span class="pp-series-label">{{ g.label }}</span>
            <div class="pp-titles">
              <button
                v-for="ti in g.titles"
                :key="ti.id"
                :class="['pp-title-chip', ti.rank, { on: draft.titleId === ti.id, locked: !isTitleUnlocked(ti.id, g.key) }]"
                :title="isTitleUnlocked(ti.id, g.key) ? ti.obtain || undefined : (ti.obtain || t('profile.locked'))"
                @click="pickTitle(ti.id, g.key)"
              >{{ ti.name }}</button>
            </div>
          </div>
        </div>

      </div>
    </template>

    <div v-else class="pp-body">
      <label class="pp-field">
        <span class="pp-label">{{ t('profile.name') }}</span>
        <input
          v-model="draft.name"
          class="pp-input"
          maxlength="20"
          :placeholder="t('profile.namePlaceholder')"
        >
      </label>

      <div class="pp-field">
        <span class="pp-label">{{ t('profile.musicVolume') }}</span>
        <VolumeBar
          :model-value="audioSettings.volume"
          :disabled="audioSettings.muted"
          @update:model-value="setVolume"
        />
      </div>

      <div class="pp-field">
        <span class="pp-label">{{ t('profile.sfxVolume') }}</span>
        <VolumeBar
          :model-value="sfxSettings.volume"
          @update:model-value="setSfxVolume"
        />
      </div>

      <!-- Only ever rendered for the organiser's own account, so for everyone else admin mode
           isn't something to be refused — it's something they never learn is there. Off on every
           page load: being the organiser is permanent, wanting the admin cards in the menu is
           not. -->
      <label v-if="isAdminAccount" class="pp-field pp-check">
        <input type="checkbox" :checked="isAdminMode" @change="setAdminMode($event.target.checked)">
        <span>{{ t('profile.adminMode') }}</span>
      </label>

      <button class="btn secondary" @click="handleSignOut">{{ t('account.signOut') }}</button>
    </div>

    <p v-if="saveError" class="pp-save-error">{{ saveError }}</p>

    <div class="pp-foot">
      <button
        v-if="tab === 'badge'"
        class="btn secondary pp-foot-btn"
        @click="showAll = !showAll"
      >{{ showAll ? t('profile.showOwned') : t('profile.showAll') }}</button>
      <button class="btn pp-foot-btn" :disabled="!dirty || saving" @click="save">{{ t('profile.save') }}</button>
      <button class="btn secondary pp-foot-btn" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
.pp-board { display: flex; flex-direction: column; min-height: 0; }

/* A row, not a stacked field: the label belongs beside its box, and the whole thing is a
   <label> so the text is part of the hit target. */
.pp-check {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--ink);
}
.pp-check input { width: 1rem; height: 1rem; accent-color: var(--accent-strong); cursor: pointer; }

.pp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
}

/* One joined bar rather than separate pills — segments share borders (collapsed via negative
   margin) and only the two outer corners round, the way a segmented control reads as a single
   control instead of a row of buttons that happen to be near each other. */
.pp-tabs {
  flex-shrink: 0;
  display: flex;
  width: 100%;
  max-width: 30rem;
  margin: 0.625rem auto 0.5rem;
  padding: 0 0.75rem;
}
.pp-tab {
  flex: 1;
  padding: 0.4375rem 0.25rem;
  font-size: 0.75rem;
  font-weight: 700;
  border: 0.0625rem solid var(--line);
  margin-left: -0.0625rem;
  background: #fff;
  color: var(--ink);
  cursor: pointer;
  font-family: inherit;
  position: relative;
}
.pp-tab:first-child { margin-left: 0; border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.pp-tab:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
/* Dark fill, same as .btn.secondary elsewhere in the app — white tab for "not this one",
   solid dark fill with white text for "this one". */
.pp-tab.on {
  background: #1F1F1D;
  border-color: #1F1F1D;
  color: #fff;
  z-index: 1;
}

.pp-preview {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding: 0.25rem 0 0.5rem;
}

.pp-foot-btn { padding: 0.4375rem 0.75rem; font-size: 0.6875rem; }

.pp-field { width: 100%; max-width: 30rem; display: flex; flex-direction: column; gap: 0.25rem; }
.pp-label { font-size: 0.625rem; font-weight: 800; color: var(--sub); letter-spacing: 0.04em; }

.pp-input {
  width: 100%;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--ink);
  padding: 0.4375rem 0.5rem;
  border: 0.125rem solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card);
}
.pp-input:focus { outline: none; border-color: var(--accent-strong); }

.pp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(4.25rem, 1fr));
  gap: 0.5rem;
}
.pp-grid.wide { grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); }

.pp-swatch {
  position: relative;
  padding: 0;
  border: 0.125rem solid transparent;
  border-radius: var(--radius-sm);
  background: var(--card);
  cursor: pointer;
  overflow: hidden;
  aspect-ratio: 1;
  box-shadow: var(--shadow);
}
/* 8:3, so a flag reads as the shape it will actually be rather than a cropped square. */
.pp-swatch.flag { aspect-ratio: 8 / 3; }
.pp-swatch img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* A thin border alone got lost against busy artwork — the outer glow is what actually reads as
   "selected" at a glance. */
.pp-swatch.on { border-color: #1F1F1D; box-shadow: 0 0 0 0.1875rem #1F1F1D; }
.pp-swatch:focus-visible { outline: 0.125rem solid var(--accent-strong); outline-offset: 0.125rem; }

/* Shown, not hidden — a player should see what exists to aim for, just not be able to wear it
   yet. Greyed out and inert rather than removed from the grid. */
.pp-swatch.locked { cursor: not-allowed; }
.pp-swatch.locked img { filter: grayscale(1); opacity: 0.45; }
/* Coloured the way the nameplate will colour them, so what is picked here is what appears
   there. Same ranks, same tints. */
.pp-series { display: flex; flex-direction: column; gap: 0.1875rem; padding-top: 0.25rem; }
.pp-series-label {
  font-size: 0.5rem;
  font-weight: 800;
  color: var(--sub);
  letter-spacing: 0.06em;
}
.pp-titles { display: flex; flex-wrap: wrap; gap: 0.25rem; }

.pp-title-chip {
  font-size: 0.625rem;
  font-weight: 700;
  padding: 0.1875rem 0.4375rem;
  border-radius: var(--radius-sm);
  border: 0.125rem solid transparent;
  background: #2A2A28;
  color: var(--tint, rgba(255, 255, 255, .78));
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
/* Filled rather than just outlined, same reasoning as the tabs above. */
/* A border, not a fill — filling it in flattened every rank to the same colour, which is exactly
   what the rank tint exists to avoid. A white ring reads as "selected" without hiding it. */
.pp-title-chip.on { border-color: #fff; }
.pp-title-chip:focus-visible { outline: 0.125rem solid var(--accent-strong); outline-offset: 0.125rem; }
.pp-title-chip.locked { cursor: not-allowed; opacity: 0.45; }
.pp-title-chip.plain  { --tint: rgba(255, 255, 255, .78); }
.pp-title-chip.silver { --tint: #D5DAE3; }
.pp-title-chip.bronze { --tint: #DB9A68; }
.pp-title-chip.epic   { --tint: #CE93E8; }
.pp-title-chip.gold   { --tint: #F0C244; }
.pp-title-chip.legend { --tint: #FFDC73; }

.pp-save-error {
  flex-shrink: 0;
  margin: 0;
  padding: 0 0.75rem;
  text-align: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: #C0392B;
}

.pp-foot {
  flex-shrink: 0;
  display: flex;
  gap: 0.625rem;
  justify-content: center;
  padding: 0.75rem 0 0.25rem;
}
</style>
