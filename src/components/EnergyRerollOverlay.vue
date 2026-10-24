<script setup>
import { computed, defineAsyncComponent, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { faceTypes } from '../game/diceParts'
import ChipIcon from './dice/ChipIcon.vue'

// Online only: REROLL_DICE_ENEMY (ほりかえす / ジュエルフラッシュ). The mover's throw has
// settled; the side that cast the effect picks which of those energy dice get thrown again,
// then the mover's own client re-throws just those — same "roller runs the physics" split as
// ExtraRollOverlay. See beginEnergyRerollTask() in useBattleState.js.
const DiceRoll3DCanvas = defineAsyncComponent(() => import('./dice/DiceRoll3DCanvas.vue'))

const battle = inject('battle')
const online = inject('online')
const { t } = useI18n()
const state = battle.state

const task = computed(() => state.energyRerollTask)
const isPicker = computed(() => !online.myKey.value || online.myKey.value === task.value.pickerKey)
const isRoller = computed(() => !online.myKey.value || online.myKey.value === task.value.rollerKey)
const rolledDice = computed(() => state.energyRolledDice || [])

const rolling = ref(false)
const canvasRef = ref(null)
let thrownDice = []

function togglePick(i) {
  if (!isPicker.value) return
  battle.toggleEnergyRerollPick(i)
}
function confirmPick() {
  battle.confirmEnergyRerollPick()
}

async function throwPicked() {
  if (rolling.value || !canvasRef.value) return
  rolling.value = true
  try {
    const { buildEnergyDieFaces } = await import('../game/diceTextures')
    thrownDice = task.value.picked.map(i => task.value.dice[i])
    const faces = await Promise.all(thrownDice.map(buildEnergyDieFaces))
    await canvasRef.value.setDice(faces)
  } finally {
    rolling.value = false
  }
}
function onRolled(results, transforms) {
  const perDie = results.map((faceKey, i) => faceTypes(thrownDice[i], faceKey))
  battle.submitEnergyRerollResult(perDie, transforms)
}
</script>

<template>
  <div class="overlay full">
    <template v-if="task.stage === 'pick'">
      <div class="overlay-title">{{ isPicker ? t('diceTask.energyRerollPick', { n: task.count }) : t('diceTask.energyRerollPickWaiting') }}</div>
      <div style="display:flex; gap:0.625rem; flex-wrap:wrap; justify-content:center; margin-top:0.75rem;">
        <button
          v-for="(types, i) in rolledDice"
          :key="i"
          class="select-card"
          :disabled="!isPicker"
          :style="{ padding:'0.5rem', outline: task.picked.includes(i) ? '0.1875rem solid var(--ink)' : 'none', opacity: isPicker || task.picked.includes(i) ? 1 : .6 }"
          @click="togglePick(i)"
        >
          <ChipIcon :types="types" :size="2.5" />
        </button>
      </div>
      <button v-if="isPicker" class="btn wide" style="margin-top:0.875rem;" @click="confirmPick">
        {{ task.picked.length > 0 ? t('diceTask.energyRerollConfirm', { n: task.picked.length }) : t('diceTask.energyRerollSkip') }}
      </button>
    </template>
    <template v-else>
      <div class="overlay-title">{{ isRoller ? t('diceTask.energyYourTurn', { n: task.picked.length }) : t('diceTask.energyWaiting', { n: task.picked.length }) }}</div>
      <div class="dr-throw-gate">
        <div class="dr-throw-canvas"><DiceRoll3DCanvas ref="canvasRef" @rolled="onRolled" /></div>
        <button v-if="isRoller" class="btn wide" :disabled="rolling" :style="rolling ? 'opacity:.6;' : ''" @click="throwPicked">{{ t('dice.throwCharaDie') }}</button>
      </div>
    </template>
  </div>
</template>
