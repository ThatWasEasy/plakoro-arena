<script setup>
// Brings tournaments exported from another device — or a folder of past events — back in.
//
// Several files at once, because the realistic case is not one file: it is a season's worth
// sitting in a downloads folder after a device change. Importing them one at a time would be
// the same tedium the export exists to remove.
//
// Each file is judged on its own. One unreadable file in a selection of twelve reports itself
// and the other eleven still import, rather than the whole batch failing on the worst member.
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { parse } from '../../data/tournamentTransfer'

const emit = defineEmits(['close', 'import'])
const { t } = useI18n()

// { fileName, ok, tournament?, reason?, names? }
const entries = ref([])
const text = ref('')
const readError = ref('')

function summarise(tour) {
  const played = tour.rounds.reduce(
    (n, r) => n + r.matches.filter(m => m.player2Id === null || m.result).length, 0)
  return { players: tour.players.length, rounds: tour.rounds.length, played }
}

async function onFiles(e) {
  const files = [...(e.target.files || [])]
  if (!files.length) return
  readError.value = ''
  const read = await Promise.all(files.map(async file => {
    try {
      const result = parse(await file.text())
      return { fileName: file.name, ...result }
    } catch (err) {
      return { fileName: file.name, ok: false, reason: 'unreadable' }
    }
  }))
  // Appended rather than replacing, so a second pick adds to the selection — picking from two
  // different folders is otherwise impossible in one go.
  entries.value = [...entries.value, ...read]
  // Cleared so picking the same file again after an edit still fires a change event.
  e.target.value = ''
}

function addPasted() {
  if (!text.value.trim()) return
  entries.value = [...entries.value, { fileName: t('tournament.import.pastedLabel'), ...parse(text.value) }]
  text.value = ''
}

function remove(i) {
  entries.value = entries.value.filter((_, j) => j !== i)
}

const good = computed(() => entries.value.filter(e => e.ok))
const bad = computed(() => entries.value.filter(e => !e.ok))

function confirm() {
  if (good.value.length) emit('import', good.value.map(e => e.tournament))
}
</script>

<template>
  <div class="modal-overlay" style="align-items:center;" @click.self="$emit('close')">
    <div class="modal-sheet" style="max-height:88%; position:relative; display:flex; flex-direction:column;">
      <button
        @click="$emit('close')"
        style="position:absolute; top:0.625rem; right:0.625rem; width:1.75rem; height:1.75rem; border:none; border-radius:50%; background:rgba(0,0,0,.08); color:var(--ink); font-size:0.9375rem; font-weight:800; line-height:1; cursor:pointer; z-index:1;"
      >✕</button>
      <div class="modal-title" style="padding-right:2rem;">{{ t('tournament.import.title') }}</div>

      <div style="display:flex; flex-direction:column; gap:0.625rem; overflow-y:auto;">
        <div style="font-size:0.5625rem; color:var(--sub); font-weight:700; line-height:1.6;">
          {{ t('tournament.import.hint') }}
        </div>

        <label class="btn secondary" style="padding:0.5rem; font-size:0.75rem; text-align:center; cursor:pointer;">
          {{ t('tournament.import.pickFiles') }}
          <input type="file" accept="application/json,.json" multiple style="display:none;" @change="onFiles">
        </label>

        <div style="display:flex; gap:0.375rem; align-items:flex-start;">
          <textarea
            v-model="text"
            rows="2"
            :placeholder="t('tournament.import.pastePlaceholder')"
            style="flex:1; min-width:0; font-family:ui-monospace, monospace; font-size:0.5625rem; line-height:1.5; padding:0.375rem; border-radius:0.375rem; border:0.125rem solid var(--line); background:#fff; color:var(--ink); resize:vertical;"
          ></textarea>
          <button class="btn secondary" style="padding:0.375rem 0.5rem; font-size:0.625rem; flex-shrink:0;" :disabled="!text.trim()" @click="addPasted">
            {{ t('tournament.import.addPasted') }}
          </button>
        </div>

        <div v-if="readError" style="font-size:0.625rem; color:var(--danger); font-weight:700;">{{ readError }}</div>

        <!-- Both outcomes listed together and in the order picked, so a file that failed is
             visible next to the ones that worked rather than summarised into a count. -->
        <div
          v-for="(e, i) in entries"
          :key="i"
          :style="{
            background: 'var(--card)', borderRadius: '0.5rem', padding: '0.375rem 0.5rem',
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            opacity: e.ok ? 1 : 0.75
          }"
        >
          <div style="flex:1; min-width:0;">
            <div style="font-size:0.6875rem; font-weight:800; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              {{ e.ok ? e.tournament.name : e.fileName }}
            </div>
            <div v-if="e.ok" style="font-size:0.5625rem; color:var(--sub); font-weight:700;">
              {{ t('tournament.import.summary', summarise(e.tournament)) }}
            </div>
            <div v-else style="font-size:0.5625rem; color:var(--danger); font-weight:700; line-height:1.5;">
              {{ t('tournament.import.error.' + e.reason) }}
              <template v-if="e.names">（{{ e.names.join('、') }}）</template>
            </div>
          </div>
          <button
            style="border:none; background:none; color:var(--sub); font-size:0.875rem; font-weight:800; cursor:pointer; flex-shrink:0; padding:0 0.25rem;"
            @click="remove(i)"
          >✕</button>
        </div>
      </div>

      <div style="display:flex; gap:0.625rem; justify-content:center; align-items:center; padding-top:0.75rem;">
        <span v-if="bad.length" style="font-size:0.5625rem; color:var(--danger); font-weight:700;">
          {{ t('tournament.import.skipping', { n: bad.length }) }}
        </span>
        <button class="btn secondary" @click="$emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn" :disabled="!good.length" @click="confirm">
          {{ good.length > 1 ? t('tournament.import.confirmMany', { n: good.length }) : t('tournament.import.confirm') }}
        </button>
      </div>
    </div>
  </div>
</template>
