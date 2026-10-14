<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCharacterData } from './composables/useCharacterData'
import { useBattleState } from './composables/useBattleState'
import { useOnlineRoom } from './composables/useOnlineRoom'
import { useStageLayout } from './composables/useStageLayout'
import Board from './components/Board.vue'
import OnlineRoomPanel from './components/OnlineRoomPanel.vue'
import OnlineApp from './components/online/OnlineApp.vue'
import FirstPickWheel from './components/FirstPickWheel.vue'
import SelectBoard from './components/SelectBoard.vue'
import MoveSelectPanel from './components/MoveSelectPanel.vue'
import DiceOverlay from './components/DiceOverlay.vue'
import EffectPromptOverlay from './components/EffectPromptOverlay.vue'
import TurnResultOverlay from './components/TurnResultOverlay.vue'
import ExtraRollOverlay from './components/ExtraRollOverlay.vue'
import WinScreen from './components/WinScreen.vue'
import Modal from './components/Modal.vue'
import TurnCutIn from './components/TurnCutIn.vue'
import GlobalTopBar from './components/GlobalTopBar.vue'
import MusicPlayer from './components/MusicPlayer.vue'
import { showMusicPlayer } from './data/musicPlayerUi'
import { installButtonSfx } from './data/buttonSfx'
import PlayerChip from './components/PlayerChip.vue'
import PlayerProfileApp from './components/PlayerProfileApp.vue'
import GiftRevealApp from './components/GiftRevealApp.vue'
import LoginApp from './components/auth/LoginApp.vue'
import AdminSwitchApp from './components/admin/AdminSwitchApp.vue'
import AdminRewardsApp from './components/admin/AdminRewardsApp.vue'
import { isSignedIn } from './data/currentPlayer'
import ModeSelect from './components/ModeSelect.vue'
import SoloApp from './components/solo/SoloApp.vue'
import DiceBuilderApp from './components/dice/DiceBuilderApp.vue'
import StoreInfoApp from './components/StoreInfoApp.vue'
import TournamentApp from './components/tournament/TournamentApp.vue'
import TierListApp from './components/TierListApp.vue'
import TypeChartApp from './components/TypeChartApp.vue'
import TierMakerApp from './components/TierMakerApp.vue'
import TraitChartApp from './components/TraitChartApp.vue'
// d3 (scale/shape/array) rides along with this view — code-split so only players who open the
// price log pay for it, the same treatment the 3D dice tray gets.
const PriceLogApp = defineAsyncComponent(() => import('./components/pricelog/PriceLogApp.vue'))

const { t } = useI18n()
const characterData = useCharacterData()
const battle = useBattleState(characterData.moves)
const online = useOnlineRoom(battle)
provide('battle', online.battle)
provide('characterData', characterData)
provide('online', online)

const state = battle.state
const { isLoading, loadError } = characterData

const mode = ref(null)
const appVersion = __APP_VERSION__

// A mode can be entered carrying a request from the mode that opened it — the tier list hands
// the dice builder a character and the build its figure assumed. `from` is where "back" goes,
// so a screen opened from another screen returns there rather than dropping the player home
// with their place in a fifteen-row table lost.
const modeRequest = ref(null)

function openMode(key, request = null) {
  modeRequest.value = request
  mode.value = key
}

function leaveMode() {
  const back = modeRequest.value ? modeRequest.value.from : null
  modeRequest.value = null
  mode.value = back || null
}

// The duel and solo modes fill the screen and have no back button of their own (unlike the
// dice builder and store info, which each end their own flow), so they get a shared one here.
// It asks first: both modes hold real progress, and the button sits near the screen edge where
// a stray tap during play is easy.
const HOME_EXIT_MODES = ['duel', 'solo']
const canExitToHome = computed(() => HOME_EXIT_MODES.includes(mode.value))
const showExitConfirm = ref(false)

function exitToHome() {
  // Battle state lives at module scope (a single shared reactive object), so leaving without
  // resetting would drop the player back into the previous match on re-entry. Solo does the
  // same for itself in SoloApp's onUnmounted, since its state is created inside that component.
  battle.resetGame()
  showExitConfirm.value = false
  leaveMode()
}

const stageRef = ref(null)
useStageLayout(stageRef)

const inBattleBoard = computed(() => ['moveSelect', 'diceRoll', 'resolve', 'effectPrompt', 'charaThrowTask', 'energyThrowTask', 'turnResultConfirm'].includes(state.phase))

// Each side has their own modal slot (state.modals.A / .B) so opening one never closes the
// other's — this picks out whichever slot this client should actually render: your own seat
// when online, or whichever one is open when hotseat (only one is ever open at a time there,
// since it's a single shared device).
const activeModalKey = computed(() => {
  if (online.myKey.value) return state.modals[online.myKey.value] ? online.myKey.value : null
  return state.modals.A ? 'A' : (state.modals.B ? 'B' : null)
})

watch(() => t('appTitle'), (title) => {
  document.title = title
}, { immediate: true })

onMounted(() => {
  characterData.loadData()
})

const uninstallButtonSfx = installButtonSfx()
onBeforeUnmount(uninstallButtonSfx)
</script>

<template>
  <div id="stage" ref="stageRef">
    <div id="app">
      <PlayerChip v-if="mode === null" @open="openMode(isSignedIn ? 'profile' : 'login')" />
      <GlobalTopBar />
      <MusicPlayer v-if="showMusicPlayer" />
      <button
        v-if="canExitToHome"
        class="home-exit-btn"
        :aria-label="t('app.backToHome')"
        @click="showExitConfirm = true"
      >←</button>
      <div
        style="position:absolute; right:0.375rem; bottom:0.1875rem; z-index:300; font-size:0.5rem; font-weight:700; color:rgba(58,58,58,.5); cursor:default;"
      >v{{ appVersion }}</div>

      <div v-if="isLoading" style="display:flex; height:100%; align-items:center; justify-content:center; font-weight:800; font-size:1rem; color:var(--sub);">{{ t('app.loading') }}</div>

      <div v-else-if="loadError" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:0.875rem; padding:1.5rem; text-align:center;">
        <div style="font-weight:800; font-size:0.875rem; color:var(--ink); line-height:1.6;">{{ t('app.loadErrorTitle') }}</div>
        <div style="font-size:0.75rem; color:var(--sub); max-width:20rem; line-height:1.6;">{{ loadError }}</div>
        <button class="btn" @click="characterData.loadData()">{{ t('app.retry') }}</button>
      </div>

      <ModeSelect v-else-if="mode === null" @pick="openMode($event)" @gifts="openMode('gifts')" />

      <template v-else-if="mode === 'duel'">
        <OnlineRoomPanel :online="online" />
        <SelectBoard v-if="state.phase === 'select'" />
        <FirstPickWheel v-else-if="state.phase === 'drawingFirst'" :winner-key="state.pendingFirstPick" />
        <Board v-else :turn-mode="inBattleBoard" />

        <MoveSelectPanel v-if="state.phase === 'moveSelect'" />
        <DiceOverlay v-if="state.phase === 'diceRoll'" />
        <MoveSelectPanel
          v-if="['resolve', 'effectPrompt', 'charaThrowTask', 'energyThrowTask', 'turnResultConfirm'].includes(state.phase)"
          resolve-phase
        />
        <EffectPromptOverlay v-if="state.phase === 'effectPrompt'" />
        <ExtraRollOverlay v-if="state.phase === 'charaThrowTask' || state.phase === 'energyThrowTask'" />
        <TurnResultOverlay v-if="state.phase === 'turnResultConfirm'" />
        <WinScreen v-if="state.phase === 'win'" />
        <Modal v-if="activeModalKey" :player-key="activeModalKey" />
        <TurnCutIn v-if="state.turnCutIn" />
      </template>

      <DiceBuilderApp v-else-if="mode === 'diceBuilder'" :open-odds="modeRequest" @back="leaveMode()" />

      <StoreInfoApp v-else-if="mode === 'storeInfo'" @back="leaveMode()" />

      <PriceLogApp v-else-if="mode === 'priceLog'" @back="leaveMode()" />

      <TournamentApp v-else-if="mode === 'tournament'" @back="leaveMode()" />

      <TierListApp
        v-else-if="mode === 'tierList'"
        @back="leaveMode()"
        @inspect="openMode('diceBuilder', $event)"
      />

      <TypeChartApp v-else-if="mode === 'typeChart'" @back="leaveMode()" />

      <TierMakerApp v-else-if="mode === 'tierMaker'" @back="leaveMode()" />

      <TraitChartApp v-else-if="mode === 'traitChart'" @back="leaveMode()" />

      <PlayerProfileApp v-else-if="mode === 'profile'" @back="leaveMode()" />
      <GiftRevealApp v-else-if="mode === 'gifts'" @back="leaveMode()" />
      <OnlineApp v-else-if="mode === 'online'" @back="leaveMode()" />

      <!-- Signing in lands on the main screen, not the profile. Signing in is how you reach
           everything, not a visit to one screen — and the gift badge only exists out there, so
           dropping someone into their profile hides the one thing that just became true. -->
      <LoginApp v-else-if="mode === 'login'" @back="leaveMode()" @done="leaveMode()" />

      <AdminSwitchApp v-else-if="mode === 'adminSwitch'" @back="leaveMode()" />

      <AdminRewardsApp v-else-if="mode === 'adminRewards'" @back="leaveMode()" />

      <SoloApp v-else />

      <!-- Above the language switcher's z-index so the switcher can't sit on top of it. -->
      <div
        v-if="showExitConfirm"
        class="modal-overlay"
        style="z-index:400; align-items:center;"
        @click.self="showExitConfirm = false"
      >
        <div class="exit-confirm-sheet">
          <div class="exit-confirm-title">{{ t('app.exitConfirmTitle') }}</div>
          <div class="exit-confirm-desc">{{ t('app.exitConfirmDesc') }}</div>
          <div class="exit-confirm-actions">
            <button class="btn secondary" @click="showExitConfirm = false">{{ t('common.cancel') }}</button>
            <button class="btn" @click="exitToHome">{{ t('app.backToHome') }}</button>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.home-exit-btn {
  position: absolute;
  top: 0.375rem;
  left: 0.375rem;
  z-index: 300;
  border: none;
  border-radius: 0.625rem;
  background: rgba(0, 0, 0, .35);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 800;
  line-height: 1;
  padding: 0.3125rem 0.5rem;
  cursor: pointer;
}
.home-exit-btn:active { transform: scale(.94); }

.exit-confirm-sheet {
  background: var(--bg);
  border-radius: 1.125rem;
  box-shadow: var(--shadow);
  padding: 1.25rem 1.5rem;
  max-width: 22rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  text-align: center;
}
.exit-confirm-title { font-size: 1rem; font-weight: 800; color: var(--ink); }
.exit-confirm-desc { font-size: 0.75rem; color: var(--sub); line-height: 1.6; }
.exit-confirm-actions { display: flex; gap: 0.625rem; justify-content: center; }
</style>
