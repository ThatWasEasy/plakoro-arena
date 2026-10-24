<script setup>
// Who is ahead, across every event rather than inside one.
//
// Scored the same way as a tournament's own standings — win 3, draw 1, bye 3 — so the number
// here means what it meant on the day. Deliberately not win rate: one match won is 100%, which
// puts a first-timer above someone who has played all year unless a minimum-games rule props
// it up, and that threshold is a number nobody can justify.
//
// Offline only for now. Online has the same board waiting for it, but nothing writes to
// online_matches until online battle exists.
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchLeaderboard } from '../data/leaderboardApi'
import { currentIdentity, isSignedIn } from '../data/currentPlayer'
import { resolveTitle } from '../data/assetCatalogue'
import { NAMEPLATE_VERSION } from '../game/playerNameplate'
import PlayerBanner from './tournament/PlayerBanner.vue'

const emit = defineEmits(['back'])
const { t } = useI18n()

const SCOPES = ['offline', 'online']
const scope = ref('offline')

// Offline has no month: a month of offline results is one event or none, which is that event's
// result sheet rather than a ranking. Online plays all year round, so a month means something.
const WINDOWS = computed(() => (scope.value === 'online' ? ['month', 'year', 'all'] : ['year', 'all']))
// Opens on the whole record. A year window is the one you narrow to on purpose; landing on it
// hides every result from before January behind a tab nobody was told to press.
const window_ = ref('all')

const rows = ref([])
const mine = ref(null)
const busy = ref(true)
const error = ref('')

async function load() {
  busy.value = true
  error.value = ''
  try {
    const data = await fetchLeaderboard(scope.value, window_.value, currentIdentity.value.code)
    rows.value = data.rows || []
    mine.value = data.me || null
  } catch (e) {
    error.value = e.message
    rows.value = []
    mine.value = null
  } finally {
    busy.value = false
  }
}

onMounted(load)
watch([scope, window_], load)

// Leaving online drops the month view with it. Without this the board would ask the server for
// an offline month, which it answers as a year — a tab saying one thing and showing another.
watch(scope, s => { if (s === 'offline' && window_.value === 'month') window_.value = 'year' })

const isMe = code => code === currentIdentity.value.code

// Every row wears its owner's actual nameplate — the same thing they see on a pairing sheet,
// not a stripped-down echo of it. The pinned row at the bottom is built from this too, so
// finding yourself there shows exactly what finding yourself above would have.
//
// Medals and win rate are the window's, not a lifetime's: the server counts placements over
// the same span it scored the points over, and the rate is read off this row's own record.
function plateOf(r) {
  return {
    version: NAMEPLATE_VERSION,
    playerKey: `code:${r.code}`,
    name: r.name,
    code: r.code,
    avatar: r.avatar,
    background: r.background,
    title: resolveTitle(r.title_id),
    medals: { gold: r.gold || 0, silver: r.silver || 0, bronze: r.bronze || 0 },
    events: r.events,
    winRate: winRateOf(r)
  }
}

// Decided matches only, matching playerBadges.winRate — a bye scores in the standings but says
// nothing about the player, and counting it would inflate everyone who ever sat out a round.
function winRateOf(r) {
  const played = (r.wins || 0) + (r.losses || 0) + (r.draws || 0)
  if (!played) return null
  return Math.round((r.wins / played) * 100)
}

const myNameplate = computed(() => (mine.value ? plateOf(mine.value) : null))

const online = computed(() => scope.value === 'online')
</script>

<template>
  <div class="board select-board lb-board">
    <h2 class="lb-title">{{ t('leaderboard.title') }}</h2>

    <!-- Two segmented controls on one line, the same joined bar the profile tabs use: which
         board on the left, which span of it on the right. Separate groups rather than one row
         of five, because the two questions are independent. -->
    <div class="lb-tabs">
      <div class="lb-seg">
        <button
          v-for="s in SCOPES"
          :key="s"
          :class="['lb-tab', { on: scope === s }]"
          @click="scope = s"
        >{{ t('leaderboard.scope.' + s) }}</button>
      </div>
      <div class="lb-seg">
        <button
          v-for="w in WINDOWS"
          :key="w"
          :class="['lb-tab', { on: window_ === w }]"
          @click="window_ = w"
        >{{ t('leaderboard.window.' + w) }}</button>
      </div>
    </div>

    <!-- Only the offline board explains itself. The online one has nothing on it yet, and a
         scoring rule above an empty board is a footnote to nothing. -->
    <p v-if="!online" class="lb-note">{{ t('leaderboard.scoring') }}</p>

    <div class="lb-body">
      <p v-if="busy" class="lb-empty">{{ t('leaderboard.loading') }}</p>
      <p v-else-if="error" class="lb-empty lb-error">{{ error }}</p>
      <p v-else-if="!rows.length" class="lb-empty">{{ t(online ? 'leaderboard.comingSoon' : 'leaderboard.empty') }}</p>

      <div
        v-for="r in rows"
        v-else
        :key="r.code"
        :class="['lb-row', { me: isMe(r.code) }]"
      >
        <span class="lb-rank">{{ r.rank }}</span>
        <PlayerBanner :nameplate="plateOf(r)" />
        <span class="lb-side">
          <span class="lb-record">{{ t('leaderboard.record', { w: r.wins, l: r.losses, d: r.draws }) }}</span>
          <span class="lb-points">{{ t('leaderboard.points', { n: r.points }) }}</span>
        </span>
      </div>
    </div>

    <!-- Your own standing, pinned. The board is a hundred rows long and most people are not
         on screen when they open it — scrolling to find yourself is exactly what this removes.
         Kept even when the row above is also yours: a fixed place to look beats a hunt. -->
    <div v-if="myNameplate" class="lb-row lb-me">
      <span class="lb-rank">{{ mine.rank }}</span>
      <PlayerBanner :nameplate="myNameplate" />
      <span class="lb-side">
        <span class="lb-record">{{ t('leaderboard.record', { w: mine.wins, l: mine.losses, d: mine.draws }) }}</span>
        <span class="lb-points">{{ t('leaderboard.points', { n: mine.points }) }}</span>
      </span>
    </div>
    <p v-else-if="isSignedIn && !busy && rows.length" class="lb-me-none">{{ t(online ? 'leaderboard.notRankedOnline' : 'leaderboard.notRanked') }}</p>

    <div class="lb-foot">
      <button class="btn secondary lb-back" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
.lb-board { display: flex; flex-direction: column; min-height: 0; gap: 0.375rem; }
.lb-title { margin: 0; text-align: center; font-size: 1.125rem; font-weight: 900; color: var(--ink); }

/* Same joined-bar treatment as the profile's tabs: segments share borders (collapsed with a
   negative margin) and only the group's outer corners round, so each group reads as one
   control rather than buttons that happen to sit together. */
.lb-tabs { flex-shrink: 0; display: flex; justify-content: center; gap: 0.5rem; }
.lb-seg { display: flex; }
.lb-tab {
  padding: 0.3125rem 0.75rem;
  border: 0.0625rem solid var(--line);
  margin-left: -0.0625rem;
  background: #fff;
  font-family: inherit;
  font-size: 0.6875rem;
  font-weight: 700;
  color: var(--ink);
  cursor: pointer;
  position: relative;
  white-space: nowrap;
}
.lb-seg .lb-tab:first-child { margin-left: 0; border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.lb-seg .lb-tab:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.lb-tab.on { background: #1F1F1D; border-color: #1F1F1D; color: #fff; z-index: 1; }

/* Says how the number was arrived at. A ranking people care about gets argued over, and the
   rule being one line away settles it. */
.lb-note { margin: 0; text-align: center; font-size: 0.5625rem; font-weight: 700; color: var(--sub); }

.lb-body {
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  /* Just wide enough for the row's own contents: a rank, a nameplate and two numbers.
     Stretched to the full width of a 16:9 stage the three sit miles apart and stop reading
     as one line. */
  width: 100%;
  max-width: 17.5rem;
  align-self: center;
  padding: 0 0.125rem;
}
.lb-empty { margin: 1.5rem 0; text-align: center; font-size: 0.75rem; font-weight: 700; color: var(--sub); }
.lb-error { color: #C0392B; }

.lb-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4375rem;
  padding: 0.25rem 0.375rem;
  border-radius: 0.5rem;
  background: var(--card);
}
/* Your own row, findable without reading every line. */
.lb-row.me { outline: 0.125rem solid var(--accent-strong); }

.lb-rank {
  flex: none;
  /* Three digits wide: the board runs to a hundred rows. */
  width: 2rem;
  text-align: center;
  font-size: 0.875rem;
  font-weight: 900;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

/* The figures sit against the nameplate rather than out at the row's edge, so rank, name and
   score read as one line instead of three things at arm's length. Fixed width so the column
   still lines up down the board however many digits a score has. Nothing here touches the
   banner — it is the same component at the same size the pairing sheet uses. */
.lb-side { flex: none; width: 3.5rem; display: flex; flex-direction: column; align-items: flex-start; gap: 0.0625rem; }
.lb-record { font-size: 0.5625rem; font-weight: 700; color: var(--sub); font-variant-numeric: tabular-nums; white-space: nowrap; }
.lb-points { font-size: 0.875rem; font-weight: 900; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* Same row, pinned. Width matched to the list above so the two line up as one column —
   .lb-body carries its own padding, which the pinned row has to repeat to agree with it. */
.lb-me {
  flex-shrink: 0;
  width: 100%;
  max-width: calc(17.5rem - 0.25rem);
  align-self: center;
  margin-top: 0.25rem;
  box-shadow: 0 -0.125rem 0.5rem rgba(60, 60, 50, .12);
}
.lb-me-none { flex-shrink: 0; margin: 0; text-align: center; font-size: 0.625rem; font-weight: 700; color: var(--sub); }

.lb-foot { flex-shrink: 0; display: flex; justify-content: center; padding-top: 0.25rem; }
/* The way out of a board you only came to read — present, not competing with the rankings. */
.lb-back { padding: 0.3125rem 1.125rem; font-size: 0.75rem; }
</style>
