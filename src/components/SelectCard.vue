<script setup>
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { asset } from '../data/assetPath'
import EnergyDiceModal from './EnergyDiceModal.vue'

const props = defineProps({
  playerKey: { type: String, required: true }
})

const battle = inject('battle')
const online = inject('online')
const { t } = useI18n()
const state = battle.state
const isA = props.playerKey === 'A'
const p = computed(() => state.players[props.playerKey])
const trainerName = computed(() => t(`player.trainer${props.playerKey}`))

// In a room, each side only ever touches their own card — the opponent's card is a read-only
// status readout instead (see opponentStatus below) so nobody can open the other seat's
// pick/move modal from their own screen.
const isMine = computed(() => !online.myKey.value || online.myKey.value === props.playerKey)

const opponentStatus = computed(() => {
  if (p.value.locked) return t('select.opponentLocked')
  if (state.modals[props.playerKey]) return t('select.opponentPicking')
  return t('select.opponentWaiting')
})

function pickChar() {
  if (!isMine.value) return
  battle.openCharSelect(props.playerKey)
}

function reopenMoveSelect() {
  if (!isMine.value) return
  battle.openMoveSelect(props.playerKey, p.value.character)
  state.modals[props.playerKey].tempMoves = [...p.value.moveIds]
}

function startFirst() {
  if (!isMine.value) return
  battle.startBattle(props.playerKey)
}

// Online only: neither side picks who goes first themselves — both mark ready, then
// useOnlineRoom's host-side watcher draws it with FirstPickWheel once both are.
function readyUp() {
  if (!isMine.value) return
  battle.setReadyForFirst(props.playerKey)
}

// Online only: there's no universal fixed energy die (unlike the character die), so each side
// configures their own 3 before "ready" is even offered — every turn's energy throw draws from
// whatever's set here. The editor itself is local-only (see EnergyDiceModal.vue); only the
// confirmed result is synced.
const showEnergyDiceSetup = ref(false)
function openEnergyDiceSetup() {
  if (!isMine.value) return
  showEnergyDiceSetup.value = true
}
function confirmEnergyDice(dice) {
  battle.setEnergyDice(props.playerKey, dice)
  showEnergyDiceSetup.value = false
}
</script>

<template>
  <div class="select-card">
    <div class="select-card-title">{{ trainerName }}</div>

    <div v-if="!isMine" class="select-box opponent-status">
      <div class="opponent-status-label">{{ opponentStatus }}</div>
    </div>
    <div v-else-if="!p.locked" class="select-box pick-btn" @click="pickChar">
      <div class="null-ball-wrap">
        <img :src="asset('image/ICON/モンスターボールNull.png')" class="ball-icon null-ball" alt="">
        <div class="null-ball-label" v-html="t('select.pickPokemon')"></div>
      </div>
    </div>
    <div v-else class="select-box ball-wrap" @click="reopenMoveSelect">
      <div class="null-ball-wrap">
        <img :src="asset(`image/ICON/モンスターボール${playerKey}.png`)" class="ball-icon wiggle" :class="`wiggle-${playerKey}`" alt="モンスターボール">
        <div class="null-ball-label">{{ t('common.selected') }}</div>
      </div>
    </div>
    <template v-if="isMine && p.locked">
      <button
        v-if="online.role.value && !p.energyDice"
        class="btn wide start-first-btn"
        :style="{ background: isA ? 'var(--trainerA-btn)' : 'var(--trainerB-btn)' }"
        @click="openEnergyDiceSetup"
      >{{ t('select.setupEnergyDice') }}</button>
      <template v-else-if="battle.bothLocked()">
        <button
          v-if="!online.role.value"
          class="btn wide start-first-btn"
          :style="{ background: isA ? 'var(--trainerA-btn)' : 'var(--trainerB-btn)' }"
          @click="startFirst"
        >{{ t('select.startFirst') }}</button>
        <template v-else-if="!p.readyForFirst">
          <button
            class="btn wide start-first-btn"
            :style="{ background: isA ? 'var(--trainerA-btn)' : 'var(--trainerB-btn)' }"
            @click="readyUp"
          >{{ t('select.ready') }}</button>
          <button class="edit-energy-dice-link" @click="openEnergyDiceSetup">{{ t('select.editEnergyDice') }}</button>
        </template>
        <div v-else class="ready-waiting-label">{{ t('select.readyWaiting') }}</div>
      </template>
    </template>

    <EnergyDiceModal
      v-if="showEnergyDiceSetup"
      :initial-dice="p.energyDice"
      @close="showEnergyDiceSetup = false"
      @confirm="confirmEnergyDice"
    />
  </div>
</template>
