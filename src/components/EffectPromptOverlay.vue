<script setup>
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import MoveCard from './MoveCard.vue'
import EnergyDiceModal from './EnergyDiceModal.vue'
import { asset } from '../data/assetPath'

const battle = inject('battle')
const online = inject('online')
const { moves } = inject('characterData')
const { t } = useI18n()
const state = battle.state
const ep = computed(() => state.effectPrompt)

// bindWaza is the one prompt kind still standing in for a genuine choice rather than a die read
// (see useBattleState.js) — it's the opponent's own choice of which of THEIR moves to sacrifice,
// so only ep.targetKey's own client may pick a row; the other side gets a read-only wait state.
const isBindTarget = computed(() => ep.value.kind !== 'bindWaza' || !online.myKey.value || online.myKey.value === ep.value.targetKey)

const diceCountLabel = computed(() => t('effectPrompt.diceRollLabel', { n: ep.value.max === 6 ? 3 : ep.value.max === 4 ? 2 : 1 }))
const diceSub = computed(() => ep.value.max === 2 ? t('effectPrompt.diceSubSingle') : t('effectPrompt.diceSubMulti'))

// swapChip (へんげぎり, online only): the mover re-chips one of their own dice; the other side
// just waits. Closing the editor without changing anything keeps the dice as they were.
const isSwapTarget = computed(() => ep.value.kind === 'swapChip' && (!online.myKey.value || online.myKey.value === ep.value.targetKey))
const swapDice = computed(() => ep.value.kind === 'swapChip' ? state.players[ep.value.targetKey].energyDice : null)

const target = computed(() => ep.value.kind === 'bindWaza' ? state.players[ep.value.targetKey] : null)
const targetOpp = computed(() => target.value ? state.players[battle.opponentKey(ep.value.targetKey)] : null)
const bindRemaining = computed(() => ep.value.kind === 'bindWaza' ? ep.value.count - ep.value.picked.length : 0)
const bindMoveRows = computed(() => {
  if (ep.value.kind !== 'bindWaza') return []
  return target.value.moveIds.map(mid => {
    const mv = moves.value[mid]
    const isPrevUsed = mid === target.value.lastMoveId
    const isPicked = ep.value.picked.includes(mid)
    const dmgInfo = battle.computeDisplayDamage(mv, target.value, targetOpp.value)
    return { mid, mv, dmgInfo, disabled: isPrevUsed || isPicked }
  })
})

const repeatCount = ref(1)
const eneCountValue = ref(0)
watch(() => state.effectPrompt, () => {
  repeatCount.value = 1
  eneCountValue.value = 0
})

function submit(value) {
  battle.submitEffectPrompt(value)
}
function pickBindMove(mid) {
  battle.pickBindWazaMove(mid)
}
</script>

<template>
  <div class="overlay full">
    <template v-if="ep.kind === 'diceNumber'">
      <div class="overlay-title">{{ t('effectPrompt.enemyRollTitle', { label: diceCountLabel }) }}</div>
      <div class="overlay-sub">{{ diceSub }}</div>
      <div style="display:flex; gap:0.625rem; flex-wrap:wrap; justify-content:center; margin-top:0.625rem;">
        <button v-for="n in ep.max" :key="n" class="btn" @click="submit(n)">{{ n }}</button>
      </div>
    </template>

    <template v-else-if="ep.kind === 'charaDiceCount'">
      <div class="overlay-title">{{ t('effectPrompt.charaDiceCountTitle', { n: ep.n }) }}</div>
      <div style="width:100%; max-width:18.75rem; margin:0.625rem auto 0;">
        <MoveCard :mv="ep.mv" :dmg-info="ep.dmgInfo" :owner="ep.mover" :opponent="ep.opp" :clickable="false" style="min-height:10.75rem;" />
      </div>
      <div style="display:flex; gap:0.625rem; flex-wrap:wrap; justify-content:center; margin-top:0.875rem;">
        <button v-for="n in ep.n + 1" :key="n" class="btn" @click="submit(n - 1)">{{ n - 1 }}</button>
      </div>
    </template>

    <template v-else-if="ep.kind === 'charaDiceRepeat'">
      <div class="overlay-title">{{ t('effectPrompt.charaDiceRepeatTitle') }}</div>
      <div style="width:100%; max-width:18.75rem; margin:0.625rem auto 0;">
        <MoveCard :mv="ep.mv" :dmg-info="ep.dmgInfo" :owner="ep.mover" :opponent="ep.opp" :clickable="false" style="min-height:10.75rem;" />
      </div>
      <div style="display:flex; align-items:center; justify-content:center; gap:0.75rem; margin-top:0.875rem;">
        <select v-model.number="repeatCount" style="font-size:1.125rem; font-weight:800; padding:0.5rem 0.75rem; border-radius:0.625rem; border:0.125rem solid #EDEBE3; background:#fff; color:var(--ink);">
          <option v-for="n in 20" :key="n" :value="n">{{ n }}</option>
        </select>
        <button class="btn" @click="submit(repeatCount)">{{ t('common.confirm') }}</button>
      </div>
    </template>

    <template v-else-if="ep.kind === 'bindWaza'">
      <div class="overlay-title">{{ t('effectPrompt.bindWazaTitle') }}</div>
      <div class="overlay-sub">{{ isBindTarget ? t('effectPrompt.bindWazaRemaining', { remaining: bindRemaining }) : t('turnResult.waiting') }}</div>
      <div class="ms-grid" style="margin-top:0.625rem; width:100%; max-width:40rem; flex:1 1 auto; min-height:0;">
        <MoveCard
          v-for="row in bindMoveRows"
          :key="row.mid"
          :mv="row.mv"
          :dmg-info="row.dmgInfo"
          :owner="target"
          :opponent="targetOpp"
          :disabled="row.disabled || !isBindTarget"
          :clickable="!row.disabled && isBindTarget"
          @pick="pickBindMove"
        />
      </div>
    </template>

    <template v-else-if="ep.kind === 'swapChip'">
      <div class="overlay-title">{{ ep.mvName }}</div>
      <div class="overlay-sub">{{ isSwapTarget ? t('effectPrompt.swapChipSub') : t('turnResult.waiting') }}</div>
      <EnergyDiceModal v-if="isSwapTarget" :initial-dice="swapDice" swap-one-die @close="submit(null)" @confirm="submit" />
    </template>

    <template v-else-if="ep.kind === 'eneCount'">
      <div class="overlay-title">{{ t('effectPrompt.eneCountTitle') }}<img v-if="ep.eneType" :src="asset(`image/ICON/${ep.eneType}.png`)" :alt="ep.eneType" style="height:1em; width:1em; object-fit:contain; vertical-align:-0.15em; margin-left:0.25rem;"></div>
      <div style="width:100%; max-width:18.75rem; margin:0.625rem auto 0;">
        <MoveCard :mv="ep.mv" :dmg-info="ep.dmgInfo" :owner="ep.mover" :opponent="ep.opp" :clickable="false" style="min-height:10.75rem;" />
      </div>
      <div style="display:flex; align-items:center; justify-content:center; gap:0.75rem; margin-top:0.875rem;">
        <select v-model.number="eneCountValue" style="font-size:1.125rem; font-weight:800; padding:0.5rem 0.75rem; border-radius:0.625rem; border:0.125rem solid #EDEBE3; background:#fff; color:var(--ink);">
          <option v-for="n in 13" :key="n" :value="n - 1">{{ n - 1 }}</option>
        </select>
        <button class="btn" @click="submit(eneCountValue)">{{ t('common.confirm') }}</button>
      </div>
    </template>

    <template v-else-if="ep.kind === 'charaDiceEnemyManual'">
      <div class="overlay-title">
        {{ t('effectPrompt.charaDiceEnemyPrefix') }}<img v-for="(ori, i) in ep.orientations" :key="i" :src="asset(`image/ICON/${ori}.png`)" :alt="ori" style="height:1em; width:1em; object-fit:contain; vertical-align:-0.15em; margin:0 0.0625rem;">{{ t('effectPrompt.charaDiceEnemySuffix') }}
      </div>
      <div style="width:100%; max-width:18.75rem; margin:0.625rem auto 0;">
        <MoveCard :mv="ep.mv" :dmg-info="ep.dmgInfo" :owner="ep.mover" :opponent="ep.opp" :clickable="false" style="min-height:10.75rem;" />
      </div>
      <div style="display:flex; gap:0.75rem; justify-content:center; margin-top:0.875rem;">
        <button class="btn" @click="submit(true)">{{ t('common.success') }}</button>
        <button class="btn fail" @click="submit(false)">{{ t('common.fail') }}</button>
      </div>
    </template>

    <!-- Opponent rolls their character die n times; the player reports the hit count. Buttons
         0..n rather than a stepper, so a 3-roll answer is one tap like the other count prompt. -->
    <template v-else-if="ep.kind === 'charaDiceComboEnemy'">
      <div class="overlay-title">
        {{ t('effectPrompt.charaDiceComboPrefix', { n: ep.n }) }}<img v-for="(ori, i) in ep.orientations" :key="i" :src="asset(`image/ICON/${ori}.png`)" :alt="ori" style="height:1em; width:1em; object-fit:contain; vertical-align:-0.15em; margin:0 0.0625rem;">{{ t('effectPrompt.charaDiceComboSuffix', { dmg: ep.effectValue }) }}
      </div>
      <div style="width:100%; max-width:18.75rem; margin:0.625rem auto 0;">
        <MoveCard :mv="ep.mv" :dmg-info="ep.dmgInfo" :owner="ep.mover" :opponent="ep.opp" :clickable="false" style="min-height:10.75rem;" />
      </div>
      <div style="display:flex; gap:0.625rem; flex-wrap:wrap; justify-content:center; margin-top:0.875rem;">
        <button v-for="n in ep.n + 1" :key="n" class="btn" @click="submit(n - 1)">{{ n - 1 }}</button>
      </div>
    </template>

    <!-- Which orientation the die actually landed on — only the player at the table can see it,
         so it's reported rather than rolled. Each choice is its own icon button. -->
    <template v-else-if="ep.kind === 'charaDiceSelect'">
      <div class="overlay-title">
        {{ ep.target === 'enemy' ? t('effectPrompt.charaDiceSelectEnemyTitle') : t('effectPrompt.charaDiceSelectSelfTitle') }}
      </div>
      <div style="width:100%; max-width:18.75rem; margin:0.625rem auto 0;">
        <MoveCard :mv="ep.mv" :dmg-info="ep.dmgInfo" :owner="ep.mover" :opponent="ep.opp" :clickable="false" style="min-height:10.75rem;" />
      </div>
      <div style="display:flex; gap:0.625rem; flex-wrap:wrap; justify-content:center; margin-top:0.875rem;">
        <button
          v-for="(ori, i) in ep.orientations"
          :key="i"
          class="btn"
          style="display:flex; align-items:center; gap:0.25rem; padding:0.5rem 0.75rem;"
          @click="submit(ori)"
        >
          <img :src="asset(`image/ICON/${ori}.png`)" :alt="ori" style="height:1.25rem; width:1.25rem; object-fit:contain;">
        </button>
      </div>
    </template>
  </div>
</template>
