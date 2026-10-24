<script setup>
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../../data/constants'
import { isCharaColorConditionMet } from '../../game/damage'
import { charaDiceOrientationAllowed } from '../../game/effectQueue'
import { asset } from '../../data/assetPath'

const solo = inject('solo')
const { t } = useI18n()
const state = solo.state

const mv = computed(() => solo.moveForTurn())
const mover = computed(() => state[state.turn])
const opp = computed(() => state[solo.opponentOf(state.turn)])
const dmgInfo = computed(() => {
  const base = solo.computeDisplayDamage(mv.value, mover.value, opp.value)
  const atk = mover.value.atkBonus || 0
  // Same "XX(+YY)" format as the move-select screen, so the attack bonus stays visible
  // all the way through to the character-die check step.
  return atk > 0 ? { ...base, display: `${base.display}(+${atk})` } : base
})
const hasChara = computed(() => mv.value.chara && mv.value.chara.length > 0 && !mover.value.charaDiceBlocked)

// The opponent's move cost is only ever checked by total count (see chooseFail's doc
// comment), never by energy type — showing the real types would wrongly imply the
// player needs to roll that specific type for the AI, so we show colorless pips instead.
const displayCost = computed(() => {
  if (state.turn !== 'ai') return mv.value.cost
  return mv.value.cost.map(() => '無色')
})

// Same reasoning for the success-only button's type icon in the character-die check
// panel — it's not something the player rolls for, so keep it colorless for the AI too.
const displayType = computed(() => state.turn === 'ai' ? '無色' : mv.value.type)

// Same badges duel mode's DiceOverlay shows: the moves whose effects shape this throw. Solo dice
// are physical, so for REROLL_DICE_ENEMY / REROLL_CHARADICE_SELF this badge is the whole
// effect — it's what tells the player a reroll is owed at the table.
const diceModBadges = computed(() => (mover.value.diceModBadges || []).map(b => ({ label: b.name, color: typeBgColor(b.type) })))
// The opponent chose this move, so stepping back to pick another isn't on offer.
const canGoBack = computed(() => state.turn === 'player' && !mover.value.movePickedByOpponent)

const successDmgClass = computed(() => {
  const m = dmgInfo.value.mode
  return m === 'weak' ? 'weak' : m === 'up' ? 'up' : m === 'down' ? 'down' : ''
})

// A pinned character die (FIX_CHARADICE_*) leaves only the rows covering the pinned
// orientations selectable, unlike charaDiceBlocked which disables the lot.
function charaAvailable(ce) {
  return hasChara.value && charaDiceOrientationAllowed(ce.orientations, mover.value.fixCharaDice)
}

function charaHighlighted(ce) {
  if (!charaAvailable(ce)) return false
  return isCharaColorConditionMet(ce.type, mover.value, opp.value)
}
function pickSuccessOnly() {
  solo.chooseSuccessOnly()
}
function pickChara(ce) {
  if (!charaAvailable(ce)) return
  solo.chooseCharaEffect(ce)
}
function pickFail() {
  solo.chooseFail()
}
function goBack() {
  solo.backToMoveSelect()
}
</script>

<template>
  <div class="dice-overlay" style="height:80%;">
    <div class="dr-top-row">
      <div
        class="dr-move-card"
        :style="{ backgroundColor: typeBgColor(mv.type), backgroundImage: `url('${asset(`image/BACK/back_${mv.type}.png`)}')` }"
      >
        <div class="dr-cost-row">
          <div v-for="(costType, i) in displayCost" :key="i" class="cost-dot"><img :src="asset(`image/ICON/${costType}.png`)" class="img-icon" :alt="costType"></div>
        </div>
        <div class="dr-move-name mc-name-big">{{ mv.name }}</div>
      </div>
      <div v-if="mv.effect || diceModBadges.length > 0" class="dr-roll-line" style="flex-direction:column; align-items:flex-start; gap:0.125rem;">
        <div v-if="diceModBadges.length > 0" class="dice-mod-badges">
          <div v-for="(b, i) in diceModBadges" :key="i" class="dice-mod-badge" :style="{ background: b.color }">{{ b.label }}</div>
        </div>
        <div v-if="mv.effect" class="mc-effect" style="position:static; white-space:normal;">{{ mv.effect }}</div>
      </div>
    </div>
    <div class="dr-result-cols">
      <div class="dr-success-col" :style="{ background: typeBgColor(mv.type) }">
        <div class="dr-col-header dr-header-success">{{ t('dice.moveSuccess') }} <span class="arrow">▶</span> <span class="hl">{{ t('dice.charaDiceCheck') }}</span></div>
        <div class="dr-btn-list">
          <button class="dr-success-only-btn" @click="pickSuccessOnly">
            <div class="dr-success-only-left">
              <div class="dr-type-icon"><img :src="asset(`image/ICON/${displayType}.png`)" class="img-icon" :alt="displayType"></div>
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
          <button class="dr-fail-btn" @click="pickFail">{{ t('dice.moveFail') }}</button>
        </div>
        <div v-if="canGoBack" class="dr-back-box">
          <button class="dr-back-btn" @click="goBack">{{ t('common.back') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
