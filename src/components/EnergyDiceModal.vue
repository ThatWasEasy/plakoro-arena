<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FACE_KEYS, CONVEX_TYPES, CONCAVE_TYPES, CHIP_TYPES, faceTypes, randomDie } from '../game/diceParts'
import { asset } from '../data/assetPath'
import ChipIcon from './dice/ChipIcon.vue'

// Deliberately NOT routed through battle.state.modal: editing your own dice build is a purely
// local, own-side task with nothing for the opponent to see mid-edit, and two people online
// happen to do this at almost the same time far more often than char/move picking ever did —
// sharing one state.modal slot meant whoever pressed "done" second stole/closed the other
// side's picker. Local component state confirms once, at the very end (see emit('confirm')),
// which is the only piece that ever needs to reach the opponent.
const props = defineProps({
  initialDice: { type: Array, default: null },
  // SPECIAL_SWAP_CHIP (へんげぎり): re-chip ONE die mid-match. The fixed convex/concave faces
  // aren't chips, so they stay put; once one die has been touched the other two lock; and the
  // result is that single die, emitted as { dieIndex, die }.
  swapOneDie: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'confirm'])
const { t } = useI18n()

function cloneDie(die) {
  return {
    convexType: die.convexType,
    concaveType: die.concaveType,
    singleSlots: die.singleSlots.map(s => ({ ...s })),
    dualSlots: die.dualSlots.map(s => ({ ...s, types: [...s.types] }))
  }
}

const dice = ref(props.initialDice ? props.initialDice.map(cloneDie) : [randomDie(), randomDie(), randomDie()])

const CELL = 2.5
const FACE_LABEL_KEYS = {
  convex: 'convex', concave: 'concave',
  single1: 'single', single2: 'single',
  dual1: 'dual', dual2: 'dual'
}
const FACE_ROWS = FACE_KEYS.map(key => ({ key, labelKey: FACE_LABEL_KEYS[key] }))

function slotMeta(faceKey) {
  if (faceKey === 'convex') return { kind: 'convex', options: CONVEX_TYPES }
  if (faceKey === 'concave') return { kind: 'concave', options: CONCAVE_TYPES }
  if (faceKey === 'single1') return { kind: 'single', options: CHIP_TYPES, slotIndex: 0 }
  if (faceKey === 'single2') return { kind: 'single', options: CHIP_TYPES, slotIndex: 1 }
  if (faceKey === 'dual1') return { kind: 'dual', options: CHIP_TYPES, slotIndex: 0 }
  if (faceKey === 'dual2') return { kind: 'dual', options: CHIP_TYPES, slotIndex: 1 }
  return null
}

const editingSlot = ref(null) // { dieIndex, faceKey } | null
const currentMeta = computed(() => editingSlot.value ? slotMeta(editingSlot.value.faceKey) : null)
const editingDie = computed(() => editingSlot.value ? dice.value[editingSlot.value.dieIndex] : null)

// Which die a swap has started on, so the others can be locked. null until the first change.
const swapDieIndex = ref(null)

function slotEditable(dieIndex, faceKey) {
  if (!props.swapOneDie) return true
  if (faceKey === 'convex' || faceKey === 'concave') return false
  return swapDieIndex.value === null || swapDieIndex.value === dieIndex
}

function openPicker(dieIndex, faceKey) {
  if (!slotEditable(dieIndex, faceKey)) return
  editingSlot.value = { dieIndex, faceKey }
}

function markSwapped() {
  if (props.swapOneDie && swapDieIndex.value === null && editingSlot.value) swapDieIndex.value = editingSlot.value.dieIndex
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

const currentDualTypes = computed(() => {
  const meta = currentMeta.value
  const die = editingDie.value
  if (!die || !meta || meta.kind !== 'dual') return [null, null]
  return die.dualSlots[meta.slotIndex].types
})

function pickType(type) {
  const meta = currentMeta.value
  const die = editingDie.value
  if (!meta || !die) return
  if (meta.kind === 'convex') die.convexType = type
  else if (meta.kind === 'concave') die.concaveType = type
  else if (meta.kind === 'single') die.singleSlots[meta.slotIndex] = { kind: 'single', type }
  else return
  markSwapped()
  closePicker()
}

function setDualType(half, type) {
  const meta = currentMeta.value
  const die = editingDie.value
  if (!die || !meta || meta.kind !== 'dual') return
  die.dualSlots[meta.slotIndex].types[half] = type
  markSwapped()
}

const pickerTitleKey = computed(() => {
  const kind = currentMeta.value ? currentMeta.value.kind : null
  if (kind === 'convex') return 'diceBuilder.picker.convexTitle'
  if (kind === 'concave') return 'diceBuilder.picker.concaveTitle'
  if (kind === 'single') return 'diceBuilder.picker.singleTitle'
  if (kind === 'dual') return 'diceBuilder.picker.dualTitle'
  return ''
})

// Quick apply: pick one type, every die's round/square sockets (plus whichever fixed face
// belongs to that type's own pool) become that type in one go — same shortcut the dice
// assembly simulator offers, just without its two-set compare step (there's only ever one set
// of 3 dice here).
const showQuickApply = ref(false)
function applyPureType(type) {
  const isConvexType = CONVEX_TYPES.includes(type)
  dice.value.forEach(die => {
    if (isConvexType) die.convexType = type
    else die.concaveType = type
    die.singleSlots[0] = { kind: 'single', type }
    die.singleSlots[1] = { kind: 'single', type }
    die.dualSlots[0] = { kind: 'dual', types: [type, type] }
    die.dualSlots[1] = { kind: 'dual', types: [type, type] }
  })
  showQuickApply.value = false
}

function confirm() {
  if (props.swapOneDie) {
    const i = swapDieIndex.value
    emit('confirm', i === null ? null : { dieIndex: i, die: dice.value[i] })
    return
  }
  emit('confirm', dice.value)
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-sheet" style="max-height:85%; overflow-y:auto;">
      <div class="modal-title">{{ swapOneDie ? t('energyDice.swapTitle') : t('energyDice.title') }}</div>
      <div class="center-hint" style="padding:0 0.625rem 0.5rem; text-align:center;">{{ swapOneDie ? t('energyDice.swapHint') : t('energyDice.hint') }}</div>

      <div style="display:flex; flex-direction:column; gap:0.625rem; padding:0 0.625rem;">
        <div v-for="(die, di) in dice" :key="di" class="select-card" style="width:100%; align-items:stretch; padding:0.75rem;">
          <div style="font-size:0.8125rem; font-weight:800; padding-bottom:0.375rem;">{{ t('diceBuilder.die', { n: di + 1 }) }}</div>
          <div style="display:grid; grid-template-columns: repeat(6, 1fr); gap:0.375rem;">
            <div v-for="row in FACE_ROWS" :key="row.key" style="display:flex; flex-direction:column; align-items:center; gap:0.125rem;">
              <span style="font-size:0.5625rem; font-weight:800; color:var(--sub);">{{ t('diceBuilder.face.' + row.labelKey) }}</span>
              <div :style="slotEditable(di, row.key) ? 'cursor:pointer;' : 'cursor:default; opacity:.35;'" @click="openPicker(di, row.key)">
                <ChipIcon :types="faceTypes(die, row.key)" :size="CELL" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex; gap:0.625rem; justify-content:center; flex-wrap:wrap; padding:0.875rem 0 0.25rem;">
        <button v-if="!swapOneDie" class="btn secondary" @click="showQuickApply = true">{{ t('diceBuilder.quickApplyButton') }}</button>
        <button class="btn wide" style="max-width:16rem;" @click="confirm">{{ t('energyDice.confirm') }}</button>
      </div>
    </div>

    <div v-if="editingSlot" class="modal-overlay" @click.self="closePicker">
      <div class="modal-sheet" style="max-height:75%; position:relative;">
        <button
          @click="closePicker"
          style="position:absolute; top:0.625rem; right:0.625rem; width:1.75rem; height:1.75rem; border:none; border-radius:50%; background:rgba(0,0,0,.08); color:var(--ink); font-size:0.9375rem; font-weight:800; line-height:1; cursor:pointer;"
        >✕</button>
        <div class="modal-title">{{ t(pickerTitleKey) }}</div>

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

    <div v-if="showQuickApply" class="modal-overlay" @click.self="showQuickApply = false">
      <div class="modal-sheet" style="max-height:75%; position:relative;">
        <button
          @click="showQuickApply = false"
          style="position:absolute; top:0.625rem; right:0.625rem; width:1.75rem; height:1.75rem; border:none; border-radius:50%; background:rgba(0,0,0,.08); color:var(--ink); font-size:0.9375rem; font-weight:800; line-height:1; cursor:pointer;"
        >✕</button>
        <div class="modal-title">{{ t('diceBuilder.quickApplyTitle') }}</div>
        <div style="font-size:0.75rem; color:var(--sub); text-align:center; margin:-0.25rem 0 0.625rem;">{{ t('diceBuilder.quickApplyHint') }}</div>
        <div style="display:flex; flex-wrap:wrap; gap:0.625rem; justify-content:center;">
          <div
            v-for="ty in CHIP_TYPES"
            :key="ty"
            @click="applyPureType(ty)"
            style="width:2.75rem; height:2.75rem; border-radius:0.5rem; overflow:hidden; background:#fff; cursor:pointer; border:0.125rem solid var(--line);"
          >
            <img :src="asset(`image/ICON/${ty}.png`)" class="img-icon" :alt="ty">
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
