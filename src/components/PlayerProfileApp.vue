<script setup>
// Your own player profile: the face, the flag, and the name you go by.
//
// Only the things a player chooses. Medals, titles and win rates are not here and will never
// be — those are read off the tournament records, and a profile screen that could set them
// would make every badge in the app worthless. Avatars and flags are a softer version of the
// same rule: picking is free, but only among tiers this record has actually reached — the
// pickers below are gated by live stats, not left wide open the way a mock account would be.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as authApi from '../data/authApi'
import { audioSettings, setVolume } from '../data/audioSettings'
import { sfxSettings, setSfxVolume } from '../data/sfxSettings'
import { lowData, setLowData } from '../data/lowDataMode'
import { currentIdentity, setCurrentPlayer, signOut } from '../data/currentPlayer'
import { isAdminAccount, isAdminMode, setAdminMode } from '../data/adminSession'
import { AVATAR_IDS, BACKGROUND_IDS, avatarUrl, backgroundUrl, isSecretAsset, tierOfAsset } from '../data/nameplateAssets'
import { getToken } from '../data/session'
import { translateApiError } from '../data/apiErrors'
import { googleAvailable, renderGoogleButton } from '../data/googleSignIn'
import { TITLE_GROUPS, resolveTitle } from '../data/assetCatalogue'
import { pointReason } from '../data/pointReason'
import PlayerBanner from './tournament/PlayerBanner.vue'
import VolumeBar from './VolumeBar.vue'

// Reached only while signed in — the chip sends a guest to LoginApp instead, and signing out
// below leaves this screen immediately rather than reverting it to a guest state in place.
const emit = defineEmits(['back'])
const { t, locale } = useI18n()

const emailDraft = ref('')
// 伺服器上現在存的那一組。按鈕靠它判斷「有沒有改」，沒改就不給送。
const emailSaved = ref('')
const emailBusy = ref(false)
const emailError = ref('')
const emailDone = ref(false)

/** 留下或換掉信箱。不寄驗證信 —— 這一步只是先把聯絡方式收進來。 */
async function submitEmail() {
  if (emailBusy.value) return
  emailBusy.value = true
  emailError.value = ''
  emailDone.value = false
  try {
    const saved = await authApi.setEmail(getToken(), emailDraft.value.trim())
    emailSaved.value = saved.email
    emailDraft.value = saved.email
    emailDone.value = true
  } catch (e) {
    emailError.value = translateApiError(e.message, t)
  } finally {
    emailBusy.value = false
  }
}

const emailDirty = computed(() => {
  const next = emailDraft.value.trim()
  return !!next && next !== emailSaved.value
})

/* ── Google 綁定 ──────────────────────────────────────────────────────────
   綁定要在這裡做，不是在登入畫面自動完成：這支畫面只有登入後進得來，所以按下去的人
   已經用帳號 + PIN 證明過自己是誰。信箱比對不能當作證明 —— players.email 是玩家自己
   打的，我們不寄驗證信（理由見後端 server/index.mjs）。
   ──────────────────────────────────────────────────────────────────────── */
const googleLinked = ref(false)
const googleSlot = ref(null)
const googleBusy = ref(false)
const googleError = ref('')
let stopGoogle = () => {}
// 兩件事都備齊才畫得出來：伺服器說了綁沒綁（不然可能畫在已經綁好的人面前），而且設定
// 分頁真的被畫出來了（它是 v-else，停在其他分頁時那個容器根本不存在）。
const googleReady = ref(false)
let googleDrawn = false

async function drawGoogleButton() {
  if (!googleAvailable || googleDrawn || !googleReady.value) return
  if (googleLinked.value || tab.value !== 'settings') return
  await nextTick()
  if (!googleSlot.value) return
  googleDrawn = true
  try {
    stopGoogle = await renderGoogleButton(googleSlot.value, linkGoogle, { locale: locale.value })
  } catch (e) {
    // 載不進來（擋廣告的擴充套件、公司網路擋 Google、離線）就當作沒有這個選項，
    // 設定頁其他東西照常用。
    googleDrawn = false
  }
}

async function linkGoogle(credential) {
  if (googleBusy.value) return
  googleBusy.value = true
  googleError.value = ''
  try {
    await authApi.linkGoogle(getToken(), credential)
    googleLinked.value = true
  } catch (e) {
    googleError.value = translateApiError(e.message, t)
  } finally {
    googleBusy.value = false
  }
}

const pinCurrent = ref('')
const pinNext = ref('')
const pinBusy = ref(false)
const pinError = ref('')
const pinDone = ref(false)

/** 改 PIN。成功之後把兩個欄位清掉 —— 留在畫面上的密碼沒有任何用處。 */
async function submitPin() {
  if (pinBusy.value) return
  pinBusy.value = true
  pinError.value = ''
  pinDone.value = false
  try {
    await authApi.changePin(getToken(), pinCurrent.value, pinNext.value)
    pinDone.value = true
    pinCurrent.value = ''
    pinNext.value = ''
  } catch (e) {
    pinError.value = translateApiError(e.message, t)
  } finally {
    pinBusy.value = false
  }
}

const tab = ref('badge')

// Starts empty rather than waiting on the fetch below, so the pickers never flash
// everything-unlocked before narrowing — the safe default is "nothing earned yet."
const ownedAvatars = ref(new Set())
const ownedBackgrounds = ref(new Set())
const ownedTitles = ref(new Set())

// PTP. Null until the fetch lands, so the tab can say "loading" rather than flash a zero
// balance at somebody who has points — a wrong number here is worse than no number.
const pointBalance = ref(null)
const pointEntries = ref([])
const ledgerOpen = ref(false)

// Renaming happens in its own little window rather than as a field sitting open on the page.
// A name is what everyone at an event calls this person, and the two keystrokes it takes to
// wreck it should not be available by accident — so it is: open, type, confirm.
const nameOpen = ref(false)
const nameDraft = ref('')

function openRename() {
  nameDraft.value = draft.value.name
  nameOpen.value = true
}

// Confirming writes into the same draft every other picker writes into and saves immediately,
// rather than leaving the new name pending behind the footer's Save — the window asked for a
// decision and then has to honour it.
async function confirmRename() {
  const next = nameDraft.value.trim()
  if (!next || next === draft.value.name.trim()) { nameOpen.value = false; return }
  draft.value.name = next
  nameOpen.value = false
  // Failure leaves the old name on screen and the error under it — the row reads from
  // currentIdentity, which only changes once the server has agreed.
  await persist()
}

onMounted(async () => {
  const token = getToken()
  if (!token) return
  try {
    const profile = await authApi.me(token)
    // 已經留過的信箱要帶出來 —— 欄位空白會讓人以為自己沒留過，然後重打一次。
    emailSaved.value = profile.email || ''
    emailDraft.value = emailSaved.value
    googleLinked.value = Boolean(profile.google)
    googleReady.value = true
    drawGoogleButton()
    ownedAvatars.value = new Set(profile.unlocks.filter(u => u.kind === 'avatar').map(u => u.asset))
    ownedBackgrounds.value = new Set(profile.unlocks.filter(u => u.kind === 'background').map(u => u.asset))
    ownedTitles.value = new Set(profile.unlocks.filter(u => u.kind === 'title').map(u => u.asset))
  } catch (e) {
    // Stats/unlocks just didn't load this time — stay locked down rather than guessing.
  }
  try {
    const points = await authApi.listPoints(token)
    pointBalance.value = points.balance
    pointEntries.value = points.entries
  } catch (e) {
    // Same stance: leave the tab saying it couldn't read rather than claiming a balance.
  }
})

// 切到設定分頁的那一刻才有容器可畫。
watch(tab, drawGoogleButton)

onBeforeUnmount(() => stopGoogle())

function entryReason(e) {
  return pointReason(e, t)
}

// Local date only: these are all things that happened in a room on an afternoon, and the time
// of day is noise next to that.
function entryDate(e) {
  const d = new Date(e.at)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

// Exactly what the server will accept: a `-default` flag, which every season gives away, or a
// row in player_unlocks. Nothing is inferred.
//
// There used to be a tier ladder here — placing anywhere was taken to unlock every lower tier
// too. It was wrong twice over. It ignored the season, so one third place opened every event's
// `-winner`, including events the player never attended; and even within a season it was
// backwards, because the tiers are not a ladder. A reward package gives 1st `-champion`,
// 2nd and 3rd `-winner`, and everyone `-participants` — so `-winner` means "came 2nd or 3rd",
// and a champion is not entitled to it. The one case the ladder was meant to serve, a champion
// wanting the plainer flag, is already covered: the participant grant goes to the whole entry
// list, champion included.
//
// Deciding what someone gets belongs in the reward package, which is admin-editable. A rule
// here could only ever drift from it — and did.
function isUnlocked(id, kind) {
  if (tierOfAsset(id) === 'default') return true
  const owned = kind === 'avatar' ? ownedAvatars.value : ownedBackgrounds.value
  return owned.has(id)
}

// The free starter title aside, a title is unlocked only if player_unlocks actually has it —
// titles don't ride the tier ladder the way avatars/flags do, so there's no tier shortcut here.
function isTitleUnlocked(id, groupKey) {
  return groupKey === 'general' || ownedTitles.value.has(id)
}

// Buttons stay enabled (not :disabled) even when locked, purely so a tap still registers as a
// deliberate "no" rather than doing nothing at all — but what that tap should show is still
// undecided (probably what it actually takes to unlock, once that's tracked), so for now it just
// declines the pick silently rather than showing a placeholder message.
function pickAvatar(id) {
  if (!isUnlocked(id, 'avatar')) return
  draft.value.avatar = id
}
function pickBackground(id) {
  if (!isUnlocked(id, 'background')) return
  draft.value.background = id
}
function pickTitle(id, groupKey) {
  if (!isTitleUnlocked(id, groupKey)) return
  draft.value.titleId = id
}

// Owned-only by default — a wall of mostly-locked artwork isn't a useful way to meet this
// screen the first time. "Show all" is there for whoever wants to see what's out there to aim
// for; it doesn't change what's pickable, only what's shown.
const showAll = ref(false)

// Owned always shows. "Show all" adds everything else *except* the secrets — listing one as
// locked is how a secret stops being one (see isSecretAsset).
const shown = (id, owned) => owned || (showAll.value && !isSecretAsset(id))

const visibleAvatarIds = computed(() => AVATAR_IDS.filter(id => shown(id, isUnlocked(id, 'avatar'))))
const visibleBackgroundIds = computed(() => BACKGROUND_IDS.filter(id => shown(id, isUnlocked(id, 'background'))))
const visibleTitleGroups = computed(() =>
  TITLE_GROUPS
    .map(g => ({ ...g, titles: g.titles.filter(ti => shown(ti.id, isTitleUnlocked(ti.id, g.key))) }))
    .filter(g => g.titles.length > 0))

// A draft, so backing out leaves the saved profile alone.
const draft = ref({
  code: currentIdentity.value.code,
  name: currentIdentity.value.name || '',
  avatar: currentIdentity.value.avatar,
  background: currentIdentity.value.background || BACKGROUND_IDS[0],
  titleId: currentIdentity.value.titleId || null
})

// The real nameplate component, fed the draft — so what is being previewed is the thing that
// will appear beside this player's name at an event, not an approximation of it.
const preview = computed(() => ({
  playerKey: draft.value.code ? `code:${draft.value.code}` : 'local',
  name: draft.value.name.trim() || t('player.guest'),
  code: draft.value.code,
  avatar: draft.value.avatar,
  background: draft.value.background,
  title: resolveTitle(draft.value.titleId),
  // Earned, so the preview shows them as they really are: empty, until an event says otherwise.
  medals: { gold: 0, silver: 0, bronze: 0 },
  events: 0,
  winRate: null
}))

const dirty = computed(() =>
  draft.value.name.trim() !== (currentIdentity.value.name || '') ||
  draft.value.avatar !== currentIdentity.value.avatar ||
  draft.value.background !== (currentIdentity.value.background || BACKGROUND_IDS[0]) ||
  draft.value.titleId !== (currentIdentity.value.titleId || null))

const saving = ref(false)
const saveError = ref('')

// Writes the draft and returns whether it landed. Leaving the screen is the caller's decision,
// not this function's: the footer's Save means "done here", while confirming a rename means
// "that one thing, now" and has no business closing the profile.
async function persist() {
  if (saving.value) return false
  saveError.value = ''
  saving.value = true
  try {
    const token = getToken()
    const profile = await authApi.updateMe(token, {
      name: draft.value.name.trim(),
      avatar: draft.value.avatar,
      background: draft.value.background,
      titleId: draft.value.titleId
    })
    setCurrentPlayer({
      code: profile.code,
      name: profile.name,
      avatar: profile.avatar,
      background: profile.background,
      titleId: profile.title_id
    })
    return true
  } catch (e) {
    saveError.value = e.message || t('profile.saveError')
    return false
  } finally {
    saving.value = false
  }
}

async function save() {
  if (await persist()) emit('back')
}

// Nothing left to edit once signed out, so this leaves the screen rather than reverting it to a
// guest state in place — back to the chip, which now routes a guest to LoginApp instead.
function handleSignOut() {
  signOut()
  emit('back')
}
</script>

<template>
  <div class="board select-board pp-board">
    <div class="pp-tabs">
      <button :class="['pp-tab', { on: tab === 'badge' }]" @click="tab = 'badge'">{{ t('profile.tabBadge') }}</button>
      <button :class="['pp-tab', { on: tab === 'points' }]" @click="tab = 'points'">{{ t('profile.tabDetails') }}</button>
      <button :class="['pp-tab', { on: tab === 'settings' }]" @click="tab = 'settings'">{{ t('profile.tabSettings') }}</button>
    </div>

    <template v-if="tab === 'badge'">
      <!-- Outside the scroller: the preview is what every choice below is being judged against,
           so scrolling it away would mean picking a flag with nothing to check it on. -->
      <div class="pp-preview">
        <PlayerBanner :nameplate="preview" size="lg" />
      </div>

      <div class="pp-body">
        <div class="pp-field">
          <span class="pp-label">{{ t('profile.avatar') }}</span>
          <div class="pp-grid">
            <button
              v-for="id in visibleAvatarIds"
              :key="id"
              :class="['pp-swatch', { on: draft.avatar === id, locked: !isUnlocked(id, 'avatar') }]"
              :title="isUnlocked(id, 'avatar') ? id : t('profile.locked')"
              @click="pickAvatar(id)"
            >
              <img :src="avatarUrl(id)" alt="" loading="lazy">
            </button>
          </div>
        </div>

        <div class="pp-field">
          <span class="pp-label">{{ t('profile.flag') }}</span>
          <div class="pp-grid wide">
            <button
              v-for="id in visibleBackgroundIds"
              :key="id"
              :class="['pp-swatch', 'flag', { on: draft.background === id, locked: !isUnlocked(id, 'background') }]"
              :title="isUnlocked(id, 'background') ? id : t('profile.locked')"
              @click="pickBackground(id)"
            >
              <img :src="backgroundUrl(id)" alt="" loading="lazy">
            </button>
          </div>
        </div>

        <div class="pp-field">
          <span class="pp-label">{{ t('profile.titleLabel') }}</span>
          <div class="pp-titles">
            <button
              :class="['pp-title-chip', 'plain', { on: draft.titleId === null }]"
              @click="draft.titleId = null"
            >{{ t('profile.noTitle') }}</button>
          </div>
          <!-- Grouped by the event that awards them, because that is how a player thinks of
               what they hold: "the ones I got at Meetup#2". -->
          <div v-for="g in visibleTitleGroups" :key="g.key" class="pp-series">
            <span class="pp-series-label">{{ g.label }}</span>
            <div class="pp-titles">
              <button
                v-for="ti in g.titles"
                :key="ti.id"
                :class="['pp-title-chip', ti.rank, { on: draft.titleId === ti.id, locked: !isTitleUnlocked(ti.id, g.key) }]"
                :title="isTitleUnlocked(ti.id, g.key) ? ti.obtain || undefined : (ti.obtain || t('profile.locked'))"
                @click="pickTitle(ti.id, g.key)"
              >{{ ti.name }}</button>
            </div>
          </div>
        </div>

      </div>
    </template>

    <!-- Facts about the account rather than choices: a label on the left, the value on the
         right, one row each. Nothing here is editable, which is why it reads as a list and not
         as the forms on the other two tabs. -->
    <div v-else-if="tab === 'points'" class="pp-body">
      <div class="pp-rows">
        <div class="pp-row">
          <span class="pp-row-label">{{ t('profile.name') }}</span>
          <span class="pp-row-value">{{ currentIdentity.name || '—' }}</span>
          <button class="pp-row-btn" @click="openRename">{{ t('profile.rename') }}</button>
        </div>

        <div class="pp-row">
          <span class="pp-row-label">{{ t('profile.playerCode') }}</span>
          <span class="pp-row-value code">{{ currentIdentity.code || '—' }}</span>
        </div>

        <div class="pp-row">
          <span class="pp-row-label">PTP</span>
          <span class="pp-row-value">{{ pointBalance === null ? '—' : pointBalance }}</span>
          <!-- The balance answers the usual question on its own. The statement is a second
               question, so it waits behind a button instead of filling the tab. -->
          <button class="pp-row-btn" @click="ledgerOpen = !ledgerOpen">{{ t('points.detail') }}</button>
        </div>
      </div>

      <div v-if="ledgerOpen" class="pp-ptp-list">
        <div v-for="e in pointEntries" :key="e.id" class="pp-ptp-row">
          <span :class="['pp-ptp-delta', e.delta > 0 ? 'plus' : 'minus']">
            {{ e.delta > 0 ? '+' : '' }}{{ e.delta }}
          </span>
          <span class="pp-ptp-reason">{{ entryReason(e) }}</span>
          <span class="pp-ptp-date">{{ entryDate(e) }}</span>
        </div>
        <p v-if="!pointEntries.length" class="pp-ptp-empty">{{ t('points.empty') }}</p>
      </div>
    </div>

    <div v-else class="pp-body">
      <div class="pp-field">
        <span class="pp-label">{{ t('profile.musicVolume') }}</span>
        <VolumeBar
          :model-value="audioSettings.volume"
          :disabled="audioSettings.muted"
          @update:model-value="setVolume"
        />
      </div>

      <div class="pp-field">
        <span class="pp-label">{{ t('profile.sfxVolume') }}</span>
        <VolumeBar
          :model-value="sfxSettings.volume"
          @update:model-value="setSfxVolume"
        />
      </div>

      <!-- 低流量模式。public/image 有 21MB，光是招式卡的滿版底圖就 16MB（單張 1.5MB）——
           在賽場的行動網路下那是開一次就吃掉的量。開啟後圖片一律不下載，版面照舊。 -->
      <label class="pp-field pp-check">
        <input type="checkbox" :checked="lowData" @change="setLowData($event.target.checked)">
        <span>{{ t('profile.lowData') }}</span>
      </label>

      <!-- Only ever rendered for the organiser's own account, so for everyone else admin mode
           isn't something to be refused — it's something they never learn is there. Off on every
           page load: being the organiser is permanent, wanting the admin cards in the menu is
           not. -->
      <label v-if="isAdminAccount" class="pp-field pp-check">
        <input type="checkbox" :checked="isAdminMode" @change="setAdminMode($event.target.checked)">
        <span>{{ t('profile.adminMode') }}</span>
      </label>

      <!-- 信箱。既有玩家沒有（那一欄是後來加的），而那正是「忘記密碼只能找管理員」
           的根源 —— 所以補的路開在這裡，由他們自己來。

           綁過 Google 的人看不到這塊（包含用 Google 註冊的）：他們的信箱是 Google 給的，
           而往後希望他們一律走 Google 登入。留一個可以改的欄位在這裡，改了也不會變成新的
           登入方式，只會讓人以為自己改掉了什麼。 -->
      <div v-if="!googleLinked" class="pp-form">
        <div class="pp-form-title">{{ t('profile.email') }}</div>
        <p class="pp-form-note">{{ t('profile.emailHint') }}</p>
        <label class="pp-form-row">
          <span class="pp-form-label">{{ t('profile.emailField') }}</span>
          <input v-model="emailDraft" class="pp-input" type="email" inputmode="email"
                 autocapitalize="none" maxlength="254">
        </label>
        <div class="pp-form-foot">
          <button class="btn secondary" :disabled="emailBusy || !emailDirty" @click="submitEmail">
            {{ emailBusy ? t('profile.pinSaving') : t('common.save') }}
          </button>
        </div>
        <p v-if="emailDone" class="pp-form-ok">{{ t('profile.pinDone') }}</p>
        <p v-if="emailError" class="pp-form-err">{{ emailError }}</p>
      </div>

      <!-- Google 綁定。擺在信箱與改 PIN 中間，因為這三塊講的是同一件事：你下次怎麼
           進得來。綁定只有這裡做得到，而不是在登入畫面用信箱自動接 —— 這支畫面進得來
           本身就是「本人」的證明。 -->
      <div v-if="googleAvailable" class="pp-form">
        <div class="pp-form-title">{{ t('profile.googleTitle') }}</div>
        <p class="pp-form-note">{{ t('profile.googleNote') }}</p>

        <!-- 綁好之後這裡只剩狀態。不放解除的按鈕，是因為往後希望大家都走 Google ——
             這是介面上的選擇，伺服器那支 API 還在。 -->
        <template v-if="googleLinked">
          <div class="pp-form-row">
            <span class="pp-form-label">{{ t('profile.googleState') }}</span>
            <span class="pp-form-value">{{ t('profile.googleLinked') }}</span>
          </div>
          <p class="pp-form-note">{{ t('profile.googleOnward') }}</p>
        </template>

        <div v-show="!googleLinked" ref="googleSlot" class="pp-google-slot"></div>

        <p v-if="googleError" class="pp-form-err">{{ googleError }}</p>
      </div>

      <!-- 改 PIN。要先給現在這組，所以撿到別人開著的手機也改不掉。
           忘記的人改不了這裡 —— 那條路是到 Line 社群報代號，由管理員重設。

           綁過 Google 的人整塊不出現。用 Google 註冊的從來沒有 PIN，會對著兩個空欄位猜
           一個不存在的密碼；本來有 PIN 的也不需要再維護它了。 -->
      <div v-if="!googleLinked" class="pp-form">
        <div class="pp-form-title">{{ t('profile.changePin') }}</div>
        <label class="pp-form-row">
          <span class="pp-form-label">{{ t('profile.pinCurrent') }}</span>
          <input v-model="pinCurrent" class="pp-input" type="password" autocomplete="current-password">
        </label>
        <label class="pp-form-row">
          <span class="pp-form-label">{{ t('profile.pinNewField') }}</span>
          <input v-model="pinNext" class="pp-input" type="password" autocomplete="new-password"
                 :placeholder="t('profile.pinNewHint')">
        </label>
        <div class="pp-form-foot">
          <button
            class="btn secondary"
            :disabled="pinBusy || !pinCurrent || pinNext.length < 8"
            @click="submitPin"
          >{{ pinBusy ? t('profile.pinSaving') : t('common.save') }}</button>
        </div>
        <p v-if="pinDone" class="pp-form-ok">{{ t('profile.pinDone') }}</p>
        <p v-if="pinError" class="pp-form-err">{{ pinError }}</p>
      </div>

      <button class="btn secondary" @click="handleSignOut">{{ t('account.signOut') }}</button>
    </div>

    <div v-if="nameOpen" class="modal-overlay" style="align-items:center;" @click.self="nameOpen = false">
      <div class="modal-sheet pp-rename">
        <div class="modal-title">{{ t('profile.rename') }}</div>
        <input
          v-model="nameDraft"
          class="pp-input"
          maxlength="20"
          :placeholder="t('profile.namePlaceholder')"
          @keyup.enter="confirmRename"
        >
        <!-- Says the name back before it is committed. The whole reason this is a window and
             not an input on the page is that somebody should read it once more first. -->
        <p class="pp-rename-confirm">{{ t('profile.renameConfirm', { name: nameDraft.trim() || '—' }) }}</p>
        <div class="pp-rename-actions">
          <button class="btn secondary" @click="nameOpen = false">{{ t('common.cancel') }}</button>
          <button class="btn" :disabled="!nameDraft.trim() || saving" @click="confirmRename">
            {{ saving ? t('points.saving') : t('profile.renameDo') }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="saveError" class="pp-save-error">{{ saveError }}</p>

    <div class="pp-foot">
      <button
        v-if="tab === 'badge'"
        class="btn secondary pp-foot-btn"
        @click="showAll = !showAll"
      >{{ showAll ? t('profile.showOwned') : t('profile.showAll') }}</button>
      <!-- Only the badge tab has anything pending. Details is read-only or commits on confirm,
           and every control on Settings takes effect the moment it is touched — a Save button
           beside them only asks to be pressed for nothing. -->
      <button v-if="tab === 'badge'" class="btn pp-foot-btn" :disabled="!dirty || saving" @click="save">{{ t('profile.save') }}</button>
      <button class="btn secondary pp-foot-btn" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
  </div>
</template>

<style scoped>
/* 信箱與改 PIN 的那兩區。跟上面那些開關隔開：它們是一次性的動作，不是一個狀態。
   寬度跟音量那幾列一樣撐滿，欄位是「標籤在左、輸入在右」—— 窄一格的卡片會讓人以為
   這裡只是個附註，但它是帳號唯一的復原手段。 */
.pp-form {
  width: 100%; max-width: 30rem;
  display: flex; flex-direction: column; gap: 0.5rem;
  padding: 0.75rem; margin: 0.25rem 0;
  border: 0.0625rem solid var(--line); border-radius: var(--radius-sm);
}
.pp-form-title { font-size: 0.75rem; font-weight: 800; color: var(--ink); }
.pp-form-note { margin: 0; font-size: 0.625rem; color: var(--sub); line-height: 1.6; }

/* 標籤欄固定寬度而不是跟著字長：兩張卡片的輸入框要對齊在同一條線上，否則一格一格
   凸進凸出，看起來就不像同一份表單。 */
.pp-form-row {
  display: grid; grid-template-columns: 5.5rem 1fr;
  align-items: center; gap: 0.5rem;
  cursor: pointer;
}
.pp-form-label { font-size: 0.6875rem; font-weight: 800; color: var(--sub); line-height: 1.3; }
.pp-form-value { font-size: 0.8125rem; font-weight: 700; color: var(--ink); }
/* Google 自己畫的按鈕是一個 iframe，樣式碰不到，只能從外面壓。 */
.pp-google-slot { display: flex; justify-content: center; width: 100%; min-height: 2.5rem; }
.pp-form-foot { display: flex; justify-content: flex-end; }
/* 按不下去的要看起來按不下去。全域的 .btn 沒有 :disabled 樣式，所以停用的按鈕跟能按的
   長得一模一樣 —— 玩家會一直按，然後以為是壞了。 */
.pp-form-foot .btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
.pp-form-foot .btn:disabled:active { transform: none; }
.pp-form-foot .btn { padding: 0.4375rem 1.5rem; font-size: 0.75rem; }
.pp-form-ok { margin: 0; font-size: 0.6875rem; font-weight: 700; color: #2E7D4F; }
.pp-form-err { margin: 0; font-size: 0.6875rem; font-weight: 700; color: #C0392B; }

/* 真的很窄的機子（iPhone SE 直向以下）才疊回去 —— 橫排擠到輸入框只剩兩個字寬，
   那比疊起來更難用。 */
@media (max-width: 22rem) {
  .pp-form-row { grid-template-columns: 1fr; gap: 0.25rem; }
}

.pp-board { display: flex; flex-direction: column; min-height: 0; }

/* Label left, value right. The label column is sized to the longest label rather than to the
   content, so the values start on the same line down the list instead of stepping in and out. */
.pp-rows {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  /* Rows are the same width as each other and capped, rather than each one sized to its own
     contents — otherwise the two cards step in and out and the button never reaches a right
     edge to sit against. */
  width: 100%;
  max-width: 24rem;
  align-self: center;
}
.pp-row {
  display: grid;
  grid-template-columns: 6rem 1fr auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: var(--card);
}
.pp-row-label { font-size: 0.75rem; font-weight: 800; color: var(--sub); }
.pp-row-value { font-size: 0.9375rem; font-weight: 900; color: var(--ink); font-variant-numeric: tabular-nums; text-align: right; }
.pp-row-value.code { letter-spacing: 0.04em; }
.pp-row-btn {
  padding: 0.25rem 0.75rem;
  border: 0;
  border-radius: 999px;
  background: #1A1A18;
  color: #FFFFFF;
  font-family: inherit;
  font-size: 0.6875rem;
  font-weight: 800;
  cursor: pointer;
}
.pp-row-btn:active { transform: scale(.96); }

.pp-rename {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  width: 100%;
  max-width: 20rem;
  border-radius: 1rem;
  padding: 1rem;
}
.pp-rename-confirm { margin: 0; text-align: center; font-size: 0.75rem; font-weight: 700; color: var(--sub); }
.pp-rename-actions { display: flex; gap: 0.5rem; justify-content: center; }

.pp-ptp-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-top: 0.75rem;
  width: 100%;
  max-width: 24rem;
  align-self: center;
}
.pp-ptp-row {
  display: grid;
  /* Amount column fixed so the signs and digits line up down the page — a statement you have to
     read sideways is not one anybody checks. */
  grid-template-columns: 3.25rem 1fr auto;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.4375rem 0.625rem;
  border-radius: 0.5rem;
  background: var(--card);
  font-size: 0.75rem;
  font-weight: 700;
}
.pp-ptp-delta { font-weight: 900; text-align: right; font-variant-numeric: tabular-nums; }
.pp-ptp-delta.plus { color: #2E9E6B; }
.pp-ptp-delta.minus { color: #C0392B; }
.pp-ptp-reason { color: var(--ink); overflow-wrap: anywhere; }
.pp-ptp-date { color: var(--sub); font-size: 0.625rem; font-variant-numeric: tabular-nums; }
.pp-ptp-empty { margin: 1rem 0 0; text-align: center; font-size: 0.75rem; font-weight: 700; color: var(--sub); }

/* A row, not a stacked field: the label belongs beside its box, and the whole thing is a
   <label> so the text is part of the hit target. */
.pp-check {
  flex-direction: row;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--ink);
}
.pp-check input { width: 1rem; height: 1rem; accent-color: var(--accent-strong); cursor: pointer; }

.pp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: center;
}

/* One joined bar rather than separate pills — segments share borders (collapsed via negative
   margin) and only the two outer corners round, the way a segmented control reads as a single
   control instead of a row of buttons that happen to be near each other. */
.pp-tabs {
  flex-shrink: 0;
  display: flex;
  width: 100%;
  max-width: 30rem;
  margin: 0.625rem auto 0.5rem;
  padding: 0 0.75rem;
}
.pp-tab {
  flex: 1;
  padding: 0.4375rem 0.25rem;
  font-size: 0.75rem;
  font-weight: 700;
  border: 0.0625rem solid var(--line);
  margin-left: -0.0625rem;
  background: #fff;
  color: var(--ink);
  cursor: pointer;
  font-family: inherit;
  position: relative;
}
.pp-tab:first-child { margin-left: 0; border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.pp-tab:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
/* Dark fill, same as .btn.secondary elsewhere in the app — white tab for "not this one",
   solid dark fill with white text for "this one". */
.pp-tab.on {
  background: #1F1F1D;
  border-color: #1F1F1D;
  color: #fff;
  z-index: 1;
}

.pp-preview {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding: 0.25rem 0 0.5rem;
}

.pp-foot-btn { padding: 0.4375rem 0.75rem; font-size: 0.6875rem; }

.pp-field { width: 100%; max-width: 30rem; display: flex; flex-direction: column; gap: 0.25rem; }
.pp-label { font-size: 0.625rem; font-weight: 800; color: var(--sub); letter-spacing: 0.04em; }

.pp-input {
  width: 100%;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--ink);
  padding: 0.4375rem 0.5rem;
  border: 0.125rem solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card);
}
.pp-input:focus { outline: none; border-color: var(--accent-strong); }

.pp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(4.25rem, 1fr));
  gap: 0.5rem;
}
.pp-grid.wide { grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); }

.pp-swatch {
  position: relative;
  padding: 0;
  border: 0.125rem solid transparent;
  border-radius: var(--radius-sm);
  background: var(--card);
  cursor: pointer;
  overflow: hidden;
  aspect-ratio: 1;
  box-shadow: var(--shadow);
}
/* 8:3, so a flag reads as the shape it will actually be rather than a cropped square. */
.pp-swatch.flag { aspect-ratio: 8 / 3; }
.pp-swatch img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* A thin border alone got lost against busy artwork — the outer glow is what actually reads as
   "selected" at a glance. */
.pp-swatch.on { border-color: #1F1F1D; box-shadow: 0 0 0 0.1875rem #1F1F1D; }
.pp-swatch:focus-visible { outline: 0.125rem solid var(--accent-strong); outline-offset: 0.125rem; }

/* Shown, not hidden — a player should see what exists to aim for, just not be able to wear it
   yet. Greyed out and inert rather than removed from the grid. */
.pp-swatch.locked { cursor: not-allowed; }
.pp-swatch.locked img { filter: grayscale(1); opacity: 0.45; }
/* Coloured the way the nameplate will colour them, so what is picked here is what appears
   there. Same ranks, same tints. */
.pp-series { display: flex; flex-direction: column; gap: 0.1875rem; padding-top: 0.25rem; }
.pp-series-label {
  font-size: 0.5rem;
  font-weight: 800;
  color: var(--sub);
  letter-spacing: 0.06em;
}
.pp-titles { display: flex; flex-wrap: wrap; gap: 0.25rem; }

.pp-title-chip {
  font-size: 0.625rem;
  font-weight: 700;
  padding: 0.1875rem 0.4375rem;
  border-radius: var(--radius-sm);
  border: 0.125rem solid transparent;
  background: #2A2A28;
  color: var(--tint, rgba(255, 255, 255, .78));
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
/* Filled rather than just outlined, same reasoning as the tabs above. */
/* A border, not a fill — filling it in flattened every rank to the same colour, which is exactly
   what the rank tint exists to avoid. A white ring reads as "selected" without hiding it. */
.pp-title-chip.on { border-color: #fff; }
.pp-title-chip:focus-visible { outline: 0.125rem solid var(--accent-strong); outline-offset: 0.125rem; }
.pp-title-chip.locked { cursor: not-allowed; opacity: 0.45; }
.pp-title-chip.plain  { --tint: rgba(255, 255, 255, .78); }
.pp-title-chip.silver { --tint: #D5DAE3; }
.pp-title-chip.bronze { --tint: #DB9A68; }
.pp-title-chip.epic   { --tint: #CE93E8; }
.pp-title-chip.gold   { --tint: #F0C244; }
.pp-title-chip.legend { --tint: #FFDC73; }

.pp-save-error {
  flex-shrink: 0;
  margin: 0;
  padding: 0 0.75rem;
  text-align: center;
  font-size: 0.75rem;
  font-weight: 700;
  color: #C0392B;
}

.pp-foot {
  flex-shrink: 0;
  display: flex;
  gap: 0.625rem;
  justify-content: center;
  padding: 0.75rem 0 0.25rem;
}
</style>
