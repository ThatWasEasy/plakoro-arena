<script setup>
import { useI18n } from 'vue-i18n'

const emit = defineEmits(['pick'])
const { t } = useI18n()

// Adding a mode should never mean re-tuning the layout, so the grid is driven off this list
// rather than hand-written cards.
//
// `enabled: false` hides a mode from the menu while leaving it fully built and reachable in
// code. Deleting the entry instead would leave its component, i18n strings and data loader with
// no visible caller, which is how features quietly rot — this way re-enabling is one word.
const MODES = [
  { key: 'duel', icon: '⚔️' },
  { key: 'solo', icon: '🗼' },
  { key: 'diceBuilder', icon: '🎲' },
  { key: 'storeInfo', icon: '🗺️' },
  // Hidden 2026-08-28: the market data behind it isn't maintainable by hand yet — most listing
  // sources need a login to snapshot, so the figures would go stale without anyone noticing.
  { key: 'priceLog', icon: '💰', enabled: false },
  { key: 'tournament', icon: '📋' },
  { key: 'tierList', icon: '📊' }
]

const VISIBLE_MODES = MODES.filter(m => m.enabled !== false)
</script>

<template>
  <div class="board select-board mode-select">
    <!-- Wrapping rows rather than one tall column: a single column divides the fixed stage
         height by however many modes there are, so each new one shrinks every card until they
         stop fitting (which is exactly what happened at five). Wrapping adds a row instead, so
         the cards keep a workable size no matter how many there are. -->
    <div class="mode-grid">
      <button
        v-for="m in VISIBLE_MODES"
        :key="m.key"
        class="select-card mode-card"
        @click="emit('pick', m.key)"
      >
        <span class="select-card-title mode-card-title">{{ t('mode.' + m.key) }}</span>
        <span class="select-box mode-card-icon">{{ m.icon }}</span>
      </button>
    </div>

    <!-- Attribution sits on the mode select rather than inside each mode: it's the one screen
         every player passes through, and the play screens have no spare room for it. -->
    <div class="select-credit">
      <div>{{ t('credit.sources') }}</div>
      <div>{{ t('credit.rights') }}</div>
    </div>
  </div>
</template>

<style scoped>
.mode-select {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.mode-grid {
  flex: 1;
  /* Without this the grid refuses to shrink below its content and overflows the stage — the
     same flex default (min-height:auto) that broke the single-column version. */
  min-height: 0;
  width: 100%;
  max-width: 26rem;
  display: flex;
  flex-wrap: wrap;
  align-content: center;
  justify-content: center;
  gap: 0.5rem;
}

.mode-card {
  /* Two per row: basis is half the track minus its share of the gap, and the matching max-width
     stops a lone card on the last row from stretching to full width. */
  flex: 1 1 calc(50% - 0.25rem);
  max-width: calc(50% - 0.25rem);
  min-width: 0;
  min-height: 0;
  /* Caps the row height so three rows always clear the stage, while flex-basis still lets the
     cards breathe when there are fewer of them. */
  max-height: 5.5rem;
  padding: 0.5rem;
  gap: 0.25rem;
  overflow: hidden;
  cursor: pointer;
  border: none;
  font-family: inherit;
}
.mode-card:active { transform: scale(.97); }

.mode-card-title {
  font-size: 0.8125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.mode-card-icon {
  font-size: 1.5rem;
  /* Inherited from .select-box, but restated so the icon block can shrink with the card. */
  min-height: 0;
}
</style>
