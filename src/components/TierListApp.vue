<script setup>
import { computed, inject, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../data/constants'
import { asset } from '../data/assetPath'
import { rankCharacters, METRIC_TOP_N, METRIC_PER_TURN } from '../game/characterRanking'
import { SUSTAINABLE_SLOTS } from '../game/turnValue'
import { buildTempoTable } from '../game/tempoValue'

const emit = defineEmits(['back', 'inspect'])
const { characters, moves } = inject('characterData')
const { t } = useI18n()

// Counting worth that isn't damage — reduction kept as HP, and what a move denies the
// opponent — is on by default here, unlike the odds view. That view answers "what will this
// move do to their HP", where a strict reading is the honest one; this one answers "how
// strong is this character", and a move like 10まんボルト that costs its caster two dice next
// turn is genuinely worse than its printed damage suggests. Both kinds ride one switch here
// rather than the odds view's two: at this level they are the same assumption.
const countIndirect = ref(true)
const expandedId = ref(null)

// Three readings of the same rotation. Two slots is what the no-repeat rule forces, so it
// is the default; three covers the opponent locking one of them out. The per-turn view adds
// HP bands on top, which is the only thing that separates it from the plain average — for a
// character with no conditional moves the two agree exactly, and so they should.
const SLOTS_OPTIONS = [SUSTAINABLE_SLOTS, SUSTAINABLE_SLOTS + 1]
const slots = ref(SUSTAINABLE_SLOTS)
const metric = ref(METRIC_TOP_N)
const perTurn = computed(() => metric.value === METRIC_PER_TURN)

// Pricing the denial effects means evaluating the whole roster against itself several times
// over, which is a few hundred milliseconds — long enough to drop a frame on the fixed stage.
// It's held outside the reactive graph and built once, after the first paint, so the screen
// appears immediately with a note rather than arriving late in one lump.
const tempoTable = shallowRef(null)
const tempoPending = ref(false)

function ensureTempoTable() {
  if (tempoTable.value || tempoPending.value) return
  tempoPending.value = true
  setTimeout(() => {
    tempoTable.value = buildTempoTable(characters.value, moves.value)
    tempoPending.value = false
  }, 0)
}

onMounted(() => {
  if (countIndirect.value) ensureTempoTable()
})
watch(countIndirect, on => {
  if (on) ensureTempoTable()
})

const waitingForTempo = computed(() => countIndirect.value && !tempoTable.value)

const rows = computed(() =>
  rankCharacters(characters.value, moves.value, {
    topN: slots.value,
    metric: metric.value,
    countDefensiveValue: countIndirect.value,
    tempoValues: countIndirect.value ? tempoTable.value : null
  })
)

// Bars are measured from zero rather than from the lowest entry. Starting the axis at the
// bottom of the range would stretch a modest spread across the full width and read as a
// gulf; from zero, the picture the roster actually presents — closely matched, with a real
// but not dramatic gap — is the picture shown.
const barMax = computed(() => rows.value.reduce((max, row) => Math.max(max, row.average), 0) || 1)

function toggle(id) {
  expandedId.value = expandedId.value === id ? null : id
}
</script>

<template>
  <div class="board select-board" style="overflow-y:auto; align-items:center;">
    <div class="modal-title" style="margin:0.5rem 0 0.25rem;">{{ t('tierList.title') }}</div>
    <div class="center-hint" style="padding-bottom:0.375rem;">{{ perTurn ? t('tierList.hintPerTurn', { n: slots }) : t('tierList.hint', { n: slots }) }}</div>

    <div style="width:100%; max-width:34rem; padding:0 0.625rem 0.5rem; display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex-wrap:wrap;">
      <div style="display:flex; gap:0.25rem; flex-wrap:wrap;">
        <button
          v-for="option in SLOTS_OPTIONS"
          :key="option"
          class="btn secondary"
          :style="{ padding: '0.1875rem 0.5rem', fontSize: '0.625rem', opacity: slots === option ? 1 : 0.5 }"
          @click="slots = option"
        >{{ t('tierList.metricTopN', { n: option }) }}</button>
        <button
          class="btn secondary"
          :style="{ padding: '0.1875rem 0.5rem', fontSize: '0.625rem', opacity: perTurn ? 1 : 0.5 }"
          @click="metric = perTurn ? METRIC_TOP_N : METRIC_PER_TURN"
        >{{ t('tierList.metricPerTurn') }}</button>
      </div>
      <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
        <input type="checkbox" v-model="countIndirect" style="width:0.75rem; height:0.75rem; margin:0;">
        {{ t('tierList.countIndirect') }}
        <span v-if="waitingForTempo" style="font-weight:700;">{{ t('tierList.calculating') }}</span>
      </label>
    </div>

    <div style="width:100%; max-width:34rem; padding:0 0.625rem; display:flex; flex-direction:column; gap:0.1875rem;">
      <div
        v-for="(row, index) in rows"
        :key="row.character.id"
        class="tier-row"
        @click="toggle(row.character.id)"
      >
        <div class="tier-head">
          <span class="tier-rank">{{ index + 1 }}</span>
          <div class="tier-portrait">
            <img :src="row.character.imageUrl || asset(`image/CHARA/${row.character.name}.png`)" class="img-icon" :alt="row.character.name">
          </div>
          <span class="tier-name">{{ row.character.name }}</span>
          <!-- the build the figure assumes, so the number is never read as build-independent -->
          <span class="tier-energy">
            <span class="tier-energy-icon"><img :src="asset(`image/ICON/${row.mainType}.png`)" class="img-icon" :alt="row.mainType"></span>
            <span class="tier-energy-icon"><img :src="asset(`image/ICON/${row.secondaryType}.png`)" class="img-icon" :alt="row.secondaryType"></span>
          </span>
          <span class="tier-bar">
            <span
              class="tier-bar-fill"
              :style="{ width: `${(row.average / barMax) * 100}%`, background: typeBgColor(row.character.type) }"
            ></span>
          </span>
          <span class="tier-value">{{ row.average.toFixed(1) }}</span>
          <!-- Straight to the odds table for this character, on the very build this figure
               assumes. It stops the click reaching the row, whose job is expanding the
               breakdown — the two are different questions and a row that did both on one tap
               would answer neither reliably. -->
          <button
            class="tier-inspect"
            :aria-label="t('tierList.inspect')"
            :title="t('tierList.inspect')"
            @click.stop="emit('inspect', {
              from: 'tierList',
              characterId: row.character.id,
              mainType: row.mainType,
              secondaryType: row.secondaryType
            })"
          >🎲</button>
        </div>

        <div v-if="expandedId === row.character.id" class="tier-detail">
          <div
            v-for="(entry, ei) in row.top"
            :key="ei"
            class="tier-move"
            :style="perTurn && entry.leadOfBand && ei > 0 ? 'margin-top:0.1875rem;' : ''"
          >
            <!-- in the per-turn reading the rows come in bands, so only the first of each
                 pair repeats the band's label and share of the game -->
            <span v-if="perTurn" class="tier-move-band">
              <template v-if="entry.leadOfBand">{{ entry.above ? t('tierList.bandHealthy') : t('tierList.bandBelow', { hp: entry.hp }) }} {{ Math.round(entry.weight * 100) }}%</template>
            </span>
            <span class="tier-move-type"><img :src="asset(`image/ICON/${entry.mv.type}.png`)" class="img-icon" :alt="entry.mv.type"></span>
            <span class="tier-move-name">{{ entry.mv.name }}</span>
            <span class="tier-move-ev">{{ entry.ev.toFixed(1) }}</span>
          </div>
          <div v-if="!perTurn && row.moveCount < slots" class="tier-move-note">{{ t('tierList.fewMoves', { n: row.moveCount }) }}</div>
        </div>
      </div>
    </div>

    <div style="width:100%; max-width:34rem; padding:0.625rem 0.75rem 0; font-size:0.5rem; font-weight:700; color:var(--sub); line-height:1.6; display:flex; flex-direction:column; gap:0.25rem;">
      <div>{{ t('tierList.assumptions') }}</div>
      <div>{{ t('tierList.rotationNote') }}</div>
      <div>{{ t('tierList.premiseNote') }}</div>
      <div>{{ t('tierList.disclaimer') }}</div>
    </div>

    <div style="display:flex; justify-content:center; padding:0.875rem 0 0.25rem;">
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
.tier-row {
  background: var(--card);
  border: 0.0625rem solid var(--line);
  border-radius: 0.5rem;
  padding: 0.25rem 0.375rem;
  cursor: pointer;
}
.tier-row:active { transform: scale(.995); }

.tier-head {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}

.tier-rank {
  font-size: 0.6875rem;
  font-weight: 900;
  color: var(--sub);
  min-width: 1rem;
  text-align: right;
  flex-shrink: 0;
}

.tier-portrait {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.25rem;
  overflow: hidden;
  flex-shrink: 0;
}

/* The one part allowed to give way: a long name ellipses rather than pushing the bar and
   the figure off the row. */
.tier-name {
  font-size: 0.6875rem;
  font-weight: 800;
  color: var(--ink);
  flex: 1 1 3.5rem;
  min-width: 2rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tier-energy { display: flex; gap: 0.0625rem; flex-shrink: 0; }
.tier-energy-icon { width: 0.75rem; height: 0.75rem; }

.tier-bar {
  flex: 2 1 5rem;
  min-width: 2.5rem;
  height: 0.5rem;
  border-radius: 0.25rem;
  background: var(--line);
  overflow: hidden;
}
.tier-bar-fill { display: block; height: 100%; border-radius: 0.25rem; }

.tier-value {
  font-size: 0.8125rem;
  font-weight: 900;
  color: var(--ink);
  min-width: 2.125rem;
  text-align: right;
  flex-shrink: 0;
}

.tier-inspect {
  flex-shrink: 0;
  width: 1.25rem;
  height: 1.25rem;
  padding: 0;
  border: none;
  border-radius: 0.3125rem;
  background: var(--line);
  font-size: 0.6875rem;
  line-height: 1;
  cursor: pointer;
}

.tier-inspect:active { transform: scale(.92); }

.tier-detail {
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
  padding: 0.25rem 0 0.125rem 1.5rem;
}

.tier-move { display: flex; align-items: center; gap: 0.25rem; }
.tier-move-type { width: 0.75rem; height: 0.75rem; flex-shrink: 0; }
.tier-move-name {
  font-size: 0.625rem;
  font-weight: 700;
  color: var(--sub);
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tier-move-band { font-size: 0.5rem; font-weight: 800; color: var(--sub); min-width: 4.25rem; flex-shrink: 0; }
.tier-move-ev { font-size: 0.6875rem; font-weight: 800; color: var(--ink); flex-shrink: 0; }
.tier-move-note { font-size: 0.5rem; font-weight: 700; color: var(--sub); padding-top: 0.125rem; }
</style>
