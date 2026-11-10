<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCharacterData } from './composables/useCharacterData'
import { useBattleState } from './composables/useBattleState'
import { useOnlineRoom } from './composables/useOnlineRoom'
import { useStageLayout } from './composables/useStageLayout'
import Board from './components/Board.vue'
import OnlineRoomPanel from './components/OnlineRoomPanel.vue'
import OnlineApp from './components/online/OnlineApp.vue'
import LeaderboardApp from './components/LeaderboardApp.vue'
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
import TurnStepper from './components/TurnStepper.vue'
import HandbookApp from './components/handbook/HandbookApp.vue'
import { DICE_PHASES, IN_TURN_PHASES, RESOLVING_PHASES } from './game/turnSteps'
import GlobalTopBar from './components/GlobalTopBar.vue'
import MusicPlayer from './components/MusicPlayer.vue'
import { showMusicPlayer } from './data/musicPlayerUi'
import { installButtonSfx } from './data/buttonSfx'
import PlayerChip from './components/PlayerChip.vue'
import PlayerProfileApp from './components/PlayerProfileApp.vue'
import GiftRevealApp from './components/GiftRevealApp.vue'
import LoginApp from './components/auth/LoginApp.vue'
import NoticeBoard from './components/notice/NoticeBoard.vue'
import NoticeSplash from './components/notice/NoticeSplash.vue'
import { splashNotices } from './data/announcements'
import AdminSwitchApp from './components/admin/AdminSwitchApp.vue'
import AdminRewardsApp from './components/admin/AdminRewardsApp.vue'
import AdminHandbookApp from './components/admin/AdminHandbookApp.vue'
import AdminCouponsApp from './components/admin/AdminCouponsApp.vue'
import AdminSalesApp from './components/admin/AdminSalesApp.vue'
import AdminNoticeApp from './components/admin/AdminNoticeApp.vue'
import AdminTickerApp from './components/admin/AdminTickerApp.vue'
import { isSignedIn } from './data/currentPlayer'
import { tapVersion } from './data/betaMode'
import { refreshHandbookShop } from './data/handbookTiers'
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

// Held back from release: the bar breaks its own layout mid-turn and has not been looked at
// yet. One line to put back — the component stays, and so does game/turnSteps.js, which is
// now what routes every phase to its screen whether or not this is rendered.
const SHOW_TURN_STEPPER = true

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

// 綠界付完款會把人導回根網址加 ?ecpay=<訂單編號>。這裡認出來，直接開到手冊並把單號
// 交給它去查狀態。
//
// 參數讀完就從網址上拿掉：留著的話重新整理會再跑一次結帳結果，而那筆訂單早就結束了。
// replaceState 而不是導頁 —— 這時 App 已經在跑了，再導一次等於整個重載。
// 參數只讀得到一次，所以之後整個流程就靠這個 ref 記著。手冊看完那張收據會回報一聲，
// 這裡才把它清掉 —— 中途若要去登入，手冊會被卸載再掛回來，單號得活過那一趟。
const ecpayOrder = ref((() => {
  const no = new URLSearchParams(location.search).get('ecpay')
  if (!no) return ''
  history.replaceState(null, '', location.pathname + location.hash)
  return no
})())
if (ecpayOrder.value) mode.value = 'handbook'

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

// 公告。兩件事分開：列表是人主動點開的，蓋板是自己跳出來的。
const noticeBoard = ref(false)
// 從信箱去拆禮：拆完要回得來。空字串＝整疊一起拆，有值＝只拆那一件。
const giftOnly = ref('')
const fromMailbox = ref(false)

function openGifts(id = '') {
  giftOnly.value = id
  fromMailbox.value = noticeBoard.value
  noticeBoard.value = false
  openMode('gifts')
}

function closeGifts() {
  leaveMode()
  giftOnly.value = ''
  // 從信箱來的就回信箱 —— 一疊信領到一半被丟回主畫面，剩下的那幾封就得重新找一次。
  if (fromMailbox.value) {
    fromMailbox.value = false
    noticeBoard.value = true
  }
}
// 蓋板只在主畫面出現，有幾則就一則一則接著跳，每則都要自己按掉；按掉過的不會因為
// 從某個模式返回主畫面又跳一次。「今日不再顯示」是更強的一層，跨重新整理。
//
// 記的是「按掉過哪幾則」而不是排到第幾個：按掉的那一則如果同時被「今日不再顯示」
// 收走，整疊會當場少一個，用序號的話就會跳過下一則。
const splashDone = ref([])
const splashNow = computed(() => (mode.value === null
  ? splashNotices.value.find(a => !splashDone.value.includes(a.id)) || null
  : null))

function closeSplash(id) {
  splashDone.value = [...splashDone.value, id]
}

const stageRef = ref(null)
useStageLayout(stageRef)

const inBattleBoard = computed(() => IN_TURN_PHASES.includes(state.phase))

// Each side has their own modal slot (state.modals.A / .B) so opening one never closes the
// other's — this picks out whichever slot this client should actually render: your own seat
// when online, or whichever one is open when hotseat (only one is ever open at a time there,
// since it's a single shared device).
const activeModalKey = computed(() => {
  if (online.myKey.value) return state.modals[online.myKey.value] ? online.myKey.value : null
  return state.modals.A ? 'A' : (state.modals.B ? 'B' : null)
})

// The page title is set once in index.html and left alone. It used to follow the locale, but
// PLAKORO ARENA is a name, not a phrase — translating it only meant the browser tab disagreed
// with the wordmark on the screen below it.

onMounted(() => {
  characterData.loadData()
  // 首頁那張「秘笈手冊」卡片要不要顯示「即將上線」，由伺服器說了算。
  refreshHandbookShop()
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
      <!-- Six taps here turn the unreleased cards on; see data/betaMode.js. Deliberately
           still looks like a label — no pointer cursor, no hover state. -->
      <div
        style="position:absolute; right:0.375rem; bottom:0.1875rem; z-index:300; font-size:0.5rem; font-weight:700; color:rgba(58,58,58,.5); cursor:default; user-select:none;"
        @click="tapVersion()"
      >v{{ appVersion }}</div>

      <div v-if="isLoading" style="display:flex; height:100%; align-items:center; justify-content:center; font-weight:800; font-size:1rem; color:var(--sub);">{{ t('app.loading') }}</div>

      <div v-else-if="loadError" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:0.875rem; padding:1.5rem; text-align:center;">
        <div style="font-weight:800; font-size:0.875rem; color:var(--ink); line-height:1.6;">{{ t('app.loadErrorTitle') }}</div>
        <div style="font-size:0.75rem; color:var(--sub); max-width:20rem; line-height:1.6;">{{ loadError }}</div>
        <button class="btn" @click="characterData.loadData()">{{ t('app.retry') }}</button>
      </div>

      <ModeSelect
        v-else-if="mode === null"
        @pick="openMode($event)"
        @gifts="openGifts()"
        @notices="noticeBoard = true"
      />

      <template v-else-if="mode === 'duel'">
        <OnlineRoomPanel :online="online" />
        <!-- The battle column, stated as shares of a fixed height rather than left to add up:
             .duel-content takes whatever is left after the stepper band, and every full-screen
             overlay anchors to it (it is the positioned ancestor) instead of to #app. That is
             what stops a bar at the foot of the screen from being painted over the cards —
             the previous arrangement gave the stepper no share at all and simply laid it on
             top, so the moment its contents wrapped it grew upward across the board. -->
        <div class="duel-content">
        <SelectBoard v-if="state.phase === 'select'" />
        <FirstPickWheel v-else-if="state.phase === 'drawingFirst'" :winner-key="state.pendingFirstPick" />
        <Board v-else :turn-mode="inBattleBoard" />

        <MoveSelectPanel v-if="state.phase === 'moveSelect'" />
        <DiceOverlay v-if="DICE_PHASES.includes(state.phase)" />
        <MoveSelectPanel
          v-if="RESOLVING_PHASES.includes(state.phase)"
          resolve-phase
        />
        <EffectPromptOverlay v-if="state.phase === 'effectPrompt'" />
        <ExtraRollOverlay v-if="state.phase === 'charaThrowTask' || state.phase === 'energyThrowTask'" />
        <TurnResultOverlay v-if="state.phase === 'turnResultConfirm'" />
        <WinScreen v-if="state.phase === 'win'" />
        <Modal v-if="activeModalKey" :player-key="activeModalKey" />
        <TurnCutIn v-if="state.turnCutIn" />
        </div>
        <TurnStepper v-if="SHOW_TURN_STEPPER" />
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
      <HandbookApp
        v-else-if="mode === 'handbook'"
        :ecpay-order="ecpayOrder"
        @back="leaveMode()"
        @sign-in="openMode('login', { from: 'handbook' })"
        @order-seen="ecpayOrder = ''"
      />

      <TierMakerApp v-else-if="mode === 'tierMaker'" @back="leaveMode()" />

      <TraitChartApp v-else-if="mode === 'traitChart'" @back="leaveMode()" />

      <PlayerProfileApp v-else-if="mode === 'profile'" @back="leaveMode()" />
      <GiftRevealApp v-else-if="mode === 'gifts'" :only="giftOnly" @back="closeGifts()" />
      <OnlineApp v-else-if="mode === 'online'" @back="leaveMode()" />
      <LeaderboardApp v-else-if="mode === 'leaderboard'" @back="leaveMode()" />

      <!-- Signing in lands on the main screen, not the profile. Signing in is how you reach
           everything, not a visit to one screen — and the gift badge only exists out there, so
           dropping someone into their profile hides the one thing that just became true. -->
      <LoginApp v-else-if="mode === 'login'" @back="leaveMode()" @done="leaveMode()" />

      <AdminSwitchApp v-else-if="mode === 'adminSwitch'" @back="leaveMode()" />

      <AdminRewardsApp v-else-if="mode === 'adminRewards'" @back="leaveMode()" />

      <AdminHandbookApp v-else-if="mode === 'adminHandbook'" @back="leaveMode()" />
      <AdminSalesApp v-else-if="mode === 'adminSales'" @back="leaveMode()" />
      <AdminCouponsApp v-else-if="mode === 'adminCoupons'" @back="leaveMode()" />
      <AdminNoticeApp v-else-if="mode === 'adminNotice'" @back="leaveMode()" />
      <AdminTickerApp v-else-if="mode === 'adminTicker'" @back="leaveMode()" />

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

      <NoticeSplash v-if="splashNow" :key="splashNow.id" :notice="splashNow" @close="closeSplash" />
      <NoticeBoard
        v-if="noticeBoard"
        @close="noticeBoard = false"
        @gifts="openGifts()"
        @gift="openGifts($event)"
      />

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
