<script setup>
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../../data/constants'
import { scaleMoveForFloor } from '../../game/aiOpponent'
import MoveCard from '../MoveCard.vue'

const solo = inject('solo')
const { moves } = inject('characterData')
const { t } = useI18n()
const state = solo.state

const player = computed(() => state.player)
const ai = computed(() => state.ai)

// SPECIAL_PICK_ENEMY_WAZA: on the AI's turn after the player cast it, this same screen shows the
// AI's moves and the player picks one for it (see aiTakeTurn). The AI's cards are shown at the
// floor's scaled strength, which is what they'll actually hit for.
const pickingForAi = computed(() => state.turn === 'ai')
const owner = computed(() => pickingForAi.value ? ai.value : player.value)
const target = computed(() => pickingForAi.value ? player.value : ai.value)

// Straight from availableMoveIds — no fallback that quietly re-enables a sealed move. When
// this comes back empty the player really has no legal move, and the skip button below is
// how the turn advances.
const available = computed(() => pickingForAi.value ? solo.aiPickableMoveIds() : solo.availableMoveIds('player'))
const noMoveAvailable = computed(() => !pickingForAi.value && available.value.length === 0)

const rows = computed(() => owner.value.moveIds.map(mid => {
  const raw = moves.value[mid]
  const mv = pickingForAi.value && ai.value.multiplier ? scaleMoveForFloor(raw, ai.value.multiplier) : raw
  const disabled = !available.value.includes(mid)
  const baseDmgInfo = solo.computeDisplayDamage(mv, owner.value, target.value)
  const atk = owner.value.atkBonus || 0
  // Show as "XX(+YY)" so the player can see their attack bonus is applied on top of
  // the move's own number, matching how resolveTurn actually adds atkBonus at cast time.
  const dmgInfo = atk > 0 ? { ...baseDmgInfo, display: `${baseDmgInfo.display}(+${atk})` } : baseDmgInfo
  const isBanned = (owner.value.committedBannedMoveIds || []).includes(mid)
  // Same labels as duel mode's MovesGrid — a disabled card has to say why it's disabled,
  // otherwise it reads as the app being broken.
  const disableBadge = disabled
    ? (isBanned
      ? { kind: 'bind', label: owner.value.committedBannedMoveSourceName || t('moveCard.unusable') }
      : { kind: 'lastused', label: t('moveCard.usedLastTurn') })
    : null
  return { mid, mv, disabled, dmgInfo, disableBadge }
}))

function pick(mid) {
  solo.pickMove(mid)
}
</script>

<template>
  <div class="move-select-panel" :style="{ background: typeBgColor(owner.character.type), boxShadow: 'none', height: '80%', borderRadius: pickingForAi ? '1.125rem 0 0 0' : '0 1.125rem 0 0' }">
    <div v-if="pickingForAi" style="flex-shrink:0; padding:0.375rem 0.5rem 0.125rem; font-size:0.6875rem; font-weight:800; color:var(--ink); line-height:1.4;">
      {{ t('moveSelect.pickForOpponent', { source: ai.movePickedByOpponent.sourceName }) }}
    </div>
    <div v-if="noMoveAvailable" style="display:flex; align-items:center; justify-content:space-between; gap:0.625rem; flex-shrink:0; padding:0.375rem 0.5rem 0.125rem;">
      <div style="font-size:0.6875rem; font-weight:800; color:var(--ink); line-height:1.4; min-width:0;">{{ t('solo.playerSkip.notice') }}</div>
      <button class="btn" style="flex-shrink:0; padding:0.4375rem 0.75rem; font-size:0.8125rem;" @click="solo.skipPlayerTurn()">{{ t('solo.playerSkip.button') }}</button>
    </div>
    <div class="ms-grid">
      <div v-for="row in rows" :key="row.mid" style="position:relative; display:flex; min-height:0; min-width:0;">
        <MoveCard
          :mv="row.mv"
          :dmg-info="row.dmgInfo"
          :owner="owner"
          :opponent="target"
          :disabled="row.disabled"
          :disable-badge="row.disableBadge"
          style="flex:1 1 auto; min-height:0; width:100%;"
          @pick="pick"
        />
      </div>
    </div>
  </div>
</template>
