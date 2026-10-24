<script setup>
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../data/constants'
import { isCharaColorConditionMet } from '../game/damage'
import { charaDiceOrientationAllowed } from '../game/effectQueue'
import { faceTypes } from '../game/diceParts'
import { canPayCost } from '../game/energyPayment'
import { asset } from '../data/assetPath'

// Same treatment as the price-log chart and the 3D dice tray elsewhere: Three.js/cannon-es
// only get downloaded when a turn actually needs the character-die throw (online mode).
const DiceRoll3DCanvas = defineAsyncComponent(() => import('./dice/DiceRoll3DCanvas.vue'))

const battle = inject('battle')
const online = inject('online')
const { moves } = inject('characterData')
const { t } = useI18n()
const state = battle.state

const mv = computed(() => moves.value[state.selectedMove])
const p = computed(() => state.players[state.turnPlayer])
const opp = computed(() => state.players[battle.opponentKey(state.turnPlayer)])
const dmgInfo = computed(() => battle.computeDisplayDamage(mv.value, p.value, opp.value))
const isFirstTurn = computed(() => state.turnCount === 0)
const energyCount = computed(() => Math.max(0, (isFirstTurn.value ? 2 : 3) + (p.value.diceMod || 0)))
const hasChara = computed(() => mv.value.chara && mv.value.chara.length > 0 && !p.value.charaDiceBlocked)

// Online only: whoever's turn it is throws their own configured energy dice (see
// EnergyDiceModal.vue) plus the (real, fixed 6-face) character die together in 3D. Both the
// character-die face and whether the roll actually pays this move's cost are real physics
// results now, not self-reported — see onDiceRolled(). The opponent never runs their own
// physics: once state.diceTransforms syncs, their canvas replays the exact same final dice
// pose (see playOpponentReplay()), so both screens show the identical result.
const isMyTurn = computed(() => !online.myKey.value || online.myKey.value === state.turnPlayer)
const needsThrow = computed(() => !!online.role.value && !state.charaDieFace)
const rolling = ref(false)
const diceCanvasRef = ref(null)
const oppDiceCanvasRef = ref(null)

// Local only, mover's own client: the settled roll stays pinned on screen behind a "確定" button
// instead of falling straight through to the success/fail/chara button list — the transition was
// fast enough that the actual dice result (energy types + chara face) was easy to miss entirely.
// Purely a pacing gate, so it doesn't need to sync — the opponent already has their own separate
// "對方判定招式中/已擲出" status text for the same wait.
const resultAcked = ref(false)
const awaitingAck = computed(() => !!online.role.value && !!state.charaDieFace && !resultAcked.value)

function waitForCanvas(canvasRef) {
  if (canvasRef.value) return Promise.resolve()
  return new Promise(resolve => {
    const stop = watch(canvasRef, value => { if (value) { stop(); resolve() } })
  })
}

// Which of the mover's 3 configured energy dice get thrown this turn (cycling if energyCount
// differs from 3) is fully determined by public state (turnCount/diceMod), so both sides derive
// the identical list independently — nothing extra needs to sync for this part.
function diceForThrow(energyDiceConfig) {
  return Array.from({ length: energyCount.value }, (_, i) => energyDiceConfig[i % energyDiceConfig.length])
}

async function buildThrowFaces(energyDiceConfig) {
  const { buildCharaDieFaces, buildEnergyDieFaces } = await import('../game/diceTextures')
  const rollDice = diceForThrow(energyDiceConfig)
  const energyFaces = await Promise.all(rollDice.map(buildEnergyDieFaces))
  const charaFaces = await buildCharaDieFaces()
  return { rollDice, faces: [...energyFaces, charaFaces] }
}

let lastRollDice = []

async function throwDice() {
  if (rolling.value || !diceCanvasRef.value) return
  resultAcked.value = false
  rolling.value = true
  try {
    const { rollDice, faces } = await buildThrowFaces(p.value.energyDice)
    lastRollDice = rollDice
    await diceCanvasRef.value.setDice(faces)
  } finally {
    rolling.value = false
  }
}

function onDiceRolled(results, transforms) {
  const charaFace = results[results.length - 1]
  const energyResults = results.slice(0, -1)
  // Kept per die as well as flat: an opponent's REROLL_DICE_ENEMY swaps out single dice.
  const perDie = energyResults.map((faceKey, i) => faceTypes(lastRollDice[i], faceKey))
  const rolledTypes = perDie.flat()
  const success = canPayCost(rolledTypes, mv.value.cost)
  battle.setDiceRollResult(charaFace, rolledTypes, success, transforms, perDie)
}

// Online only, opponent's side: replays the mover's exact throw (same dice, same final pose) —
// see the module doc comment above.
async function playOpponentReplay(transforms) {
  await waitForCanvas(oppDiceCanvasRef)
  const { faces } = await buildThrowFaces(p.value.energyDice)
  oppDiceCanvasRef.value?.replay(faces, transforms)
}
watch(() => state.diceTransforms, transforms => {
  if (isMyTurn.value || !transforms) return
  playOpponentReplay(transforms)
}, { immediate: true })

const diceModBadges = computed(() => {
  const badges = []
  if (isFirstTurn.value) badges.push({ label: t('dice.firstTurnBadge'), firstTurn: true })
  ;(p.value.diceModBadges || []).forEach(b => badges.push({ label: b.name, color: typeBgColor(b.type) }))
  return badges
})

const energyIcons = computed(() => Array.from({ length: energyCount.value }, (_, i) => (i % 6) + 1))

const successDmgClass = computed(() => {
  const m = dmgInfo.value.mode
  return m === 'weak' ? 'weak' : m === 'up' ? 'up' : m === 'down' ? 'down' : ''
})

// Online only: whether the actual rolled energy types can pay this move's cost (see
// onDiceRolled()) — null before the throw, so these stay permissive until then (the whole
// button row is hidden behind needsThrow at that point anyway).
const canSucceed = computed(() => !online.role.value || state.energySuccess !== false)
const canFail = computed(() => !online.role.value || state.energySuccess !== true)

// A pinned character die (FIX_CHARADICE_*) leaves only the rows covering the pinned
// orientations selectable, unlike charaDiceBlocked which disables the lot.
function charaAvailable(ce) {
  if (!hasChara.value || !charaDiceOrientationAllowed(ce.orientations, p.value.fixCharaDice)) return false
  if (online.role.value && state.charaDieFace && !ce.orientations.includes(state.charaDieFace)) return false
  if (!canSucceed.value) return false
  return true
}

// Online only: disabled either because the energy roll didn't pay the cost, or because the
// character die landed on a face matching one of this move's chara conditions — physically
// that effect must apply, so "success with no chara bonus" stops being a real outcome this turn.
const successOnlyDisabled = computed(() => {
  if (!canSucceed.value) return true
  return !!online.role.value && !!state.charaDieFace && (mv.value.chara || []).some(charaAvailable)
})

function charaHighlighted(ce) {
  if (!charaAvailable(ce)) return false
  return isCharaColorConditionMet(ce.type, p.value, opp.value)
}

function pickSuccessOnly() {
  if (successOnlyDisabled.value) return
  battle.resolveTurn({ kind: 'success', dmgInfo: dmgInfo.value })
}
function pickChara(ce) {
  if (!charaAvailable(ce)) return
  battle.resolveTurn({ kind: 'chara', ce, dmgInfo: dmgInfo.value })
}
function pickFail() {
  if (!canFail.value) return
  battle.resolveTurn({ kind: 'fail' })
}
function goBack() {
  battle.backToMoveSelect()
}

// SPECIAL_PICK_ENEMY_WAZA: the opponent chose this move, so going back to swap it is closed.
const backLocked = computed(() => state.repeatActive || !!p.value.movePickedByOpponent)

// REROLL_CHARADICE_SELF, online only: offered on the settled result, before it's confirmed,
// since that's the one point where the player has seen the face and not yet committed to it.
const canRerollChara = computed(() => !!online.role.value && hasChara.value && p.value.charaRerolls > 0 && !!state.charaDieFace)
function rerollChara() {
  battle.rerollCharaDie()
}
</script>

<template>
  <div class="dice-overlay">
    <template v-if="!isMyTurn">
    <div class="dr-top-row">
      <div
        class="dr-move-card"
        :style="{ backgroundColor: typeBgColor(mv.type), backgroundImage: `url('${asset(`image/BACK/back_${mv.type}.png`)}')` }"
      >
        <div class="dr-cost-row">
          <div v-for="(costType, i) in mv.cost" :key="i" class="cost-dot"><img :src="asset(`image/ICON/${costType}.png`)" class="img-icon" :alt="costType"></div>
        </div>
        <div class="dr-move-name mc-name-big">{{ mv.name }}</div>
      </div>
      <div class="dr-roll-line">
        <template v-if="hasChara">
          <div class="dr-inline-icon big"><img :src="asset('image/ICON/キャラコロ.png')" class="img-icon" alt="キャラコロ"></div>
          <span v-if="energyCount > 0" class="dr-flow-word">{{ t('common.and') }}</span>
        </template>
        <div v-if="energyCount > 0" class="dr-energy-icons one-row">
          <div v-for="(num, i) in energyIcons" :key="i" class="dr-inline-icon big"><img :src="asset(`image/ICON/エネコロ${num}.png`)" class="img-icon" alt="エネコロ"></div>
        </div>
        <span class="dr-flow-word">{{ t('dice.rollSuffix') }}</span>
      </div>
    </div>
    <div class="dr-result-cols">
      <div class="dr-success-col" :style="{ background: typeBgColor(mv.type) }">
        <div class="dr-col-header dr-header-success">{{ t('dice.moveSuccess') }} <span class="arrow">▶</span> <span class="hl">{{ t('dice.charaDiceCheck') }}</span></div>
        <div class="dr-btn-list">
          <div class="dr-success-only-btn dr-readonly" :class="{ 'success-disabled': successOnlyDisabled }">
            <div class="dr-success-only-left">
              <div class="dr-type-icon"><img :src="asset(`image/ICON/${mv.type}.png`)" class="img-icon" :alt="mv.type"></div>
              <div class="dr-chara-btn-text">{{ t('dice.successOnly') }}</div>
            </div>
            <div class="mc-dmg dr-success-only-dmg" :class="successDmgClass">{{ dmgInfo.display }}</div>
          </div>
          <div
            v-for="(ce, i) in mv.chara"
            :key="i"
            class="dr-chara-btn dr-readonly"
            :class="{ 'chara-unavailable': !charaAvailable(ce) }"
          >
            <div class="dr-chara-btn-icons">
              <div v-for="(ori, j) in ce.orientations" :key="j" class="oi"><img :src="asset(`image/ICON/${ori}.png`)" class="img-icon" :alt="ori"></div>
            </div>
            <div class="dr-chara-btn-text" :style="charaHighlighted(ce) ? 'color:#F5F842;' : ''">{{ ce.text }}</div>
          </div>
        </div>
      </div>
      <div class="dr-right-col">
        <div class="dr-throw-gate">
          <div class="dr-throw-canvas compact"><DiceRoll3DCanvas ref="oppDiceCanvasRef" /></div>
          <div class="dr-opponent-status">
            <template v-if="state.charaDieFace">
              <div class="dr-opponent-result-icons">
                <div v-for="(ty, i) in state.energyRolledTypes" :key="i" class="dr-inline-icon half"><img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty"></div>
                <div class="dr-inline-icon half"><img :src="asset(`image/ICON/${state.charaDieFace}.png`)" class="img-icon" :alt="state.charaDieFace"></div>
              </div>
              <span>{{ t('dice.opponentRolled') }}</span>
            </template>
            <span v-else>{{ t('dice.opponentResolving') }}</span>
          </div>
        </div>
      </div>
    </div>
    </template>
    <template v-else>
    <div class="dr-top-row">
      <div
        class="dr-move-card"
        :style="{ backgroundColor: typeBgColor(mv.type), backgroundImage: `url('${asset(`image/BACK/back_${mv.type}.png`)}')` }"
      >
        <div class="dr-cost-row">
          <div v-for="(costType, i) in mv.cost" :key="i" class="cost-dot"><img :src="asset(`image/ICON/${costType}.png`)" class="img-icon" :alt="costType"></div>
        </div>
        <div class="dr-move-name mc-name-big">{{ mv.name }}</div>
      </div>
      <div class="dr-roll-line">
        <div v-if="diceModBadges.length > 0" class="dice-mod-badges">
          <div
            v-for="(b, i) in diceModBadges"
            :key="i"
            class="dice-mod-badge"
            :class="{ 'first-turn': b.firstTurn }"
            :style="b.firstTurn ? '' : { background: b.color }"
          >{{ b.label }}</div>
        </div>
        <template v-if="hasChara">
          <div class="dr-inline-icon big"><img :src="asset('image/ICON/キャラコロ.png')" class="img-icon" alt="キャラコロ"></div>
          <span v-if="energyCount > 0" class="dr-flow-word">{{ t('common.and') }}</span>
        </template>
        <div v-if="energyCount > 0" class="dr-energy-icons one-row">
          <div v-for="(num, i) in energyIcons" :key="i" class="dr-inline-icon big"><img :src="asset(`image/ICON/エネコロ${num}.png`)" class="img-icon" alt="エネコロ"></div>
        </div>
        <span class="dr-flow-word">{{ t('dice.rollSuffix') }}</span>
      </div>
    </div>
    <div v-if="needsThrow || awaitingAck" class="dr-throw-gate">
      <div class="dr-throw-canvas"><DiceRoll3DCanvas ref="diceCanvasRef" @rolled="onDiceRolled" /></div>
      <button v-if="needsThrow" class="btn wide" :disabled="rolling" :style="rolling ? 'opacity:.6;' : ''" @click="throwDice">{{ t('dice.throwCharaDie') }}</button>
      <div v-else class="dr-result-ack">
        <div class="dr-opponent-result-icons">
          <div v-for="(ty, i) in state.energyRolledTypes" :key="i" class="dr-inline-icon half"><img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty"></div>
          <div v-if="hasChara" class="dr-inline-icon half"><img :src="asset(`image/ICON/${state.charaDieFace}.png`)" class="img-icon" :alt="state.charaDieFace"></div>
        </div>
        <div class="dr-result-ack-label" :class="state.energySuccess ? 'succ' : 'fail'">{{ state.energySuccess ? t('common.success') : t('common.fail') }}</div>
        <button v-if="canRerollChara" class="btn wide" @click="rerollChara">{{ t('dice.rerollCharaDie', { n: p.charaRerolls }) }}</button>
        <button class="btn wide" @click="resultAcked = true">{{ t('common.confirm') }}</button>
      </div>
    </div>
    <div v-else class="dr-result-cols">
      <div class="dr-success-col" :style="{ background: typeBgColor(mv.type) }">
        <div class="dr-col-header dr-header-success">{{ t('dice.moveSuccess') }} <span class="arrow">▶</span> <span class="hl">{{ t('dice.charaDiceCheck') }}</span></div>
        <div class="dr-btn-list">
          <button class="dr-success-only-btn" :disabled="successOnlyDisabled" :class="{ 'success-disabled': successOnlyDisabled }" @click="pickSuccessOnly">
            <div class="dr-success-only-left">
              <div class="dr-type-icon"><img :src="asset(`image/ICON/${mv.type}.png`)" class="img-icon" :alt="mv.type"></div>
              <div class="dr-chara-btn-text">{{ t('dice.successOnly') }}</div>
            </div>
            <div class="mc-dmg dr-success-only-dmg" :class="successDmgClass">{{ dmgInfo.display }}</div>
          </button>
          <button
            v-for="(ce, i) in mv.chara"
            :key="i"
            class="dr-chara-btn"
            :class="{ 'chara-unavailable': !charaAvailable(ce) }"
            :disabled="!charaAvailable(ce)"
            @click="pickChara(ce)"
          >
            <div class="dr-chara-btn-icons">
              <div v-for="(ori, j) in ce.orientations" :key="j" class="oi"><img :src="asset(`image/ICON/${ori}.png`)" class="img-icon" :alt="ori"></div>
            </div>
            <div class="dr-chara-btn-text" :style="charaHighlighted(ce) ? 'color:#F5F842;' : ''">{{ ce.text }}</div>
          </button>
        </div>
      </div>
      <div class="dr-right-col">
        <div class="dr-fail-box">
          <div class="dr-col-header dr-header-fail">{{ t('dice.energyShortage') }}</div>
          <button class="dr-fail-btn" :disabled="!canFail" :class="{ 'success-disabled': !canFail }" @click="pickFail">{{ t('dice.moveFail') }}</button>
        </div>
        <div class="dr-back-box">
          <button
            class="dr-back-btn"
            :disabled="backLocked"
            :style="backLocked ? 'opacity:.35; pointer-events:none;' : ''"
            @click="goBack"
          >{{ t('common.back') }}</button>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>
