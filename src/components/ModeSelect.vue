<script setup>
import { useI18n } from 'vue-i18n'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { isAdminMode } from '../data/adminSession'
import { giftCount, hasGifts, refreshGifts } from '../data/gifts'
import { refreshPoints } from '../data/points'
import Icon from './Icon.vue'

const emit = defineEmits(['pick', 'gifts'])
const { t } = useI18n()

// Two things on this screen open the group — the menu card and the mark in the corner. Held in
// one place so they can never end up pointing somewhere different.
const LINE_URL = 'https://line.me/ti/g2/nX4Wb5UHJR9vy573jqGe_Q_q2Rd6JsruabTKVw'

// Adding a mode should never mean re-tuning the layout, so the grid is driven off this list
// rather than hand-written cards.
//
// `enabled: false` hides a mode from the menu while leaving it fully built and reachable in
// code. Deleting the entry instead would leave its component, i18n strings and data loader with
// no visible caller, which is how features quietly rot — this way re-enabling is one word.
const MODES = [
  { key: 'duel' },
  { key: 'solo' },
  { key: 'diceBuilder' },
  { key: 'storeInfo' },
  // Hidden 2026-08-28: the market data behind it isn't maintainable by hand yet — most listing
  // sources need a login to snapshot, so the figures would go stale without anyone noticing.
  { key: 'priceLog', enabled: false },
  { key: 'tierList' },
  { key: 'typeChart' },
  // A link out, not a mode. `url` is what tells the menu to render an anchor instead of a
  // button — the card looks the same either way, but one changes screen and one leaves.
  { key: 'line', url: LINE_URL },
  // `group` moves a mode one level down. The top level is what a player opens the app to do;
  // these three are things an organiser or a theorycrafter comes looking for, and keeping them
  // up front pushed the front page past the point where every card still fit.
  { key: 'tournament', group: 'tools' },
  { key: 'tierMaker', group: 'tools' },
  { key: 'traitChart', group: 'tools' },
  // Only ever shown once admin mode is on (see App.vue's triple-tap-the-version-number entry
  // point) — hidden rather than just inert, so its existence isn't a hint to someone poking
  // around the menu who hasn't passed the PIN check.
  { key: 'adminSwitch', group: 'tools', adminOnly: true },
  { key: 'adminRewards', group: 'tools', adminOnly: true }
]

const GROUPS = [{ key: 'tools' }]

const openGroup = ref(null)

function visible(m) {
  return m.enabled !== false && (!m.adminOnly || isAdminMode.value)
}

const topLevel = computed(() => [
  ...MODES.filter(m => visible(m) && !m.group),
  ...GROUPS.map(g => ({ ...g, isGroup: true }))
])

const groupModes = computed(() =>
  MODES.filter(m => visible(m) && m.group === openGroup.value))

const cards = computed(() => (openGroup.value ? groupModes.value : topLevel.value))

function pick(card) {
  if (card.isGroup) openGroup.value = card.key
  else emit('pick', card.key)
}

function label(card) {
  return card.isGroup ? t('mode.group.' + card.key) : t('mode.' + card.key)
}

// The cards, split into rows here rather than left to wrap.
//
// Wrapping decides which card lands on which line, but gives the lines no way to share the
// height they have: a wrapped line is as tall as its contents, so each mode added pushed the
// last line further past the bottom of the stage — at nine it was clipped. Real rows can each
// take `flex: 1` and divide the box between them, so the cards shrink instead.
const COLUMNS = 3

// --- notice ticker ---
//
// How many copies of the message the track carries.
//
// Two is not always enough. The track slides left by exactly one copy's width and then jumps
// back, which is seamless only while the copies that remain still cover the full width of the
// band. With the Chinese message the copy came out 17px narrower than the band, so for one
// frame at the loop point a sliver of empty track showed — the flicker. A shorter message, or
// a wider stage, makes that sliver bigger.
//
// So it is measured rather than guessed: enough copies to cover the band, plus one to slide
// away. Re-measured on resize, since this app scales its whole type scale with the stage.
const tickerEl = ref(null)
const tickerCopies = ref(2)

function measureTicker() {
  const el = tickerEl.value
  if (!el) return
  const first = el.querySelector('.mt-text')
  if (!first) return
  const copyW = first.getBoundingClientRect().width
  const bandW = el.getBoundingClientRect().width
  if (!copyW || !bandW) return
  tickerCopies.value = Math.max(2, Math.ceil(bandW / copyW) + 1)
}

onMounted(() => {
  measureTicker()
  window.addEventListener('resize', measureTicker)
  // Asked every time the menu is shown, not once at startup: a prize handed out while the app
  // sat open should be waiting when they come back to this screen. The balance beside the
  // avatar moves for the same reasons, so it is re-read on the same trigger.
  refreshGifts()
  refreshPoints()
})
onBeforeUnmount(() => window.removeEventListener('resize', measureTicker))

// The track is `copies` wide; sliding by one copy is 100/copies percent of it.
const tickerShift = computed(() => `-${(100 / tickerCopies.value).toFixed(4)}%`)

const rows = computed(() => {
  const out = []
  for (let i = 0; i < cards.value.length; i += COLUMNS) {
    out.push(cards.value.slice(i, i + COLUMNS))
  }
  return out
})
</script>

<template>
  <div class="board select-board mode-select">
    <!-- Decoration, so it is out of the accessibility tree and out of the way of every click
         on the screen. One element, not a field of them: the mascot is a repeating background
         on a single layer, and the only thing that moves is that layer's transform. -->
    <div class="mode-bg" aria-hidden="true"></div>

    <h1 class="mode-wordmark">PLAKORO ARENA</h1>

    <!-- A bounded box with real rows inside it, rather than cards left to wrap. The box itself
         is a fixed share of the screen (see .mode-grid); the rows divide that fixed height
         between them, so adding a mode makes every card a little shorter rather than growing
         the box and squeezing the ticker/credit below it. -->
    <div class="mode-grid">
      <div v-for="(row, i) in rows" :key="i" class="mode-row">
        <component
          :is="c.url ? 'a' : 'button'"
          v-for="c in row"
          :key="c.key"
          class="select-card mode-card"
          :href="c.url"
          :target="c.url ? '_blank' : undefined"
          :rel="c.url ? 'noopener noreferrer' : undefined"
          @click="c.url ? undefined : pick(c)"
        >
          <span class="select-card-title mode-card-title">{{ label(c) }}</span>
        </component>
      </div>
    </div>

    <div v-if="openGroup" class="mode-back">
      <button class="btn secondary" @click="openGroup = null">{{ t('common.back') }}</button>
    </div>

    <!-- The group's own mark, in the corner. Same destination as the Line card above, offered
         as the thing people actually recognise rather than as a second labelled button. -->
    <div class="mode-mark-row">
      <!-- Bottom left, opposite the Line mark, and only when something is waiting. An unopened
           prize should be the hardest thing on this screen to miss — tucked into a dot on the
           avatar it would go unnoticed for weeks. -->
      <button v-if="hasGifts" class="mode-gift" @click="emit('gifts')">
        <Icon class="mode-gift-icon" name="gift" />
        <span class="mode-gift-label">{{ t('gift.waiting', { n: giftCount }) }}</span>
      </button>
      <a
        class="mode-mark"
        :href="LINE_URL"
        target="_blank"
        rel="noopener noreferrer"
        :aria-label="t('mode.line')"
      >
        <img src="../assets/logo.png" alt="" aria-hidden="true">
        <span class="mode-mark-bubble">{{ t('mode.lineJoin') }}</span>
      </a>
    </div>

    <!-- Announcements. The track holds as many copies as it takes to stay covered, and slides
         by exactly one of them, so at the loop point a copy is standing where the one before it
         started and the seam never shows. -->
    <div ref="tickerEl" class="mode-ticker" aria-live="off">
      <div class="mt-track" :style="{ '--shift': tickerShift }">
        <span
          v-for="i in tickerCopies"
          :key="i"
          class="mt-text"
          :aria-hidden="i > 1 ? 'true' : undefined"
        >{{ t('notice.meetup2') }}</span>
      </div>
    </div>

    <!-- Attribution sits on the mode select rather than inside each mode: it's the one screen
         every player passes through, and the play screens have no spare room for it. -->
    <div class="select-credit">
      <div>{{ t('credit.sources') }}</div>
      <div>{{ t('credit.rights') }}</div>
    </div>
  </div>
</template>

<style scoped>
/* Every direct child below (title, menu, Line mark, ticker, credit) claims a fixed share of this
   column via `flex: <n> 1 0`, rather than being sized by its own content. That's the whole fix
   for a bug this screen used to have: the menu's content (how many rows of mode cards it has)
   used to decide how tall the menu's box was, which meant a longer menu could crowd the ticker
   and credit text out of the space they needed — the exact opposite of what should determine
   what. Every section now gets the same slice of the screen no matter what's inside it; content
   fits (or is centred, or is capped) within its own slice instead of dictating it. */
.mode-select {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* The drifting layer is clipped to the screen, and everything else sits above it. */
  position: relative;
  isolation: isolate;
}

/* The mascot field.
 *
 * Why it is built this way rather than the obvious way: animating `background-position` would
 * repaint the whole area on every frame, on the main thread. A transform on one layer is
 * handed to the compositor instead — the tile is rasterised once and then just moved, so the
 * cost is flat no matter how large the field or how many mascots are visible.
 *
 * The loop is seamless because the slide is exactly one tile in each axis, measured *inside*
 * the rotation: rotate first, then translate, so the travel and the tile grid share a
 * coordinate system. One cell across and one cell down lands on an identical arrangement.
 */
.mode-bg {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}

.mode-bg::before {
  /* The cell, not the mascot. Two things are baked into the image rather than done here —
     the mascot's own -50° tilt and the transparent gap around it — and both have to be,
     because CSS cannot space a repeating background (background-size sets the drawn size and
     the repeat period at once) and a CSS rotation would turn the whole lattice, dragging the
     drift off its diagonal with it. See scripts/make-emblem-tile.py.
     Changing this scales mascots and gaps together, keeping their ratio. */
  --tile: 8rem;
  content: '';
  position: absolute;
  /* A whole cell of overhang on every side, so the half-cell the layer travels can never
     bring an edge into view — the same idea as the ticker's extra copies, except the layer is
     simply larger rather than duplicated.
     Measured in cells, not percent: a percentage resolves against the parent, and 20% of a
     short stage came out *smaller* than the travel — the top edge crossed into view near the
     end of every cycle and the reset read as a jump. Tied to --tile, it cannot drift out of
     step again. */
  inset: calc(var(--tile) * -1);
  background-image: url('../assets/gray-plakoro-mascot-emblem-tile.png');
  background-repeat: repeat;
  background-size: var(--tile) var(--tile);
  /* Faint: this is the texture of the board, not a thing to look at. The artwork is already
     grey, so opacity alone is enough and there is no filter on the paint path. */
  opacity: 0.25;
  transform: translate3d(0, 0, 0);
  /* One cell per 6s. The duration is the speed, and the distance is fixed at exactly one cell
     in each axis (anything else breaks the seam) — so this has to move with --tile to hold a
     speed steady. Half of 8rem diagonally over 4.5s is ~35px/s. */
  animation: mode-bg-drift 4.5s linear infinite;
  will-change: transform;
}

/* Straight down-left, in screen space, by *half* a cell — the offset course repeats every half
   step diagonally, so half a cell lands on the same arrangement again and the loop is seamless
   at twice the rate a full cell would be. A true 45° toward the bottom-left corner, which reads
   as drifting in from the top-right. The mascots are tilted inside the image, so their angle
   and this direction are independent of each other. */
@keyframes mode-bg-drift {
  to { transform: translate3d(calc(var(--tile) * -0.5), calc(var(--tile) * 0.5), 0); }
}

@media (prefers-reduced-motion: reduce) {
  /* The texture stays, the drift goes. */
  .mode-bg::before { animation: none; }
}

/* Set large enough to read as the screen's title rather than a heading over a list. */
.mode-wordmark {
  flex: 2 1 0%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  /* rem, not vw: the app already scales its root font with the stage, so a viewport unit
     here would drift out of step with everything around it. */
  font-size: 1.75rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  /* The tracking adds a trailing gap after the last letter; pulling it back keeps the mark
     optically centred. */
  text-indent: 0.1em;
  line-height: 1;
  color: var(--ink);
  text-align: center;
  white-space: nowrap;
}

.mode-grid {
  --gap: 0.625rem;
  flex: 7 1 0%;
  min-height: 0;
  width: 100%;
  max-width: 23rem;
  display: flex;
  flex-direction: column;
  /* Rows collect at the bottom of this slice rather than the middle of it, which is the only
     thing "anchored toward the ticker" can mean now that the slice itself is fixed-size. */
  justify-content: flex-end;
  gap: var(--gap);
  padding: 0.25rem 0;
}

/* `flex: 1 1 0` divides .mode-grid's now-guaranteed-definite height evenly between rows; the cap
   is what stops a short menu (one row, in the "more tools" group) from stretching to fill the
   whole slice — the leftover goes to `justify-content: flex-end` above instead. */
.mode-row {
  flex: 1 1 0%;
  min-height: 0;
  max-height: 3.25rem;
  display: flex;
  gap: var(--gap);
}

.mode-card {
  /* Half the row, and capped there so a lone card on the last row doesn't stretch across. */
  flex: 1 1 0;
  /* A third of the row, so a last row holding one or two cards keeps them the same width
     as the full rows above rather than spreading them across. */
  max-width: calc((100% - var(--gap) * 2) / 3);
  min-width: 0;
  min-height: 0;
  /* Overridden rather than changing .select-card or --radius: those are shared with every
     other picker in the app, and only this menu's cards got smaller. */
  border-radius: 0.5rem;
  /* Stronger than the global --shadow. That one is tuned for large cards, where a wide soft
     spread reads as depth; at this size it spreads further than the card itself and vanishes.
     A tighter, darker drop keeps the cards sitting on the board. */
  box-shadow: 0 0.125rem 0.375rem rgba(60, 60, 50, 0.16);
  transition: box-shadow 0.12s, transform 0.1s;
  /* The label is the whole card, so it takes the middle. */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.1875rem 0.375rem;
  overflow: hidden;
  cursor: pointer;
  border: none;
  font-family: inherit;
}
/* The link cards are anchors, which bring their own underline and colour. */
.mode-card { text-decoration: none; color: inherit; }
.mode-card:hover { box-shadow: 0 0.1875rem 0.5rem rgba(60, 60, 50, 0.22); }
.mode-card:active { transform: scale(.97); box-shadow: 0 0.0625rem 0.1875rem rgba(60, 60, 50, 0.2); }

.mode-back { flex-shrink: 0; padding-top: 0.875rem; }

/* Full width so the mark lands on the board's right edge — the corner — rather than on the
   right edge of the centred menu. Sized to its own content (`0 0 auto`) rather than a shared
   ratio like its siblings: the mark+bubble's real height doesn't divide evenly into a slice of
   the screen, and giving it a ratio anyway let the artwork overflow its box and bleed into the
   ticker below. Fixed-content size here, with the grid/ticker/credit's ratios absorbing the
   (small, roughly even) difference, is what actually keeps every section's content inside its
   own box. */
.mode-mark-row {
  flex: 0 0 auto;
  width: 100%;
  display: flex;
  align-items: center;
  /* The gift grows leftward via its own auto margin rather than `space-between`, which would
     shove the Line mark across whenever no gift is waiting. */
  justify-content: flex-end;
}

/* Loud on purpose, and animated until it is opened — the reason grants moved out of the
   profile screen is that nobody noticed them there. */
.mode-gift {
  margin-right: auto;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  border: none;
  border-radius: var(--radius-sm);
  /* Black on a pale board. Everything else down here is light — the Line mark, the cards, the
     ground — so the one thing asking to be tapped is the one thing that inverts. */
  background: #1A1A18;
  color: #FFFFFF;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 0.125rem 0.5rem rgba(26, 26, 24, .3);
  animation: mode-gift-pulse 1.8s ease-in-out infinite;
}
.mode-gift:active { transform: scale(.96); }
.mode-gift-icon { font-size: 1rem; flex-shrink: 0; }
.mode-gift-label { white-space: nowrap; }

@keyframes mode-gift-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.05); }
}
@media (prefers-reduced-motion: reduce) {
  .mode-gift { animation: none; }
}

/* Mark and bubble are one target: the whole thing is the invitation, so either half opens it. */
.mode-mark {
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Leaves the tail somewhere to sit without it touching the artwork. */
  gap: 0.3125rem;
  text-decoration: none;
}
.mode-mark:active { transform: scale(.95); }
.mode-mark:focus-visible { outline: 0.125rem solid var(--accent-strong); outline-offset: 0.1875rem; border-radius: var(--radius-sm); }

/* Line's own green rather than the app's lime: the words name Line, and the brand colour is
   what makes it read as that at this size instead of as another small label. */
.mode-mark-bubble {
  position: relative;
  padding: 0.1875rem 0.4375rem;
  border-radius: 0.3125rem;
  background: #06C755;
  color: #fff;
  font-size: 0.5625rem;
  font-weight: 700;
  line-height: 1.4;
  white-space: nowrap;
}

/* The tail, pointing back up at the mark it is speaking for. */
.mode-mark-bubble::before {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 100%;
  transform: translateX(-50%);
  border: 0.25rem solid transparent;
  border-top-width: 0;
  border-bottom-color: #06C755;
}

/* Height-led, width from the artwork: the mark is 1800x1536 and pinning the height is what
   keeps it the same visual weight as the type around it. */
.mode-mark img {
  display: block;
  height: 2.75rem;
  width: auto;
}

.mode-ticker {
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
  background: #1F1F1D;
  /* Full-bleed: the board has side padding, and a band that stops short of the edges reads as
     a box rather than as a ticker running across the screen. */
  margin-left: -0.625rem;
  margin-right: -0.625rem;
  width: calc(100% + 1.25rem);
}

.mt-track {
  display: flex;
  width: max-content;
  animation: mt-scroll 22s linear infinite;
}

.mt-text {
  /* The gap belongs to the text, not the track — a flex gap would be halved at the seam. */
  padding-right: 3rem;
  font-size: 0.6875rem;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
}

@keyframes mt-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(var(--shift)); }
}

/* Motion that never stops is the kind people ask to be rid of. Held still and centred, the
   message still reads — it just stops moving. */
@media (prefers-reduced-motion: reduce) {
  .mt-track { animation: none; justify-content: center; width: 100%; }
  .mt-text { padding-right: 0; }
  .mt-text:not(:first-child) { display: none; }
}

/* The global .btn is sized for screens whose controls are the main event. Here it sits under
   a menu of 0.875rem labels, and at 1rem/800 in full ink it read as the heaviest thing on the
   screen — which is what kept looking "too dark" while the fill was already almost white. */
.mode-back .btn {
  padding: 0.4375rem 1.125rem;
  font-size: 0.8125rem;
  font-weight: 700;
  /* Colour comes from .btn.secondary; only the size is this menu's business. */
  box-shadow: 0 0.0625rem 0.25rem rgba(0, 0, 0, 0.18);
}

/* Two lines allowed before it truncates — "Character strength ranking" does not fit on one
   at any size the card can afford, and clipping a mode's name is worse than wrapping it. */
.mode-card-title {
  max-width: 100%;
  font-size: 0.875rem;
  line-height: 1.25;
  text-align: center;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Smaller and tighter than the shared .select-credit (used as-is on other select-board screens)
   — the grid sitting closer to the ticker now leaves this less room, and clipped attribution
   text is worse than small attribution text. */
.mode-select .select-credit {
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  font-size: 0.3125rem;
  line-height: 1.3;
  padding: 0 0.5rem;
}

</style>
