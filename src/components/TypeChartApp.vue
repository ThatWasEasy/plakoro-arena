<script setup>
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../data/constants'
import { asset } from '../data/assetPath'
import { typeAffinity } from '../game/typeAffinity'

const emit = defineEmits(['back'])
const { characters, moves } = inject('characterData')
const { t } = useI18n()

// Every printed weakness so far is worth the same 20, so the number is stated once in the
// hint rather than repeated down fifteen rows. A card that breaks the pattern will show its
// own figure — the per-row damage is read from the data, not assumed.
const uniformWeakness = computed(() => {
  const amounts = new Set()
  characters.value.forEach(c => c.weaknesses.forEach(w => amounts.add(w.damage)))
  return amounts.size === 1 ? [...amounts][0] : null
})

const rows = computed(() =>
  characters.value.map(character => {
    const moveList = (character.moves || []).map(id => moves.value[id]).filter(Boolean)
    const { main, secondary } = typeAffinity(moveList)
    return { character, main, secondary }
  })
)
</script>

<template>
  <div class="board select-board" style="overflow-y:auto; align-items:center;">
    <div class="modal-title" style="margin:0.5rem 0 0.25rem;">{{ t('typeChart.title') }}</div>
    <div class="center-hint" style="padding-bottom:0.5rem;">
      {{ uniformWeakness !== null ? t('typeChart.hint', { n: uniformWeakness }) : t('typeChart.hintMixed') }}
    </div>

    <!-- Two per row. A row is a name and three icons, which leaves half the stage empty in a
         single column, and fifteen characters then need scrolling to compare. The stage is a
         fixed logical width (see useStageLayout.js), so the pair always fits and there is no
         breakpoint to fall back from — hence one header per column rather than one shared. -->
    <div class="tc-grid">
      <div v-for="col in 2" :key="`head${col}`" class="tc-head">
        <span class="tc-name-col">{{ t('typeChart.character') }}</span>
        <span class="tc-col">{{ t('typeChart.main') }}</span>
        <span class="tc-col">{{ t('typeChart.secondary') }}</span>
        <span class="tc-col tc-weak-col">{{ t('typeChart.weakness') }}</span>
      </div>

      <div v-for="row in rows" :key="row.character.id" class="tc-row">
        <span class="tc-name-col">
          <span class="tc-portrait" :style="{ background: typeBgColor(row.character.type) }">
            <img :src="row.character.imageUrl || asset(`image/CHARA/${row.character.name}.png`)" class="img-icon" :alt="row.character.name">
          </span>
          <span class="tc-name">{{ row.character.name }}</span>
        </span>

        <!-- A tie is shown as a tie. イーブイ's second type is a genuine one-all draw, and
             printing whichever the tally happened to reach first would be a confident answer
             the cards don't support. -->
        <span class="tc-col">
          <template v-if="row.main.length > 0">
            <span v-for="type in row.main" :key="type" class="tc-type">
              <img :src="asset(`image/ICON/${type}.png`)" class="img-icon" :alt="type">
            </span>
          </template>
          <span v-else class="tc-none">{{ t('typeChart.colorlessOnly') }}</span>
        </span>

        <span class="tc-col">
          <template v-if="row.secondary.length > 0">
            <span v-for="type in row.secondary" :key="type" class="tc-type">
              <img :src="asset(`image/ICON/${type}.png`)" class="img-icon" :alt="type">
            </span>
          </template>
          <span v-else class="tc-none">—</span>
        </span>

        <span class="tc-col tc-weak-col">
          <span v-for="w in row.character.weaknesses" :key="w.type" class="tc-type tc-weak">
            <img :src="asset(`image/ICON/${w.type}.png`)" class="img-icon" :alt="w.type">
            <span v-if="uniformWeakness === null" class="tc-weak-amount">+{{ w.damage }}</span>
          </span>
          <span v-if="row.character.weaknesses.length === 0" class="tc-none">—</span>
        </span>
      </div>
    </div>

    <div style="padding:0.625rem 0 0.75rem;">
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
.tc-grid {
  width: 100%;
  max-width: 40rem;
  padding: 0 0.625rem;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.1875rem 0.375rem;
  align-content: start;
}

.tc-head {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.375rem 0.125rem;
  font-size: 0.5625rem;
  font-weight: 800;
  color: var(--sub);
}

.tc-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: var(--card);
  border-radius: 0.5rem;
  padding: 0.1875rem 0.375rem;
}

.tc-name-col {
  display: flex;
  align-items: center;
  gap: 0.3125rem;
  flex: 1 1 auto;
  min-width: 0;
}

.tc-portrait {
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.tc-name {
  font-size: 0.6875rem;
  font-weight: 800;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Fixed width so the three type columns line up down the list and can be read as columns
   rather than as three things that happen to follow each name. */
.tc-col {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.125rem;
  width: 2.5rem;
  flex-shrink: 0;
}

.tc-weak-col { width: 2.75rem; }

.tc-type {
  display: inline-flex;
  align-items: center;
  gap: 0.0625rem;
  width: 1.125rem;
  height: 1.125rem;
}

.tc-weak { width: auto; }
.tc-weak-amount { font-size: 0.5625rem; font-weight: 800; color: var(--ink); }
.tc-none { font-size: 0.5625rem; font-weight: 700; color: var(--sub); }
</style>
