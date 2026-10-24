<script setup>
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../data/constants'
import { asset } from '../data/assetPath'

// Online only (see useBattleState.js's showTurnResultConfirm()): the side that just took the hit
// reviews the damage + the mover's real dice result and taps through before the turn actually
// hands off — otherwise the screen could flip straight to their own move-select before they'd
// had a chance to see what happened.
const battle = inject('battle')
const online = inject('online')
const { t } = useI18n()
const state = battle.state
const tr = computed(() => state.turnResult)
const isReceiver = computed(() => !online.myKey.value || online.myKey.value === tr.value.oppKey)
</script>

<template>
  <div class="overlay full">
    <div class="overlay-title">{{ t('turnResult.title') }}</div>
    <div class="tr-card" :style="{ background: typeBgColor(tr.mvType) }">
      <div class="tr-move-row">
        <div class="dr-type-icon"><img :src="asset(`image/ICON/${tr.mvType}.png`)" class="img-icon" :alt="tr.mvType"></div>
        <div class="tr-move-name">{{ tr.mvName }}</div>
      </div>
      <div class="tr-dmg">-{{ tr.dmgToOpp }}</div>
      <div v-if="state.charaDieFace" class="dr-opponent-result-icons">
        <div v-for="(ty, i) in state.energyRolledTypes" :key="i" class="dr-inline-icon half"><img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty"></div>
        <div class="dr-inline-icon half"><img :src="asset(`image/ICON/${state.charaDieFace}.png`)" class="img-icon" :alt="state.charaDieFace"></div>
      </div>
    </div>
    <button v-if="isReceiver" class="btn wide" style="max-width:16rem;" @click="battle.confirmTurnResult()">{{ t('common.confirm') }}</button>
    <div v-else class="overlay-sub">{{ t('turnResult.waiting') }}</div>
  </div>
</template>
