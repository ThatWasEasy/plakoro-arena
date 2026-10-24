<script setup>
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../data/constants'
import MovesGrid from './MovesGrid.vue'

const props = defineProps({
  resolvePhase: { type: Boolean, default: false }
})

const battle = inject('battle')
const online = inject('online')
const { moves } = inject('characterData')
const { t } = useI18n()
const state = battle.state

const p = computed(() => state.players[state.turnPlayer])
const opp = computed(() => state.players[battle.opponentKey(state.turnPlayer)])

// Online only: while actually picking (not resolvePhase, which just shows the already-picked
// move to both sides afterward), the opponent only learns that a choice is being made, not
// which moves are on the table.
const isMyTurn = computed(() => !online.myKey.value || online.myKey.value === state.turnPlayer)

// SPECIAL_PICK_ENEMY_WAZA: the opponent picks this turn's move, so online the grid belongs to
// their client and the mover only sees a waiting line. Hotseat shares one screen, so the grid
// stays live and a notice says whose hand should be on it.
const pickedBy = computed(() => p.value.movePickedByOpponent)
const isPicker = computed(() => {
  if (!online.myKey.value) return true
  return pickedBy.value ? online.myKey.value !== state.turnPlayer : isMyTurn.value
})

const panelStyle = computed(() => ({
  background: typeBgColor(p.value.character.type),
  boxShadow: 'none',
  height: '80%',
  borderRadius: state.turnPlayer === 'A' ? '0 1.125rem 0 0' : '1.125rem 0 0 0'
}))

function onPick(mid) {
  battle.pickMove(mid)
}
</script>

<template>
  <div class="move-select-panel" :class="{ 'resolve-panel': resolvePhase }" :style="panelStyle">
    <div v-if="!resolvePhase && !isPicker" class="move-select-status">{{ pickedBy ? t('moveSelect.opponentPickingForYou', { source: pickedBy.sourceName }) : t('moveSelect.opponentThinking') }}</div>
    <template v-else>
      <div v-if="!resolvePhase && pickedBy" style="flex-shrink:0; padding:0.375rem 0.5rem 0.125rem; font-size:0.6875rem; font-weight:800; color:var(--ink); line-height:1.4;">{{ t('moveSelect.pickForOpponent', { source: pickedBy.sourceName }) }}</div>
      <MovesGrid :player="p" :opponent="opp" :moves-map="moves" :interactive="!resolvePhase" @pick="onPick" />
    </template>
  </div>
</template>
