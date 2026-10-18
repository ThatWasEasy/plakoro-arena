<script setup>
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { asset } from '../data/assetPath'
import { typeBgColor } from '../data/constants'
import { typeAffinity } from '../game/typeAffinity'
import { defaultTiers, loadTierMaker, newInstanceId, saveTierMaker, TIER_PALETTE } from '../data/tierMaker'

const emit = defineEmits(['back'])
const { characters, moves } = inject('characterData')
const { t } = useI18n()

const tiers = ref(defaultTiers())
// Keyed by tier id -> an ordered list of placed instances, each its own
// {id, characterId, type}. A character sits in the roster below regardless of how many times
// it's already been placed — 急凍鳥 built around water and 急凍鳥 built around flying are two
// different instances with two different scores, so pulling the same Pokémon up more than
// once has to make a new instance rather than move the one copy the roster would otherwise be
// tracking.
const entries = ref({})

// A date is the obvious default for a tier list someone intends to export and compare against
// a later one — it costs nothing to overwrite with a real title, but means nobody has to type
// anything just to get a sensible export.
function defaultTitle() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}
const title = ref(defaultTitle())

// Loaded once at mount rather than eagerly at module scope, so a fresh install (nothing saved
// yet) gets the default S/A/B/C/D rows instead of an empty board.
onMounted(() => {
  const saved = loadTierMaker()
  if (saved) {
    tiers.value = saved.tiers
    entries.value = saved.entries
    if (saved.title) title.value = saved.title
  }
})

// Any change — a placement, a rename, a reorder, a badge pick, the title — is small enough to
// just persist whole.
watch([tiers, entries, title], () => {
  saveTierMaker({ tiers: tiers.value, entries: entries.value, title: title.value })
}, { deep: true })

function characterById(id) {
  return characters.value.find(c => c.id === id)
}

// Options come from the same main/secondary derivation the type chart uses (what the
// character's own moves actually cost), so the badge only ever offers types this character
// could plausibly be built around.
function typeOptionsFor(character) {
  const moveList = (character.moves || []).map(id => moves.value[id]).filter(Boolean)
  const { main, secondary } = typeAffinity(moveList)
  const combined = [...main, ...secondary]
  return combined.length > 0 ? combined : [character.type]
}

function listFor(tierId) {
  return entries.value[tierId] || []
}

// Two kinds of selection share one slot: a roster Pokémon queued to become a new instance
// wherever it's dropped, or an instance already on the board picked up to move or reorder.
// Only one can be "in hand" at a time, same as there's only one hand.
const selected = ref(null)

function selectFromRoster(characterId) {
  const same = selected.value?.kind === 'new' && selected.value.characterId === characterId
  selected.value = same ? null : { kind: 'new', characterId }
}

function selectInstance(tierId, instanceId) {
  const same = selected.value?.kind === 'instance' && selected.value.instanceId === instanceId
  selected.value = same ? null : { kind: 'instance', tierId, instanceId }
}

function isSelectedInstance(instanceId) {
  return selected.value?.kind === 'instance' && selected.value.instanceId === instanceId
}

// Tapping a tier either drops a fresh instance of whatever roster Pokémon is in hand — staying
// selected afterwards, since pulling the same one into several tiers in a row is the whole
// point — or relocates an instance already in hand, which does clear the hand: a move is a
// single, finished action the way a new placement isn't.
function placeInTier(tierId) {
  const sel = selected.value
  if (!sel) return
  if (sel.kind === 'new') {
    const character = characterById(sel.characterId)
    if (!character) return
    // Left unset rather than defaulting to the first option — a badge nobody chose isn't
    // information, and this way every visible badge actually means something.
    const entry = { id: newInstanceId(), characterId: sel.characterId, types: [] }
    entries.value = { ...entries.value, [tierId]: [...listFor(tierId), entry] }
    return
  }
  if (sel.tierId === tierId) { selected.value = null; return }
  const fromList = listFor(sel.tierId)
  const entry = fromList.find(e => e.id === sel.instanceId)
  if (!entry) { selected.value = null; return }
  entries.value = {
    ...entries.value,
    [sel.tierId]: fromList.filter(e => e.id !== sel.instanceId),
    [tierId]: [...listFor(tierId), entry]
  }
  selected.value = null
}

function deleteInstance(tierId, instanceId) {
  entries.value = { ...entries.value, [tierId]: listFor(tierId).filter(e => e.id !== instanceId) }
  if (isSelectedInstance(instanceId)) selected.value = null
}

// Swapping with a neighbour rather than splicing-and-reinserting keeps this a single, cheap
// operation regardless of list length, and reads the same way the tier ▲▼ buttons already do.
function nudgeInstance(tierId, instanceId, delta) {
  const list = listFor(tierId)
  const idx = list.findIndex(e => e.id === instanceId)
  if (idx === -1) return
  const target = idx + delta
  if (target < 0 || target >= list.length) return
  const arr = [...list]
  ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
  entries.value = { ...entries.value, [tierId]: arr }
}

const MAX_TYPES = 2

// Always an array, including for instances saved before there was one.
function typesOf(entry) {
  return Array.isArray(entry.types) ? entry.types : (entry.type ? [entry.type] : [])
}

// Tapping the badge opens a picker rather than cycling to the next type.
//
// Cycling worked while a Pokémon had exactly one: tap until the right one shows. With two it
// stops working — the combinations multiply and there is no way to see what you are cycling
// past. The picker lays out every type this character could be built around and you tap the
// ones you want.
const picking = ref(null)   // { tierId, instanceId }

function openPicker(tierId, instanceId) {
  picking.value = { tierId, instanceId }
}

const pickingEntry = computed(() => {
  if (!picking.value) return null
  return listFor(picking.value.tierId).find(e => e.id === picking.value.instanceId) || null
})

const pickingCharacter = computed(() =>
  pickingEntry.value ? characterById(pickingEntry.value.characterId) : null)

const pickingOptions = computed(() =>
  pickingCharacter.value ? typeOptionsFor(pickingCharacter.value) : [])

// On when chosen, off when tapped again. Past two, the new one takes the second slot — the
// first stays put, so changing your mind about the secondary never disturbs the main and no
// tap is ever a dead one.
function toggleType(type) {
  const entry = pickingEntry.value
  if (!entry) return
  const { tierId } = picking.value
  const current = typesOf(entry)
  let next
  if (current.includes(type)) next = current.filter(x => x !== type)
  else if (current.length < MAX_TYPES) next = [...current, type]
  else next = [current[0], type]

  const list = listFor(tierId)
  const idx = list.findIndex(e => e.id === entry.id)
  if (idx === -1) return
  const arr = [...list]
  arr[idx] = { ...entry, types: next }
  entries.value = { ...entries.value, [tierId]: arr }
}

const editingTierId = ref(null)
const editingLabel = ref('')
function startEditingTier(tier) {
  editingTierId.value = tier.id
  editingLabel.value = tier.label
}
function commitTierLabel(tier) {
  const label = editingLabel.value.trim()
  if (label) tier.label = label
  editingTierId.value = null
}

// The HTML `autofocus` attribute only fires for elements present when the page first parses —
// this input is inserted later, by a v-if toggling on, so the attribute silently does nothing
// and the field would sit there unfocused until the player taps it a second time. Focusing it
// explicitly, once Vue has actually mounted it, is what makes a single tap work.
function focusLabelInput(el) {
  if (el) nextTick(() => { el.focus(); el.select() })
}

function addTier() {
  const tier = { id: `tier-${Date.now()}`, label: t('tierMaker.newTierLabel'), color: TIER_PALETTE[tiers.value.length % TIER_PALETTE.length] }
  tiers.value = [...tiers.value, tier]
  startEditingTier(tier)
}

function moveTier(index, delta) {
  const target = index + delta
  if (target < 0 || target >= tiers.value.length) return
  const next = [...tiers.value]
  ;[next[index], next[target]] = [next[target], next[index]]
  tiers.value = next
}

// Deleting a tier drops whatever instances were in it — unlike a character, an instance has
// no other home to return to, but it cost one tap to create and one tap recreates it.
function deleteTier(tierId) {
  const next = { ...entries.value }
  delete next[tierId]
  entries.value = next
  tiers.value = tiers.value.filter(t => t.id !== tierId)
}

// Clearing every placement does lose real arranging work, so it gets the one confirmation
// step in this screen — a second tap on an armed button rather than a native dialog, since
// everything else here is already tap-to-place.
const confirmingReset = ref(false)
function resetPlacements() {
  if (!confirmingReset.value) {
    confirmingReset.value = true
    return
  }
  entries.value = {}
  confirmingReset.value = false
}

function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Drawn on a canvas from the same tier/entry data the board renders, rather than snapshotting
// the live DOM — this needs no extra library, and the per-die nudge/delete controls that only
// make sense while editing are simply never part of the picture.
const exporting = ref(false)
async function exportImage() {
  if (exporting.value) return
  exporting.value = true
  try {
    const AVATAR = 68, GAP = 8, PAD = 6, LABEL_W = 72, CANVAS_W = 820, TITLE_H = 48
    const BADGE_R = 12
    const bodyW = CANVAS_W - LABEL_W - PAD * 3
    const perRow = Math.max(1, Math.floor((bodyW + GAP) / (AVATAR + GAP)))

    const neededCharIds = new Set()
    const neededTypes = new Set()
    tiers.value.forEach(tier => listFor(tier.id).forEach(e => {
      neededCharIds.add(e.characterId)
      typesOf(e).forEach(ty => neededTypes.add(ty))
    }))
    const charImageMap = {}
    const typeImageMap = {}
    await Promise.all([
      ...[...neededCharIds].map(async id => {
        const c = characterById(id)
        if (!c) return
        charImageMap[id] = await loadImage(c.imageUrl || asset(`image/CHARA/${c.name}.png`))
      }),
      ...[...neededTypes].map(async type => {
        typeImageMap[type] = await loadImage(asset(`image/ICON/${type}.png`))
      })
    ])

    const rows = tiers.value.map(tier => {
      const count = listFor(tier.id).length
      const lines = Math.max(1, Math.ceil(count / perRow))
      return { tier, height: lines * (AVATAR + GAP) + PAD * 2 - GAP }
    })
    const canvasH = TITLE_H + rows.reduce((sum, row) => sum + row.height + GAP, PAD)

    // Drawn at 3x and scaled back down through the canvas's own CSS-pixel coordinate system —
    // every call below still thinks in the same logical units (CANVAS_W etc.), but the actual
    // pixel grid underneath is dense enough to survive a Retina screen or someone zooming in,
    // instead of visibly blurring the moment it's viewed any bigger than its own small size.
    const EXPORT_SCALE = 3
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_W * EXPORT_SCALE
    canvas.height = canvasH * EXPORT_SCALE
    const ctx = canvas.getContext('2d')
    ctx.scale(EXPORT_SCALE, EXPORT_SCALE)
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#f7f6f1'
    ctx.fillRect(0, 0, CANVAS_W, canvasH)

    if (title.value.trim()) {
      ctx.fillStyle = '#3a3a3a'
      ctx.font = 'bold 24px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(title.value.trim(), CANVAS_W / 2, TITLE_H / 2 + 4)
    }

    let y = TITLE_H + PAD
    rows.forEach(({ tier, height }) => {
      ctx.fillStyle = tier.color
      roundRect(ctx, PAD, y, LABEL_W, height, 8)
      ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,.72)'
      ctx.font = 'bold 20px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(tier.label, PAD + LABEL_W / 2, y + height / 2)

      const bodyX = PAD * 2 + LABEL_W
      ctx.fillStyle = '#ffffff'
      roundRect(ctx, bodyX, y, bodyW, height, 8)
      ctx.fill()
      ctx.strokeStyle = '#e5e3da'
      ctx.stroke()

      let ax = bodyX + PAD
      let ay = y + PAD
      listFor(tier.id).forEach((e, i) => {
        if (i > 0 && i % perRow === 0) { ax = bodyX + PAD; ay += AVATAR + GAP }
        const img = charImageMap[e.characterId]
        ctx.save()
        ctx.beginPath()
        ctx.arc(ax + AVATAR / 2, ay + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2)
        ctx.closePath()
        ctx.clip()
        if (img) ctx.drawImage(img, ax, ay, AVATAR, AVATAR)
        else { ctx.fillStyle = '#ddd'; ctx.fillRect(ax, ay, AVATAR, AVATAR) }
        ctx.restore()

        // Bottom upward, matching the on-screen stack — sideways would reach over the avatar
        // beside it.
        typesOf(e).forEach((ty, i) => {
          const bx = ax + AVATAR - BADGE_R * 0.6
          const by = ay + AVATAR - BADGE_R * 0.6 - i * (BADGE_R * 2 + 1)
          ctx.beginPath()
          ctx.fillStyle = typeBgColor(ty)
          ctx.arc(bx, by, BADGE_R, 0, Math.PI * 2)
          ctx.fill()
          ctx.lineWidth = 1.5
          ctx.strokeStyle = '#fff'
          ctx.stroke()
          const typeImg = typeImageMap[ty]
          if (typeImg) {
            ctx.save()
            ctx.beginPath()
            ctx.arc(bx, by, BADGE_R - 2, 0, Math.PI * 2)
            ctx.closePath()
            ctx.clip()
            ctx.drawImage(typeImg, bx - (BADGE_R - 2), by - (BADGE_R - 2), (BADGE_R - 2) * 2, (BADGE_R - 2) * 2)
            ctx.restore()
          }
        })
        ax += AVATAR + GAP
      })
      y += height + GAP
    })

    canvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safeName = title.value.trim().replace(/[\\/:*?"<>|]/g, '-')
      a.download = `${safeName || 'tier-list'}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="board select-board" style="overflow-y:auto; align-items:center;">
    <div class="modal-title" style="margin:0.5rem 0 0.25rem;">{{ t('tierMaker.title') }}</div>
    <input v-model="title" class="tm-title-input" :placeholder="t('tierMaker.titlePlaceholder')" style="margin-bottom:0.625rem;">

    <div style="width:100%; max-width:36rem; padding:0 0.625rem; display:flex; flex-direction:column; gap:0.375rem;">
      <div v-for="(tier, index) in tiers" :key="tier.id" style="display:flex; align-items:stretch; gap:0.375rem;">
        <div style="display:flex; flex-direction:column; gap:0.125rem; flex-shrink:0;">
          <button class="tm-reorder-btn" :disabled="index === 0" @click="moveTier(index, -1)">▲</button>
          <button class="tm-reorder-btn" :disabled="index === tiers.length - 1" @click="moveTier(index, 1)">▼</button>
        </div>

        <div
          class="tm-tier-label"
          :style="{ background: tier.color }"
          @click="startEditingTier(tier)"
        >
          <input
            v-if="editingTierId === tier.id"
            v-model="editingLabel"
            class="tm-label-input"
            :ref="focusLabelInput"
            @click.stop
            @blur="commitTierLabel(tier)"
            @keydown.enter="commitTierLabel(tier)"
          >
          <span v-else>{{ tier.label }}</span>
        </div>

        <div class="tm-tier-body" @click="placeInTier(tier.id)">
          <span v-for="e in listFor(tier.id)" :key="e.id" class="tm-slot">
            <button v-if="isSelectedInstance(e.id)" class="tm-nudge-btn" @click.stop="nudgeInstance(tier.id, e.id, -1)">◀</button>
            <button
              class="tm-avatar"
              :class="{ 'tm-avatar-selected': isSelectedInstance(e.id) }"
              @click.stop="selectInstance(tier.id, e.id)"
            >
              <img :src="characterById(e.characterId).imageUrl || asset(`image/CHARA/${characterById(e.characterId).name}.png`)" class="img-icon" :alt="characterById(e.characterId).name">
              <span v-if="isSelectedInstance(e.id)" class="tm-delete-badge" @click.stop="deleteInstance(tier.id, e.id)">✕</span>
              <!-- One dot per type, up to two. The whole strip is the tap target, including
                   when it is empty — an instance with no type still has to be reachable. -->
              <span class="tm-badges" @click.stop="openPicker(tier.id, e.id)">
                <span
                  v-for="ty in typesOf(e)"
                  :key="ty"
                  class="tm-badge"
                  :style="{ background: typeBgColor(ty) }"
                >
                  <img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty">
                </span>
                <span v-if="!typesOf(e).length" class="tm-badge tm-badge-empty"></span>
              </span>
            </button>
            <button v-if="isSelectedInstance(e.id)" class="tm-nudge-btn" @click.stop="nudgeInstance(tier.id, e.id, 1)">▶</button>
          </span>
        </div>

        <button class="tm-delete-btn" :aria-label="t('tierMaker.deleteTier')" @click="deleteTier(tier.id)">✕</button>
      </div>
    </div>

    <div style="padding:0.5rem 0;">
      <button class="btn secondary" style="padding:0.1875rem 0.75rem; font-size:0.75rem;" @click="addTier">{{ t('tierMaker.addTier') }}</button>
    </div>

    <div style="width:100%; max-width:36rem; padding:0 0.625rem;">
      <div style="font-size:0.6875rem; font-weight:800; color:var(--sub); padding:0 0.125rem 0.25rem; border-bottom:0.125rem solid var(--line); margin-bottom:0.375rem;">
        {{ t('tierMaker.rosterLabel') }}
      </div>
      <div class="tm-tier-body tm-roster">
        <button
          v-for="c in characters"
          :key="c.id"
          class="tm-avatar"
          :class="{ 'tm-avatar-selected': selected?.kind === 'new' && selected.characterId === c.id }"
          @click="selectFromRoster(c.id)"
        >
          <img :src="c.imageUrl || asset(`image/CHARA/${c.name}.png`)" class="img-icon" :alt="c.name">
        </button>
      </div>
    </div>

    <div style="display:flex; gap:0.625rem; justify-content:center; padding:0.875rem 0 0.25rem;">
      <button class="btn secondary" :disabled="exporting" @click="exportImage">
        {{ exporting ? t('tierMaker.exporting') : t('tierMaker.exportButton') }}
      </button>
      <button class="btn secondary" @click="resetPlacements" @blur="confirmingReset = false">
        {{ confirmingReset ? t('tierMaker.resetConfirm') : t('tierMaker.resetButton') }}
      </button>
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>

    <!-- Type picker. A sheet rather than a popover anchored to the dot: the dot is a quarter of
         a thumb wide and sits inside a horizontally scrolling row, so anything hanging off it
         would be both hard to hit and liable to be clipped. -->
    <div v-if="picking" class="modal-overlay" style="align-items:center;" @click.self="picking = null">
      <div class="modal-sheet tm-pick">
        <div class="modal-title">{{ pickingCharacter?.name }}</div>
        <p class="tm-pick-hint">{{ t('tierMaker.typeHint', { n: MAX_TYPES }) }}</p>
        <div class="tm-pick-grid">
          <button
            v-for="ty in pickingOptions"
            :key="ty"
            :class="['tm-pick-chip', { on: typesOf(pickingEntry).includes(ty) }]"
            :style="typesOf(pickingEntry).includes(ty) ? { background: typeBgColor(ty) } : {}"
            @click="toggleType(ty)"
          >
            <img :src="asset(`image/ICON/${ty}.png`)" class="tm-pick-icon" :alt="ty">
            <span>{{ ty }}</span>
          </button>
        </div>
        <button class="btn secondary" @click="picking = null">{{ t('common.close') }}</button>
      </div>
    </div>
</template>

<style scoped>
.tm-reorder-btn {
  width: 1.25rem;
  height: 1.0625rem;
  padding: 0;
  border: none;
  border-radius: 0.25rem;
  background: var(--line);
  font-size: 0.5rem;
  line-height: 1;
  cursor: pointer;
}
.tm-reorder-btn:disabled { opacity: 0.3; cursor: default; }

.tm-title-input {
  width: 100%;
  max-width: 20rem;
  text-align: center;
  font-size: 0.9375rem;
  font-weight: 800;
  color: var(--ink);
  border: none;
  border-bottom: 0.125rem solid var(--line);
  background: transparent;
  padding: 0.25rem 0.5rem;
}
.tm-title-input::placeholder { color: var(--sub); font-weight: 700; }

.tm-tier-label {
  flex-shrink: 0;
  /* Grows with the label instead of wrapping "全場最強" down four lines inside 3rem. Capped at
     a third of the row so a long name can never squeeze the avatars out — past that it wraps,
     which is the right failure for a name nobody should be writing an essay in. */
  width: auto;
  min-width: 3rem;
  max-width: 33%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 900;
  color: rgba(0, 0, 0, .72);
  cursor: pointer;
  text-align: center;
  padding: 0.25rem;
  word-break: break-word;
}

.tm-label-input {
  /* field-sizing lets the box follow the text where it is supported; the ch floor keeps it
     usable everywhere else. */
  width: 100%;
  min-width: 2.5rem;
  field-sizing: content;
  text-align: center;
  font-size: 0.8125rem;
  font-weight: 900;
  border: none;
  border-radius: 0.25rem;
  background: rgba(255, 255, 255, .6);
  padding: 0.125rem;
}

.tm-tier-body {
  flex: 1 1 auto;
  min-height: 3rem;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  align-items: center;
  gap: 0.25rem;
  background: var(--card);
  border: 0.0625rem solid var(--line);
  border-radius: 0.5rem;
  padding: 0.125rem;
  cursor: pointer;
}

.tm-roster { min-height: 4rem; }

.tm-slot { display: flex; align-items: center; gap: 0.0625rem; flex-shrink: 0; }

.tm-avatar {
  position: relative;
  width: 2.75rem;
  height: 2.75rem;
  flex-shrink: 0;
  border-radius: 50%;
  border: 0.125rem solid transparent;
  padding: 0;
  overflow: visible;
  cursor: pointer;
  background: #fff;
}
.tm-avatar .img-icon { border-radius: 50%; overflow: hidden; }
.tm-avatar-selected { border-color: var(--ink); transform: scale(1.08); }

/* Stacked down the right edge rather than along the bottom: a second dot placed sideways
   reaches across the avatar next to it, and in a packed tier row that covers a face. Going
   down only uses the space the avatar already occupies. */
.tm-badges {
  position: absolute;
  right: -0.1875rem;
  bottom: -0.1875rem;
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  gap: 0.0625rem;
  z-index: 1;
  cursor: pointer;
}
.tm-badge {
  width: 1rem;
  height: 1rem;
  flex: none;
  border-radius: 50%;
  border: 0.09375rem solid #fff;
  overflow: hidden;
  display: block;
}

.tm-pick { width: 100%; max-width: 22rem; border-radius: 1rem; padding: 1rem; }
.tm-pick-hint { margin: 0 0 0.75rem; text-align: center; font-size: 0.6875rem; font-weight: 700; color: var(--sub); }
.tm-pick-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  justify-content: center;
  margin-bottom: 0.875rem;
}
.tm-pick-chip {
  display: flex;
  align-items: center;
  gap: 0.3125rem;
  /* Sized for a thumb — this is the part the request was about. */
  padding: 0.4375rem 0.75rem;
  border: 0.125rem solid var(--line);
  border-radius: 999px;
  background: var(--card);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 800;
  color: var(--ink);
  cursor: pointer;
}
.tm-pick-chip.on { border-color: var(--ink); }
.tm-pick-chip:active { transform: scale(.96); }
.tm-pick-icon { width: 1.125rem; height: 1.125rem; object-fit: contain; }
/* No type picked yet — stay fully invisible rather than drawing an empty outline, so an unset
   badge doesn't read as its own bit of UI; the click target is still there, just unseen. */
.tm-badge-empty {
  background: none;
  border: none;
}

.tm-delete-badge {
  position: absolute;
  right: -0.1875rem;
  top: -0.1875rem;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  border: 0.09375rem solid #fff;
  background: rgba(0, 0, 0, .6);
  color: #fff;
  font-size: 0.5rem;
  font-weight: 900;
  line-height: 0.75rem;
  text-align: center;
  z-index: 1;
}

.tm-nudge-btn {
  flex-shrink: 0;
  width: 0.875rem;
  height: 2.75rem;
  padding: 0;
  border: none;
  border-radius: 0.25rem;
  background: var(--line);
  color: var(--sub);
  font-size: 0.5rem;
  line-height: 1;
  cursor: pointer;
}

.tm-delete-btn {
  flex-shrink: 0;
  width: 1.375rem;
  height: 1.375rem;
  align-self: center;
  border: none;
  border-radius: 50%;
  background: var(--line);
  color: var(--sub);
  font-size: 0.625rem;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
}
</style>
