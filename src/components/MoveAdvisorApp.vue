<script setup>
import { computed, inject, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../data/constants'
import { asset } from '../data/assetPath'
import { printedMoves } from '../composables/useCharacterData'
import { recommendDeck, DECK_SIZE, JUDGED_DICE } from '../game/recommendDeck'
import { buildTempoTable } from '../game/tempoValue'

const emit = defineEmits(['back'])
const { characters, moves } = inject('characterData')
const { t } = useI18n()

// A tournament team is three, which is the only reason for the cap: past three the screen
// stops being a team sheet and turns back into the roster.
const TEAM_SIZE = 3
const picked = ref([])

// The two floors a player sets when they expect to be short of energy. They are printed
// costs, because that is what a player counts when reading a card — see chooseDeck.
const COST_FLOORS = [1, 2]
const floors = ref([])

function togglePick(character) {
  const at = picked.value.indexOf(character.id)
  if (at >= 0) picked.value.splice(at, 1)
  else if (picked.value.length < TEAM_SIZE) picked.value.push(character.id)
}

function toggleFloor(cost) {
  const at = floors.value.indexOf(cost)
  if (at >= 0) floors.value.splice(at, 1)
  else floors.value.push(cost)
}

// Pricing what a move denies the opponent means evaluating the whole roster against itself
// several times over — a few hundred milliseconds, which would stall the first paint. It is
// built once, off the reactive graph, the first time a character is picked, and the
// recommendations recompute when it lands.
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

watch(picked, list => { if (list.length > 0) ensureTempoTable() }, { deep: true })

const teams = computed(() =>
  picked.value
    .map(id => characters.value.find(c => c.id === id))
    .filter(Boolean)
    .map(character => recommendDeck(character, moves.value, {
      tempoValues: tempoTable.value,
      costFloors: [...floors.value].sort((a, b) => a - b)
    }))
    .filter(Boolean)
)

// The printed name is the one on the card in the player's hand; the translated name is only
// worth a second line when it actually differs from it.
function printedName(mv) {
  const base = printedMoves[mv.id]
  return base ? base.name : mv.name
}
function translatedName(mv) {
  const printed = printedName(mv)
  return mv.name && mv.name !== printed ? mv.name : null
}

function effectLines(mv) {
  const lines = []
  if (mv.effect) lines.push({ text: mv.effect, orientations: null })
  mv.chara.forEach(ce => { if (ce.text) lines.push({ text: ce.text, orientations: ce.orientations }) })
  return lines
}
</script>

<template>
  <div class="board select-board" style="overflow-y:auto; align-items:center;">
    <div class="modal-title" style="margin:0.5rem 0 0.25rem;">{{ t('moveAdvisor.title') }}</div>
    <div class="center-hint" style="padding-bottom:0.375rem;">{{ t('moveAdvisor.hint', { team: TEAM_SIZE, deck: DECK_SIZE }) }}</div>

    <div class="ma-roster">
      <button
        v-for="c in characters"
        :key="c.id"
        class="ma-pick"
        :class="{ 'ma-pick-on': picked.includes(c.id) }"
        :disabled="!picked.includes(c.id) && picked.length >= TEAM_SIZE"
        :style="{ background: typeBgColor(c.type) }"
        @click="togglePick(c)"
      >
        <img :src="c.imageUrl || asset(`image/CHARA/${c.name}.png`)" class="img-icon" :alt="c.name">
        <span v-if="picked.includes(c.id)" class="ma-pick-order">{{ picked.indexOf(c.id) + 1 }}</span>
      </button>
    </div>

    <div class="ma-floors">
      <label v-for="cost in COST_FLOORS" :key="cost" class="ma-floor">
        <input type="checkbox" :checked="floors.includes(cost)" @change="toggleFloor(cost)">
        {{ t('moveAdvisor.floor', { n: cost }) }}
      </label>
      <span v-if="tempoPending" class="ma-note">{{ t('moveAdvisor.calculating') }}</span>
    </div>
    <div class="center-hint" style="padding:0 0.75rem 0.5rem; line-height:1.6;">{{ t('moveAdvisor.floorWhy') }}</div>

    <div v-if="teams.length === 0" class="center-hint" style="padding:1.5rem 0.75rem;">{{ t('moveAdvisor.empty') }}</div>

    <div v-else class="ma-teams">
      <div v-for="team in teams" :key="team.character.id" class="ma-team">
        <div class="ma-team-head">
          <span class="ma-portrait" :style="{ background: typeBgColor(team.character.type) }">
            <img :src="team.character.imageUrl || asset(`image/CHARA/${team.character.name}.png`)" class="img-icon" :alt="team.character.name">
          </span>
          <span class="ma-team-name">{{ team.character.name }}</span>
          <!-- What the deck is worth in rotation, and what survives a die being taken away.
               Both are shown because the floors exist to trade between them. -->
          <span class="ma-rotation">
            <span v-for="(value, i) in team.rotation" :key="i" class="ma-rot">
              <span class="ma-rot-label">{{ t('moveAdvisor.dice', { n: JUDGED_DICE[i] }) }}</span>
              <span class="ma-rot-value">{{ value.toFixed(1) }}</span>
            </span>
          </span>
        </div>

        <div v-if="team.unmet.length > 0" class="ma-unmet">
          {{ t('moveAdvisor.unmet', { costs: team.unmet.join('・') }) }}
        </div>

        <div v-for="(entry, i) in team.deck" :key="entry.mv.id" class="ma-move">
          <span class="ma-slot">{{ i + 1 }}</span>
          <span class="ma-move-type"><img :src="asset(`image/ICON/${entry.mv.type}.png`)" class="img-icon" :alt="entry.mv.type"></span>

          <span class="ma-move-body">
            <span class="ma-move-line">
              <span class="ma-move-name">{{ printedName(entry.mv) }}</span>
              <span v-if="translatedName(entry.mv)" class="ma-move-alt">{{ translatedName(entry.mv) }}</span>
            </span>
            <span class="ma-move-line">
              <span class="ma-cost">
                <span v-for="(type, ci) in entry.mv.cost" :key="ci" class="ma-cost-pip">
                  <img :src="asset(`image/ICON/${type}.png`)" class="img-icon" :alt="type">
                </span>
                <span v-if="entry.mv.cost.length === 0" class="ma-move-alt">{{ t('moveAdvisor.free') }}</span>
              </span>
              <span class="ma-damage">{{ entry.mv.baseDamage }}</span>
            </span>
            <span v-for="(line, li) in effectLines(entry.mv)" :key="li" class="ma-effect">
              <span v-if="line.orientations" class="ma-effect-die">{{ line.orientations.join('') }}</span>{{ line.text }}
            </span>
          </span>

          <span class="ma-ev">{{ entry.ev.toFixed(1) }}</span>
        </div>
      </div>
    </div>

    <div class="center-hint" style="padding:0.5rem 0.75rem 0; line-height:1.6;">{{ t('moveAdvisor.assumptions') }}</div>

    <div style="padding:0.625rem 0 0.75rem;">
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
.ma-roster {
  width: 100%;
  max-width: 34rem;
  padding: 0 0.625rem 0.375rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.25rem;
}

.ma-pick {
  position: relative;
  width: 2.25rem;
  height: 2.25rem;
  border: 0.125rem solid transparent;
  border-radius: 50%;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  opacity: 0.55;
}

.ma-pick-on { opacity: 1; border-color: var(--ink); }
.ma-pick:disabled { opacity: 0.25; cursor: default; }

.ma-pick-order {
  position: absolute;
  right: 0;
  bottom: 0;
  min-width: 0.875rem;
  font-size: 0.5625rem;
  font-weight: 900;
  color: var(--card);
  background: var(--ink);
  border-radius: 0.5rem;
}

.ma-floors {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex-wrap: wrap;
  justify-content: center;
  padding: 0 0.625rem 0.1875rem;
}

.ma-floor {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.625rem;
  font-weight: 800;
  color: var(--sub);
  cursor: pointer;
}

.ma-floor input { width: 0.75rem; height: 0.75rem; margin: 0; }
.ma-note { font-size: 0.625rem; font-weight: 700; color: var(--sub); }

.ma-teams {
  width: 100%;
  max-width: 34rem;
  padding: 0 0.625rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ma-team {
  background: var(--card);
  border-radius: 0.5rem;
  padding: 0.3125rem 0.375rem 0.375rem;
  display: flex;
  flex-direction: column;
  gap: 0.1875rem;
}

.ma-team-head { display: flex; align-items: center; gap: 0.3125rem; }

.ma-portrait {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.ma-team-name { font-size: 0.75rem; font-weight: 900; color: var(--ink); flex: 1 1 auto; min-width: 0; }
.ma-rotation { display: flex; gap: 0.375rem; flex-shrink: 0; }
.ma-rot { display: flex; align-items: baseline; gap: 0.125rem; }
.ma-rot-label { font-size: 0.5rem; font-weight: 800; color: var(--sub); }
.ma-rot-value { font-size: 0.6875rem; font-weight: 900; color: var(--ink); }

.ma-unmet {
  font-size: 0.5625rem;
  font-weight: 800;
  color: var(--sub);
  background: var(--line);
  border-radius: 0.25rem;
  padding: 0.125rem 0.25rem;
  line-height: 1.5;
}

.ma-move {
  display: flex;
  align-items: flex-start;
  gap: 0.25rem;
  border-top: 0.0625rem solid var(--line);
  padding-top: 0.1875rem;
}

.ma-slot { font-size: 0.5625rem; font-weight: 900; color: var(--sub); min-width: 0.625rem; padding-top: 0.125rem; }
.ma-move-type { width: 0.875rem; height: 0.875rem; flex-shrink: 0; padding-top: 0.0625rem; }
.ma-move-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.0625rem; }
.ma-move-line { display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
.ma-move-name { font-size: 0.6875rem; font-weight: 900; color: var(--ink); }
.ma-move-alt { font-size: 0.5625rem; font-weight: 700; color: var(--sub); }
.ma-cost { display: inline-flex; align-items: center; gap: 0.0625rem; }
.ma-cost-pip { width: 0.75rem; height: 0.75rem; }
.ma-damage { font-size: 0.625rem; font-weight: 900; color: var(--ink); }

.ma-effect {
  font-size: 0.5625rem;
  font-weight: 700;
  color: var(--sub);
  line-height: 1.5;
}

.ma-effect-die { font-weight: 900; color: var(--ink); padding-right: 0.1875rem; }
.ma-ev { font-size: 0.75rem; font-weight: 900; color: var(--ink); min-width: 2rem; text-align: right; flex-shrink: 0; }
</style>
