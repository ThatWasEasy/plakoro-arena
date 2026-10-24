<script setup>
// Saves a tournament as one file.
//
// One file per event, carrying everything: the players, every round's pairings, every result.
// Earlier this screen also produced three blocks of spreadsheet rows to paste into separate
// tabs, which meant one event arrived as three things to handle and keep aligned. A single
// file is both simpler to manage and the only form that can be imported back and carried on
// with, so it is the only one offered.
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { serialize, fileName, downloadText } from '../../data/tournamentTransfer'

const props = defineProps({ tournament: { type: Object, required: true } })
defineEmits(['close'])
const { t } = useI18n()

const json = computed(() => serialize(props.tournament))
const name = computed(() => fileName(props.tournament))

// Said plainly rather than hidden, because an organiser exporting mid-event should know the
// file reflects that. Unplayed matches export as pairings with no result, which is accurate.
const unplayed = computed(() =>
  (props.tournament.rounds || []).reduce((n, r) =>
    n + r.matches.filter(m => m.player2Id !== null && !m.result).length, 0))

const playerCount = computed(() => (props.tournament.players || []).length)
const roundCount = computed(() => (props.tournament.rounds || []).length)

function saveFile() {
  downloadText(json.value, name.value)
}

const copied = ref(false)
async function copy() {
  try {
    await navigator.clipboard.writeText(json.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  } catch (e) {
    // The clipboard API needs a secure context, which a plain-http LAN address isn't. The
    // textarea below is still selectable by hand, so this only has to stop claiming it worked.
    copied.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" style="align-items:center;" @click.self="$emit('close')">
    <div class="modal-sheet" style="max-height:88%; position:relative; display:flex; flex-direction:column;">
      <button
        @click="$emit('close')"
        style="position:absolute; top:0.625rem; right:0.625rem; width:1.75rem; height:1.75rem; border:none; border-radius:50%; background:rgba(0,0,0,.08); color:var(--ink); font-size:0.9375rem; font-weight:800; line-height:1; cursor:pointer; z-index:1;"
      >✕</button>
      <div class="modal-title" style="padding-right:2rem;">{{ t('tournament.export.title') }}</div>

      <div style="display:flex; flex-direction:column; gap:0.625rem; overflow-y:auto;">
        <div style="font-size:0.5625rem; color:var(--sub); font-weight:700; line-height:1.6;">
          {{ t('tournament.export.hint') }}
        </div>

        <div style="background:var(--card); border-radius:0.5rem; padding:0.5rem 0.625rem; display:flex; flex-direction:column; gap:0.25rem;">
          <div style="font-size:0.8125rem; font-weight:800; color:var(--ink);">{{ tournament.name }}</div>
          <div style="font-size:0.625rem; color:var(--sub); font-weight:700;">
            {{ t('tournament.export.summary', { players: playerCount, rounds: roundCount }) }}
          </div>
          <div style="font-size:0.5625rem; color:var(--sub); font-weight:700; font-family:ui-monospace, monospace; padding-top:0.125rem;">
            {{ name }}
          </div>
        </div>

        <div v-if="unplayed" style="font-size:0.625rem; color:var(--danger); font-weight:800; line-height:1.6;">
          {{ t('tournament.export.unplayed', { n: unplayed }) }}
        </div>

        <div style="display:flex; gap:0.375rem;">
          <button class="btn" style="flex:1; padding:0.4375rem 0.5rem; font-size:0.75rem;" @click="saveFile">
            {{ t('tournament.export.saveFile') }}
          </button>
          <button class="btn secondary" style="flex:1; padding:0.4375rem 0.5rem; font-size:0.75rem;" @click="copy">
            {{ copied ? t('tournament.export.copied') : t('tournament.export.copyFile') }}
          </button>
        </div>

        <!-- Readonly rather than disabled, so it can still be selected by hand where the
             clipboard API is unavailable. -->
        <textarea
          :value="json"
          readonly
          rows="8"
          style="width:100%; font-family:ui-monospace, monospace; font-size:0.5625rem; line-height:1.5; padding:0.375rem; border-radius:0.375rem; border:0.125rem solid var(--line); background:#fff; color:var(--ink); resize:vertical;"
        ></textarea>
      </div>
    </div>
  </div>
</template>
