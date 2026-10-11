<!-- Admin-only: the reverse of TournamentUploadModal.vue. Lists tournaments already in the
     database and pulls one back into the local editor — same destination as importing an
     exported file (TournamentImportModal.vue), for a device whose localStorage never had the
     event or lost it. -->
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as adminApi from '../../data/adminApi'
import { adminToken } from '../../data/adminSession'
import { fromObject } from '../../data/tournamentTransfer'

const emit = defineEmits(['close', 'download'])
const { t } = useI18n()

const list = ref([])
const busy = ref(false)
const error = ref('')

async function load() {
  busy.value = true
  error.value = ''
  try {
    const { tournaments } = await adminApi.listTournaments(adminToken.value)
    list.value = tournaments
  } catch (e) {
    error.value = e.message || t('admin.downloadError')
  } finally {
    busy.value = false
  }
}
load()

async function pick(id) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const data = await adminApi.getTournament(adminToken.value, id)
    // Keep the database's own id rather than letting fromObject mint a fresh one — this has to
    // stay a live handle on that same row, or "Upload to database" later creates a duplicate
    // instead of updating it (see tournamentTransfer.js's fromObject for why that matters).
    const result = fromObject(data, { id })
    if (!result.ok) {
      error.value = t('tournament.import.error.' + result.reason)
      return
    }
    emit('download', result.tournament)
  } catch (e) {
    error.value = e.message || t('admin.downloadError')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" style="align-items:center;" @click.self="emit('close')">
    <div class="modal-sheet" style="max-height:88%; position:relative; display:flex; flex-direction:column;">
      <button
        @click="emit('close')"
        style="position:absolute; top:0.625rem; right:0.625rem; width:1.75rem; height:1.75rem; border:none; border-radius:50%; background:rgba(0,0,0,.08); color:var(--ink); font-size:0.9375rem; font-weight:800; line-height:1; cursor:pointer; z-index:1;"
      >✕</button>
      <div class="modal-title" style="padding-right:2rem;">{{ t('admin.downloadTitle') }}</div>

      <div style="display:flex; flex-direction:column; gap:0.375rem; overflow-y:auto;">
        <p v-if="error" style="margin:0; font-size:0.75rem; font-weight:700; color:#C0392B;">{{ error }}</p>
        <p v-if="!busy && !list.length && !error" style="margin:0; font-size:0.75rem; color:var(--sub);">
          {{ t('admin.downloadEmpty') }}
        </p>

        <button
          v-for="tour in list"
          :key="tour.id"
          class="btn secondary"
          style="text-align:left; padding:0.5rem 0.625rem; font-size:0.75rem; display:flex; flex-direction:column; align-items:flex-start; gap:0.125rem;"
          :disabled="busy"
          @click="pick(tour.id)"
        >
          <span style="font-weight:800;">{{ tour.name }}</span>
          <span style="font-size:0.625rem; opacity:.75;">{{ tour.date }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
