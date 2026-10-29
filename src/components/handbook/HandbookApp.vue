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
import { mostRecent, pageOf, startedOf } from '../../data/handbookProgress'
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

// Where to pick back up. A 190-page book cut into 27 chapters needs a way in that is not
// "find your place again" — without it the shelf is a pile.
const showIndex = ref(false)

// Jump targets for the quick index. The shelf is 27 rows tall; without this, reaching
// 探險盒 01 means scrolling past every starter.
const jumps = computed(() => {
  const out = [{ id: '__top', label: t('handbook.title') }]
  for (const sec of sections.value) {
    if (sec.title) out.push({ id: 'g' + sec.title, label: sec.title })
  }
  return out
})

function jumpTo(id) {
  showIndex.value = false
  const el = id === '__top'
    ? document.querySelector('.hb-sheet')
    : document.getElementById(id)
  el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

const resume = computed(() => mostRecent(units.value.filter(owns)))
const resumePct = computed(() => {
  const r = resume.value
  return r && r.pages ? Math.min(100, Math.round(r.page / r.pages * 100)) : 0
})
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
        <button
          v-if="units.length"
          class="hb-x hb-idx"
          :class="{ on: showIndex }"
          :aria-label="t('handbook.quickIndex')"
          @click="showIndex = !showIndex"
        >☰</button>
        <button class="hb-x" :aria-label="t('common.back')" @click="emit('back')">✕</button>
      </header>

      <div v-if="isPrototype" class="hb-proto">
        <span>{{ t('handbook.prototypeNote') }}</span>
        <label><input v-model="showAll" type="checkbox">{{ t('handbook.unlockAll') }}</label>
      </div>

      <!-- Toggled, not always on: it is a shortcut for a long page, and a permanent rail
           would spend space the shelf is already short of on a phone. -->
      <div v-if="showIndex" class="hb-jump" @click.self="showIndex = false">
        <div class="hb-jump-sheet">
          <button v-for="j in jumps" :key="j.id" class="hb-jump-row" @click="jumpTo(j.id)">
            <span>{{ j.label }}</span><span class="hb-go">❯</span>
          </button>
        </div>
      </div>

      <div v-if="loading" class="hb-state">{{ t('handbook.loading') }}</div>
      <div v-else-if="error" class="hb-state">{{ error }}</div>
      <div v-else-if="!units.length" class="hb-state">{{ t('handbook.empty') }}</div>

      <div v-else class="hb-scroll">
        <div class="hb-sheet">

          <!-- The book itself, before its parts. A shelf that opens straight into a list of
               chapters never says what the thing is; this is also the one place the product
               gets to look like a product. -->
          <div class="hb-hero">
            <div class="hb-vol">
              <span class="hb-vol-pub">PLAKORO TAIWAN</span>
              <span class="hb-vol-name">秘笈<br>手冊</span>
              <span class="hb-vol-ed">2026 EDITION</span>
            </div>
          </div>

          <!-- Only once something has actually been opened. An empty "continue reading" card
               is a promise the shelf has not earned yet. -->
          <button v-if="resume" class="hb-resume" @click="enter(resume.unit)">
            <span class="hb-resume-lab">{{ t('handbook.continue') }}</span>
            <span class="hb-resume-name">{{ label(resume.unit) }}</span>
            <span class="hb-resume-pos">{{ resume.page }} / {{ resume.pages }}</span>
            <span class="hb-progress"><i :style="{ width: resumePct + '%' }"></i></span>
          </button>

          <section v-for="(sec, i) in sections" :key="i">
            <h2 v-if="sec.title" :id="'g' + sec.title" class="hb-group"><span>{{ sec.title }}</span></h2>

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
                  <span v-else-if="startedOf(u.id)" class="hb-dot" aria-hidden="true">●</span>
                  <span class="hb-entry-pages">{{ t('handbook.pages', { n: u.pages }) }}</span>
                  <span v-if="owns(u)" class="hb-go" aria-hidden="true">❯</span>
                </button>
              </li>
            </ul>

            <!-- Characters as rows, same slip as the chapters above, with the figure standing
                 out past the top edge. The overflow is the whole point: it turns a list into a
                 line-up, which is how you pick a character. -->
            <ul v-else class="hb-roster">
              <li v-for="u in sec.items" :key="u.id">
                <button
                  class="hb-pick"
                  :class="{ locked: !owns(u) }"
                  :style="{ '--tint': tint(u) }"
                  :disabled="!owns(u)"
                  @click="enter(u)"
                >
                  <span class="hb-figure"><img :src="art(u)" :alt="u.title" loading="lazy"></span>
                  <span class="hb-pick-name">{{ u.title }}</span>
                  <span class="hb-leader" aria-hidden="true"></span>
                  <span v-if="!owns(u)" class="hb-entry-lock">{{ t('handbook.lockedShort') }}</span>
                  <span v-else-if="startedOf(u.id)" class="hb-dot" aria-hidden="true">●</span>
                  <span class="hb-entry-pages">{{ t('handbook.pages', { n: u.pages }) }}</span>
                  <span v-if="owns(u)" class="hb-go" aria-hidden="true">❯</span>
                </button>
              </li>
            </ul>
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

.hb-idx.on { background: #F0E4CC; color: #2C2117; }

.hb-jump {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: rgba(20, 16, 10, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
}
.hb-jump-sheet {
  margin: 8px 10px 0 0;
  min-width: 170px;
  padding: 6px;
  background: #EDE0C8;
  border: 1px solid #A9865A;
  box-shadow: 3px 4px 0 rgba(95, 70, 40, .3);
}
.hb-jump-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  padding: 10px 10px;
  border: 0;
  border-bottom: 1px solid rgba(195, 167, 127, .5);
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.hb-jump-row:last-child { border-bottom: 0; }

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

/* --- the volume itself --- */
.hb-hero {
  display: grid;
  place-items: center;
  padding: 26px 0 30px;
}
.hb-vol {
  width: 150px;
  height: 206px;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: linear-gradient(150deg, #33281C, #19130D);
  color: #F0E4CC;
  /* A spine and a stacked shadow, so it reads as an object with thickness rather than a
     rectangle with a gradient. */
  border-left: 7px solid #4A3A27;
  box-shadow: 7px 8px 0 rgba(95, 70, 40, .22), 12px 14px 22px rgba(60, 42, 20, .3);
  transform: rotate(-4deg);
}
.hb-vol-pub { font-size: 8px; letter-spacing: .24em; color: #C8A86A; }
.hb-vol-name { font-size: 30px; font-weight: 700; line-height: 1.18; letter-spacing: .06em; }
.hb-vol-ed { font-size: 8.5px; letter-spacing: .2em; color: rgba(240, 228, 204, .62); }

/* --- continue reading --- */
.hb-resume {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 10px;
  width: 100%;
  margin-bottom: 24px;
  padding: 12px 14px;
  border: 1px solid rgba(150, 118, 74, .5);
  background: rgba(255, 252, 243, .62);
  box-shadow: 2px 2px 0 rgba(120, 90, 50, .18);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hb-resume:active { transform: translate(1px, 1px); box-shadow: none; }
.hb-resume-lab { grid-column: 1 / -1; font-size: 9.5px; letter-spacing: .22em; color: var(--ink-soft); }
.hb-resume-name { font-size: 16px; font-weight: 700; }
.hb-resume-pos { font-size: 11px; color: var(--ink-soft); font-variant-numeric: tabular-nums; align-self: end; }
.hb-progress { grid-column: 1 / -1; height: 3px; margin-top: 7px; background: rgba(150, 118, 74, .25); }
.hb-progress i { display: block; height: 100%; background: #6B5234; }

/* name is hb-progress, not hb-bar: the header is .hb-bar, and the collision gave the header
   the progress bar's 3px height — the title all but vanished. */
/* A chapter already opened, marked where the lock would be. Quiet on purpose — it is a
   reminder, not a status to act on. */
.hb-dot { flex: none; font-size: 7px; color: #9A7F55; }

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
section:first-child /* --- the volume itself --- */
.hb-hero {
  display: grid;
  place-items: center;
  padding: 26px 0 30px;
}
.hb-vol {
  width: 150px;
  height: 206px;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: linear-gradient(150deg, #33281C, #19130D);
  color: #F0E4CC;
  /* A spine and a stacked shadow, so it reads as an object with thickness rather than a
     rectangle with a gradient. */
  border-left: 7px solid #4A3A27;
  box-shadow: 7px 8px 0 rgba(95, 70, 40, .22), 12px 14px 22px rgba(60, 42, 20, .3);
  transform: rotate(-4deg);
}
.hb-vol-pub { font-size: 8px; letter-spacing: .24em; color: #C8A86A; }
.hb-vol-name { font-size: 30px; font-weight: 700; line-height: 1.18; letter-spacing: .06em; }
.hb-vol-ed { font-size: 8.5px; letter-spacing: .2em; color: rgba(240, 228, 204, .62); }

/* --- continue reading --- */
.hb-resume {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 10px;
  width: 100%;
  margin-bottom: 24px;
  padding: 12px 14px;
  border: 1px solid rgba(150, 118, 74, .5);
  background: rgba(255, 252, 243, .62);
  box-shadow: 2px 2px 0 rgba(120, 90, 50, .18);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.hb-resume:active { transform: translate(1px, 1px); box-shadow: none; }
.hb-resume-lab { grid-column: 1 / -1; font-size: 9.5px; letter-spacing: .22em; color: var(--ink-soft); }
.hb-resume-name { font-size: 16px; font-weight: 700; }
.hb-resume-pos { font-size: 11px; color: var(--ink-soft); font-variant-numeric: tabular-nums; align-self: end; }
.hb-progress { grid-column: 1 / -1; height: 3px; margin-top: 7px; background: rgba(150, 118, 74, .25); }
.hb-progress i { display: block; height: 100%; background: #6B5234; }

/* name is hb-progress, not hb-bar: the header is .hb-bar, and the collision gave the header
   the progress bar's 3px height — the title all but vanished. */
/* A chapter already opened, marked where the lock would be. Quiet on purpose — it is a
   reminder, not a status to act on. */
.hb-dot { flex: none; font-size: 7px; color: #9A7F55; }

.hb-group { margin-top: 6px; }

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

/* --- characters, set as a line-up --- */
.hb-roster { list-style: none; margin: 0; padding: 0; }
/* Room for the figure to stand above the slip without touching the row before it. */
.hb-roster li + li { margin-top: 20px; }

.hb-pick {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 56px;
  /* Left inset is the figure's lane; the artwork sits in it and rises out of the top. */
  padding: 10px 12px 10px 92px;
  border: 1px solid transparent;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  /* Not hidden: the figure breaking the frame is the effect, not a mistake. */
  overflow: visible;
  transition: transform .1s ease;
}
.hb-pick:not(.locked) {
  border-color: rgba(150, 118, 74, 0.45);
  /* The character's type, washed into the paper from the figure's side rather than filling
     the row — a tinted slip, not a coloured button. */
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--tint) 55%, transparent), rgba(255, 252, 243, 0.6) 62%);
  box-shadow: 1px 1px 0 rgba(120, 90, 50, 0.16);
}
.hb-pick:not(.locked):active { transform: translate(1px, 1px); box-shadow: none; }
.hb-pick.locked { border-bottom-color: rgba(195, 167, 127, 0.45); }

.hb-figure {
  position: absolute;
  left: 2px;
  bottom: -2px;
  width: 86px;
  /* Taller than the row, so the figure clears the top edge. */
  height: 84px;
  pointer-events: none;
}
.hb-figure img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom;
  display: block;
  /* multiply so the portrait's white JPEG ground sinks into the paper.
     No drop-shadow: the source is an opaque rectangle, so the shadow it cast was a rectangle
     too — a grey box standing behind every unlocked figure. */
  mix-blend-mode: multiply;
}
.hb-pick.locked .hb-figure img { filter: sepia(.5) saturate(.35); opacity: .5; }

.hb-pick-name { font-size: 15px; font-weight: 700; }
.hb-pick.locked .hb-pick-name { color: var(--ink-soft); font-weight: 600; }

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
  .hb-pick { min-height: 64px; padding-left: 108px; }
  .hb-figure { width: 100px; height: 98px; }
}
</style>
