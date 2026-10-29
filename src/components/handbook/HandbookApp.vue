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
import Icon from '../Icon.vue'
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

// The cut-out, which is what lets the figure cast a shadow and sit proud of the cover rather
// than being a white rectangle pasted into a circle. Falls back to the opaque original if a
// character was added without re-running scripts/cutout-chara.py.
function art(u) {
  const c = byName.value.get(u.title)
  // Derived from imageUrl, not from `c.name`: the roster is localised, so `name` is the
  // Chinese one while the files on disk are named in Japanese. Building the path from the
  // name sent every request to a filename that does not exist, and the fallback quietly
  // covered it up — 19 of 21 covers were still the opaque original.
  return c?.imageUrl
    ? c.imageUrl.replace('/CHARA/', '/CHARA-cut/').replace(/\.jpe?g$/i, '.webp')
    : null
}
function artFallback(e, u) {
  const c = byName.value.get(u.title)
  if (c?.imageUrl && e.target.src !== c.imageUrl) e.target.src = c.imageUrl
}
function tint(u) {
  const c = byName.value.get(u.title)
  return c ? typeBgColor(c.type) : '#E7E5DC'
}

// Chapters read as a contents list; characters read as plates. Grouping keeps them apart
// without needing a tab bar — the book's own order already separates them.
// The six main chapters stand on the shelf as one volume, because that is what they are —
// the handbook itself, beside its character supplements. They stay six separately sellable
// units underneath; opening the volume lists them with their own locks. Collapsing them into
// one product later would be a pricing change, not a rebuild.
// Which units are shelved together as one volume, and which stand alone. Driven by the
// manifest's `bundle`, which the split config decides — so moving Meta out of the main
// volume is a line in a config, not a change here.
const bundled = computed(() => {
  const m = new Map()
  for (const u of units.value) {
    if (!u.bundle) continue
    if (!m.has(u.bundle)) m.set(u.bundle, [])
    m.get(u.bundle).push(u)
  }
  return m
})
const openBundle = ref(null)
const mainUnits = computed(() => (openBundle.value ? bundled.value.get(openBundle.value) : []) || [])

const shelves = computed(() => {
  const out = []
  const seenBundles = new Set()
  for (const u of units.value) {
    const shelfTitle = u.kind === 'character' ? (u.group || '') : t('handbook.mainVolumes')
    let shelf = out.find(x => x.title === shelfTitle)
    if (!shelf) {
      shelf = { id: 's' + out.length, title: shelfTitle, items: [] }
      out.push(shelf)
    }
    if (u.bundle) {
      // One entry for the whole bundle, at the position of its first member.
      if (seenBundles.has(u.bundle)) continue
      seenBundles.add(u.bundle)
      shelf.items.push({ bundle: u.bundle, kind: 'bundle' })
    } else {
      shelf.items.push(u)
    }
  }
  return out
})

function bundleUnits(id) { return bundled.value.get(id) || [] }
function bundlePages(id) { return bundleUnits(id).reduce((n, u) => n + u.pages, 0) }
function bundleOwned(id) { return bundleUnits(id).filter(owns).length }

// What the single main volume reports on its cover.


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
  for (const sec of shelves.value) {
    if (sec.title) out.push({ id: sec.id, label: sec.title })
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
        <button v-if="resume" class="hb-resume" @click="enter(resume.unit)">
          <span class="hb-resume-lab">{{ t('handbook.continue') }}</span>
          <span class="hb-resume-name">{{ label(resume.unit) }}</span>
          <span class="hb-resume-pos">{{ resume.page }} / {{ resume.pages }}</span>
          <span class="hb-progress"><i :style="{ width: resumePct + '%' }"></i></span>
        </button>

        <!-- One shelf per group. Horizontal, because that is how books are kept and because
             27 covers stacked vertically is a page nobody reaches the bottom of. -->
        <section v-for="sec in shelves" :key="sec.id" class="hb-shelf" :id="sec.id">
          <h2 class="hb-shelf-head">
            <span>{{ sec.title }}</span>
            <!-- The main shelf holds one volume made of six chapters, so its count is the
                 chapters, not the books standing there. -->
            <small>{{ t('handbook.volumes', { n: sec.items.length }) }}</small>
          </h2>

          <div class="hb-case">
            <div class="hb-books">

              <!-- A bundle stands as one volume; opening it lists what is inside. -->
              <button
                v-for="u in sec.items"
                :key="u.id || u.bundle"
                class="hb-book"
                :class="[u.kind, { locked: u.kind !== 'bundle' && !owns(u) }]"
                :style="{ '--tint': tint(u) }"
                :disabled="u.kind !== 'bundle' && !owns(u)"
                @click="u.kind === 'bundle' ? (openBundle = u.bundle) : enter(u)"
              >
                <span class="hb-spine" aria-hidden="true"></span>
                <template v-if="u.kind === 'bundle'">
                  <span class="hb-face hb-maincover">
                    <span class="hb-maintitle">{{ t('handbook.title') }}</span>
                  </span>
                  <span class="hb-owned">{{ bundleOwned(u.bundle) }} / {{ bundleUnits(u.bundle).length }}</span>
                </template>
                <span v-else-if="u.kind === 'chapter'" class="hb-face hb-maincover">
                  <span class="hb-maintitle">{{ label(u) }}</span>
                </span>
                <!-- The printed cover, with the three places it leaves for us: the circle
                     for the figure, the ruled box for the name, the corner for the code. -->
                <span v-else class="hb-face hb-cover">
                  <img class="hb-art" :src="art(u)" :alt="u.title" loading="lazy"
                       @error="artFallback($event, u)">
                  <span class="hb-covername">{{ u.title }}</span>
                  <span class="hb-covercode">{{ u.cardCode }}</span>
                </span>
                <template v-if="u.kind !== 'bundle'">
                  <span v-if="!owns(u)" class="hb-locked" aria-hidden="true"><Icon name="lock" /></span>
                  <span v-else-if="startedOf(u.id)" class="hb-ribbon" aria-hidden="true"></span>
                </template>
              </button>
            </div>
            <!-- The board the books stand on, drawn over their feet so they sit *in* the
                 shelf rather than floating above a stripe. -->
            <div class="hb-board" aria-hidden="true"></div>
          </div>
        </section>
      </div>

      <!-- Inside the main volume: its chapters, each with its own lock. Same sheet pattern as
           the reader's own contents list. -->
      <div v-if="openBundle" class="hb-jump" @click.self="openBundle = null">
        <div class="hb-main-sheet">
          <div class="hb-main-head">{{ t('handbook.title') }}</div>
          <button
            v-for="u in mainUnits"
            :key="u.id"
            class="hb-main-row"
            :class="{ locked: !owns(u) }"
            :disabled="!owns(u)"
            @click="openBundle = null; enter(u)"
          >
            <span class="hb-main-seal">{{ numeral(u) }}</span>
            <span class="hb-main-title">{{ label(u) }}</span>
            <span v-if="!owns(u)" class="hb-main-lock">{{ t('handbook.lockedShort') }}</span>
            <span class="hb-main-pages">{{ t('handbook.pages', { n: u.pages }) }}</span>
            <span v-if="owns(u)" class="hb-go">❯</span>
          </button>
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
  --ink: #2A2118;
  --ink-soft: #7C6A55;
  --wood: #7A5636;
  --wood-dark: #5A3E26;
  --wood-light: #9A7249;
  background: #EFE9DC;
  color: var(--ink);
  font-family: "Noto Serif TC", "Songti TC", "Hiragino Mincho ProN", serif;
}

.hb-bar {
  flex: none;
  display: flex; align-items: center; gap: 10px;
  padding: max(10px, env(safe-area-inset-top)) 16px 11px;
  background: #241B13;
  color: #F2E8D6;
  border-bottom: 3px solid var(--wood-dark);
}
.hb-bar-wrap { flex: 1; min-width: 0; }
.hb-bar-title { font-size: 19px; font-weight: 700; letter-spacing: .22em; }
.hb-bar-count { font-size: 10px; letter-spacing: .1em; color: rgba(242,232,214,.58); font-variant-numeric: tabular-nums; }
.hb-x {
  flex: none; width: 30px; height: 30px; border: 1px solid rgba(242,232,214,.32);
  background: none; color: #F2E8D6; font-size: 13px; cursor: pointer;
}
.hb-idx.on { background: #F2E8D6; color: #241B13; }

.hb-proto {
  flex: none; display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
  padding: 6px 16px; background: #E0D2B4; border-bottom: 1px solid #C2A87F;
  font-size: 11px; color: #6B5636; font-family: system-ui, sans-serif;
}
.hb-proto label { display: flex; align-items: center; gap: 4px; font-weight: 700; color: var(--ink); }

.hb-jump {
  position: absolute; inset: 0; z-index: 10; background: rgba(20,14,8,.5);
  display: flex; align-items: flex-start; justify-content: flex-end;
}
.hb-jump-sheet {
  margin: 8px 10px 0 0; min-width: 170px; padding: 6px;
  background: #EFE9DC; border: 1px solid var(--wood); box-shadow: 3px 4px 0 rgba(60,40,22,.35);
}
.hb-jump-row {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  width: 100%; padding: 10px; border: 0; border-bottom: 1px solid rgba(122,86,54,.3);
  background: none; color: var(--ink); font: inherit; font-size: 14px; text-align: left; cursor: pointer;
}
.hb-jump-row:last-child { border-bottom: 0; }
.hb-go { font-size: 11px; color: var(--ink-soft); }

.hb-scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 16px 0 48px; }

.hb-resume {
  display: grid; grid-template-columns: 1fr auto; gap: 2px 10px;
  width: calc(100% - 32px); margin: 0 16px 26px; padding: 12px 14px;
  border: 1px solid rgba(122,86,54,.4); background: #FBF6EA;
  box-shadow: 2px 2px 0 rgba(90,62,38,.2);
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.hb-resume:active { transform: translate(1px,1px); box-shadow: none; }
.hb-resume-lab { grid-column: 1 / -1; font-size: 9.5px; letter-spacing: .22em; color: var(--ink-soft); }
.hb-resume-name { font-size: 16px; font-weight: 700; }
.hb-resume-pos { font-size: 11px; color: var(--ink-soft); font-variant-numeric: tabular-nums; align-self: end; }
.hb-progress { grid-column: 1 / -1; height: 3px; margin-top: 7px; background: rgba(122,86,54,.22); }
.hb-progress i { display: block; height: 100%; background: var(--wood); }

/* --- a shelf --- */
.hb-shelf { margin-bottom: 30px; }
.hb-shelf-head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin: 0 16px 10px; font-size: 15px; font-weight: 700; letter-spacing: .1em;
}
.hb-shelf-head small { font-size: 11px; color: var(--ink-soft); letter-spacing: .06em; font-variant-numeric: tabular-nums; }

.hb-case { position: relative; }
.hb-books {
  display: flex; align-items: flex-end; gap: 10px;
  padding: 0 16px 20px;
  overflow-x: auto; overflow-y: visible;
  -webkit-overflow-scrolling: touch;
  scroll-snap-type: x proximity;
  /* Without this the snap pulls the first book flush to the edge and eats the padding —
     the shelf looked like it started off-screen. */
  scroll-padding-inline: 16px;
  scrollbar-width: none;
}
.hb-books::-webkit-scrollbar { display: none; }

/* The board. Drawn over the books' feet, which is the whole trick — it puts them *in* the
   shelf instead of on top of a stripe. Sits outside the scroller so it stays put while the
   books slide past it, the way a real shelf does. */
.hb-board {
  position: absolute; left: 0; right: 0; bottom: 0; height: 22px;
  pointer-events: none;
  background:
    linear-gradient(180deg, var(--wood-light) 0 3px, var(--wood) 3px 9px, var(--wood-dark) 9px 100%);
  box-shadow: 0 6px 10px rgba(60,40,22,.3);
}
/* The grain, and the two end supports a fitted shelf is screwed into. */
.hb-board::before {
  content: ""; position: absolute; inset: 0;
  background: repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 2px, transparent 2px 9px);
}
.hb-board::after {
  content: ""; position: absolute; left: 6px; right: 6px; top: 4px; height: 1px;
  background: rgba(255,255,255,.18);
}

.hb-book {
  position: relative; flex: none;
  width: 92px; height: 132px;
  /* Overlaps the board so the feet are hidden behind it. */
  margin-bottom: -10px;
  padding: 0; border: 0; background: none; cursor: pointer;
  scroll-snap-align: start;
  transition: transform .12s ease;
}
.hb-book:not(.locked):active { transform: translateY(2px); }
.hb-book:not(.locked):hover { transform: translateY(-3px); }

/* A sliver of the board edge, so each volume reads as a thing with thickness. */
.hb-spine {
  position: absolute; left: 0; top: 0; bottom: 10px; width: 7px;
  background: linear-gradient(90deg, rgba(0,0,0,.34), rgba(0,0,0,.08));
  z-index: 2;
}
.hb-face {
  position: absolute; inset: 0 0 10px 0;
  display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
  gap: 2px; padding: 7px 7px 8px 11px; overflow: hidden;
  background: var(--tint, #DCD3C2);
  box-shadow: 2px 3px 6px rgba(60,40,22,.35), inset 0 0 0 1px rgba(255,255,255,.35);
}
/* --- the printed character cover --- */
/* Regions measured off the artwork rather than eyeballed, as percentages so they hold at any
   book size: the circle spans x 21–80% / y 21.5–70%, the name box x 25.6–80.9% / y 76.4–86.2%. */
.hb-cover {
  display: block;
  padding: 0;
  background: #EFE7D5 url("/image/handbook-cover.jpg") center / 100% 100% no-repeat;
  box-shadow: 2px 3px 6px rgba(60,40,22,.35);
}
.hb-art {
  position: absolute;
  /* Larger than the circle and allowed to cross it. The figure is a cut-out pasted onto the
     cover, and a cut-out that stops politely at a printed rule reads as clip-art; breaking
     the rule is what makes it look stuck on. */
  left: 17%; width: 66%;
  top: 20%; height: 54%;
  object-fit: contain;
  object-position: bottom;
  /* Possible at all only because the source is keyed: on the opaque JPEG this cast the
     rectangle's shadow, not the figure's. Two passes — a tight contact shadow to seat it on
     the page, a wider soft one for depth. */
  filter:
    drop-shadow(0 1px 1px rgba(60, 44, 26, .55))
    drop-shadow(1px 3px 5px rgba(60, 44, 26, .38));
}
.hb-covername {
  position: absolute;
  /* Centred on the printed box but not confined to it: the name is the one thing here that
     must be readable at shelf size, and the box is drawn for a page, not a thumbnail. A long
     name simply sits proud of the rule. */
  left: 4%; width: 92%;
  top: 79%; height: 11%;
  display: grid; place-items: center;
  /* The app's own display face, already loaded for move names. A Mincho at 15px over a
     textured cover reads thin and muddy; this is the weight a cover label wants, and it
     covers all 65 characters these titles use (龜 and 歐 included, which Japanese faces
     often drop). */
  font-family: 'CorporateLogoBold', 'Hiragino Sans', 'Noto Sans TC', sans-serif;
  font-size: 15px; font-weight: 400; line-height: 1;
  letter-spacing: .02em;
  color: #231C14;
  white-space: nowrap;
}
.hb-covercode {
  position: absolute;
  /* Up the right edge, reading bottom to top — the way a catalogue number is set on a spine.
     Printed flat at the top it had to be ~5px to fit the width and was unreadable; turned
     on its side it has the whole height of the cover to use.
     vertical-rl + rotate(180deg) rather than a bare rotate(-90deg): it keeps the element in
     normal flow for positioning, so no transform-origin arithmetic. */
  right: 1px; bottom: 26%;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 9px; font-weight: 700; letter-spacing: .12em;
  color: #3A2F22;
  font-family: ui-monospace, "SFMono-Regular", monospace;
}
.hb-booktitle {
  flex: none; width: 100%; text-align: center;
  font-size: 11.5px; font-weight: 700; line-height: 1.25;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* The hardback cover, shared by the main volume and every non-character chapter — its middle
   is left clear precisely so a title can be set there, which is why a new DLC does not need
   artwork of its own.
   Measured off the file: the spine is cropped away (the shelf draws its own, and two would
   read as a fold), leaving the clear panel at roughly x 22–88%, y 48–72%. */
.hb-maincover {
  display: block;
  padding: 0;
  background: #1C1510 url("/image/handbook-cover-main.jpg") center / 100% 100% no-repeat;
  box-shadow: 2px 3px 6px rgba(60,40,22,.4);
}
.hb-maintitle {
  position: absolute;
  left: 22%; width: 66%;
  top: 48%; height: 24%;
  display: grid; place-items: center;
  text-align: center;
  font-family: 'CorporateLogoBold', 'Hiragino Sans', 'Noto Sans TC', sans-serif;
  font-size: 14px; font-weight: 400; line-height: 1.3;
  color: #F2E8D6;
}

/* A ribbon marker for a volume already started — what a reader leaves in a book. */
.hb-ribbon {
  position: absolute; left: 16px; top: -3px; width: 7px; height: 30px; z-index: 3;
  background: #B4402F;
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 82%, 0 100%);
}
/* A drawn clasp in the top-right corner, not an emoji across the cover: at this size an
   emoji lock is a different object on every platform, and over the middle it read as the
   character holding a padlock. */
.hb-locked {
  position: absolute; right: 0; top: 0; z-index: 4;
  width: 21px; height: 21px; display: grid; place-items: center;
  font-size: 11px; background: #241B13; color: #F2E8D6;
}
.hb-book.locked { cursor: default; }
/* Dimmed and drained, but not to grey: at .75 every locked cover collapsed into the same
   brown and the shelf stopped being scannable. The tint has to survive. */
.hb-book.locked .hb-face { filter: saturate(.45) brightness(.94); opacity: .82; }
/* The cover is printed paper, so draining it reads as a faded copy rather than a greyed
   control — which is the right signal for something not yet bought. */
.hb-book.locked .hb-cover { filter: saturate(.3) brightness(.97); opacity: .72; }
.hb-book.locked .hb-booktitle { color: var(--ink-soft); }
.hb-book.locked .chapterface .hb-booktitle { color: rgba(242,232,214,.6); }

/* "4 / 6" on the main volume's cover: one book, but six things inside it, and the shelf
   should say so without being opened. */
.hb-owned {
  /* Top-left, beside the extent badge: the title runs full width along the foot, so the
     bottom corners are not free. */
  position: absolute; left: 11px; top: 4px; z-index: 3;
  padding: 1px 5px; background: rgba(200,168,106,.9); color: #241B13;
  font-size: 9px; font-weight: 700; font-variant-numeric: tabular-nums;
}

.hb-main-sheet {
  align-self: flex-end;
  width: 100%; max-height: 72%; overflow-y: auto;
  padding: 16px 18px calc(20px + env(safe-area-inset-bottom));
  background: #EFE9DC; border-top: 3px solid var(--wood);
}
.hb-main-head {
  font-size: 12px; font-weight: 700; letter-spacing: .26em; color: var(--ink-soft);
  padding-bottom: 9px; border-bottom: 1px solid rgba(122,86,54,.35);
}
.hb-main-row {
  display: flex; align-items: center; gap: 11px; width: 100%;
  padding: 12px 2px; border: 0; border-bottom: 1px solid rgba(122,86,54,.22);
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.hb-main-seal {
  flex: none; width: 26px; height: 26px; display: grid; place-items: center;
  border: 1px solid var(--wood); font-size: 13px; font-weight: 700;
}
.hb-main-title { flex: 1; font-size: 16px; font-weight: 700; }
.hb-main-pages { flex: none; font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.hb-main-lock {
  flex: none; padding: 1px 7px; border: 1px solid var(--wood);
  font-size: 9.5px; letter-spacing: .14em; color: var(--ink-soft); font-family: system-ui, sans-serif;
}
.hb-main-row.locked { cursor: default; }
.hb-main-row.locked .hb-main-title, .hb-main-row.locked .hb-main-seal {
  color: var(--ink-soft); font-weight: 600;
}

.hb-state {
  flex: 1; display: grid; place-items: center; padding: 40px 20px;
  text-align: center; color: var(--ink-soft); font-size: 14px;
}

@media (min-width: 560px) {
  .hb-book { width: 112px; height: 160px; }
  .hb-covername { font-size: 18px; }
  .hb-maintitle { font-size: 15px; }
  .hb-covercode { font-size: 11px; }
  .hb-books { gap: 14px; padding: 0 24px 22px; }
  .hb-shelf-head { margin: 0 24px 12px; }
}
</style>
