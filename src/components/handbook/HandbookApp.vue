<script setup>
// The shelf.
//
// Portrait and full-screen, like the reader — the whole mode steps outside #stage rather than
// only the reading view. Browsing a book and reading it are one activity, and making someone
// turn their phone between the two was the wrong seam to put a transition on.
//
// Dressed as an old document: aged paper, sepia ink, a serif face and ruled entries, because
// that is what this is — a manual, not a settings screen. The texture is a 17KB crop of the
// reference sheet rather than CSS gradients pretending to be paper, and the type does most of
// the work: a serif at a generous size reads as a book the moment it appears.
//
// Character chapters still carry their own artwork. Twenty-one of the twenty-six units are
// characters and the app already holds their portraits; numbering them instead would throw
// away the one thing that makes the shelf scannable.
import { computed, inject, onMounted, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { asset } from '../../data/assetPath'
import { typeBgColor } from '../../data/constants'
import { currentIdentity } from '../../data/currentPlayer'
import { fetchManifest, isPrototype } from '../../data/handbookSource'
import HandbookReader from './HandbookReader.vue'

const emit = defineEmits(['back'])
const { t } = useI18n()
const { characters } = inject('characterData')

const units = ref([])
const loading = ref(true)
const error = ref('')
const open = ref(null)

// Stand-in for `player_unlocks` until the endpoint exists. Deliberately a plain list: the real
// version replaces it with what the server says this player owns, and nothing else changes.
const PROTOTYPE_OWNED = new Set(['front', 'ch1', 'chara.STW04', 'chara.EBC02-001'])
const showAll = ref(false)
const owns = u => showAll.value || (isPrototype ? PROTOTYPE_OWNED.has(u.id) : u.owned === true)

// The handbook names characters the way the book does and the app names them the way the cards
// do (STW01 against STC01-001), so the join is on the displayed name — which both sides take
// from the same translation table.
const byName = computed(() => {
  const m = new Map()
  for (const c of characters.value) m.set(c.name, c)
  return m
})

// "一、PLAKORO 基礎規則" carries its own numbering, which is right in a printed contents list
// and wrong beside a seal showing the same character twice.
function numeral(u) {
  if (u.kind !== 'chapter') return ''
  const n = u.title.charAt(0)
  // The front matter is titled 序 with no numbering to strip, so the seal would repeat the
  // title back at itself. It gets a printer's ornament instead.
  return u.title === label(u) ? '❧' : n
}
function label(u) {
  return u.kind === 'chapter' ? u.title.replace(/^[^、]+、\s*/, '') : u.title
}

function art(u) {
  const c = byName.value.get(u.title)
  return c?.imageUrl || null
}
function tint(u) {
  const c = byName.value.get(u.title)
  return c ? typeBgColor(c.type) : '#E7E5DC'
}

// Chapters read as a contents list; characters read as plates. Grouping keeps them apart
// without needing a tab bar — the book's own order already separates them.
const sections = computed(() => {
  const out = []
  for (const u of units.value) {
    const key = u.kind === 'character' ? (u.group || '') : ''
    const kind = u.kind === 'character' ? 'plates' : 'list'
    const last = out[out.length - 1]
    if (last && last.key === key && last.kind === kind) last.items.push(u)
    else out.push({ key, kind, title: key, items: [u] })
  }
  return out
})

const ownedCount = computed(() => units.value.filter(owns).length)
const watermark = computed(() => currentIdentity.value?.code || '')

function enter(u) {
  // Checked here as well as in the markup: a disabled button is a courtesy, the rule is the
  // server's 404, and this mirrors where that rule lives.
  if (owns(u)) open.value = u
}

function onKey(e) {
  if (e.key === 'Escape' && !open.value) emit('back')
}

onMounted(async () => {
  document.addEventListener('keydown', onKey)
  document.body.style.overflow = 'hidden'
  try {
    units.value = (await fetchManifest()).units || []
  } catch (e) {
    error.value = t('handbook.manifestFailed')
  } finally {
    loading.value = false
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div class="hb">
      <header class="hb-bar">
        <div class="hb-bar-wrap">
          <div class="hb-bar-title">{{ t('handbook.title') }}</div>
          <div v-if="units.length" class="hb-bar-count">
            {{ t('handbook.ownedCount', { n: ownedCount, total: units.length }) }}
          </div>
        </div>
        <button class="hb-x" :aria-label="t('common.back')" @click="emit('back')">✕</button>
      </header>

      <div v-if="isPrototype" class="hb-proto">
        <span>{{ t('handbook.prototypeNote') }}</span>
        <label><input v-model="showAll" type="checkbox">{{ t('handbook.unlockAll') }}</label>
      </div>

      <div v-if="loading" class="hb-state">{{ t('handbook.loading') }}</div>
      <div v-else-if="error" class="hb-state">{{ error }}</div>
      <div v-else-if="!units.length" class="hb-state">{{ t('handbook.empty') }}</div>

      <div v-else class="hb-scroll">
        <div class="hb-sheet">
          <section v-for="(sec, i) in sections" :key="i">
            <h2 v-if="sec.title" class="hb-group"><span>{{ sec.title }}</span></h2>

            <!-- Chapters as a contents list: numeral, title, leader, extent. The shape a
                 printed manual uses, because it is the shape that makes a list of chapters
                 readable at a glance. -->
            <ul v-if="sec.kind === 'list'" class="hb-toc">
              <li v-for="u in sec.items" :key="u.id">
                <button class="hb-entry" :class="{ locked: !owns(u) }" :disabled="!owns(u)" @click="enter(u)">
                  <span class="hb-seal">{{ numeral(u) }}</span>
                  <span class="hb-entry-title">{{ label(u) }}</span>
                  <span class="hb-leader" aria-hidden="true"></span>
                  <span v-if="!owns(u)" class="hb-entry-lock">{{ t('handbook.lockedShort') }}</span>
                  <span class="hb-entry-pages">{{ t('handbook.pages', { n: u.pages }) }}</span>
                  <!-- The one thing that says "this opens". An engraver's fist rather than a
                       chevron: the row has to look pressable without looking like a web link. -->
                  <span v-if="owns(u)" class="hb-go" aria-hidden="true">❯</span>
                </button>
              </li>
            </ul>

            <!-- Characters as plates. -->
            <div v-else class="hb-plates">
              <button
                v-for="u in sec.items"
                :key="u.id"
                class="hb-plate"
                :class="{ locked: !owns(u) }"
                :disabled="!owns(u)"
                @click="enter(u)"
              >
                <span class="hb-frame" :style="{ '--tint': tint(u) }">
                  <img :src="art(u)" :alt="u.title" loading="lazy">
                </span>
                <span class="hb-plate-name">{{ u.title }}</span>
                <span class="hb-plate-pages">
                  {{ owns(u) ? t('handbook.pages', { n: u.pages }) : t('handbook.lockedShort') }}
                </span>
              </button>
            </div>
          </section>
        </div>
      </div>

      <HandbookReader v-if="open" :unit="open" :watermark="watermark" @close="open = null" />
    </div>
  </Teleport>
</template>

<style scoped>
/* Outside #stage, so px and viewport units — the root font-size tracks the stage's short edge
   and this screen has no relationship to it. Same reasoning as HandbookReader. */
.hb {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  flex-direction: column;
  /* Sepia ink rather than black: on paper, black never appears, and the difference is most of
     why a page reads as a document instead of a dialog. */
  --ink: #3E2F22;
  --ink-soft: #7A6753;
  --rule: #C3A77F;
  --paper: #EDE0C8;
  background: var(--paper);
  color: var(--ink);
  font-family: "Noto Serif TC", "Songti TC", "Hiragino Mincho ProN", "Source Han Serif TC", serif;
}

.hb-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: max(10px, env(safe-area-inset-top)) 16px 11px;
  background: #2C2117;
  color: #F0E4CC;
  border-bottom: 3px double var(--rule);
}
.hb-bar-wrap { flex: 1; min-width: 0; }
.hb-bar-title { font-size: 19px; font-weight: 700; letter-spacing: 0.22em; }
.hb-bar-count { font-size: 10px; letter-spacing: 0.1em; color: rgba(240, 228, 204, 0.6); font-variant-numeric: tabular-nums; }
.hb-x {
  flex: none;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(240, 228, 204, 0.35);
  background: none;
  color: #F0E4CC;
  font-size: 13px;
  cursor: pointer;
}

.hb-proto {
  flex: none;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  padding: 6px 16px;
  background: #DCCBA6;
  border-bottom: 1px solid var(--rule);
  font-size: 11px;
  color: #6B5636;
  font-family: system-ui, sans-serif;
}
.hb-proto label { display: flex; align-items: center; gap: 4px; font-weight: 700; color: var(--ink); }

.hb-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
/* The paper itself. A photograph of a real sheet beats any gradient at this, and at 17KB it
   costs less than the shadows it replaces. */
.hb-sheet {
  min-height: 100%;
  padding: 26px 20px 56px;
  background-image: url("/image/paper.jpg");
  background-size: 420px;
  background-blend-mode: multiply;
  background-color: #EDE0C8;
  box-shadow: inset 0 0 70px rgba(120, 90, 50, 0.25);
}

.hb-group {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 30px 0 14px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: var(--ink-soft);
}
.hb-group::before, .hb-group::after {
  content: "";
  flex: 1;
  height: 0;
  border-top: 1px solid var(--rule);
}
.hb-group span { flex: none; }
section:first-child .hb-group { margin-top: 6px; }

/* --- chapters, set as a contents list --- */
.hb-toc { list-style: none; margin: 0; padding: 0; }
/* An unlocked chapter is a slip of paper sitting on the sheet; a locked one is just a line of
   the contents list. Before this they looked identical and nothing said the row could be
   pressed — the leader dots and page number read as print, which is exactly what they are. */
.hb-entry {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px 12px 11px 10px;
  border: 1px solid transparent;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform .1s ease, background-color .1s ease;
}
.hb-toc li + li { margin-top: 6px; }
.hb-entry:not(.locked) {
  border-color: rgba(150, 118, 74, 0.45);
  background: rgba(255, 252, 243, 0.55);
  box-shadow: 1px 1px 0 rgba(120, 90, 50, 0.16);
}
.hb-entry:not(.locked):active { transform: translate(1px, 1px); box-shadow: none; }
.hb-entry.locked { border-bottom-color: rgba(195, 167, 127, 0.45); }

/* A ruled square carrying the chapter's own numeral — it gives the row an object to press and
   replaces the numbering that used to be repeated inside the title. */
.hb-seal {
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule);
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-soft);
}
.hb-entry:not(.locked) .hb-seal { color: var(--ink); border-color: rgba(120, 90, 50, 0.6); }
.hb-go { flex: none; font-size: 11px; color: var(--ink-soft); }
.hb-entry-title { font-size: 16px; font-weight: 700; }
/* Leader dots, the way a printed contents page joins a title to its page number. */
.hb-leader {
  flex: 1;
  min-width: 14px;
  align-self: center;
  height: 1px;
  background-image: radial-gradient(circle, var(--rule) 1px, transparent 1px);
  background-size: 6px 2px;
  background-repeat: repeat-x;
}
.hb-entry-pages { flex: none; font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.hb-leader { align-self: flex-end; margin-bottom: 5px; }
.hb-entry-lock {
  flex: none;
  padding: 1px 7px;
  border: 1px solid var(--rule);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  color: var(--ink-soft);
  font-family: system-ui, sans-serif;
}
.hb-entry.locked { cursor: default; }
.hb-entry.locked .hb-entry-title { color: var(--ink-soft); font-weight: 600; }

/* --- characters, set as plates --- */
.hb-plates { display: grid; grid-template-columns: repeat(auto-fill, minmax(98px, 1fr)); gap: 16px 12px; }
.hb-plate {
  transition: transform .1s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
/* A ruled frame, like a plate pasted into a manual — the tint only shows as a wash behind the
   figure, because the portraits are opaque JPEGs and would paint over a filled ground. */
.hb-frame {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  padding: 7px;
  border: 1px solid var(--rule);
  outline: 1px solid rgba(195, 167, 127, 0.4);
  outline-offset: 2px;
  background:
    linear-gradient(0deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0.55)),
    var(--tint, #D9C7A3);
}
.hb-plate:not(.locked):active { transform: translateY(1px) scale(.985); }
.hb-plate:not(.locked) .hb-frame { box-shadow: 1px 1px 0 rgba(120, 90, 50, 0.18); }
.hb-frame img { width: 100%; height: 100%; object-fit: contain; display: block; mix-blend-mode: multiply; }
.hb-plate-name { font-size: 13px; font-weight: 700; line-height: 1.25; text-align: center; }
.hb-plate-pages {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--ink-soft);
  font-variant-numeric: tabular-nums;
  font-family: system-ui, sans-serif;
}
/* Not hidden — a chapter nobody owns still has to be recognisable, because that is what makes
   it worth buying. Drained to a faded plate, with the state said in words underneath. */
.hb-plate.locked { cursor: default; }
.hb-plate.locked .hb-frame { filter: sepia(.5) saturate(.4); opacity: .55; }
.hb-plate.locked .hb-plate-name { color: var(--ink-soft); font-weight: 600; }

.hb-state {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 40px 20px;
  text-align: center;
  color: var(--ink-soft);
  font-size: 14px;
}

@media (min-width: 560px) {
  .hb-sheet { padding: 34px 32px 64px; }
  .hb-plates { grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 20px 16px; }
}
</style>
