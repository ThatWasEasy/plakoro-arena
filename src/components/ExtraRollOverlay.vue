<script setup>
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { faceTypes } from '../game/diceParts'
import { asset } from '../data/assetPath'

// Online only: real synced throws for the handful of effects that need one more die read after
// the main throw — either the mover's own character die again (state.charaThrowTask, self
// target) or the opponent's own die/energy dice (state.charaThrowTask / state.energyThrowTask,
// enemy target) — see the hook functions in useBattleState.js for exactly which effect maps to
// which. Whoever owns `rollerKey` runs the real physics and reports the result; the other side
// just replays the identical transforms, same as the main DiceOverlay throw.
const DiceRoll3DCanvas = defineAsyncComponent(() => import('./dice/DiceRoll3DCanvas.vue'))

const battle = inject('battle')
const online = inject('online')
const { t } = useI18n()
const state = battle.state

const charaTask = computed(() => state.charaThrowTask)
const energyTask = computed(() => state.energyThrowTask)
const rollerKey = computed(() => (charaTask.value || energyTask.value)?.rollerKey)
const isRoller = computed(() => !online.myKey.value || online.myKey.value === rollerKey.value)

const rolling = ref(false)
const canvasRef = ref(null)
let lastEnergyDice = []

function waitForCanvas() {
  if (canvasRef.value) return Promise.resolve()
  return new Promise(resolve => {
    const stop = watch(canvasRef, value => { if (value) { stop(); resolve() } })
  })
}

async function throwChara() {
  if (rolling.value || !canvasRef.value) return
  rolling.value = true
  try {
    const { buildCharaDieFaces } = await import('../game/diceTextures')
    const faces = await buildCharaDieFaces()
    await canvasRef.value.setDice([faces])
  } finally {
    rolling.value = false
  }
}
function onCharaRolled(results, transforms) {
  battle.submitCharaThrowResult(results[0], transforms)
}

function energyDiceForTask(task) {
  const config = state.players[task.rollerKey].energyDice
  return Array.from({ length: task.n }, (_, i) => config[i % config.length])
}

async function throwEnergy() {
  if (rolling.value || !canvasRef.value || !energyTask.value) return
  rolling.value = true
  try {
    const { buildEnergyDieFaces } = await import('../game/diceTextures')
    const dice = energyDiceForTask(energyTask.value)
    lastEnergyDice = dice
    const faces = await Promise.all(dice.map(buildEnergyDieFaces))
    await canvasRef.value.setDice(faces)
  } finally {
    rolling.value = false
  }
}
function onEnergyRolled(results, transforms) {
  const rolledTypes = results.flatMap((faceKey, i) => faceTypes(lastEnergyDice[i], faceKey))
  battle.submitEnergyThrowResult(rolledTypes, transforms)
}

// Non-roller side: replay whichever task's transforms just synced in, using the same
// deterministically-derived faces (both sides compute them the same way from public state).
async function replayChara(transforms) {
  await waitForCanvas()
  const { buildCharaDieFaces } = await import('../game/diceTextures')
  const faces = await buildCharaDieFaces()
  canvasRef.value?.replay([faces], transforms)
}
async function replayEnergy(transforms, task) {
  await waitForCanvas()
  const { buildEnergyDieFaces } = await import('../game/diceTextures')
  const dice = energyDiceForTask(task)
  const faces = await Promise.all(dice.map(buildEnergyDieFaces))
  canvasRef.value?.replay(faces, transforms)
}
watch(() => charaTask.value?.transforms, transforms => {
  if (isRoller.value || !transforms) return
  replayChara(transforms)
})
watch(() => energyTask.value?.transforms, transforms => {
  if (isRoller.value || !transforms || !energyTask.value) return
  replayEnergy(transforms, energyTask.value)
})
</script>

<template>
  <div class="overlay full">
    <template v-if="charaTask">
      <div class="overlay-title">{{ isRoller ? t('diceTask.charaYourTurn') : t('diceTask.charaWaiting') }}</div>
      <div class="overlay-sub">
        {{ t('diceTask.charaOrientationHint') }}
        <span v-for="(ori, i) in charaTask.orientations" :key="i" class="dr-inline-icon half" style="display:inline-block; vertical-align:-0.3em; margin:0 0.0625rem;"><img :src="asset(`image/ICON/${ori}.png`)" class="img-icon" :alt="ori"></span>
      </div>
      <div v-if="charaTask.mode === 'count'" class="overlay-sub">{{ t('diceTask.charaProgressCount', { count: charaTask.successCount, remaining: charaTask.targetN }) }}</div>
      <div v-else-if="charaTask.mode === 'repeat'" class="overlay-sub">{{ t('diceTask.charaProgressRepeat', { count: charaTask.successCount }) }}</div>
      <div class="dr-throw-gate">
        <div class="dr-throw-canvas"><DiceRoll3DCanvas ref="canvasRef" @rolled="onCharaRolled" /></div>
        <button v-if="isRoller" class="btn wide" :disabled="rolling" :style="rolling ? 'opacity:.6;' : ''" @click="throwChara">{{ t('diceTask.throwAgain') }}</button>
      </div>
    </template>
    <template v-else-if="energyTask">
      <div class="overlay-title">{{ isRoller ? t('diceTask.energyYourTurn', { n: energyTask.n }) : t('diceTask.energyWaiting', { n: energyTask.n }) }}</div>
      <div class="dr-throw-gate">
        <div class="dr-throw-canvas"><DiceRoll3DCanvas ref="canvasRef" @rolled="onEnergyRolled" /></div>
        <button v-if="isRoller" class="btn wide" :disabled="rolling" :style="rolling ? 'opacity:.6;' : ''" @click="throwEnergy">{{ t('dice.throwCharaDie') }}</button>
      </div>
    </template>
  </div>
</template>
