<script setup>
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../../data/constants'
import { asset } from '../../data/assetPath'
import { enumerateRolls, charaEffectOdds, jointOdds } from '../../game/energyPayment'
import { moveExpectedValue } from '../../game/moveExpectedValue'
import MoveCard from '../MoveCard.vue'

// Which dice sets exist upstream, and their labels, so this view can report a move's odds
// under each configuration side by side.
const props = defineProps({
  sets: { type: Array, required: true },
  setLabels: { type: Array, required: true }
})
const emit = defineEmits(['back'])

const { characters, moves } = inject('characterData')
const { t } = useI18n()

const selectedCharacterId = ref(null)
const selectedCharacter = computed(() =>
  characters.value.find(c => c.id === selectedCharacterId.value) || null
)

// How many times each die gets rolled. Some game rules let a player roll a die more than
// once, and it's the player's own call how many times each one goes — not just an on/off
// switch — so this is a per-die count, defaulting to 1 each (i.e. today's normal roll).
const diceCounts = ref([1, 1, 1])
const activeCount = computed(() => diceCounts.value.reduce((a, b) => a + b, 0))

// Each extra roll multiplies the outcome space by 6 (enumerateRolls is 6^n), so the per-die
// and total caps keep worst case (all 3 dice at MAX_PER_DIE) at 6^9 ≈ 10M — comfortably fast
// for a single synchronous pass, even doubled for a 2-set comparison.
const MAX_PER_DIE = 4
const MAX_TOTAL = 9

function incrementDie(index) {
  if (diceCounts.value[index] >= MAX_PER_DIE) return
  if (activeCount.value >= MAX_TOTAL) return
  diceCounts.value[index] += 1
}
function decrementDie(index) {
  // At least one roll has to stay in play for the odds to mean anything.
  if (diceCounts.value[index] <= 0) return
  if (diceCounts.value[index] <= 1 && activeCount.value <= 1) return
  diceCounts.value[index] -= 1
}

const hasCompare = computed(() => props.sets.length > 1)

// Rolling a die twice is statistically identical to two dice built the same way each rolled
// once, so a die just gets repeated in the list per its count.
function expandDiceByCounts(dice, counts) {
  const expanded = []
  dice.forEach((die, i) => {
    for (let n = 0; n < counts[i]; n++) expanded.push(die)
  })
  return expanded
}

// One roll-outcome list per dice set, covering each die as many times as it's set to roll.
const rollsPerSet = computed(() =>
  props.sets.map(set => enumerateRolls(expandDiceByCounts(set.dice, diceCounts.value)))
)

const showCounts = ref(false)

// Premises the expected value depends on but the dice can't supply: a few moves only pay out
// below an HP threshold or after a particular previous turn, and damage reduction is only
// worth counting as HP if the player wants it counted.
const showSettings = ref(false)
const sortByEv = ref(false)
const countDefensiveValue = ref(false)
const selfHpText = ref('')
const prevEnemyFailed = ref(false)
const prevSelfFailed = ref(false)
const prevPrereqSucceeded = ref(false)

// Left blank, HP conditions stay unmet and say so on the affected moves, rather than the
// view quietly picking a number on the player's behalf.
const selfHp = computed(() => {
  const parsed = parseInt(selfHpText.value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
})

// Why a move's figure is qualified, in the order moveExpectedValue reports them. `tempo` is
// deliberately absent: the move's own card sits directly below the figure and already spells
// out what a dice-count change or a move lock does, so repeating it here says nothing.
const NOTE_LABEL_KEYS = {
  defensive: 'noteDefensive',
  needsHp: 'noteNeedsHp',
  needsPrev: 'noteNeedsPrev',
  mirrorDice: 'noteMirrorDice',
  unknown: 'noteUnknown',
  unsupported: 'noteUnsupported'
}

function pct(payable, total) {
  return (payable / total * 100).toFixed(1)
}

function oddsText(payable, total) {
  const percentage = `${pct(payable, total)}%`
  return showCounts.value ? `${payable}/${total}（${percentage}）` : percentage
}

// Rounding leaves the odd -0.00000001 behind, which would print as a startling "-0.0".
function clean(value) {
  return Math.abs(value) < 0.05 ? 0 : value
}

function evText(value) {
  return clean(value).toFixed(1)
}

function signedText(value) {
  const rounded = clean(value)
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`
}

// Where a move's expected value comes from. The parts are signed and add up to the headline
// figure, so the line reads as its arithmetic rather than as four loose statistics: the
// printed damage first, then what the character die is worth on top, then whatever the move
// costs or gives back in own HP. Parts worth nothing are dropped instead of printing zeroes.
function breakdownText(result) {
  const parts = [`${t('diceBuilder.moveOdds.evPartBase')} ${evText(result.evDamageBase)}`]
  if (clean(result.evDamageChara) !== 0) {
    parts.push(`${t('diceBuilder.moveOdds.evPartChara')} ${signedText(result.evDamageChara)}`)
  }
  if (clean(result.evDefensive) !== 0) {
    parts.push(`${t('diceBuilder.moveOdds.evPartDefensive')} ${signedText(result.evDefensive)}`)
  }
  if (clean(result.evSelf) !== 0) {
    parts.push(`${t('diceBuilder.moveOdds.evPartSelf')} ${signedText(-result.evSelf)}`)
  }
  return parts.join('　')
}

// Nothing to break down when the printed damage is the whole story.
function hasBreakdown(result) {
  return clean(result.evDamageChara) !== 0 || clean(result.evSelf) !== 0 || clean(result.evDefensive) !== 0
}

// Every move the character has, in the order the roster defines — including ones that are
// unpayable with the current dice, since "this build can't cast it at all" is the point.
const moveRows = computed(() => {
  const character = selectedCharacter.value
  if (!character) return []
  const rows = character.moves.map(id => moves.value[id]).filter(Boolean).map(mv => {
    // moveExpectedValue reports the payability it had to work out anyway, so the success
    // rate and the expected value share a single pass over the roll space.
    const evs = rollsPerSet.value.map((rolls, si) => moveExpectedValue(mv, {
      rolls,
      // The one move that makes the opponent throw energy dice has no other build to go on,
      // so it assumes a mirror of this set and flags that it did.
      enemyDice: props.sets[si].dice,
      selfHp: selfHp.value,
      prev: {
        enemyMoveFailed: prevEnemyFailed.value,
        selfMoveFailed: prevSelfFailed.value,
        prereqMoveSucceeded: prevPrereqSucceeded.value
      },
      countDefensiveValue: countDefensiveValue.value
    }))
    const odds = evs.map(result => result.odds)
    const noteKinds = [...new Set(evs.flatMap(result => result.notes.map(note => note.kind)))]
    return {
      mv,
      odds,
      evs,
      // Drives whether the breakdown is shown or merely held open — the cards sit in a
      // two-column grid, so a line that appears on one move and not its neighbour would
      // knock the two cards out of alignment.
      showBreakdown: evs.some(hasBreakdown),
      noteKeys: noteKinds.map(kind => NOTE_LABEL_KEYS[kind]).filter(Boolean),
      // Per dice set, since the joint figure depends on that set's own success rate.
      charaEffects: mv.chara.map(ce => {
        const charaOdds = charaEffectOdds(ce.orientations)
        return { ce, charaOdds, joint: odds.map(moveOdds => jointOdds(moveOdds, charaOdds)) }
      })
    }
  })
  // Sorted on set A: with two builds side by side one order has to win, and A is the one the
  // comparison is anchored to.
  if (sortByEv.value) rows.sort((a, b) => b.evs[0].ev - a.evs[0].ev)
  return rows
})

</script>

<template>
  <div class="board select-board" style="overflow-y:auto; align-items:center;">
    <div class="modal-title" style="margin:0.5rem 0 0.25rem;">{{ t('diceBuilder.moveOdds.title') }}</div>
    <div class="center-hint" style="padding-bottom:0.375rem;">{{ t('diceBuilder.moveOdds.hint') }}</div>

    <!-- character picker -->
    <template v-if="!selectedCharacter">
      <div class="grid-2">
        <div v-for="c in characters" :key="c.id" class="pick-card" @click="selectedCharacterId = c.id">
          <div class="pick-top" :style="{ background: typeBgColor(c.type) }">
            <div class="pick-type-icon"><img :src="asset(`image/ICON/${c.type}.png`)" class="img-icon" :alt="c.type"></div>
            <div class="ic"><img :src="c.imageUrl || asset(`image/CHARA/${c.name}.png`)" class="img-icon" :alt="c.name"></div>
          </div>
          <div class="pick-bottom">
            <div class="nm-row"><span class="nm">{{ c.name }}</span></div>
          </div>
        </div>
      </div>
      <div style="display:flex; justify-content:center; padding:0.875rem 0 0.25rem;">
        <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
      </div>
    </template>

    <!-- odds table -->
    <template v-else>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap; width:100%; max-width:40rem; padding:0 0.625rem 0.5rem;">
        <div style="display:flex; align-items:center; gap:0.375rem;">
          <div style="width:2rem; height:2rem; border-radius:0.375rem; overflow:hidden; flex-shrink:0;">
            <img :src="selectedCharacter.imageUrl || asset(`image/CHARA/${selectedCharacter.name}.png`)" class="img-icon" :alt="selectedCharacter.name">
          </div>
          <span style="font-size:0.875rem; font-weight:800;">{{ selectedCharacter.name }}</span>
          <button class="btn secondary" style="padding:0.1875rem 0.5rem; font-size:0.625rem;" @click="selectedCharacterId = null">{{ t('diceBuilder.moveOdds.changeCharacter') }}</button>
        </div>

        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <span style="font-size:0.75rem; font-weight:800; color:var(--sub);">{{ t('diceBuilder.moveOdds.diceInPlay') }}</span>
          <div
            v-for="(count, di) in diceCounts"
            :key="di"
            style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub);"
          >
            <span>{{ t('diceBuilder.die', { n: di + 1 }) }}</span>
            <button
              type="button"
              @click="decrementDie(di)"
              style="width:1rem; height:1rem; line-height:1; border:1px solid var(--line); border-radius:0.25rem; background:#fff; font-weight:800; cursor:pointer; padding:0;"
            >−</button>
            <span style="min-width:0.75rem; text-align:center; color:var(--ink);">{{ count }}</span>
            <button
              type="button"
              @click="incrementDie(di)"
              style="width:1rem; height:1rem; line-height:1; border:1px solid var(--line); border-radius:0.25rem; background:#fff; font-weight:800; cursor:pointer; padding:0;"
            >+</button>
          </div>
          <label style="display:flex; align-items:center; gap:0.1875rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="showCounts" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.showCountsLabel') }}
          </label>
          <button class="btn secondary" style="padding:0.1875rem 0.5rem; font-size:0.625rem;" @click="showSettings = !showSettings">
            {{ t('diceBuilder.moveOdds.settings') }}
          </button>
        </div>
      </div>

      <!-- what the expected value is allowed to assume; folded away because the defaults are
           the honest ones and most players never need to touch them -->
      <div
        v-if="showSettings"
        style="width:100%; max-width:40rem; margin:0 0.625rem 0.5rem; padding:0.5rem 0.625rem; border:0.0625rem solid var(--line); border-radius:0.5rem; display:flex; flex-direction:column; gap:0.375rem;"
      >
        <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="sortByEv" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.sortByEv') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="countDefensiveValue" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.countDefensive') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub);">
            {{ t('diceBuilder.moveOdds.selfHpLabel') }}
            <input
              type="number"
              min="0"
              v-model="selfHpText"
              :placeholder="t('diceBuilder.moveOdds.selfHpAny')"
              style="width:4.5rem; font-size:0.625rem; font-weight:800; padding:0.125rem 0.25rem; border:0.0625rem solid var(--line); border-radius:0.25rem; background:#fff; color:var(--ink);"
            >
          </label>
        </div>
        <div style="display:flex; flex-direction:column; gap:0.1875rem;">
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="prevEnemyFailed" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.prevEnemyFailed') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="prevSelfFailed" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.prevSelfFailed') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="prevPrereqSucceeded" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.prevPrereqSucceeded') }}
          </label>
        </div>
        <div style="font-size:0.5625rem; font-weight:600; color:var(--sub); line-height:1.5;">
          {{ t('diceBuilder.moveOdds.evHint') }}
        </div>
      </div>

      <div style="width:100%; max-width:40rem; padding:0 0.625rem;">
        <div style="font-size:0.6875rem; font-weight:800; color:var(--sub); padding:0 0.125rem 0.25rem; border-bottom:0.125rem solid var(--line); margin-bottom:0.5rem;">
          {{ t('diceBuilder.moveOdds.moveHeader', { n: activeCount }) }}
        </div>

        <div class="move-pick-list">
          <div v-for="row in moveRows" :key="row.mv.id" style="display:flex; flex-direction:column; gap:0.25rem; min-width:0;">
            <!-- odds sit above the card so the card itself stays exactly as it looks in game -->
            <div style="display:flex; align-items:center; justify-content:space-between; gap:0.375rem; padding:0 0.125rem;">
              <span style="font-size:0.625rem; font-weight:800; color:var(--sub); flex-shrink:0;">{{ t('diceBuilder.moveOdds.successRate') }}</span>
              <div style="display:flex; gap:0.5rem; flex-shrink:0;">
                <span
                  v-for="(o, si) in row.odds"
                  :key="si"
                  :style="{ display: 'flex', alignItems: 'baseline', gap: '0.1875rem', fontSize: '0.75rem', fontWeight: 600, color: o.payable === 0 ? 'var(--line)' : 'var(--sub)', whiteSpace: 'nowrap' }"
                >
                  <span v-if="hasCompare" style="font-weight:800;">{{ setLabels[si] }}</span>
                  <span :style="{ fontSize: '1.25rem', fontWeight: 900, color: o.payable === 0 ? 'var(--line)' : 'var(--ink)' }">{{ oddsText(o.payable, o.total) }}</span>
                </span>
              </div>
            </div>

            <!-- the headline figure: what the move is worth per cast, success rate included -->
            <div style="display:flex; align-items:center; justify-content:space-between; gap:0.375rem; padding:0 0.125rem;">
              <span style="font-size:0.625rem; font-weight:800; color:var(--sub); flex-shrink:0;">{{ t('diceBuilder.moveOdds.expectedValue') }}</span>
              <div style="display:flex; gap:0.5rem; flex-shrink:0;">
                <span
                  v-for="(result, si) in row.evs"
                  :key="si"
                  :style="{ display: 'flex', alignItems: 'baseline', gap: '0.1875rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--sub)', whiteSpace: 'nowrap' }"
                >
                  <span v-if="hasCompare" style="font-weight:800;">{{ setLabels[si] }}</span>
                  <span :style="{ fontSize: '1.25rem', fontWeight: 900, color: result.ev === 0 ? 'var(--line)' : 'var(--ink)' }">{{ evText(result.ev) }}</span>
                </span>
              </div>
            </div>

            <!-- where that figure came from. One line per dice set whether or not it has
                 anything to say, so every card in the grid starts at the same height. -->
            <div
              :style="{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '0.0625rem',
                padding: '0 0.125rem',
                fontSize: '0.5625rem',
                fontWeight: 700,
                color: 'var(--sub)',
                visibility: row.showBreakdown ? 'visible' : 'hidden'
              }"
              :aria-hidden="!row.showBreakdown"
            >
              <div v-for="(result, si) in row.evs" :key="si" style="white-space:nowrap;">
                <span v-if="hasCompare" style="font-weight:800;">{{ setLabels[si] }} </span>{{ breakdownText(result) }}
              </div>
            </div>

            <div class="odds-card"><MoveCard :mv="row.mv" :clickable="false" /></div>

            <!-- what the figure above had to assume, or had to leave out -->
            <div v-if="row.noteKeys.length > 0" style="display:flex; flex-direction:column; gap:0.0625rem; padding:0 0.125rem;">
              <div
                v-for="key in row.noteKeys"
                :key="key"
                style="font-size:0.5rem; font-weight:700; color:var(--sub); line-height:1.4;"
              >＊{{ t(`diceBuilder.moveOdds.${key}`) }}</div>
            </div>

            <!-- character-die odds, keyed to the orientation icons on the card's lower half.
                 Reported separately because it rides on a different die from the energy cost. -->
            <div v-if="row.charaEffects.length > 0" style="display:flex; flex-direction:column; gap:0.125rem; padding:0 0.125rem;">
              <div v-for="(entry, ei) in row.charaEffects" :key="ei" style="display:flex; align-items:center; justify-content:space-between; gap:0.375rem;">
                <div style="display:flex; align-items:center; gap:0.1875rem; min-width:0;">
                  <span style="font-size:0.625rem; font-weight:800; color:var(--sub); flex-shrink:0;">{{ t('diceBuilder.moveOdds.charaDieOdds') }}</span>
                  <div style="display:flex; gap:0.0625rem; flex-shrink:0;">
                    <div v-for="(ori, oi) in entry.ce.orientations" :key="oi" style="width:0.875rem; height:0.875rem; flex-shrink:0;">
                      <img :src="asset(`image/ICON/${ori}.png`)" class="img-icon" :alt="ori">
                    </div>
                  </div>
                </div>
                <div style="display:flex; gap:0.5rem; flex-shrink:0;">
                  <span
                    v-for="(j, si) in entry.joint"
                    :key="si"
                    :style="{ display: 'flex', alignItems: 'baseline', gap: '0.125rem', whiteSpace: 'nowrap' }"
                  >
                    <span v-if="hasCompare" style="font-size:0.625rem; font-weight:800; color:var(--sub);">{{ setLabels[si] }}</span>
                    <span :style="{ fontSize: '1rem', fontWeight: 900, color: j.payable === 0 ? 'var(--line)' : 'var(--ink)' }">{{ oddsText(j.payable, j.total) }}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex; justify-content:center; padding:0.875rem 0 0.25rem;">
        <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* The odds are the point of this view, so the card is scaled down to a reference thumbnail.
   MoveCard sizes everything in rem (root-relative), so a parent font-size can't scale it —
   each size has to be overridden explicitly. */
.odds-card :deep(.move-card) { min-height: 7.25rem; }
.odds-card :deep(.mc-top) { padding: 0.25rem 0.375rem 0.1875rem; }
.odds-card :deep(.mc-bottom) { padding: 0.125rem 0.375rem 0.25rem; }
.odds-card :deep(.mc-type-icon) { width: 1.125rem; height: 1.125rem; }
.odds-card :deep(.mc-name-big) { font-size: 0.8125rem; }
.odds-card :deep(.cost-dot) { width: 0.8125rem; height: 0.8125rem; }
.odds-card :deep(.mc-dmg) { font-size: 1rem; }
.odds-card :deep(.mc-dmg .orig) { font-size: 0.5rem; }
.odds-card :deep(.mc-effect) { font-size: 0.5rem; }
.odds-card :deep(.mc-chara-row) { font-size: 0.5rem; gap: 0.1875rem; padding-top: 0.125rem; }
.odds-card :deep(.mc-chara-row .oi) { width: 0.75rem; height: 0.75rem; }
</style>
