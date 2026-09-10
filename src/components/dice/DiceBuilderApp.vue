<script setup>
import { computed, defineAsyncComponent, nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { randomDie, faceTypes, FACE_KEYS, CONVEX_TYPES, CONCAVE_TYPES, CHIP_TYPES } from '../../game/diceParts'
import { asset } from '../../data/assetPath'
import MoveOddsView from './MoveOddsView.vue'

// Three.js + cannon-es (pulled in by DiceRoll3DCanvas and diceTextures) add roughly 600kB to
// the bundle — code-split so only players who actually open the dice builder and roll pay
// for it, instead of it loading for every player of the actual battle modes.
const DiceRoll3DCanvas = defineAsyncComponent(() => import('./DiceRoll3DCanvas.vue'))

const emit = defineEmits(['back'])
const { t } = useI18n()

// Up to two dice sets can exist side by side, so their roll probabilities can be compared
// against each other. Set A always exists; set B is opt-in and starts as a copy of A, since
// the usual reason to compare is "what changes if I swap this one face".
const SET_LABELS = ['A', 'B']

function cloneDie(die) {
  return {
    convexType: die.convexType,
    concaveType: die.concaveType,
    singleSlots: die.singleSlots.map(s => ({ ...s })),
    dualSlots: die.dualSlots.map(s => ({ ...s, types: [...s.types] }))
  }
}

function newDiceSet() {
  return {
    dice: [randomDie(), randomDie(), randomDie()],
    // Whether die 2 / die 3 (indices 1 and 2) are locked to always mirror die 1's setup.
    // Scoped per set — set B's checkboxes mirror set B's own die 1, never set A's.
    sameAsDie1: [false, false]
  }
}

function cloneDiceSet(set) {
  return { dice: set.dice.map(cloneDie), sameAsDie1: [...set.sameAsDie1] }
}

const sets = ref([newDiceSet()])
const hasCompare = computed(() => sets.value.length > 1)

function syncCheckedDice() {
  sets.value.forEach(set => {
    for (let i = 1; i <= 2; i++) {
      if (set.sameAsDie1[i - 1]) set.dice[i] = cloneDie(set.dice[0])
    }
  })
}

// Keep die 2 / die 3 mirroring die 1 live — any edit to die 1 (picking a new energy on one of
// its faces, or a quick pure-type apply) should immediately propagate to the locked dice.
// Watching only each set's die 1 keeps this from re-triggering itself: the handler writes to
// dice[1]/dice[2], which aren't part of the watched source.
watch(() => sets.value.map(s => s.dice[0]), syncCheckedDice, { deep: true })

function onToggleSame(setIndex, dieIndex, checked) {
  const set = sets.value[setIndex]
  set.sameAsDie1[dieIndex - 1] = checked
  if (checked) set.dice[dieIndex] = cloneDie(set.dice[0])
}

function addCompareSet() {
  if (sets.value.length > 1) return
  sets.value.push(cloneDiceSet(sets.value[0]))
  // A previous roll only covered set A, so it would render as a lone set-A row under a
  // header that now promises two. Clear it and let the player roll both together.
  rollResults.value = null
  charaRollResult.value = null
}

function removeCompareSet() {
  sets.value.splice(1)
  // Drop any state still pointing at the set that no longer exists.
  if (editingSlot.value && editingSlot.value.setIndex > 0) editingSlot.value = null
  if (rollResults.value) rollResults.value = rollResults.value.slice(0, 1)
  closeQuickApply()
  // A filter or grouping can be pinned to a type only set B carried. Its icon disappears
  // from the control row with set B, which would leave an invisible filter silently
  // emptying the table, so anything no longer present gets dropped.
  const stillPresent = diceHaveTypes.value
  probFilterTypes.value = probFilterTypes.value.filter(ty => stillPresent.includes(ty))
  if (groupByType.value && !stillPresent.includes(groupByType.value)) {
    groupByType.value = null
    expandedGroupCounts.clear()
  }
}

// Row labels for the 6 faces, in FACE_KEYS order. The two round sockets share one label, as
// do the two square ones, so the label can't just be derived from the key.
const FACE_LABEL_KEYS = {
  convex: 'convex', concave: 'concave',
  single1: 'single', single2: 'single',
  dual1: 'dual', dual2: 'dual'
}
const FACE_ROWS = FACE_KEYS.map(key => ({ key, labelKey: FACE_LABEL_KEYS[key] }))

// A single source of truth for the face-cell size, in rem — everything else (the dual-slot
// mini icons, their inset, and the divider line's length) is derived from it proportionally.
const CELL = 2.5
const MINI = CELL * 9 / 24
const INSET = CELL * 1 / 24
const DIVIDER_LEN = CELL * Math.SQRT2

// --- energy picker popup ---
// convex/concave faces are fixed to their own type pool (5-way / 4-way single pick).
// Round sockets hold one single-energy chip (any of the 9 types); square sockets hold one
// dual-energy chip, so picking there means choosing 2 distinct types (diagonal split).
function slotMeta(faceKey) {
  if (faceKey === 'convex') return { kind: 'convex', options: CONVEX_TYPES }
  if (faceKey === 'concave') return { kind: 'concave', options: CONCAVE_TYPES }
  if (faceKey === 'single1') return { kind: 'single', options: CHIP_TYPES, slotIndex: 0 }
  if (faceKey === 'single2') return { kind: 'single', options: CHIP_TYPES, slotIndex: 1 }
  if (faceKey === 'dual1') return { kind: 'dual', options: CHIP_TYPES, slotIndex: 0 }
  if (faceKey === 'dual2') return { kind: 'dual', options: CHIP_TYPES, slotIndex: 1 }
  return null
}

const editingSlot = ref(null) // { setIndex, dieIndex, faceKey } | null
const currentMeta = computed(() => editingSlot.value ? slotMeta(editingSlot.value.faceKey) : null)
const editingDie = computed(() => {
  const es = editingSlot.value
  return es ? sets.value[es.setIndex].dice[es.dieIndex] : null
})

function openPicker(setIndex, dieIndex, faceKey) {
  editingSlot.value = { setIndex, dieIndex, faceKey }
}

function closePicker() {
  editingSlot.value = null
}

function isTypeSelected(type) {
  const meta = currentMeta.value
  const die = editingDie.value
  if (!meta || !die) return false
  if (meta.kind === 'convex') return die.convexType === type
  if (meta.kind === 'concave') return die.concaveType === type
  if (meta.kind === 'single') return die.singleSlots[meta.slotIndex].type === type
  return false
}

// A dual-energy chip's 2 types are picked independently, one row of type icons per slot
// half — the two halves can be the same type.
const currentDualTypes = computed(() => {
  const meta = currentMeta.value
  const die = editingDie.value
  if (!die || !meta || meta.kind !== 'dual') return [null, null]
  return die.dualSlots[meta.slotIndex].types
})

function setDualType(idx, type) {
  const meta = currentMeta.value
  const die = editingDie.value
  if (!die || !meta || meta.kind !== 'dual') return
  die.dualSlots[meta.slotIndex].types[idx] = type
}

const pickerTitleKey = computed(() => {
  const kind = currentMeta.value ? currentMeta.value.kind : null
  if (kind === 'convex') return 'diceBuilder.picker.convexTitle'
  if (kind === 'concave') return 'diceBuilder.picker.concaveTitle'
  if (kind === 'single') return 'diceBuilder.picker.singleTitle'
  if (kind === 'dual') return 'diceBuilder.picker.dualTitle'
  return ''
})

function pickType(type) {
  const meta = currentMeta.value
  const die = editingDie.value
  if (!die || !meta) return

  if (meta.kind === 'convex') {
    die.convexType = type
  } else if (meta.kind === 'concave') {
    die.concaveType = type
  } else if (meta.kind === 'single') {
    die.singleSlots[meta.slotIndex] = { kind: 'single', type }
  }
  closePicker()
}

// --- quick pure-type apply ---
// Sets a die's round and square sockets to one type in one go, plus the fixed face that type
// belongs to (a convex-pool type can never sit on the concave face, or the other way round).
//
// That leaves the other fixed face still holding whatever it held, which is why there is a
// second step: picking 火 fills both sockets and the convex face, and the concave face can
// then be pinned to one of 悪/闘/超/飛 so the die is single-purpose in both halves. Skipping
// that step leaves the face untouched, which is what this used to do unconditionally.
//
// `target` is null when the whole build is the subject (which set is asked at the end), or
// {setIndex, dieIndex} when one die's own button opened it.
// `step` walks 'main' -> 'opposite' -> 'set', skipping any step with only one answer.
const quickApply = ref(null)

function openQuickApply(target = null) {
  quickApply.value = { target, step: 'main', mainType: null, oppositeType: null }
}

function closeQuickApply() {
  quickApply.value = null
}

// The second step always draws from the pool the first pick didn't come from.
const quickApplyOppositeIsConcave = computed(() =>
  !!quickApply.value && !!quickApply.value.mainType && CONVEX_TYPES.includes(quickApply.value.mainType)
)
const quickApplyOppositeOptions = computed(() =>
  quickApplyOppositeIsConcave.value ? CONCAVE_TYPES : CONVEX_TYPES
)

function applyPureType(die, mainType, oppositeType) {
  if (CONVEX_TYPES.includes(mainType)) {
    die.convexType = mainType
    if (oppositeType) die.concaveType = oppositeType
  } else {
    die.concaveType = mainType
    if (oppositeType) die.convexType = oppositeType
  }
  die.singleSlots[0].type = mainType
  die.singleSlots[1].type = mainType
  die.dualSlots[0].types = [mainType, mainType]
  die.dualSlots[1].types = [mainType, mainType]
}

function commitQuickApply(setIndexes) {
  const qa = quickApply.value
  if (!qa || qa.mainType === null) return
  const dieIndex = qa.target ? qa.target.dieIndex : null
  setIndexes.forEach(si => {
    const set = sets.value[si]
    const indexes = dieIndex === null ? set.dice.map((_, di) => di) : [dieIndex]
    indexes.forEach(di => {
      // Aiming at one locked die is a statement that it should differ from die 1, so the
      // lock comes off — otherwise the next edit to die 1 would quietly undo this.
      if (dieIndex !== null && di > 0 && set.sameAsDie1[di - 1]) set.sameAsDie1[di - 1] = false
      applyPureType(set.dice[di], qa.mainType, qa.oppositeType)
    })
  })
  closeQuickApply()
}

function pickQuickApplyMain(type) {
  quickApply.value.mainType = type
  quickApply.value.step = 'opposite'
}

// `type` is null when the player opts to leave the opposite face as it is.
function pickQuickApplyOpposite(type) {
  const qa = quickApply.value
  qa.oppositeType = type
  if (qa.target) {
    commitQuickApply([qa.target.setIndex])
    return
  }
  if (!hasCompare.value) {
    commitQuickApply([0])
    return
  }
  qa.step = 'set'
}

// --- roll simulation ---
// A physics-backed 3D tray (Three.js + cannon-es, see useDiceRoll3D.js) actually decides the
// outcome now — the dice are really tossed and land on a face — rather than a plain
// Math.random() pick. It's its own full page (rather than a strip under the dice builder)
// so the tray gets real space, with the roll results listed beside it.
const ALL_FACE_KEYS = FACE_KEYS
const rollResults = ref(null) // [[{ faceKey, types }, x3], ...] — one entry per set | null
const showDiceRoll3D = ref(false)
const isRolling = ref(false)
const diceCanvasRef = ref(null)
// Bumped every time the tray is (re)opened and bound as DiceRoll3DCanvas's :key, forcing Vue
// to fully destroy and recreate the component (and its Three.js/cannon-es scene) instead of
// potentially reusing anything from a previous visit.
const diceCanvasKey = ref(0)

// The character die (キャラコロ) is a separate, fixed 6-face die — not part of the energy
// dice being assembled above — using the up/down/left/right/upright/reversed orientation
// icons that character-die move effects already reference elsewhere in the app. It's rolled
// once and shared: it belongs to neither set, so comparing two of them would be meaningless.
const charaRollResult = ref(null)

// DiceRoll3DCanvas is an async component (see the import above), so nextTick() alone isn't
// enough to guarantee diceCanvasRef is populated yet — nextTick only waits for the *sync*
// DOM patch, not for the chunk to finish downloading and the component to actually mount.
function waitForCanvas() {
  if (diceCanvasRef.value) return Promise.resolve()
  return new Promise(resolve => {
    const stop = watch(diceCanvasRef, value => {
      if (value) {
        stop()
        resolve()
      }
    })
  })
}

function openDiceRoll3D() {
  // Force a brand new DiceRoll3DCanvas instance (and Three.js/cannon-es scene) every time this
  // page is opened, rather than risk Vue reusing anything from a previous visit — this is what
  // was causing the dice to "disappear" after closing and reopening the tray.
  diceCanvasKey.value += 1
  diceCanvasRef.value = null
  rollResults.value = null
  charaRollResult.value = null
  showDiceRoll3D.value = true
  rollDice()
}

// A plain Math.random() pick, skipping the physics tray entirely — for when the player just
// wants the outcome without waiting for the toss animation.
const CHARA_DIE_FACES = ['上', '下', '左', '右', '立', '逆']

function quickRoll() {
  rollResults.value = sets.value.map(set => set.dice.map(die => {
    const faceKey = ALL_FACE_KEYS[Math.floor(Math.random() * ALL_FACE_KEYS.length)]
    return { faceKey, types: faceTypes(die, faceKey) }
  }))
  charaRollResult.value = CHARA_DIE_FACES[Math.floor(Math.random() * CHARA_DIE_FACES.length)]
}

// Builds face textures for the current dice config and drops them into the tray. The drop is
// itself a roll — the dice fall, tumble and settle, and setDice() resolves with the faces they
// land on — so opening the tray produces a result without the player doing anything.
async function rollDice() {
  if (isRolling.value) return
  isRolling.value = true
  rollResults.value = null
  charaRollResult.value = null
  try {
    const [{ buildEnergyDieFaces, buildCharaDieFaces }] = await Promise.all([
      import('../../game/diceTextures'),
      waitForCanvas()
    ])

    // Flatten every set's 3 dice plus the shared character die into one ordered list of face
    // textures — onDiceRolled() slices the eventual result back apart by this same order.
    const energyDice = sets.value.flatMap(set => set.dice)
    const [energyFaces, charaFaces] = await Promise.all([
      Promise.all(energyDice.map(buildEnergyDieFaces)),
      buildCharaDieFaces()
    ])
    placedFaces = [...energyFaces, charaFaces]
    await diceCanvasRef.value.setDice(placedFaces)
  } finally {
    isRolling.value = false
  }
}

// The face textures currently in the tray, kept so a button throw can re-drop the same dice
// without rebuilding all 6 faces per die again (clearDice disposes the old GPU textures, and a
// fresh CanvasTexture can be built from the same canvas).
let placedFaces = null

// Button equivalent of the press-and-shake gesture, for players who'd rather press than flick
// (and for pointer devices where a flick is awkward). It re-drops the dice exactly the way
// opening the tray does — falling in from above the table and tumbling to a stop — rather than
// flinging the dice sideways, which read as a different, harsher toss.
async function throwDice() {
  if (isRolling.value || !diceCanvasRef.value) return
  // No textures built yet (the tray was opened but the first drop hasn't finished): fall back
  // to the full path, which builds them and drops them.
  if (!placedFaces) return rollDice()
  isRolling.value = true
  // Clear last throw's numbers up front — leaving them on screen during the toss reads as if
  // the new result were already in.
  rollResults.value = null
  charaRollResult.value = null
  try {
    await diceCanvasRef.value.setDice(placedFaces)
  } finally {
    isRolling.value = false
  }
}

// DiceRoll3DCanvas emits this once the physics settles after a throw, with the logical face
// name that landed up on each die in the same order rollDice() handed it faces in.
function onDiceRolled(results) {
  let i = 0
  rollResults.value = sets.value.map(set => set.dice.map(die => {
    const faceKey = results[i++]
    return { faceKey, types: faceTypes(die, faceKey) }
  }))
  charaRollResult.value = results[i]
}

// --- probability table ---
// All 3 dice of a set are rolled together (6x6x6 = 216 equally-likely face combinations).
// Rather than listing all 216 permutations, each one collapses to the multiset of energy
// types it grants (regardless of which die contributed which face or what order), and those
// 216 outcomes get grouped/tallied by that resulting type set.
const showProbTable = ref(false)
const showMoveOdds = ref(false)
const TOTAL_ROLLS = ALL_FACE_KEYS.length ** 3

function sortByChipOrder(types) {
  return [...types].sort((a, b) => CHIP_TYPES.indexOf(a) - CHIP_TYPES.indexOf(b))
}

function combosForDice(dice) {
  const byKey = new Map()
  for (const faceA of ALL_FACE_KEYS) {
    for (const faceB of ALL_FACE_KEYS) {
      for (const faceC of ALL_FACE_KEYS) {
        const types = sortByChipOrder([
          ...faceTypes(dice[0], faceA),
          ...faceTypes(dice[1], faceB),
          ...faceTypes(dice[2], faceC)
        ])
        const key = types.join(',')
        if (!byKey.has(key)) byKey.set(key, { types, count: 0 })
        byKey.get(key).count += 1
      }
    }
  }
  return byKey
}

// One row per energy combination that ANY set can produce, carrying that combination's count
// for every set (0 for a set that can't roll it at all) so the two are directly comparable
// on the same line. Ordered by set A's probability, falling back to set B's to break ties —
// so combinations unique to B collect at the bottom instead of being scattered.
const probCombos = computed(() => {
  const maps = sets.value.map(set => combosForDice(set.dice))
  const keys = new Set()
  maps.forEach(map => map.forEach((_, key) => keys.add(key)))
  const rows = [...keys].map(key => {
    const hit = maps.map(map => map.get(key))
    return {
      key,
      types: hit.find(Boolean).types,
      counts: hit.map(entry => (entry ? entry.count : 0))
    }
  })
  return rows.sort((a, b) => (b.counts[0] - a.counts[0]) || ((b.counts[1] || 0) - (a.counts[1] || 0)))
})

// "Only show" filter: multi-select among the energy types actually present on the dice right
// now (not the full 9), narrowing the list to combos that contain every selected type. With
// two sets the pool is their union, so a type only set B carries is still filterable.
const diceHaveTypes = computed(() => {
  const present = new Set()
  sets.value.forEach(set => {
    set.dice.forEach(die => {
      ALL_FACE_KEYS.forEach(faceKey => faceTypes(die, faceKey).forEach(ty => present.add(ty)))
    })
  })
  return CHIP_TYPES.filter(ty => present.has(ty))
})

const probFilterTypes = ref([])

function toggleProbFilter(type) {
  const idx = probFilterTypes.value.indexOf(type)
  if (idx >= 0) probFilterTypes.value.splice(idx, 1)
  else probFilterTypes.value.push(type)
}

const filteredProbCombos = computed(() => {
  if (probFilterTypes.value.length === 0) return probCombos.value
  return probCombos.value.filter(combo => combo.types.every(ty => probFilterTypes.value.includes(ty)))
})

// "Group by count" — pick one energy type and combos are bucketed by how many of that type
// they contain (e.g. "3 fire" covers both fire/fire/fire/water and fire/fire/fire/water/water),
// each bucket showing its combined probability, sorted by that count descending; within a
// bucket the individual combos that make it up are still listed with their own probability.
// Each bucket also carries a cumulative "at least n" figure, which is usually the number that
// actually matters: a move costing 3 fire is payable by any roll of 3 fire or more, not only
// by exactly 3.
const groupByType = ref(null)
// Which bucket counts (the "n" of "n fire") are currently expanded to show their individual
// combos — collapsed by default so the grouped view starts as just the summary rows.
const expandedGroupCounts = reactive(new Set())

function toggleGroupBy(type) {
  groupByType.value = groupByType.value === type ? null : type
  expandedGroupCounts.clear()
}

function toggleGroupExpanded(n) {
  if (expandedGroupCounts.has(n)) expandedGroupCounts.delete(n)
  else expandedGroupCounts.add(n)
}

const groupedProbCombos = computed(() => {
  if (!groupByType.value) return null
  const groups = new Map() // count of groupByType in combo -> { n, totals: [perSet], combos }
  filteredProbCombos.value.forEach(combo => {
    const n = combo.types.filter(ty => ty === groupByType.value).length
    if (!groups.has(n)) groups.set(n, { n, totals: sets.value.map(() => 0), combos: [] })
    const g = groups.get(n)
    combo.counts.forEach((count, i) => { g.totals[i] += count })
    g.combos.push(combo)
  })
  groups.forEach(g => g.combos.sort((a, b) => b.counts[0] - a.counts[0]))
  const list = [...groups.values()].sort((a, b) => b.n - a.n)
  // "At least n" = every bucket from n upwards. The list is already sorted by n descending,
  // so one running total down the list gives each bucket its own cumulative figure.
  const running = sets.value.map(() => 0)
  list.forEach(g => {
    g.totals.forEach((total, i) => { running[i] += total })
    g.cumulative = [...running]
  })
  return list
})

function pct(count) {
  return (count / TOTAL_ROLLS * 100).toFixed(1)
}

// A grouped bucket has two figures worth knowing: how often it comes up exactly, and how often
// it comes up at all ("n or more"). Showing both at once doubles every row's width, so the two
// share one column and a toggle picks which is on screen. Exact is the default, matching what
// the table showed before cumulative figures existed. Only meaningful while grouping is on —
// an individual combination has no "or more".
const showCumulative = ref(false)

function groupFigure(group, setIndex) {
  return showCumulative.value ? group.cumulative[setIndex] : group.totals[setIndex]
}

// The percentage is what a player actually reads; the raw "n/216" tally is opt-in detail. With
// it off the figure is just the percentage, so the parenthesis only belongs there when the
// tally precedes it.
const showCounts = ref(false)

function pctText(count) {
  return showCounts.value ? `（${pct(count)}%）` : `${pct(count)}%`
}

// Narrower when only the percentage is on screen, so the column doesn't sit in dead space.
const figureColWidth = computed(() => {
  if (!hasCompare.value) return 'auto'
  return showCounts.value ? '7.5rem' : '4.5rem'
})

function openProbTable() {
  showProbTable.value = true
  probFilterTypes.value = []
  groupByType.value = null
  expandedGroupCounts.clear()
}
</script>

<template>
  <MoveOddsView v-if="showMoveOdds" :sets="sets" :set-labels="SET_LABELS.slice(0, sets.length)" @back="showMoveOdds = false" />

  <div v-else-if="showDiceRoll3D" class="board select-board" style="display:flex; flex-direction:column; align-items:center; min-height:0;">
    <div class="modal-title" style="margin:0.5rem 0 0.25rem; flex-shrink:0;">{{ t('diceBuilder.rollButton') }}</div>

    <div style="flex:1; min-height:0; width:100%; max-width:56rem; display:flex; gap:0.75rem; padding:0 0.625rem;">
      <div style="flex:1.6; min-width:0; border-radius:0.75rem; overflow:hidden; background:linear-gradient(180deg,#EDEBE3,#F6F5F0);">
        <DiceRoll3DCanvas :key="diceCanvasKey" ref="diceCanvasRef" @rolled="onDiceRolled" />
      </div>

      <div style="flex:1; min-width:0; overflow-y:auto; display:flex; flex-direction:column; gap:0.875rem; padding:0.125rem;">
        <div v-if="!rollResults" style="font-size:0.8125rem; color:var(--sub); text-align:center; padding-top:1rem;">{{ t('diceBuilder.rollingHint') }}</div>
        <template v-else>
          <div v-for="(setResult, si) in rollResults" :key="si" style="display:flex; flex-direction:column; gap:0.5rem;">
            <div v-if="hasCompare" style="font-size:0.8125rem; font-weight:800; color:var(--ink);">{{ t('diceBuilder.set', { label: SET_LABELS[si] }) }}</div>
            <div v-for="(res, ri) in setResult" :key="ri" style="display:flex; align-items:center; gap:0.5rem;">
              <div :style="{ position: 'relative', width: '2.25rem', height: '2.25rem', borderRadius: '0.5rem', overflow: 'hidden', background: '#fff', border: '0.125rem solid var(--line)', flexShrink: 0 }">
                <template v-if="res.types.length > 1">
                  <div :style="{ position: 'absolute', top: '50%', left: '50%', width: '3.18rem', height: '0.09375rem', background: 'var(--line)', transform: 'translate(-50%,-50%) rotate(-45deg)' }"></div>
                  <img :src="asset(`image/ICON/${res.types[0]}.png`)" class="img-icon" :alt="res.types[0]" style="position:absolute; top:0.09375rem; left:0.09375rem; width:0.84375rem; height:0.84375rem;">
                  <img :src="asset(`image/ICON/${res.types[1]}.png`)" class="img-icon" :alt="res.types[1]" style="position:absolute; bottom:0.09375rem; right:0.09375rem; width:0.84375rem; height:0.84375rem;">
                </template>
                <img v-else :src="asset(`image/ICON/${res.types[0]}.png`)" class="img-icon" :alt="res.types[0]">
              </div>
              <span style="font-size:0.8125rem; font-weight:800; color:var(--sub);">{{ t('diceBuilder.die', { n: ri + 1 }) }}</span>
            </div>
            <div v-if="si === 0" style="display:flex; align-items:center; gap:0.5rem;">
              <div style="width:2.25rem; height:2.25rem; border-radius:0.5rem; overflow:hidden; background:#fff; border:0.125rem solid var(--line); flex-shrink:0;">
                <img :src="asset(`image/ICON/${charaRollResult}.png`)" class="img-icon" :alt="charaRollResult">
              </div>
              <span style="font-size:0.8125rem; font-weight:800; color:var(--sub);">{{ t('diceBuilder.charaDie') }}</span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div style="display:flex; gap:0.625rem; justify-content:center; padding:0.875rem 0 0.25rem; flex-shrink:0;">
      <button class="btn" :disabled="isRolling" :style="isRolling ? 'opacity:.45;' : ''" @click="throwDice">{{ t('diceBuilder.throwButton') }}</button>
      <button class="btn secondary" :disabled="isRolling" :style="isRolling ? 'opacity:.45;' : ''" @click="quickRoll">{{ t('diceBuilder.quickRollButton') }}</button>
      <button class="btn secondary" @click="showDiceRoll3D = false">{{ t('common.back') }}</button>
    </div>
  </div>

  <div v-else-if="showProbTable" class="board select-board" style="overflow-y:auto; align-items:center;">
    <div class="modal-title" style="margin:0.5rem 0 0.25rem;">{{ t('diceBuilder.probTitle') }}</div>
    <div class="center-hint" style="padding-bottom:0.375rem;">{{ t('diceBuilder.probHint') }}</div>

    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; flex-wrap:wrap; width:100%; max-width:40rem; padding:0 0.625rem 0.625rem;">
      <div style="display:flex; align-items:center; gap:0.375rem; flex-wrap:wrap;">
        <span style="font-size:0.75rem; font-weight:800; color:var(--sub); flex-shrink:0;">{{ t('diceBuilder.probFilterLabel') }}</span>
        <div
          v-for="ty in diceHaveTypes"
          :key="ty"
          @click="toggleProbFilter(ty)"
          :style="{
            width: '1.75rem', height: '1.75rem', borderRadius: '0.375rem', overflow: 'hidden',
            background: '#fff', cursor: 'pointer',
            border: probFilterTypes.includes(ty) ? '0.1875rem solid #AEFF3E' : '0.125rem solid var(--line)'
          }"
        >
          <img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty">
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:0.375rem; flex-wrap:wrap; justify-content:flex-end;">
        <span style="font-size:0.75rem; font-weight:800; color:var(--sub); flex-shrink:0;">{{ t('diceBuilder.probGroupLabel') }}</span>
        <div
          v-for="ty in diceHaveTypes"
          :key="ty"
          @click="toggleGroupBy(ty)"
          :style="{
            width: '1.75rem', height: '1.75rem', borderRadius: '0.375rem', overflow: 'hidden',
            background: '#fff', cursor: 'pointer',
            border: groupByType === ty ? '0.1875rem solid #AEFF3E' : '0.125rem solid var(--line)'
          }"
        >
          <img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty">
        </div>
        <button
          v-if="groupByType"
          class="btn secondary"
          style="padding:0.25rem 0.5rem; font-size:0.6875rem; flex-shrink:0;"
          @click="showCumulative = !showCumulative"
        >{{ showCumulative ? t('diceBuilder.showExactProb') : t('diceBuilder.showCumulativeProb') }}</button>
        <label style="display:flex; align-items:center; gap:0.1875rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer; flex-shrink:0;">
          <input type="checkbox" v-model="showCounts" style="width:0.75rem; height:0.75rem; margin:0;">
          {{ t('diceBuilder.showCountsLabel') }}
        </label>
      </div>
    </div>

    <div style="width:100%; max-width:40rem; padding:0 0.625rem;">
      <div v-if="hasCompare" style="display:flex; align-items:center; justify-content:space-between; gap:0.625rem; padding:0 0.125rem 0.25rem; border-bottom:0.125rem solid var(--line);">
        <span style="font-size:0.6875rem; font-weight:800; color:var(--sub);">{{ t('diceBuilder.probTypeHeader') }}</span>
        <div style="display:flex; gap:0.5rem; flex-shrink:0;">
          <span v-for="(label, si) in SET_LABELS" :key="si" :style="{ fontSize: '0.6875rem', fontWeight: 800, color: 'var(--sub)', width: figureColWidth, textAlign: 'right', whiteSpace: 'nowrap' }">{{ t('diceBuilder.set', { label }) }}</span>
        </div>
      </div>

      <div v-if="groupByType" style="display:flex; flex-direction:column; gap:0.625rem;">
        <div v-for="group in groupedProbCombos" :key="group.n">
          <div
            @click="toggleGroupExpanded(group.n)"
            style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; padding:0.3125rem 0.125rem; background:rgba(0,0,0,.05); border-radius:0.375rem; cursor:pointer;"
          >
            <span style="display:flex; align-items:center; gap:0.3125rem; font-size:0.8125rem; font-weight:800;">
              <span style="font-size:0.625rem; color:var(--sub); width:0.75rem; display:inline-block;">{{ expandedGroupCounts.has(group.n) ? '▼' : '▶' }}</span>
              <span style="width:1.25rem; height:1.25rem; border-radius:0.3125rem; overflow:hidden; background:#fff; border:0.09375rem solid var(--line); flex-shrink:0;">
                <img :src="asset(`image/ICON/${groupByType}.png`)" class="img-icon" :alt="groupByType">
              </span>
              × {{ group.n }}
            </span>
            <div style="display:flex; gap:0.5rem; flex-shrink:0;">
              <div
                v-for="(_, si) in group.totals"
                :key="si"
                :style="{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--sub)', width: figureColWidth, textAlign: 'right', whiteSpace: 'nowrap' }"
              ><span v-if="showCounts">{{ groupFigure(group, si) }}/{{ TOTAL_ROLLS }}</span><span :style="{ fontWeight: 900, color: groupFigure(group, si) === 0 ? 'var(--line)' : 'var(--ink)' }">{{ pctText(groupFigure(group, si)) }}</span></div>
            </div>
          </div>
          <template v-if="expandedGroupCounts.has(group.n)">
            <div v-for="combo in group.combos" :key="combo.key" style="display:flex; align-items:center; justify-content:space-between; gap:0.625rem; padding:0.25rem 0.125rem 0.25rem 0.875rem; border-bottom:1px solid var(--line);">
              <div style="display:flex; gap:0.1875rem; flex-wrap:wrap;">
                <div v-for="(ty, ti) in combo.types" :key="ti" style="width:1.375rem; height:1.375rem; border-radius:0.3125rem; overflow:hidden; background:#fff; border:0.09375rem solid var(--line); flex-shrink:0;">
                  <img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty">
                </div>
              </div>
              <div style="display:flex; gap:0.5rem; flex-shrink:0;">
                <div
                  v-for="(count, si) in combo.counts"
                  :key="si"
                  :style="{ fontSize: '0.6875rem', fontWeight: 600, color: count === 0 ? 'var(--line)' : 'var(--sub)', width: figureColWidth, textAlign: 'right', whiteSpace: 'nowrap' }"
                ><span v-if="showCounts">{{ count }}/{{ TOTAL_ROLLS }}</span><span :style="{ fontWeight: 900, color: count === 0 ? 'var(--line)' : 'var(--ink)' }">{{ pctText(count) }}</span></div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <div v-else style="display:flex; flex-direction:column; gap:0.375rem;">
        <div v-for="combo in filteredProbCombos" :key="combo.key" style="display:flex; align-items:center; justify-content:space-between; gap:0.625rem; padding:0.25rem 0.125rem; border-bottom:1px solid var(--line);">
          <div style="display:flex; gap:0.1875rem; flex-wrap:wrap;">
            <div v-for="(ty, ti) in combo.types" :key="ti" style="width:1.5rem; height:1.5rem; border-radius:0.3125rem; overflow:hidden; background:#fff; border:0.09375rem solid var(--line); flex-shrink:0;">
              <img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty">
            </div>
          </div>
          <div style="display:flex; gap:0.5rem; flex-shrink:0;">
            <div
              v-for="(count, si) in combo.counts"
              :key="si"
              :style="{ fontSize: '0.75rem', fontWeight: 600, color: count === 0 ? 'var(--line)' : 'var(--sub)', width: figureColWidth, textAlign: 'right', whiteSpace: 'nowrap' }"
            ><span v-if="showCounts">{{ count }}/{{ TOTAL_ROLLS }}</span><span :style="{ fontWeight: 900, color: count === 0 ? 'var(--line)' : 'var(--ink)' }">{{ pctText(count) }}</span></div>
          </div>
        </div>
      </div>
    </div>

    <div style="display:flex; justify-content:center; padding:0.875rem 0 0.25rem;">
      <button class="btn secondary" @click="showProbTable = false">{{ t('common.back') }}</button>
    </div>
  </div>

  <div v-else class="board select-board" style="overflow-y:auto; align-items:center;">
    <div class="modal-title" style="margin:0.5rem 0 0.25rem;">{{ t('diceBuilder.title') }}</div>
    <div class="center-hint" style="padding-bottom:0.375rem;">{{ t('diceBuilder.hint') }}</div>

    <div v-for="(set, si) in sets" :key="si" style="width:100%; max-width:47.5rem; display:flex; flex-direction:column; align-items:center;">
      <div class="select-card" style="width:100%; align-items:stretch; padding:0.875rem;">
        <div v-if="hasCompare" style="font-size:0.875rem; font-weight:800; color:var(--ink); padding-bottom:0.375rem;">{{ t('diceBuilder.set', { label: SET_LABELS[si] }) }}</div>
        <div style="display:grid; grid-template-columns: 4.375rem repeat(6, 1fr); gap:0.5rem 0.375rem; align-items:center;">
          <div></div>
          <div v-for="row in FACE_ROWS" :key="row.key" style="font-size:0.8125rem; font-weight:800; color:var(--sub); text-align:center;">{{ t('diceBuilder.face.' + row.labelKey) }}</div>

          <template v-for="(die, di) in set.dice" :key="di">
            <div style="display:flex; flex-direction:column; align-items:center; gap:0.1875rem;">
              <span style="font-size:0.875rem; font-weight:800;">{{ t('diceBuilder.die', { n: di + 1 }) }}</span>
              <label v-if="di > 0" style="display:flex; align-items:center; gap:0.1875rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
                <input type="checkbox" :checked="set.sameAsDie1[di - 1]" @change="onToggleSame(si, di, $event.target.checked)" style="width:0.75rem; height:0.75rem; margin:0;">
                {{ t('diceBuilder.sameAsDie1Short') }}
              </label>
              <!-- sits with the other per-die control, so which die it acts on needs no asking -->
              <button
                class="btn secondary"
                style="padding:0.125rem 0.375rem; font-size:0.625rem; line-height:1.3;"
                @click="openQuickApply({ setIndex: si, dieIndex: di })"
              >{{ t('diceBuilder.quickApplyDieButton') }}</button>
            </div>
            <div v-for="row in FACE_ROWS" :key="row.key" style="display:flex; justify-content:center; cursor:pointer;" @click="openPicker(si, di, row.key)">
              <div
                v-if="faceTypes(die, row.key).length > 0"
                :style="{ position: 'relative', width: CELL + 'rem', height: CELL + 'rem', borderRadius: '0.5rem', overflow: 'hidden', background: '#fff', border: '0.125rem solid var(--line)', flexShrink: 0 }"
              >
                <template v-if="faceTypes(die, row.key).length > 1">
                  <div :style="{ position: 'absolute', top: '50%', left: '50%', width: DIVIDER_LEN + 'rem', height: '0.09375rem', background: 'var(--line)', transform: 'translate(-50%,-50%) rotate(-45deg)' }"></div>
                  <img :src="asset(`image/ICON/${faceTypes(die, row.key)[0]}.png`)" class="img-icon" :alt="faceTypes(die, row.key)[0]" :style="{ position: 'absolute', top: INSET + 'rem', left: INSET + 'rem', width: MINI + 'rem', height: MINI + 'rem' }">
                  <img :src="asset(`image/ICON/${faceTypes(die, row.key)[1]}.png`)" class="img-icon" :alt="faceTypes(die, row.key)[1]" :style="{ position: 'absolute', bottom: INSET + 'rem', right: INSET + 'rem', width: MINI + 'rem', height: MINI + 'rem' }">
                </template>
                <img v-else :src="asset(`image/ICON/${faceTypes(die, row.key)[0]}.png`)" class="img-icon" :alt="faceTypes(die, row.key)[0]">
              </div>
              <div v-else :style="{ width: CELL + 'rem', height: CELL + 'rem', borderRadius: '0.5rem', border: '0.125rem dashed var(--sub)', flexShrink: 0 }"></div>
            </div>
          </template>
        </div>
      </div>

      <button v-if="si === 0 && !hasCompare" class="btn secondary" style="margin-top:0.5rem; padding:0.4375rem 0.875rem; font-size:0.8125rem;" @click="addCompareSet">{{ t('diceBuilder.addCompare') }}</button>
      <button v-else-if="si === 1" class="btn secondary" style="margin-top:0.5rem; padding:0.4375rem 0.875rem; font-size:0.8125rem;" @click="removeCompareSet">{{ t('diceBuilder.removeCompare') }}</button>
    </div>

    <div style="display:flex; gap:0.625rem; justify-content:center; flex-wrap:wrap; padding:0.875rem 0 0.25rem;">
      <button class="btn" @click="openDiceRoll3D">{{ t('diceBuilder.rollButton') }}</button>
      <button class="btn secondary" @click="openQuickApply()">{{ t('diceBuilder.quickApplyButton') }}</button>
      <button class="btn secondary" @click="openProbTable">{{ t('diceBuilder.probButton') }}</button>
      <button class="btn secondary" @click="showMoveOdds = true">{{ t('diceBuilder.moveOddsButton') }}</button>
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>

  <div v-if="editingSlot" class="modal-overlay" @click.self="closePicker">
    <div class="modal-sheet" style="max-height:75%; position:relative;">
      <button
        @click="closePicker"
        style="position:absolute; top:0.625rem; right:0.625rem; width:1.75rem; height:1.75rem; border:none; border-radius:50%; background:rgba(0,0,0,.08); color:var(--ink); font-size:0.9375rem; font-weight:800; line-height:1; cursor:pointer;"
      >✕</button>
      <div class="modal-title">{{ t(pickerTitleKey) }}</div>
      <div v-if="hasCompare" style="font-size:0.75rem; font-weight:800; color:var(--sub); text-align:center; margin:-0.25rem 0 0.5rem;">{{ t('diceBuilder.set', { label: SET_LABELS[editingSlot.setIndex] }) }} ・ {{ t('diceBuilder.die', { n: editingSlot.dieIndex + 1 }) }}</div>

      <template v-if="currentMeta && currentMeta.kind === 'dual'">
        <div style="font-size:0.75rem; color:var(--sub); text-align:center; margin:-0.25rem 0 0.625rem;">{{ t('diceBuilder.picker.dualHint') }}</div>
        <div v-for="idx in [0, 1]" :key="idx" style="margin-bottom:0.75rem;">
          <div style="font-size:0.6875rem; font-weight:800; color:var(--sub); text-align:center; margin-bottom:0.3125rem;">{{ t('diceBuilder.picker.dualSlotLabel', { n: idx + 1 }) }}</div>
          <div style="display:flex; flex-wrap:wrap; gap:0.5rem; justify-content:center;">
            <div
              v-for="ty in currentMeta.options"
              :key="ty"
              @click="setDualType(idx, ty)"
              :style="{
                width: '2.25rem', height: '2.25rem', borderRadius: '0.5rem', overflow: 'hidden',
                background: '#fff', cursor: 'pointer',
                border: currentDualTypes[idx] === ty ? '0.1875rem solid #AEFF3E' : '0.125rem solid var(--line)'
              }"
            >
              <img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty">
            </div>
          </div>
        </div>
      </template>

      <div v-else style="display:flex; flex-wrap:wrap; gap:0.625rem; justify-content:center;">
        <div
          v-for="ty in (currentMeta ? currentMeta.options : [])"
          :key="ty"
          @click="pickType(ty)"
          :style="{
            width: '2.75rem', height: '2.75rem', borderRadius: '0.5rem', overflow: 'hidden',
            background: '#fff', cursor: 'pointer',
            border: isTypeSelected(ty) ? '0.1875rem solid #AEFF3E' : '0.125rem solid var(--line)'
          }"
        >
          <img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty">
        </div>
      </div>
    </div>
  </div>

  <div v-if="quickApply" class="modal-overlay" @click.self="closeQuickApply">
    <div class="modal-sheet" style="max-height:75%; position:relative;">
      <button
        @click="closeQuickApply"
        style="position:absolute; top:0.625rem; right:0.625rem; width:1.75rem; height:1.75rem; border:none; border-radius:50%; background:rgba(0,0,0,.08); color:var(--ink); font-size:0.9375rem; font-weight:800; line-height:1; cursor:pointer;"
      >✕</button>
      <div class="modal-title">{{ t('diceBuilder.quickApplyTitle') }}</div>

      <!-- opened from a die's own button, so say which one it will change -->
      <div v-if="quickApply.target" style="font-size:0.75rem; font-weight:800; color:var(--ink); text-align:center; margin:-0.25rem 0 0.5rem;">
        <template v-if="hasCompare">{{ t('diceBuilder.set', { label: SET_LABELS[quickApply.target.setIndex] }) }} · </template>{{ t('diceBuilder.die', { n: quickApply.target.dieIndex + 1 }) }}
      </div>

      <template v-if="quickApply.step === 'main'">
        <div style="font-size:0.75rem; color:var(--sub); text-align:center; margin:-0.25rem 0 0.625rem;">{{ t('diceBuilder.quickApplyHint') }}</div>
        <div style="font-size:0.8125rem; font-weight:800; color:var(--sub); text-align:center; padding-bottom:0.375rem;">{{ t('diceBuilder.quickApplyStepMain') }}</div>
        <div style="display:flex; flex-wrap:wrap; gap:0.625rem; justify-content:center;">
          <div
            v-for="ty in CHIP_TYPES"
            :key="ty"
            @click="pickQuickApplyMain(ty)"
            style="width:2.75rem; height:2.75rem; border-radius:0.5rem; overflow:hidden; background:#fff; cursor:pointer; border:0.125rem solid var(--line);"
          >
            <img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty">
          </div>
        </div>
      </template>

      <!-- the fixed face the first pick couldn't reach, since the two faces draw from
           different pools and no single type can fill both -->
      <template v-else-if="quickApply.step === 'opposite'">
        <div style="font-size:0.8125rem; font-weight:800; color:var(--sub); text-align:center; padding-bottom:0.375rem;">
          {{ t('diceBuilder.quickApplyStepOpposite', { face: t('diceBuilder.face.' + (quickApplyOppositeIsConcave ? 'concave' : 'convex')) }) }}
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:0.625rem; justify-content:center;">
          <div
            v-for="ty in quickApplyOppositeOptions"
            :key="ty"
            @click="pickQuickApplyOpposite(ty)"
            style="width:2.75rem; height:2.75rem; border-radius:0.5rem; overflow:hidden; background:#fff; cursor:pointer; border:0.125rem solid var(--line);"
          >
            <img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty">
          </div>
        </div>
        <div style="display:flex; justify-content:center; padding-top:0.75rem;">
          <button class="btn secondary" @click="pickQuickApplyOpposite(null)">{{ t('diceBuilder.quickApplyKeepOpposite') }}</button>
        </div>
      </template>

      <template v-else>
        <div style="display:flex; align-items:center; justify-content:center; gap:0.5rem; margin:-0.25rem 0 0.75rem;">
          <div style="width:2.25rem; height:2.25rem; border-radius:0.5rem; overflow:hidden; background:#fff; border:0.1875rem solid #AEFF3E; flex-shrink:0;">
            <img :src="asset(`image/ICON/${quickApply.mainType}.png`)" class="img-icon" :alt="quickApply.mainType">
          </div>
          <div v-if="quickApply.oppositeType" style="width:2.25rem; height:2.25rem; border-radius:0.5rem; overflow:hidden; background:#fff; border:0.1875rem solid #AEFF3E; flex-shrink:0;">
            <img :src="asset(`image/ICON/${quickApply.oppositeType}.png`)" class="img-icon" :alt="quickApply.oppositeType">
          </div>
          <span style="font-size:0.8125rem; font-weight:800; color:var(--sub);">{{ t('diceBuilder.applyToLabel') }}</span>
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:0.625rem; justify-content:center;">
          <button v-for="(label, si) in SET_LABELS" :key="si" class="btn secondary" @click="commitQuickApply([si])">{{ t('diceBuilder.set', { label }) }}</button>
          <button class="btn" @click="commitQuickApply([0, 1])">{{ t('diceBuilder.applyToBoth') }}</button>
        </div>
      </template>
    </div>
  </div>

</template>
