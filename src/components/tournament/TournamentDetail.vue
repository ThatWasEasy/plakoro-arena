<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  computeStandings,
  pairSwissRound,
  pairEliminationRound,
  isTournamentComplete,
  isRoundComplete,
  championOf,
  assignTableNumbers,
  tableNumberOf,
  addPlayerToRound,
  rewindToRound,
  roundsAfter,
  swapPlayers,
  giveByeTo
} from '../../game/tournamentPairing'
import { parsePlayerLine } from '../../data/tournaments'
import { ensureNameplates, lookupNameplate, lookupPlayerByCode, refreshNameplates } from '../../data/nameplateStore'
import { renderRoundImage, renderStandingsImage, renderPlayerImage, sheetFileName, playerImageFileName } from '../../game/roundImage'
import * as adminApi from '../../data/adminApi'
import { adminToken, isAdminMode } from '../../data/adminSession'
import TournamentLottery from './TournamentLottery.vue'
import TournamentExportModal from './TournamentExportModal.vue'
import TournamentUploadModal from './TournamentUploadModal.vue'
import PlayerBanner from './PlayerBanner.vue'

const props = defineProps({ tournament: { type: Object, required: true } })
const emit = defineEmits(['update', 'back'])
const { t } = useI18n()

// A local, mutable copy — TournamentApp gives this component a fresh instance (via :key) every
// time the active tournament changes, so cloning once here is enough; mutating a prop directly
// would trip Vue's dev warnings. JSON round-trip rather than structuredClone(): the prop is a Vue
// reactive Proxy, and structuredClone can't clone that directly ("could not be cloned") — JSON
// serialization reads through the proxy via normal property access instead, and the tournament
// data is already proven JSON-safe since it's persisted the same way in tournaments.js.
const local = ref(JSON.parse(JSON.stringify(props.tournament)))
// Swiss: 'round' | 'standings' | 'history' | 'players'. Elimination: 'round' | 'bracket' |
// 'players' ('bracket' already covers "history" — every round's matches across the whole
// tournament — so it gets no separate history tab of its own).
const subview = ref('round')
const lotteryRef = ref(null)

// Renaming the tournament or a player: clicking the text itself enters edit mode, and
// committing (Enter or clicking away) opens a confirm popup rather than saving immediately —
// `confirmState` holds the pending change until the organizer explicitly confirms it.
const editingName = ref(false)
const nameDraft = ref('')
const editingPlayerId = ref(null)
const editingPlayerName = ref('')
const confirmState = ref(null) // { kind: 'name' | 'player', playerId?, newValue }

function startEditName() {
  nameDraft.value = local.value.name
  editingName.value = true
}

// Bound to both @keyup.enter and @blur on the input — whichever fires first opens the confirm
// popup (or, if the value didn't actually change, just exits edit mode); the guard below stops
// the other one from re-triggering once a popup is already pending (e.g. blur firing because
// focus moved to the popup's own buttons).
function requestSaveName() {
  if (!editingName.value || confirmState.value) return
  const trimmed = nameDraft.value.trim()
  if (!trimmed || trimmed === local.value.name) { editingName.value = false; return }
  confirmState.value = { kind: 'name', newValue: trimmed }
}

function startEditPlayer(p) {
  editingPlayerId.value = p.id
  editingPlayerName.value = p.name
}

function requestSavePlayer() {
  if (editingPlayerId.value === null || confirmState.value) return
  const p = local.value.players.find(x => x.id === editingPlayerId.value)
  const trimmed = editingPlayerName.value.trim()
  if (!p || !trimmed || trimmed === p.name) { editingPlayerId.value = null; return }
  confirmState.value = { kind: 'player', playerId: p.id, newValue: trimmed }
}

function confirmEdit() {
  if (!confirmState.value) return
  if (confirmState.value.kind === 'name') {
    local.value.name = confirmState.value.newValue
    editingName.value = false
  } else {
    const p = local.value.players.find(x => x.id === confirmState.value.playerId)
    if (p) p.name = confirmState.value.newValue
    editingPlayerId.value = null
  }
  confirmState.value = null
  emitUpdate()
}

function cancelEdit() {
  // Exits edit mode outright rather than leaving the input focused with the typed draft — since
  // the draft was never written back to local.value, this already reverts to the original name;
  // dropping out of edit mode is what actually removes the input's focus.
  if (confirmState.value?.kind === 'name') editingName.value = false
  else if (confirmState.value?.kind === 'player') editingPlayerId.value = null
  confirmState.value = null
}

function playerName(id) {
  if (!id) return ''
  const p = local.value.players.find(p => p.id === id)
  return p ? p.name : '?'
}

// Highlights the winner and mutes the loser in a read-only match row; both stay neutral while
// undecided or drawn.
function nameColor(match, side) {
  if (!match.result || match.result === 'draw') return 'var(--ink)'
  return side === match.result ? 'var(--ink)' : 'var(--sub)'
}

const currentRound = computed(() => local.value.rounds[local.value.rounds.length - 1] || null)
const complete = computed(() => isTournamentComplete(local.value))
const standings = computed(() => computeStandings(local.value))
// Players in standings order (best rank first) — used for the lottery's eligibility list and
// wheel, so it reads the same way the organizer already sees rank in the standings table.
const playersByStandings = computed(() => {
  const byId = new Map(local.value.players.map(p => [p.id, p]))
  return standings.value.map(s => byId.get(s.playerId)).filter(Boolean)
})
const champion = computed(() => championOf(local.value))
// Still offered after the last scheduled round. A tie at the top gets settled by an extra
// match on the day, and the button disappearing at exactly that moment is what sends the
// organiser to the database afterwards — Meetup#2 新彈賽 was decided by a fourth round that
// never made it into the record, and the wrong name went onto the prize list.
//
// What it still refuses is generating a round while the current one is unfinished: that would
// pair people who are mid-match.
const canGenerateNext = computed(() => {
  if (!currentRound.value || !isRoundComplete(currentRound.value)) return false
  // Swiss can always pair another round from the standings. Elimination cannot: it finishes
  // when one player is left, and pairing again produces the champion against nobody.
  if (complete.value && local.value.format !== 'swiss') return false
  return true
})

// Past the planned round count, so the button says what pressing it means now.
const isExtraRound = computed(() => complete.value && local.value.format === 'swiss')

function emitUpdate() {
  emit('update', local.value)
}

// Swiss results stay editable in every round, not just the current one. A mis-entered result
// surfaces late often enough to matter, and correcting it is safe here: computeStandings
// recomputes from scratch, so points and both tiebreakers follow immediately, while the
// pairings of rounds people already played stay as they were — which is what a real event does.
//
// Elimination is the opposite: round N+1's players ARE round N's winners, so editing a settled
// result would leave someone who lost still in the bracket. There it goes through a rewind
// instead, which discards the rounds that were derived from the result being changed.
function recordResult(match, result) {
  match.result = result
  emitUpdate()
}

const pastRoundsEditable = computed(() => local.value.format === 'swiss')

// --- player nameplates ---
//
// The tournament knows a player's name and code; the nameplate store knows everything else.
// Looked up rather than computed here, so the day this moves to a real backend the screens
// below do not change.
function bannerFor(playerId) {
  const p = local.value.players.find(x => x.id === playerId)
  return p ? lookupNameplate(p) : null
}

// A round's pairings, or the standings, as a PNG for printing or pinning up. Drawn rather
// than screenshotted, so it comes out at a size that can be read across a table and carries
// none of the app's buttons.
const savingImage = ref(false)

async function saveSheet(render, fileName) {
  if (savingImage.value) return
  savingImage.value = true
  try {
    const blob = await render()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Revoked on the next tick: doing it synchronously can cancel the download in some
    // browsers before they have read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } finally {
    savingImage.value = false
  }
}

function saveRoundImage() {
  if (!currentRound.value) return
  return saveSheet(
    () => renderRoundImage({ tournament: local.value, round: currentRound.value, plateFor: bannerFor, t }),
    sheetFileName(local.value, `R${currentRound.value.roundNumber}`))
}

function saveStandingsImage() {
  return saveSheet(
    () => renderStandingsImage({ tournament: local.value, standings: standings.value, plateFor: bannerFor, t }),
    sheetFileName(local.value, 'standings'))
}

// One player's nameplate, for them rather than for the room.
function savePlayerImage(player) {
  const nameplate = bannerFor(player.id)
  if (!nameplate) return
  return saveSheet(() => renderPlayerImage({ nameplate, t }), playerImageFileName(nameplate))
}

// --- rewind: reopen an earlier round and re-pair everything after it ---

// Save the tournament as a file. Available whenever a round has been played rather than only
// when complete — the point of exporting mid-event is to move it to another device, which is
// exactly when it isn't finished.
const exportOpen = ref(false)

// Admin-only alternative destination for the same data — straight into the database rather than
// a file. See TournamentUploadModal.vue.
const uploadOpen = ref(false)

// Whether this exact tournament (by id) already has a row in the database — checked once so the
// button/modal can say "update" instead of "upload" and actually mean it, rather than leaving
// the admin to trust that an upsert happened under a generic label. Re-checked right after a
// successful upload too: the very first upload turns a brand-new tournament into an existing
// one, and the label should flip immediately rather than waiting for a reload.
const existsInDb = ref(false)
async function checkExistsInDb() {
  if (!isAdminMode.value) { existsInDb.value = false; return }
  try {
    const { tournaments } = await adminApi.listTournaments(adminToken.value)
    existsInDb.value = tournaments.some(x => x.id === local.value.id)
  } catch (e) {
    existsInDb.value = false
  }
}
onMounted(checkExistsInDb)

// Tournaments created before nameplates were stored on them — and anyone entered while the
// server was unreachable — have no snapshot. Fill the gaps once on open, then save.
//
// Only fills what's missing, so a plate taken at the event is never overwritten by what that
// player looks like today. Not awaited: the sheet renders with default plates and upgrades in
// place rather than waiting on a request.
onMounted(() => {
  ensureNameplates(local.value.players).then(changed => { if (changed) emitUpdate() })
})

// The server may have minted fresh codes for players who didn't have one yet (walk-ins) — apply
// those back onto the local copy so a second upload of the same event reuses them instead of
// creating a new player each time, then persist like any other edit.
function onUploaded(assigned) {
  const byId = new Map(assigned.map(a => [a.id, a.code]))
  local.value.players.forEach(p => {
    const code = byId.get(p.id)
    if (code && p.code !== code) p.code = code
  })
  emit('update', local.value)
  existsInDb.value = true
}

const rewindTarget = ref(null)
const rewindLosses = computed(() => {
  if (rewindTarget.value === null) return { rounds: 0, matches: 0 }
  const lost = roundsAfter(local.value, rewindTarget.value)
  return { rounds: lost.length, matches: lost.reduce((n, r) => n + r.matches.length, 0) }
})

function confirmRewind() {
  if (rewindTarget.value === null) return
  rewindToRound(local.value, rewindTarget.value)
  rewindTarget.value = null
  subview.value = 'round'
  editingPairing.value = false
  swapFirst.value = null
  byePicker.value = false
  emitUpdate()
}

// Re-pairs the current round from scratch, using the roster and standings as they are now.
//
// This is what makes a late entrant's pairing correct rather than merely workable. Slotting
// someone into the bye seat puts them against whoever happened to be sitting out; Swiss pairs by
// score group, and a newcomer on zero points belongs with the other players on zero — which,
// when several arrive together, means they play each other. Only a re-pair produces that.
const repairConfirm = ref(false)
const recordedThisRound = computed(() =>
  currentRound.value ? currentRound.value.matches.filter(m => m.player2Id !== null && m.result).length : 0
)

function requestRepair() {
  if (!currentRound.value) return
  // Nothing to lose when no result has been entered yet — skip the prompt.
  if (recordedThisRound.value === 0) { doRepair(); return }
  repairConfirm.value = true
}

function doRepair() {
  const n = local.value.rounds.length
  if (n === 0) return
  rewindToRound(local.value, n - 1)
  const round = local.value.format === 'swiss' ? pairSwissRound(local.value) : pairEliminationRound(local.value)
  if (round) {
    assignTableNumbers(local.value, round)
    local.value.rounds.push(round)
  }
  repairConfirm.value = false
  editingPairing.value = false
  swapFirst.value = null
  byePicker.value = false
  lastAddResult.value = null
  emitUpdate()
}

// --- manual pairing: tap two players to swap their seats ---

const editingPairing = ref(false)
const swapFirst = ref(null)
const byePicker = ref(false)

// Everyone currently in a real match — the candidates for taking over the bye.
const byeCandidates = computed(() => {
  if (!currentRound.value) return []
  return currentRound.value.matches
    .filter(m => m.player2Id !== null)
    .flatMap(m => [m.player1Id, m.player2Id])
})

function togglePairingEdit() {
  editingPairing.value = !editingPairing.value
  swapFirst.value = null
  byePicker.value = false
}

// Two taps make a swap; tapping the same player again just cancels the selection.
function tapPlayer(playerId) {
  if (!editingPairing.value || !currentRound.value) return
  if (swapFirst.value === null) { swapFirst.value = playerId; return }
  if (swapFirst.value === playerId) { swapFirst.value = null; return }
  swapPlayers(local.value, currentRound.value, swapFirst.value, playerId)
  swapFirst.value = null
  emitUpdate()
}

function moveByeTo(playerId) {
  if (!currentRound.value) return
  if (giveByeTo(local.value, currentRound.value, playerId)) emitUpdate()
  byePicker.value = false
}

// --- roster: add a late entrant, drop someone who left ---

const newPlayerName = ref('')
// Whether a late entrant joins the round in progress or waits for the next one. Joining now is
// the default: the common case is someone arriving a few minutes late, and making them sit out
// a round they could have played is the worse of the two errors.
const addToCurrentRound = ref(true)
const lastAddResult = ref(null) // 'paired' | 'bye' | null — what happened to the last entrant

function addPlayer() {
  // Same `name;code` shorthand the setup screen accepts, so a late entrant can be added in one
  // keystroke rather than typed then edited.
  const { name, code } = parsePlayerLine(newPlayerName.value)
  if (!name) return
  const player = { id: crypto.randomUUID(), name, ...(code ? { code } : {}) }
  local.value.players.push(player)
  lastAddResult.value = null
  if (addToCurrentRound.value && currentRound.value && !complete.value) {
    const outcome = addPlayerToRound(local.value, currentRound.value, player.id)
    if (outcome) lastAddResult.value = outcome
  }
  newPlayerName.value = ''
  emitUpdate()

  // Not awaited: a late entrant is added at the desk with someone waiting, and their plate
  // filling in a moment later is better than the button hanging on a request. If it lands, the
  // row re-renders and the tournament is saved again; if it doesn't, they keep the default.
  ensureNameplates([player]).then(changed => { if (changed) emitUpdate() })
}

// A code only counts once it has been checked.
//
// Typing goes into a draft and nothing else happens: the box is not the record. Pressing 確認
// asks the server, and only an answer puts the code on the roster — a typo'd code that nobody
// owns is refused and the box goes back to what it was. The alternative, which this replaces,
// was a code that saved itself as you typed: a slip of the finger then became a real code on a
// real upload, which is exactly how a player ended up with an account nobody meant to create.
const codeDrafts = ref({})
const codeBusy = ref('')
const codeErrors = ref({})

function codeDraft(player) {
  const d = codeDrafts.value[player.id]
  return d === undefined ? (player.code || '') : d
}

// Uppercased as it is typed: a code is a case-insensitive identifier, and seeing it normalise
// in the box is also how the organiser knows the field means something specific.
function editCode(player, value) {
  codeDrafts.value = { ...codeDrafts.value, [player.id]: String(value || '').trim().toUpperCase() }
  if (codeErrors.value[player.id]) {
    const next = { ...codeErrors.value }
    delete next[player.id]
    codeErrors.value = next
  }
}

const codeDirty = player => codeDraft(player) !== (player.code || '')

function setCodeError(player, message) {
  codeErrors.value = { ...codeErrors.value, [player.id]: message }
}

function forgetDraft(player) {
  const next = { ...codeDrafts.value }
  delete next[player.id]
  codeDrafts.value = next
}

async function confirmCode(player) {
  const code = codeDraft(player)
  if (!codeDirty(player) || codeBusy.value) return

  // Clearing is the one change that needs nobody's permission — there is nothing to verify
  // about "this player has no code".
  if (!code) {
    delete player.code
    delete player.nameplate
    forgetDraft(player)
    emitUpdate()
    return
  }

  codeBusy.value = player.id
  try {
    const plate = await lookupPlayerByCode(code)
    if (!plate) {
      // Refused, and the box goes back. Leaving the typo in it would look like it had been
      // accepted and just hadn't found a name yet.
      setCodeError(player, t('tournament.detail.codeNotFound', { code }))
      forgetDraft(player)
      return
    }
    player.code = code
    player.nameplate = plate
    // The organiser wrote down what they heard across a sign-in desk; the code is what the
    // record actually calls this person.
    if (plate.name) player.name = plate.name
    forgetDraft(player)
    emitUpdate()
  } catch (e) {
    // Unreachable, not unknown. The draft stays so the same keystrokes aren't needed twice.
    setCodeError(player, t('tournament.detail.codeLookupFailed'))
  } finally {
    codeBusy.value = ''
  }
}

// Flagged, never deleted: the matches they already played stay on the record, because removing
// them would quietly rewrite every opponent's OMW%/OOMW%.
function toggleDropped(player) {
  player.dropped = !player.dropped
  emitUpdate()
}

const activeCount = computed(() => local.value.players.filter(p => !p.dropped).length)

// Re-take every player's nameplate from the server.
//
// Snapshots are taken once when a player is entered and then left alone — a finished event's
// pairing sheet has to keep showing what people were wearing that afternoon. Before the event
// that rule is backwards: someone who changed their flag this morning should appear in today's
// pairings wearing it. This is that case, made explicit.
//
// Confirms first when the tournament is already finished, because then it really is rewriting
// a record of a day that has passed.
const refreshingPlates = ref(false)
const refreshPlatesConfirm = ref(false)
const refreshedCount = ref(null)

function askRefreshPlates() {
  if (complete.value && !refreshPlatesConfirm.value) { refreshPlatesConfirm.value = true; return }
  doRefreshPlates()
}

async function doRefreshPlates() {
  if (refreshingPlates.value) return
  refreshingPlates.value = true
  refreshPlatesConfirm.value = false
  refreshedCount.value = null
  try {
    const n = await refreshNameplates(local.value.players)
    refreshedCount.value = n
    if (n > 0) emitUpdate()
  } finally {
    refreshingPlates.value = false
  }
}

// The planned round count, changeable after the event. Lowering it to the number actually
// played is how an event that ended early gets marked finished — placements are only computed
// once rounds.length reaches this, and nothing is granted until placements exist.
function setTotalRounds(value) {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n) || n < 1 || n > 20) return
  local.value.swissTotalRounds = n
  emitUpdate()
}

let generating = false
function generateNextRound() {
  if (generating || !canGenerateNext.value) return
  generating = true
  try {
    const round = local.value.format === 'swiss' ? pairSwissRound(local.value) : pairEliminationRound(local.value)
    if (round) {
      // Table numbers must be stamped now, from standings as of right before this round —
      // never recomputed later, or they'd reshuffle live as results get recorded this round.
      assignTableNumbers(local.value, round)
      local.value.rounds.push(round)
      emitUpdate()
    }
  } finally {
    generating = false
  }
}
</script>

<template>
  <div class="board select-board" style="display:flex; flex-direction:column; min-height:0;">
    <!-- Title and view tabs share a row — a separate tab row ate into the vertical space the
         main content area needed. The title shrinks/truncates first if the two don't both fit. -->
    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:0.375rem; flex-shrink:0; padding:0.375rem 0.625rem 0.25rem;">
      <input
        v-if="editingName"
        v-model="nameDraft"
        autofocus
        @keyup.enter="requestSaveName"
        @blur="requestSaveName"
        style="flex:1; min-width:0; font-size:0.8125rem; font-weight:800; padding:0.25rem 0.375rem; border-radius:0.375rem; border:0.125rem solid var(--line); color:var(--ink);"
      >
      <div
        v-else
        class="modal-title"
        style="font-size:0.8125rem; margin:0; text-align:left; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer;"
        @click="startEditName"
      >{{ local.name }}</div>
      <button :class="['btn', subview === 'round' ? '' : 'secondary']" style="flex-shrink:0; padding:0.4375rem 0.5rem; font-size:0.6875rem;" @click="subview = 'round'">
        {{ t('tournament.detail.roundTab') }}
      </button>
      <template v-if="local.format === 'swiss'">
        <button
          :class="['btn', subview === 'standings' ? '' : 'secondary']"
          style="flex-shrink:0; padding:0.4375rem 0.5rem; font-size:0.6875rem;"
          @click="subview = 'standings'"
        >{{ t('tournament.detail.standingsTab') }}</button>
        <button
          :class="['btn', subview === 'history' ? '' : 'secondary']"
          style="flex-shrink:0; padding:0.4375rem 0.5rem; font-size:0.6875rem;"
          @click="subview = 'history'"
        >{{ t('tournament.detail.historyTab') }}</button>
      </template>
      <button
        v-else
        :class="['btn', subview === 'bracket' ? '' : 'secondary']"
        style="flex-shrink:0; padding:0.4375rem 0.5rem; font-size:0.6875rem;"
        @click="subview = 'bracket'"
      >{{ t('tournament.detail.bracketTab') }}</button>
      <button
        :class="['btn', subview === 'players' ? '' : 'secondary']"
        style="flex-shrink:0; padding:0.4375rem 0.5rem; font-size:0.6875rem;"
        @click="subview = 'players'"
      >{{ t('tournament.detail.playersTab') }}</button>
      <button
        :class="['btn', subview === 'lottery' ? '' : 'secondary']"
        style="flex-shrink:0; padding:0.4375rem 0.5rem; font-size:0.6875rem;"
        @click="subview = 'lottery'"
      >{{ t('tournament.detail.lotteryTab') }}</button>
    </div>

    <div style="flex:1; min-height:0; overflow-y:auto; padding:0 0.625rem;">
      <!-- Current round — a table row per match rather than a stack of cards, so it doesn't
           spread out the whole page. -->
      <div v-if="subview === 'round' && currentRound" style="overflow-x:auto;">
        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.375rem;">
          <div style="font-size:0.75rem; font-weight:800; color:var(--sub); flex:1;">{{ t('tournament.roundLabel', { n: currentRound.roundNumber }) }}</div>
          <button
            :class="['btn', editingPairing ? '' : 'secondary']"
            style="padding:0.3125rem 0.5rem; font-size:0.625rem; flex-shrink:0;"
            @click="togglePairingEdit"
          >{{ editingPairing ? t('tournament.detail.pairingDone') : t('tournament.detail.editPairing') }}</button>
          <button
            class="btn secondary"
            style="padding:0.3125rem 0.5rem; font-size:0.625rem; flex-shrink:0;"
            @click="requestRepair"
          >{{ t('tournament.detail.repair') }}</button>
          <button
            class="btn secondary"
            style="padding:0.3125rem 0.5rem; font-size:0.625rem; flex-shrink:0;"
            :disabled="savingImage"
            @click="saveRoundImage"
          >{{ savingImage ? t('tournament.detail.savingImage') : t('tournament.detail.saveImage') }}</button>
        </div>
        <div v-if="editingPairing" style="font-size:0.625rem; color:var(--sub); line-height:1.6; padding-bottom:0.375rem;">
          {{ swapFirst ? t('tournament.detail.swapPickSecond', { name: playerName(swapFirst) }) : t('tournament.detail.swapPickFirst') }}
        </div>
        <!-- Bye reassignment is its own picker: "who should sit out" is a question about one
             person, where a swap needs two taps and the second one is always the same player. -->
        <div v-if="byePicker" style="display:flex; flex-wrap:wrap; gap:0.25rem; padding-bottom:0.5rem;">
          <button
            v-for="pid in byeCandidates"
            :key="pid"
            class="btn secondary"
            style="padding:0.1875rem 0.4375rem; font-size:0.5625rem;"
            @click="moveByeTo(pid)"
          >{{ playerName(pid) }}</button>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:0.75rem;">
          <tbody>
            <tr v-for="m in currentRound.matches" :key="m.id" style="border-bottom:1px solid var(--line);">
              <td style="padding:0.5rem 0.375rem; color:var(--sub); white-space:nowrap;">
                {{ tableNumberOf(currentRound, m) !== null
                   ? t('tournament.detail.tableLabel', { n: tableNumberOf(currentRound, m) })
                   : t('tournament.detail.bye') }}
              </td>
              <!-- While editing, each name is its own tap target — a plain pill, because
                   swapping is two taps and the nameplate's emblem would be one more thing
                   between them. Otherwise the name is shown as the player's nameplate. -->
              <td style="padding:0.5rem 0.5rem; font-weight:700; color:var(--ink);">
                <template v-if="editingPairing">
                  <span
                    v-for="(pid, si) in (m.player2Id === null ? [m.player1Id] : [m.player1Id, m.player2Id])"
                    :key="pid"
                  >
                    <span v-if="si === 1" style="color:var(--sub); font-weight:400;"> vs </span>
                    <span
                      :style="{
                        cursor:'pointer', borderRadius:'0.375rem', padding:'0.125rem 0.3125rem',
                        background: swapFirst === pid ? 'var(--accent, #AEFF3E)' : 'rgba(0,0,0,.06)'
                      }"
                      @click="tapPlayer(pid)"
                    >{{ playerName(pid) }}</span>
                  </span>
                </template>
                <template v-else-if="m.player2Id === null">
                  <PlayerBanner v-if="bannerFor(m.player1Id)" :nameplate="bannerFor(m.player1Id)" />
                  <button
                    v-if="currentRound.matches.length > 1"
                    class="btn secondary"
                    style="padding:0.125rem 0.3125rem; font-size:0.5625rem; margin-left:0.25rem;"
                    @click="byePicker = !byePicker"
                  >{{ t('tournament.detail.changeBye') }}</button>
                </template>
                <template v-else>
                  <PlayerBanner v-if="bannerFor(m.player1Id)" :nameplate="bannerFor(m.player1Id)" />
                  <span style="color:var(--sub); font-weight:400; padding:0 0.25rem;">vs</span>
                  <PlayerBanner v-if="bannerFor(m.player2Id)" :nameplate="bannerFor(m.player2Id)" />
                  <span v-if="m.rematch" style="display:inline-block; font-size:0.625rem; font-weight:800; color:#fff; background:var(--danger); border-radius:0.5rem; padding:0.125rem 0.4375rem; margin-left:0.25rem;">{{ t('tournament.detail.rematchBadge') }}</span>
                </template>
              </td>
              <td v-if="m.player2Id !== null" style="padding:0.375rem 0.25rem; white-space:nowrap;">
                <button :class="['btn', m.result === 'p1' ? '' : 'secondary']" style="padding:0.25rem 0.375rem; font-size:0.625rem;" @click="recordResult(m, 'p1')">{{ t('tournament.detail.resultP1') }}</button>
                <button v-if="local.format === 'swiss'" :class="['btn', m.result === 'draw' ? '' : 'secondary']" style="padding:0.25rem 0.375rem; font-size:0.625rem;" @click="recordResult(m, 'draw')">{{ t('tournament.detail.resultDraw') }}</button>
                <button :class="['btn', m.result === 'p2' ? '' : 'secondary']" style="padding:0.25rem 0.375rem; font-size:0.625rem;" @click="recordResult(m, 'p2')">{{ t('tournament.detail.resultP2') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Swiss standings — ranked by points, then the official Play! Pokemon tiebreakers
           (OMW%, then OOMW%). Wrapped in horizontal scroll now that it's 6 columns wide. -->
      <div v-else-if="subview === 'standings'" style="overflow-x:auto;">
        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.375rem;">
          <div style="font-size:0.75rem; font-weight:800; color:var(--sub); flex:1;">{{ t('tournament.detail.standingsTab') }}</div>
          <button
            class="btn secondary"
            style="padding:0.3125rem 0.5rem; font-size:0.625rem; flex-shrink:0;"
            :disabled="savingImage"
            @click="saveStandingsImage"
          >{{ savingImage ? t('tournament.detail.savingImage') : t('tournament.detail.saveImage') }}</button>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:0.75rem; white-space:nowrap;">
          <thead>
            <tr style="text-align:left; border-bottom:2px solid var(--line);">
              <th style="padding:0.375rem 0.5rem;">{{ t('tournament.detail.standingsHeaders.rank') }}</th>
              <th style="padding:0.375rem 0.5rem;">{{ t('tournament.detail.standingsHeaders.name') }}</th>
              <th style="padding:0.375rem 0.5rem;">{{ t('tournament.detail.standingsHeaders.points') }}</th>
              <th style="padding:0.375rem 0.5rem;">{{ t('tournament.detail.standingsHeaders.record') }}</th>
              <th style="padding:0.375rem 0.5rem;">{{ t('tournament.detail.standingsHeaders.omwp') }}</th>
              <th style="padding:0.375rem 0.5rem;">{{ t('tournament.detail.standingsHeaders.oomwp') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in standings" :key="s.playerId" style="border-bottom:1px solid var(--line);">
              <td style="padding:0.375rem 0.5rem; color:var(--sub);">{{ i + 1 }}</td>
              <td style="padding:0.375rem 0.5rem;">
                <PlayerBanner v-if="bannerFor(s.playerId)" :nameplate="bannerFor(s.playerId)" />
                <template v-else>{{ s.name }}</template>
              </td>
              <td style="padding:0.375rem 0.5rem; font-weight:800;">{{ s.points }}</td>
              <td style="padding:0.375rem 0.5rem; color:var(--sub);">{{ s.wins }}-{{ s.draws }}-{{ s.losses }}</td>
              <td style="padding:0.375rem 0.5rem; color:var(--sub);">{{ (s.omwp * 100).toFixed(1) }}%</td>
              <td style="padding:0.375rem 0.5rem; color:var(--sub);">{{ (s.oomwp * 100).toFixed(1) }}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Swiss match history — every round's pairings and results, read-only, as a flat table
           (most recent round first) so it doesn't spread out the whole page either. -->
      <div v-else-if="subview === 'history'" style="overflow-x:auto;">
        <table style="width:100%; border-collapse:collapse; font-size:0.75rem;">
          <thead>
            <tr style="text-align:left; border-bottom:2px solid var(--line);">
              <th style="padding:0.375rem 0.5rem;">{{ t('tournament.detail.historyHeaders.round') }}</th>
              <th style="padding:0.375rem 0.5rem;">{{ t('tournament.detail.historyHeaders.match') }}</th>
              <th style="padding:0.375rem 0.5rem;">{{ t('tournament.detail.historyHeaders.result') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="round in [...local.rounds].reverse()" :key="round.roundNumber">
              <!-- One rewind control per round, so "go back to round 2 and re-pair from there"
                   is reachable without hunting for it. -->
              <tr v-if="round.roundNumber < local.rounds.length">
                <td colspan="3" style="padding:0.25rem 0.5rem; text-align:right;">
                  <button
                    class="btn secondary"
                    style="padding:0.1875rem 0.4375rem; font-size:0.5625rem;"
                    @click="rewindTarget = round.roundNumber"
                  >{{ t('tournament.detail.rewindTo', { n: round.roundNumber }) }}</button>
                </td>
              </tr>
              <tr v-for="m in round.matches" :key="m.id" style="border-bottom:1px solid var(--line);">
                <td style="padding:0.375rem 0.5rem; color:var(--sub);">{{ round.roundNumber }}</td>
                <td style="padding:0.375rem 0.5rem; font-weight:700;">
                  <template v-if="m.player2Id === null">{{ playerName(m.player1Id) }}</template>
                  <template v-else>
                    <span :style="{ color: nameColor(m, 'p1') }">{{ playerName(m.player1Id) }}</span>
                    <span style="color:var(--sub); font-weight:400;"> vs </span>
                    <span :style="{ color: nameColor(m, 'p2') }">{{ playerName(m.player2Id) }}</span>
                  </template>
                </td>
                <!-- Swiss: the result stays editable here, because correcting it only moves the
                     standings. Elimination shows it read-only — changing it there needs a
                     rewind, since later rounds were derived from it. -->
                <td style="padding:0.375rem 0.5rem; color:var(--sub); white-space:nowrap;">
                  <template v-if="m.player2Id === null">{{ t('tournament.detail.bye') }}</template>
                  <template v-else-if="pastRoundsEditable">
                    <button :class="['btn', m.result === 'p1' ? '' : 'secondary']" style="padding:0.1875rem 0.3125rem; font-size:0.5625rem;" @click="recordResult(m, 'p1')">{{ t('tournament.detail.resultP1') }}</button>
                    <button :class="['btn', m.result === 'draw' ? '' : 'secondary']" style="padding:0.1875rem 0.3125rem; font-size:0.5625rem;" @click="recordResult(m, 'draw')">{{ t('tournament.detail.resultDraw') }}</button>
                    <button :class="['btn', m.result === 'p2' ? '' : 'secondary']" style="padding:0.1875rem 0.3125rem; font-size:0.5625rem;" @click="recordResult(m, 'p2')">{{ t('tournament.detail.resultP2') }}</button>
                  </template>
                  <template v-else-if="m.result === 'draw'">{{ t('tournament.detail.resultDraw') }}</template>
                  <template v-else-if="m.result === 'p1'">{{ playerName(m.player1Id) }}</template>
                  <template v-else-if="m.result === 'p2'">{{ playerName(m.player2Id) }}</template>
                  <span v-if="m.rematch" style="font-size:0.625rem; font-weight:800; color:#fff; background:var(--danger); border-radius:0.5rem; padding:0.125rem 0.4375rem; margin-left:0.25rem;">{{ t('tournament.detail.rematchBadge') }}</span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- Player roster — rename anyone who registered under the wrong name/nickname. Renaming
           is safe at any point: matches/results are keyed by player id, never by name. -->
      <div v-else-if="subview === 'players'" style="display:flex; flex-direction:column; gap:0.375rem;">
        <!-- Editable after the fact, not just at setup. An event that was planned for four
             rounds and finished in three stays "unfinished" forever otherwise: no placements
             are computed, so no placement prizes are ever granted — which is exactly what
             happened to Meetup#2 雙打賽. -->
        <!-- Before the event: pull in whatever people are wearing now. -->
        <div style="display:flex; align-items:center; gap:0.5rem; padding:0.375rem 0.5rem; background:var(--card); border-radius:0.5rem; box-shadow:var(--shadow);">
          <button
            class="btn secondary"
            style="padding:0.25rem 0.5rem; font-size:0.625rem; flex-shrink:0;"
            :disabled="refreshingPlates"
            @click="askRefreshPlates"
          >{{ refreshingPlates ? t('tournament.detail.refreshingPlates') : t('tournament.detail.refreshPlates') }}</button>
          <span v-if="refreshPlatesConfirm" style="font-size:0.625rem; font-weight:800; color:#C8203C;">
            {{ t('tournament.detail.refreshPlatesWarn') }}
          </span>
          <span v-else-if="refreshedCount !== null" style="font-size:0.625rem; font-weight:700; color:var(--sub);">
            {{ t('tournament.detail.refreshedPlates', { n: refreshedCount }) }}
          </span>
        </div>

        <label
          v-if="local.format === 'swiss'"
          style="display:flex; align-items:center; gap:0.5rem; padding:0.375rem 0.5rem; background:var(--card); border-radius:0.5rem; box-shadow:var(--shadow);"
        >
          <span style="font-size:0.6875rem; font-weight:800; color:var(--sub);">{{ t('tournament.setup.roundsLabel') }}</span>
          <input
            :value="local.swissTotalRounds"
            type="number"
            min="1"
            max="20"
            style="width:3.5rem; text-align:center; font-size:0.8125rem; font-weight:800; color:var(--ink); padding:0.25rem; border:0.125rem solid var(--line); border-radius:0.375rem; background:#fff; font-variant-numeric:tabular-nums;"
            @input="setTotalRounds($event.target.value)"
          >
          <span style="font-size:0.625rem; font-weight:700; color:var(--sub);">
            {{ t('tournament.detail.roundsPlayed', { n: local.rounds.length }) }}
          </span>
        </label>

        <div
          v-for="p in local.players"
          :key="p.id"
          style="display:flex; align-items:center; gap:0.5rem; background:var(--card); border-radius:0.5rem; box-shadow:var(--shadow); padding:0.5rem 0.625rem;"
        >
          <input
            v-if="editingPlayerId === p.id"
            v-model="editingPlayerName"
            autofocus
            @keyup.enter="requestSavePlayer"
            @blur="requestSavePlayer"
            style="flex:1; min-width:0; font-size:0.8125rem; font-weight:700; padding:0.25rem 0.375rem; border-radius:0.375rem; border:0.125rem solid var(--line); color:var(--ink);"
          >
          <span
            v-else
            :style="{
              flex:1, minWidth:0, fontSize:'0.8125rem', fontWeight:700, overflow:'hidden',
              textOverflow:'ellipsis', whiteSpace:'nowrap', cursor:'pointer',
              color: p.dropped ? 'var(--sub)' : 'var(--ink)',
              textDecoration: p.dropped ? 'line-through' : 'none'
            }"
            @click="startEditPlayer(p)"
          >{{ p.name }}</span>
          <!-- The player's id in whatever shared roster the organiser submits to. Edited here
               rather than only at setup, because a player often gives it after sign-in — and
               getting it right is what links this result to the rest of their record. -->
          <input
            :value="codeDraft(p)"
            :placeholder="t('tournament.detail.codePlaceholder')"
            :title="codeErrors[p.id] || ''"
            @input="e => editCode(p, e.target.value)"
            @keyup.enter="confirmCode(p)"
            :style="{
              width:'5.5rem', flexShrink:0, fontSize:'0.625rem', fontWeight:800,
              padding:'0.25rem 0.3125rem', borderRadius:'0.375rem',
              border:'0.125rem solid ' + (codeErrors[p.id] ? '#C0392B' : 'var(--line)'),
              background:'#fff', color:'var(--ink)', textAlign:'center'
            }"
          >
          <!-- Only ever offered when the box differs from what is on the roster: with nothing to
               confirm, a live button is just something to press and wonder about. -->
          <button
            v-if="codeDirty(p)"
            class="btn"
            style="padding:0.25rem 0.4375rem; font-size:0.5625rem; flex-shrink:0;"
            :disabled="codeBusy === p.id"
            @click="confirmCode(p)"
          >{{ codeBusy === p.id ? t('tournament.detail.codeChecking') : t('tournament.detail.codeConfirm') }}</button>
          <button
            class="btn secondary"
            style="padding:0.25rem 0.4375rem; font-size:0.5625rem; flex-shrink:0;"
            :disabled="savingImage"
            :title="t('tournament.detail.savePlayerImage')"
            @click="savePlayerImage(p)"
          >{{ t('tournament.detail.savePlayerImageShort') }}</button>
          <button
            class="btn secondary"
            style="padding:0.25rem 0.4375rem; font-size:0.5625rem; flex-shrink:0;"
            @click="toggleDropped(p)"
          >{{ p.dropped ? t('tournament.detail.undrop') : t('tournament.detail.drop') }}</button>
        </div>

        <!-- Late entrants join from the next round; they simply start on zero. -->
        <div style="display:flex; align-items:center; gap:0.5rem; padding-top:0.25rem;">
          <input
            v-model="newPlayerName"
            :placeholder="t('tournament.detail.addPlayerPlaceholder')"
            @keyup.enter="addPlayer"
            style="flex:1; min-width:0; font-size:0.8125rem; font-weight:700; padding:0.375rem 0.5rem; border-radius:0.375rem; border:0.125rem solid var(--line); background:#fff; color:var(--ink);"
          >
          <button class="btn" style="padding:0.375rem 0.625rem; font-size:0.6875rem; flex-shrink:0;" :disabled="!newPlayerName.trim()" @click="addPlayer">{{ t('tournament.detail.addPlayer') }}</button>
        </div>
        <label v-if="currentRound && !complete" style="display:flex; align-items:center; gap:0.3125rem; font-size:0.625rem; font-weight:700; color:var(--sub); cursor:pointer;">
          <input type="checkbox" v-model="addToCurrentRound" style="width:0.75rem; height:0.75rem; margin:0;">
          {{ t('tournament.detail.joinCurrentRound', { n: currentRound.roundNumber }) }}
        </label>
        <!-- Says which of the two things happened, since it depends on whether the round was
             odd or even and the organizer shouldn't have to go and look. -->
        <div v-if="lastAddResult" style="font-size:0.625rem; font-weight:800; color:var(--ink); line-height:1.6;">
          {{ lastAddResult === 'paired' ? t('tournament.detail.addedPaired') : t('tournament.detail.addedBye') }}
        </div>
        <div style="font-size:0.625rem; color:var(--sub); line-height:1.6;">
          {{ t('tournament.detail.rosterNote', { active: activeCount, total: local.players.length }) }}
        </div>
      </div>

      <!-- Prize draw wheel — a separate component since it's a genuinely distinct little tool
           (its own animation/state), not part of the tournament's core pairing data. -->
      <TournamentLottery v-else-if="subview === 'lottery'" ref="lotteryRef" :players="playersByStandings" />

      <!-- Elimination bracket (read-only history across all rounds) -->
      <div v-else-if="subview === 'bracket'" style="display:flex; gap:0.625rem; overflow-x:auto; padding-bottom:0.5rem;">
        <div v-for="round in local.rounds" :key="round.roundNumber" style="min-width:7.5rem; flex-shrink:0; display:flex; flex-direction:column; gap:0.375rem;">
          <div style="font-size:0.6875rem; font-weight:800; color:var(--sub); text-align:center;">{{ t('tournament.roundLabel', { n: round.roundNumber }) }}</div>
          <!-- The bracket is elimination's history view, so the rewind control lives here for
               that format — a wrong result can only be corrected by re-deriving what came after. -->
          <button
            v-if="round.roundNumber < local.rounds.length"
            class="btn secondary"
            style="padding:0.1875rem 0.375rem; font-size:0.5625rem;"
            @click="rewindTarget = round.roundNumber"
          >{{ t('tournament.detail.rewindHere') }}</button>
          <div
            v-for="m in round.matches"
            :key="m.id"
            style="background:var(--card); border-radius:0.5rem; box-shadow:var(--shadow); padding:0.375rem 0.5rem; font-size:0.6875rem; font-weight:700; color:var(--ink);"
          >
            <div v-if="m.player2Id === null">{{ playerName(m.player1Id) }} ({{ t('tournament.detail.bye') }})</div>
            <template v-else>
              <div :style="{ color: m.result === 'p1' ? 'var(--ink)' : 'var(--sub)' }">{{ playerName(m.player1Id) }}</div>
              <div :style="{ color: m.result === 'p2' ? 'var(--ink)' : 'var(--sub)' }">{{ playerName(m.player2Id) }}</div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div style="display:flex; flex-direction:column; align-items:center; gap:0.375rem; padding:0.375rem 0 0.25rem; flex-shrink:0;">
      <div v-if="champion" style="font-size:0.8125rem; font-weight:800; color:var(--ink);">
        {{ t('tournament.detail.champion', { name: champion.name }) }}
      </div>
      <div style="display:flex; gap:0.625rem;">
        <!-- After the last scheduled round this becomes 加賽一輪 and goes quiet (.secondary):
             still reachable for a tie-break, but no longer the thing the screen is suggesting.
             Gone entirely once an elimination bracket has a champion — there is nobody left to
             pair him against. -->
        <button
          v-if="!complete || isExtraRound"
          :class="['btn', { secondary: isExtraRound }]"
          style="padding:0.5rem 0.875rem; font-size:0.8125rem;"
          :disabled="!canGenerateNext"
          @click="generateNextRound"
        >{{ isExtraRound ? t('tournament.detail.generateExtraRound') : t('tournament.detail.generateNextRound') }}</button>
        <button
          v-if="subview === 'lottery'"
          class="btn"
          style="padding:0.5rem 0.875rem; font-size:0.8125rem;"
          :disabled="!lotteryRef?.canSpin || lotteryRef?.spinning"
          @click="lotteryRef.startSpin()"
        >{{ t('tournament.detail.drawButton') }}</button>
        <button
          v-if="local.rounds.length"
          class="btn secondary"
          style="padding:0.5rem 0.875rem; font-size:0.8125rem;"
          @click="exportOpen = true"
        >{{ t('tournament.export.button') }}</button>
        <button
          v-if="local.rounds.length && isAdminMode"
          class="btn secondary"
          style="padding:0.5rem 0.875rem; font-size:0.8125rem;"
          @click="uploadOpen = true"
        >{{ existsInDb ? t('admin.updateButton') : t('admin.uploadButton') }}</button>
        <button class="btn secondary" style="padding:0.5rem 0.875rem; font-size:0.8125rem;" @click="emit('back')">{{ t('common.back') }}</button>
      </div>
    </div>

    <div v-if="confirmState" class="modal-overlay" style="align-items:center;" @click.self="cancelEdit">
      <div style="background:var(--bg); border-radius:1.125rem; box-shadow:var(--shadow); padding:1.25rem 1.5rem; max-width:22rem; display:flex; flex-direction:column; align-items:center; gap:0.75rem; text-align:center;">
        <div style="font-size:0.8125rem; font-weight:700; color:var(--ink); line-height:1.6;">
          {{ confirmState.kind === 'name'
            ? t('tournament.detail.confirmRenameTournament', { name: confirmState.newValue })
            : t('tournament.detail.confirmRenamePlayer', { name: confirmState.newValue }) }}
        </div>
        <div style="display:flex; gap:0.625rem; justify-content:center;">
          <button class="btn secondary" @click="cancelEdit">{{ t('common.cancel') }}</button>
          <button class="btn" @click="confirmEdit">{{ t('common.confirm') }}</button>
        </div>
      </div>
    </div>

    <!-- Re-pairing discards this round's pairings; it only asks when results would be lost. -->
    <div v-if="repairConfirm" class="modal-overlay" style="align-items:center;" @click.self="repairConfirm = false">
      <div style="background:var(--bg); border-radius:1.125rem; box-shadow:var(--shadow); padding:1.25rem 1.5rem; max-width:22rem; display:flex; flex-direction:column; align-items:center; gap:0.75rem; text-align:center;">
        <div style="font-size:0.8125rem; font-weight:700; color:var(--ink); line-height:1.6;">
          {{ t('tournament.detail.confirmRepair', { n: recordedThisRound }) }}
        </div>
        <div style="display:flex; gap:0.625rem; justify-content:center;">
          <button class="btn secondary" @click="repairConfirm = false">{{ t('common.cancel') }}</button>
          <button class="btn fail" @click="doRepair">{{ t('tournament.detail.repair') }}</button>
        </div>
      </div>
    </div>

    <TournamentExportModal
      v-if="exportOpen"
      :tournament="local"
      @close="exportOpen = false"
    />

    <TournamentUploadModal
      v-if="uploadOpen"
      :tournament="local"
      :exists-in-db="existsInDb"
      @close="uploadOpen = false"
      @uploaded="onUploaded"
    />

    <!-- Rewinding throws away recorded results, so it says how many before doing it. -->
    <div v-if="rewindTarget !== null" class="modal-overlay" style="align-items:center;" @click.self="rewindTarget = null">
      <div style="background:var(--bg); border-radius:1.125rem; box-shadow:var(--shadow); padding:1.25rem 1.5rem; max-width:22rem; display:flex; flex-direction:column; align-items:center; gap:0.75rem; text-align:center;">
        <div style="font-size:0.8125rem; font-weight:700; color:var(--ink); line-height:1.6;">
          {{ t('tournament.detail.confirmRewind', { n: rewindTarget, rounds: rewindLosses.rounds, matches: rewindLosses.matches }) }}
        </div>
        <div style="display:flex; gap:0.625rem; justify-content:center;">
          <button class="btn secondary" @click="rewindTarget = null">{{ t('common.cancel') }}</button>
          <button class="btn fail" @click="confirmRewind">{{ t('tournament.detail.rewindConfirmBtn') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
