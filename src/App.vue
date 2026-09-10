<script setup>
import { computed, defineAsyncComponent, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCharacterData } from './composables/useCharacterData'
import { useBattleState } from './composables/useBattleState'
import { useStageLayout } from './composables/useStageLayout'
import Board from './components/Board.vue'
import SelectBoard from './components/SelectBoard.vue'
import MoveSelectPanel from './components/MoveSelectPanel.vue'
import DiceOverlay from './components/DiceOverlay.vue'
import EffectPromptOverlay from './components/EffectPromptOverlay.vue'
import WinScreen from './components/WinScreen.vue'
import Modal from './components/Modal.vue'
import TurnCutIn from './components/TurnCutIn.vue'
import LanguageSwitcher from './components/LanguageSwitcher.vue'
import ModeSelect from './components/ModeSelect.vue'
import SoloApp from './components/solo/SoloApp.vue'
import DiceBuilderApp from './components/dice/DiceBuilderApp.vue'
import StoreInfoApp from './components/StoreInfoApp.vue'
import TournamentApp from './components/tournament/TournamentApp.vue'
import TierListApp from './components/TierListApp.vue'
// d3 (scale/shape/array) rides along with this view — code-split so only players who open the
// price log pay for it, the same treatment the 3D dice tray gets.
const PriceLogApp = defineAsyncComponent(() => import('./components/pricelog/PriceLogApp.vue'))

const { t } = useI18n()
const characterData = useCharacterData()
const battle = useBattleState(characterData.moves)
provide('battle', battle)
provide('characterData', characterData)

const state = battle.state
const { isLoading, loadError } = characterData

const mode = ref(null)
const appVersion = __APP_VERSION__

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
  mode.value = null
}

const stageRef = ref(null)
useStageLayout(stageRef)

const inBattleBoard = computed(() => ['moveSelect', 'diceRoll', 'resolve', 'effectPrompt'].includes(state.phase))

watch(() => t('appTitle'), (title) => {
  document.title = title
}, { immediate: true })

onMounted(() => {
  characterData.loadData()
})
</script>

<template>
  <div id="stage" ref="stageRef">
    <div id="app">
      <LanguageSwitcher v-if="mode === null" />
      <button
        v-if="canExitToHome"
        class="home-exit-btn"
        :aria-label="t('app.backToHome')"
        @click="showExitConfirm = true"
      >←</button>
      <div style="position:absolute; right:0.375rem; bottom:0.25rem; z-index:300; font-size:0.625rem; font-weight:700; color:rgba(58,58,58,.5); pointer-events:none;">v{{ appVersion }}</div>

      <div v-if="isLoading" style="display:flex; height:100%; align-items:center; justify-content:center; font-weight:800; font-size:1rem; color:var(--sub);">{{ t('app.loading') }}</div>

      <div v-else-if="loadError" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:0.875rem; padding:1.5rem; text-align:center;">
        <div style="font-weight:800; font-size:0.875rem; color:var(--ink); line-height:1.6;">{{ t('app.loadErrorTitle') }}</div>
        <div style="font-size:0.75rem; color:var(--sub); max-width:20rem; line-height:1.6;">{{ loadError }}</div>
        <button class="btn" @click="characterData.loadData()">{{ t('app.retry') }}</button>
      </div>

      <ModeSelect v-else-if="mode === null" @pick="mode = $event" />

      <template v-else-if="mode === 'duel'">
        <SelectBoard v-if="state.phase === 'select'" />
        <Board v-else :turn-mode="inBattleBoard" />

        <MoveSelectPanel v-if="state.phase === 'moveSelect'" />
        <DiceOverlay v-if="state.phase === 'diceRoll'" />
        <MoveSelectPanel v-if="state.phase === 'resolve' || state.phase === 'effectPrompt'" resolve-phase />
        <EffectPromptOverlay v-if="state.phase === 'effectPrompt'" />
        <WinScreen v-if="state.phase === 'win'" />
        <Modal v-if="state.modal" />
        <TurnCutIn v-if="state.turnCutIn" />
      </template>

      <DiceBuilderApp v-else-if="mode === 'diceBuilder'" @back="mode = null" />

      <StoreInfoApp v-else-if="mode === 'storeInfo'" @back="mode = null" />

      <PriceLogApp v-else-if="mode === 'priceLog'" @back="mode = null" />

      <TournamentApp v-else-if="mode === 'tournament'" @back="mode = null" />

      <TierListApp v-else-if="mode === 'tierList'" @back="mode = null" />

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
