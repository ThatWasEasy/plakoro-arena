<script setup>
import { computed, inject, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../data/constants'
import { asset } from '../data/assetPath'
import { rankCharacters, DEFAULT_TOP_N } from '../game/characterRanking'
import { buildTempoTable } from '../game/tempoValue'

const emit = defineEmits(['back'])
const { characters, moves } = inject('characterData')
const { t } = useI18n()

// Counting what a move denies the opponent is on by default here, unlike the odds view. That
// view answers "what will this move do to their HP", where a strict reading is the honest
// one; this one answers "how strong is this character", and a move like 10まんボルト that
// costs its caster two dice next turn is genuinely worse than its printed damage suggests.
const countTempo = ref(true)
const expandedId = ref(null)

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
  if (countTempo.value) ensureTempoTable()
})
watch(countTempo, on => {
  if (on) ensureTempoTable()
})

const waitingForTempo = computed(() => countTempo.value && !tempoTable.value)

const rows = computed(() =>
  rankCharacters(characters.value, moves.value, {
    topN: DEFAULT_TOP_N,
    tempoValues: countTempo.value ? tempoTable.value : null
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
    <div class="center-hint" style="padding-bottom:0.375rem;">{{ t('tierList.hint', { n: DEFAULT_TOP_N }) }}</div>

    <div style="width:100%; max-width:34rem; padding:0 0.625rem 0.5rem; display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex-wrap:wrap;">
      <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
        <input type="checkbox" v-model="countTempo" style="width:0.75rem; height:0.75rem; margin:0;">
        {{ t('tierList.countTempo') }}
      </label>
      <span v-if="waitingForTempo" style="font-size:0.625rem; font-weight:800; color:var(--sub);">{{ t('tierList.calculating') }}</span>
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
        </div>

        <div v-if="expandedId === row.character.id" class="tier-detail">
          <div v-for="entry in row.top" :key="entry.mv.id" class="tier-move">
            <span class="tier-move-type"><img :src="asset(`image/ICON/${entry.mv.type}.png`)" class="img-icon" :alt="entry.mv.type"></span>
            <span class="tier-move-name">{{ entry.mv.name }}</span>
            <span class="tier-move-ev">{{ entry.ev.toFixed(1) }}</span>
          </div>
          <div v-if="row.moveCount < DEFAULT_TOP_N" class="tier-move-note">{{ t('tierList.fewMoves', { n: row.moveCount }) }}</div>
        </div>
      </div>
    </div>

    <div style="width:100%; max-width:34rem; padding:0.625rem 0.75rem 0; font-size:0.5rem; font-weight:700; color:var(--sub); line-height:1.6;">
      {{ t('tierList.assumptions') }}
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
.tier-move-ev { font-size: 0.6875rem; font-weight: 800; color: var(--ink); flex-shrink: 0; }
.tier-move-note { font-size: 0.5rem; font-weight: 700; color: var(--sub); padding-top: 0.125rem; }
</style>
