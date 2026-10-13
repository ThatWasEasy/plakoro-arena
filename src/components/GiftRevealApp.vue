<script setup>
// Opening what the organiser handed over.
//
// Everything is claimed in one request the moment this opens — the cards that follow are the
// reveal, not the transaction. A player who closes the screen halfway has still received all
// of it; nothing is left in a half-opened state for them to come back to and wonder about.
//
// Each card says why they got it, because a flag with no explanation is just a picture. The
// text comes from the asset catalogue by default, and from the organiser's note when there is
// one — see reasonFor().
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { claimAllGifts } from '../data/gifts'
import { describeAsset } from '../data/assetCatalogue'
import { pointReason } from '../data/pointReason'
import { avatarUrl, backgroundUrl } from '../data/nameplateAssets'
import { playGetItemSound } from '../data/buttonSfx'

const emit = defineEmits(['back'])
const { t } = useI18n()

const items = ref([])
const index = ref(0)
const busy = ref(true)
const error = ref('')

const current = computed(() => items.value[index.value] || null)
// Only decides the button's wording — the count itself is already in the header.
const remaining = computed(() => items.value.length - index.value - 1)

onMounted(async () => {
  try {
    items.value = await claimAllGifts()
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
  if (!items.value.length) emit('back')
})

// Why this arrived.
//
// A hand-granted item has whatever reason the organiser typed; failing that it falls back to
// the catalogue, which is right for anything given under a standing rule ("早期註冊的玩家").
// An automatic grant always uses the catalogue — the rule is the reason.
function reasonFor(g) {
  // Points are not in the asset catalogue and never will be — there is no "how you obtain PTP"
  // rule, only what happened and where.
  if (g.kind === 'points') return pointReason(g, t)
  const entry = describeAsset(g.kind, g.asset)
  if (g.src && g.src.startsWith('manual:')) return g.note || entry?.obtain || t('gift.fromOrganiser')
  return entry?.obtain || g.tournament_name || t('gift.fromOrganiser')
}

// Falls back to the raw id rather than rendering blank. An asset the catalogue doesn't list is
// a typo or a missing entry, and showing the id is how that gets noticed.
function nameFor(g) {
  return describeAsset(g.kind, g.asset)?.name || g.asset
}

// Which of the three things this is.
//
// A title's artwork is just words, so without this line it reads as a slogan rather than as
// something you can put on a nameplate. Reuses the profile screen's own wording — this is the
// first place a player meets an item, and the second is the profile.
const KIND_LABELS = {
  avatar: 'profile.avatar', background: 'profile.flag',
  title: 'profile.titleLabel', points: 'points.name'
}
function kindLabel(g) {
  const key = KIND_LABELS[g.kind]
  return key ? t(key) : g.kind
}

// One sound per card, including the first. The board carries data-sfx="off" so the generic
// tap sound doesn't fire underneath it — advancing a card and receiving the thing are the same
// gesture here, and they should make one sound, not two.
watch(current, g => { if (g) playGetItemSound() })

function next() {
  if (index.value < items.value.length - 1) index.value++
  else emit('back')
}
</script>

<template>
  <div class="board select-board gr-board" data-sfx="off" @click="!busy && current && next()">
    <template v-if="current">
      <div class="gr-count">{{ t('gift.nth', { n: index + 1, total: items.length }) }}</div>

      <div :key="current.id" class="gr-card">
        <div class="gr-art">
          <img v-if="current.kind === 'avatar'" class="gr-avatar" :src="avatarUrl(current.asset)" alt="">
          <img v-else-if="current.kind === 'background'" class="gr-flag" :src="backgroundUrl(current.asset)" alt="">
          <!-- The amount is the artwork, the same way a title's words are. Nothing to illustrate
               and nothing gained by inventing a coin. -->
          <div v-else-if="current.kind === 'points'" class="gr-title-art gr-points-art">
            +{{ current.points }}<span class="gr-points-unit">PTP</span>
          </div>
          <div v-else class="gr-title-art">{{ nameFor(current) }}</div>
        </div>

        <div class="gr-kind">{{ kindLabel(current) }}</div>

        <!-- A title's artwork is its own name, so repeating it underneath says nothing. An
             avatar or flag needs the line: the picture alone doesn't tell you which one it is. -->
        <div v-if="current.kind !== 'title' && current.kind !== 'points'" class="gr-name">{{ nameFor(current) }}</div>
        <div class="gr-reason">{{ reasonFor(current) }}</div>
      </div>

      <!-- The board stays tappable — a thumb on a phone shouldn't have to find a target — but
           the button is what says the screen is waiting on you. @click.stop so the two don't
           both fire and skip a card. -->
      <button class="gr-next" @click.stop="next()">
        {{ remaining > 0 ? t('gift.next') : t('gift.done') }}
      </button>
    </template>

    <div v-else-if="busy" class="gr-busy">{{ t('gift.opening') }}</div>
    <div v-else-if="error" class="gr-busy gr-error">{{ error }}</div>
  </div>
</template>

<style scoped>
/* The whole board is the button. There is one thing to do here and a player holding a phone
   one-handed should not have to find a target. */
.gr-board {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.875rem;
  cursor: pointer;
  user-select: none;
}

.gr-count { font-size: 0.6875rem; font-weight: 800; color: var(--sub); letter-spacing: 0.08em; }

.gr-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  /* Re-keyed per item, so each card plays the entrance again instead of the text swapping
     under a stationary frame. */
  animation: gr-in 0.32s cubic-bezier(.2, .9, .3, 1.3);
}

@keyframes gr-in {
  from { opacity: 0; transform: translateY(0.75rem) scale(.92); }
  to   { opacity: 1; transform: none; }
}

.gr-art { display: flex; align-items: center; justify-content: center; min-height: 7rem; }

.gr-avatar {
  width: 7rem;
  height: 7rem;
  border-radius: 0.875rem;
  object-fit: contain;
  box-shadow: 0 0 0 0.125rem rgba(255, 255, 255, .6), 0 0.25rem 1rem rgba(60, 60, 50, .3);
}

/* 8:3, the shape it will actually be on a nameplate. */
.gr-flag {
  width: 18rem;
  aspect-ratio: 8 / 3;
  object-fit: cover;
  border-radius: 0.5rem;
  box-shadow: 0 0.25rem 1rem rgba(60, 60, 50, .3);
}

/* A title has no artwork, so the words are the artwork. */
.gr-title-art {
  font-size: 1.5rem;
  font-weight: 900;
  color: var(--ink);
  padding: 1rem 1.75rem;
  border-radius: 0.75rem;
  background: var(--card);
  box-shadow: 0 0.25rem 1rem rgba(60, 60, 50, .25);
  white-space: nowrap;
}

.gr-kind {
  font-size: 0.625rem;
  font-weight: 800;
  color: var(--sub);
  letter-spacing: 0.14em;
}
.gr-points-art {
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
  font-size: 2.25rem;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.gr-points-unit { font-size: 0.875rem; font-weight: 800; color: var(--sub); letter-spacing: 0.08em; }

.gr-name { font-size: 1rem; font-weight: 900; color: var(--ink); text-align: center; }
.gr-reason {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--sub);
  text-align: center;
  max-width: 20rem;
  line-height: 1.6;
}

.gr-next {
  margin-top: 0.25rem;
  padding: 0.5rem 1.75rem;
  border: 0;
  border-radius: 999px;
  background: #1A1A18;
  color: #FFFFFF;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 0.125rem 0.5rem rgba(26, 26, 24, .3);
}
.gr-next:active { transform: scale(.96); }
.gr-busy { font-size: 0.875rem; font-weight: 800; color: var(--sub); }
.gr-error { color: #C0392B; }

@media (prefers-reduced-motion: reduce) {
  .gr-card { animation: none; }
}
</style>
