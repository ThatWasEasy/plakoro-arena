<script setup>
// The shelf: which chapters this player holds, and a way into them.
//
// Lives inside #stage like every other mode, because browsing is the same kind of activity as
// the rest of the app. Only the reader steps outside — see HandbookReader.vue.
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { currentIdentity } from '../../data/currentPlayer'
import { fetchManifest, isPrototype } from '../../data/handbookSource'
import HandbookReader from './HandbookReader.vue'

defineEmits(['back'])
const { t } = useI18n()

const units = ref([])
const loading = ref(true)
const error = ref('')
const open = ref(null)

// Stand-in for `player_unlocks` until the endpoint exists. Deliberately a plain list rather
// than something clever: the real version replaces it with what the server says this player
// owns, and nothing else about this screen changes.
const PROTOTYPE_OWNED = new Set(['base', 'chara.STW04', 'chara.EBC02-001', 'chara.EBC02-006'])
const showAll = ref(false)

const owned = unit => showAll.value || (isPrototype
  ? PROTOTYPE_OWNED.has(unit.id)
  : unit.owned === true)

const groups = computed(() => {
  const by = new Map()
  for (const u of units.value) {
    const key = u.group || ''
    if (!by.has(key)) by.set(key, [])
    by.get(key).push(u)
  }
  return [...by].map(([title, items]) => ({ title, items }))
})

const ownedCount = computed(() => units.value.filter(owned).length)

// Each page carries the reader's own code, so a screenshot that travels says where it came
// from. Only meaningful for a signed-in player; a guest has nothing to stamp.
const watermark = computed(() => currentIdentity.value?.code || '')

function enter(u) {
  // Checked here as well as in the markup: a disabled button is a courtesy, not a rule. The
  // rule is the server's 404, and this mirrors where it lives.
  if (!owned(u)) return
  open.value = u
}

onMounted(async () => {
  try {
    const m = await fetchManifest()
    units.value = m.units || []
  } catch (e) {
    error.value = t('handbook.manifestFailed')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="board select-board hb-board">
    <div class="modal-title">{{ t('handbook.title') }}</div>

    <div v-if="isPrototype" class="hb-proto">
      {{ t('handbook.prototypeNote') }}
      <label><input v-model="showAll" type="checkbox"> {{ t('handbook.unlockAll') }}</label>
    </div>

    <div v-if="loading" class="hb-state">{{ t('handbook.loading') }}</div>
    <div v-else-if="error" class="hb-state">{{ error }}</div>
    <div v-else-if="!units.length" class="hb-state">{{ t('handbook.empty') }}</div>

    <template v-else>
      <div class="hb-summary">{{ t('handbook.ownedCount', { n: ownedCount, total: units.length }) }}</div>
      <div class="hb-scroll">
        <template v-for="g in groups" :key="g.title || '_'">
          <div v-if="g.title" class="hb-group">{{ g.title }}</div>
          <div class="hb-grid">
            <button
              v-for="u in g.items"
              :key="u.id"
              class="hb-card"
              :class="{ locked: !owned(u) }"
              :disabled="!owned(u)"
              @click="enter(u)"
            >
              <span class="hb-mark">{{ owned(u) ? '📘' : '🔒' }}</span>
              <span class="hb-name">{{ u.title }}</span>
              <span class="hb-pages">{{ t('handbook.pages', { n: u.pages }) }}</span>
            </button>
          </div>
        </template>
      </div>
    </template>

    <div class="hb-foot">
      <button class="btn secondary" @click="$emit('back')">{{ t('common.back') }}</button>
    </div>

    <HandbookReader v-if="open" :unit="open" :watermark="watermark" @close="open = null" />
  </div>
</template>

<style scoped>
/* Inside the stage, so rem throughout — the reader is the exception, not this. */
.hb-board { align-items: stretch; }
.hb-proto {
  margin: 0 0.625rem 0.375rem;
  padding: 0.3125rem 0.5rem;
  border: 0.0625rem dashed var(--line);
  border-radius: 0.375rem;
  font-size: 0.5625rem;
  color: var(--sub);
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex-wrap: wrap;
}
.hb-proto label { display: flex; align-items: center; gap: 0.25rem; color: var(--ink); font-weight: 700; }
.hb-summary { padding: 0 0.625rem 0.25rem; font-size: 0.625rem; font-weight: 700; color: var(--sub); }
.hb-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 0.625rem 0.5rem; }
.hb-group {
  font-size: 0.5625rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--sub);
  padding: 0.5rem 0.125rem 0.25rem;
}
.hb-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.375rem; }
.hb-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
  padding: 0.375rem 0.4375rem;
  border: 0.0625rem solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.hb-card:active { transform: scale(.97); }
/* Readable, not erased: a chapter you have not bought is still something you want to see the
   name of — that is what makes it buyable. */
.hb-card.locked { background: #F3F2EC; color: var(--sub); cursor: default; }
.hb-mark { font-size: 0.6875rem; line-height: 1; }
.hb-name { font-size: 0.6875rem; font-weight: 800; color: inherit; }
.hb-card:not(.locked) .hb-name { color: var(--ink); }
.hb-pages { font-size: 0.5rem; color: var(--sub); font-variant-numeric: tabular-nums; }
.hb-state { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: var(--sub); text-align: center; padding: 1rem; }
.hb-foot { flex: none; display: flex; justify-content: center; padding: 0.375rem 0 0.25rem; }
</style>
