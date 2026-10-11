<!-- Admin-only: writes this tournament into the real database (server/index.mjs's
     POST /api/admin/tournaments) instead of just exporting a file. Same event, same data — this
     is the other destination TournamentExportModal.vue's file can go to, reached straight from
     the editor so there's no file to hand off in between. -->
<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as adminApi from '../../data/adminApi'
import { adminToken } from '../../data/adminSession'
import { buildUploadPayload, isFullyPlayed } from '../../data/tournamentTransfer'

const props = defineProps({
  tournament: { type: Object, required: true },
  // Whether this tournament's id already has a row in the database (checked by
  // TournamentDetail.vue before this modal ever opens) — purely a labelling question, since the
  // upload itself already upserts either way. This just makes sure the admin can see that was
  // actually detected, instead of trusting a button that always says the same thing.
  existsInDb: { type: Boolean, default: false }
})
const emit = defineEmits(['close', 'uploaded'])
const { t } = useI18n()

// What each placement tier actually earns — configured in AdminRewardsApp.vue, not guessed from
// a season string. Optional: leaving it on "none" just uploads results without granting anything.
const rewardPackages = ref([])
const rewardPackageId = ref('')
adminApi.listRewardPackages(adminToken.value).then(r => { rewardPackages.value = r.packages }).catch(() => {})

const payload = computed(() => buildUploadPayload(props.tournament, rewardPackageId.value || null))
const finished = computed(() => isFullyPlayed(props.tournament))
const playerCount = computed(() => (props.tournament.players || []).length)
const roundCount = computed(() => (props.tournament.rounds || []).length)

const unplayed = computed(() =>
  (props.tournament.rounds || []).reduce((n, r) =>
    n + r.matches.filter(m => m.player2Id !== null && !m.result).length, 0))

const busy = ref(false)
const error = ref('')
const done = ref(false)

async function upload() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    const result = await adminApi.uploadTournament(adminToken.value, payload.value)
    emit('uploaded', result.players)
    done.value = true
  } catch (e) {
    error.value = e.message || (props.existsInDb ? t('admin.updateError') : t('admin.uploadError'))
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
      <div class="modal-title" style="padding-right:2rem;">{{ existsInDb ? t('admin.updateTitle') : t('admin.uploadTitle') }}</div>

      <div style="display:flex; flex-direction:column; gap:0.625rem; overflow-y:auto;">
        <div style="font-size:0.5625rem; color:var(--sub); font-weight:700; line-height:1.6;">
          {{ existsInDb ? t('admin.updateHint') : t('admin.uploadHint') }}
        </div>

        <div style="background:var(--card); border-radius:0.5rem; padding:0.5rem 0.625rem; display:flex; flex-direction:column; gap:0.25rem;">
          <div style="font-size:0.8125rem; font-weight:800; color:var(--ink);">{{ tournament.name }}</div>
          <div style="font-size:0.625rem; color:var(--sub); font-weight:700;">
            {{ t('tournament.export.summary', { players: playerCount, rounds: roundCount }) }}
          </div>
          <div style="font-size:0.625rem; font-weight:800;" :style="{ color: finished ? 'var(--accent-strong)' : 'var(--sub)' }">
            {{ finished ? t('admin.uploadFinished') : t('admin.uploadNotFinished') }}
          </div>
        </div>

        <div v-if="unplayed" style="font-size:0.625rem; color:var(--danger); font-weight:800; line-height:1.6;">
          {{ t('tournament.export.unplayed', { n: unplayed }) }}
        </div>

        <label style="display:flex; flex-direction:column; gap:0.1875rem;">
          <span style="font-size:0.625rem; font-weight:800; color:var(--sub); letter-spacing:0.04em;">{{ t('admin.uploadRewardPackage') }}</span>
          <select v-model="rewardPackageId" style="font-size:0.8125rem; font-weight:700; color:var(--ink); padding:0.375rem 0.5rem; border:0.125rem solid var(--line); border-radius:var(--radius-sm); background:#fff;">
            <option value="">{{ t('admin.uploadRewardNone') }}</option>
            <option v-for="p in rewardPackages" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>

        <p v-if="error" style="margin:0; font-size:0.75rem; font-weight:700; color:#C0392B;">{{ error }}</p>
        <p v-if="done" style="margin:0; font-size:0.75rem; font-weight:700; color:var(--accent-strong);">{{ existsInDb ? t('admin.updateDone') : t('admin.uploadDone') }}</p>

        <button class="btn" style="padding:0.4375rem 0.5rem; font-size:0.75rem;" :disabled="busy" @click="upload">
          {{ busy
            ? (existsInDb ? t('admin.updating') : t('admin.uploading'))
            : (existsInDb ? t('admin.updateButton') : t('admin.uploadButton')) }}
        </button>
      </div>
    </div>
  </div>
</template>
