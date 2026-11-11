<!-- A standalone login/register/claim screen — talks to server/index.mjs.

     註冊一律走 Google。自己設帳號 + PIN 那條路收掉了：它製造的問題（忘記 PIN、忘記帳號
     名，而且沒有任何自動的復原管道）比它解決的多，而那正是這一輪所有改動的起點。Google
     進不來的人由主辦方開帳號、發認領碼 —— 那條路不碰信箱，也不受唯一值限制。

     登入保留帳號 + PIN，收在「以舊系統登入」後面：一百多位既有玩家只有這一條路進得來，
     而他們之中多數人的 players.email 是 NULL。他們該做的是登入之後到設定頁綁 Google。

     刻意只有表單：沒有名牌預覽、沒有頭像／旗幟／稱號編輯、沒有儲存鍵 —— 那些在
     PlayerProfileApp.vue，而那支畫面要有帳號才進得去。 -->
<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { LINE_COMMUNITY_URL } from '../../data/community'
import { googleAvailable, renderGoogleButton } from '../../data/googleSignIn'
import { translateApiError } from '../../data/apiErrors'
import { useI18n } from 'vue-i18n'
import * as authApi from '../../data/authApi'
import { setCurrentPlayer } from '../../data/currentPlayer'
import { FALLBACK_AVATAR, FALLBACK_BACKGROUND } from '../../data/nameplateAssets'
import { setToken } from '../../data/session'
import LegalView from '../legal/LegalView.vue'

const emit = defineEmits(['back', 'done'])
const { t, locale } = useI18n()

const TABS = ['login', 'register', 'claim']
const tab = ref('login')

const loginAccount = ref('')
const loginPin = ref('')
const claimAccount = ref('')
const claimCode = ref('')
const claimPin = ref('')

// 「以舊系統登入」展開了沒。換分頁時收回去 —— 回到登入頁看到的該是主要的那條路。
const legacyOpen = ref(false)

const busy = ref(false)
const error = ref('')
// Google 的 script 載不進來時，整塊就不要出現 —— 一個畫不出按鈕的空框比沒有更糟。
const googleFailed = ref(false)

// 條款的同意。三個分頁共用一份，登入、註冊、認領都要勾了才送得出去。
//
// 預設不打勾，而且按鈕要等它打勾才會亮：同意必須是人主動做的動作，不是我們替他做好的。
// 擺在登入這一關的代價是老玩家每次回來都要再勾一次；好處是條款改版時，所有人都會在
// 下一次登入時重新看到它。
const agreedLegal = ref(false)
// '' | 'terms' | 'privacy'
const showLegal = ref('')

async function afterAuth(result) {
  setToken(result.token)
  const profile = await authApi.me(result.token)
  setCurrentPlayer({
    code: profile.code,
    name: profile.name,
    avatar: profile.avatar || FALLBACK_AVATAR,
    background: profile.background || FALLBACK_BACKGROUND,
    titleId: profile.title_id || null
  })
  emit('done')
}

async function run(action) {
  error.value = ''
  busy.value = true
  try {
    await action()
  } catch (e) {
    error.value = translateApiError(e.message, t)
  } finally {
    busy.value = false
  }
}

/* ── Google 登入 ──────────────────────────────────────────────────────────
   登入與註冊共用同一顆按鈕：對玩家來說「用 Google 進來」就是一件事，第一次按是註冊、
   之後按是登入，他不需要先選自己是哪一種。認領那一頁不放，因為那條路一定要有 PIN。

   按鈕本體由 Google 畫（品牌規範要求），所以這裡只給一個容器。容器常駐在 DOM 裡用
   v-show 切換 —— 用 v-if 的話切分頁會把它毀掉重建，而 Google 只在我們呼叫 renderButton
   的那一刻畫一次。
   ──────────────────────────────────────────────────────────────────────── */
const googleSlot = ref(null)
let stopGoogle = () => {}

// 同一顆按鈕，兩種意圖。按鈕只畫得了一次（Google 自己塞的 iframe），所以意圖在按下去
// 的當下由分頁決定，而不是畫兩顆。
const onGoogleCredential = credential =>
  run(async () => afterAuth(await authApi.googleSignIn(credential, tab.value === 'register')))

onMounted(async () => {
  if (!googleAvailable || !googleSlot.value) return
  try {
    stopGoogle = await renderGoogleButton(googleSlot.value, onGoogleCredential, {
      locale: locale.value,
      // 跟 .la-google-slot 的 transform 是同一個數字，改一邊就要改另一邊。
      scale: 1.22
    })
  } catch (e) {
    // 載不進來（擋廣告的擴充套件、公司網路擋 Google、離線）就當作沒有這個選項。
    // 帳號 + PIN 那條路不受影響，不該因為畫不出一顆按鈕就讓人登不進來。
    googleFailed.value = true
  }
})

onBeforeUnmount(() => stopGoogle())

const doLogin = () => run(async () => afterAuth(await authApi.login(loginAccount.value.trim(), loginPin.value)))
const doClaim = () => run(async () =>
  afterAuth(await authApi.claim(claimAccount.value.trim(), claimCode.value.trim(), claimPin.value)))
</script>

<template>
  <div class="board select-board la-board">
    <div class="modal-title">{{ t('account.title') }}</div>

    <div class="la-panel">
      <div class="la-tabs">
        <button
          v-for="tb in TABS"
          :key="tb"
          :class="['la-tab', { on: tab === tb }]"
          @click="tab = tb; error = ''; legacyOpen = false"
        >{{ t(`account.tab${tb[0].toUpperCase()}${tb.slice(1)}`) }}</button>
      </div>

      <!-- 登入以 Google 為主，帳號 + PIN 收在按鈕後面。不是把它藏起來 —— 它仍然是一百多位
           既有玩家唯一進得來的方式，而是讓畫面先給出那條不會再忘記密碼的路。 -->
      <div v-if="tab === 'login'" class="la-form">
        <!-- 跟 Google 那顆同一個規矩：沒同意條款之前，哪一條進來的路都不開。 -->
        <button
          v-if="!legacyOpen"
          type="button"
          class="la-legacy-toggle"
          :disabled="!agreedLegal"
          @click="legacyOpen = true"
        >{{ t('account.legacyLogin') }}</button>

        <form v-else class="la-form" @submit.prevent="doLogin">
          <input v-model="loginAccount" class="la-input" :placeholder="t('account.accountPlaceholder')" autocapitalize="none">
          <input v-model="loginPin" type="password" class="la-input" :placeholder="t('account.pinPlaceholder')">
          <button class="btn" type="submit" :disabled="busy || !agreedLegal">{{ t('account.loginSubmit') }}</button>
        </form>
      </div>

      <!-- 註冊只剩上面那顆 Google 按鈕，這裡沒有表單。自己設帳號 + PIN 那條路收掉了 ——
           它製造的問題（忘記 PIN、忘記帳號名，而且沒有任何自動的復原管道）比它解決的多。
           Google 進不來的人由主辦方開帳號、發認領碼。 -->

      <!-- v-else-if 而不是 v-else：註冊那一頁沒有表單（只有上面那顆 Google 按鈕），
           寫成 v-else 的話註冊頁會掉進來顯示認領表單。 -->
      <form v-else-if="tab === 'claim'" class="la-form" @submit.prevent="doClaim">
        <p class="la-hint">{{ t('account.claimHint') }}</p>
        <input v-model="claimAccount" class="la-input" :placeholder="t('account.accountPlaceholder')" autocapitalize="none" maxlength="20">
        <input v-model="claimCode" class="la-input" :placeholder="t('account.claimCodePlaceholder')" autocapitalize="characters">
        <input v-model="claimPin" type="password" class="la-input" :placeholder="t('account.pinPlaceholder')">
        <button class="btn" type="submit" :disabled="busy || !agreedLegal">{{ t('account.claimSubmit') }}</button>
      </form>

      <!-- Google 按鈕。登入與註冊共用，認領那一頁不放（那條路一定要有 PIN）。
           沒勾條款時整塊變淡並關掉點擊，跟旁邊那顆送出鈕是同一個規矩 —— 同意必須先於
           任何一種建立帳號的動作，換成 Google 也不例外。 -->
      <div
        v-show="tab !== 'claim' && !googleFailed"
        class="la-google"
        :class="{ off: !agreedLegal || busy }"
      >
        <div ref="googleSlot" class="la-google-slot"></div>
      </div>

      <!-- 忘記 PIN 的求助落在最底下。它不是表單的一部分，是「這幾種方式都不行的時候
           去找誰」—— 擺在送出鈕中間會打斷填表，擺在最後才是它該在的位置。 -->
      <p v-if="tab === 'login'" class="la-hint la-foot-hint">
        {{ t('account.forgotPin') }}
        <a class="la-link" :href="LINE_COMMUNITY_URL" target="_blank" rel="noopener">{{ t('mode.line') }}</a>
      </p>

      <!-- 一份，三個分頁共用。放在表單外面是因為它問的不是「你要做哪一件事」，而是
           「你同不同意這份條款」—— 那個答案在登入、註冊、認領之間不會改變。

           位置在最上面（排序由 CSS 的 order 決定，不是 DOM 順序）：同意這件事是進這個
           畫面要做的第一個決定，而不是填完才補的一道手續。
           連結直接寫在句子裡 —— 條款一律中文、不走 i18n（見 data/legalDocs.js），所以
           沒有語序問題，不必把一句話拆成四個 key 再拼回去。多個 label 指向同一個 id 是
           合法的：按文字會打勾，按書名號會開文件。 -->
      <div class="la-legal">
        <input id="la-agree" v-model="agreedLegal" type="checkbox">
        <span class="la-agree-text">
          <label for="la-agree">我已閱讀並同意</label>
          <button type="button" class="la-link" @click="showLegal = 'terms'">《服務條款》</button>
          <label for="la-agree">與</label>
          <button type="button" class="la-link" @click="showLegal = 'privacy'">《隱私權政策》</button>
        </span>
      </div>

      <p v-if="error" class="la-error">{{ error }}</p>
    </div>

    <!-- 跟著內容一起往下排，不另外釘住。`.board` 現在自己會捲（見 style.css），所以
         頁腳只要排在最後就捲得到 —— 不需要再把內容關進一個內層捲動容器。 -->
    <div class="la-foot">
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>

    <LegalView v-if="showLegal" :start="showLegal" @close="showLegal = ''" />
  </div>
</template>

<style scoped>
.la-board { display: flex; flex-direction: column; align-items: center; }

/* 版面順序由 order 決定，不是 DOM 順序 —— 因為 Google 按鈕只能畫一次（它是 Google 自己
   塞進來的 iframe），用 DOM 搬動就等於每次切分頁都要重畫。排法：
     Google → 表單（登入頁是「以舊系統登入」那顆）→ 同意 → 忘記 PIN → 錯誤
   Google 在最前面，因為它現在是主要路徑；帳號 + PIN 退成次要入口。 */
.la-panel {
  width: 100%;
  max-width: 24rem;
  margin-top: 0.5rem;
  padding: 0.875rem;
  border: 0.0625rem solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card);
  display: flex;
  flex-direction: column;
}
.la-panel > .la-tabs { order: 0; }
.la-panel > .la-legal { order: 4; }
.la-panel > .la-google { order: 2; }
.la-panel > .la-form { order: 3; }
.la-panel > .la-foot-hint { order: 5; }
.la-panel > .la-error { order: 6; }

/* One joined bar rather than separate pills — see PlayerProfileApp.vue's .pp-tabs for the same
   treatment and why. */
.la-tabs { display: flex; margin-bottom: 0.75rem; }
.la-tab {
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
.la-tab:first-child { margin-left: 0; border-radius: var(--radius-sm) 0 0 var(--radius-sm); }
.la-tab:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
.la-tab.on {
  background: #1F1F1D;
  border-color: #1F1F1D;
  color: #fff;
  z-index: 1;
}

.la-form { display: flex; flex-direction: column; gap: 0.5625rem; }

.la-input {
  width: 100%;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--ink);
  padding: 0.5625rem 0.625rem;
  border: 0.125rem solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
  font-family: inherit;
}
.la-input:focus { outline: none; border-color: var(--accent-strong); }

/* 入口被斷成兩行的話就不像一個可以按的東西了。 */
.la-google { display: flex; flex-direction: column; align-items: center; }
/* Google 自己畫的按鈕是一個 iframe，樣式碰不到，所以只能從外面壓。 */
/* Google 的按鈕高度是它自己決定的（large 已經是最大），所以要再大只能整個放大。外層給
   固定高度吸收放大後多出來的部分，不然底下的東西會被推開。 */
.la-google-slot {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 3.375rem;
}
.la-google-slot > * { transform: scale(1.22); transform-origin: center; }
.la-google.off { opacity: 0.45; pointer-events: none; }
.la-foot-hint { margin-top: 0.75rem; }

/* 黑底白字，跟站上其他次要動作一樣。
   試過描邊的淡版本（次要入口不該跟主要那顆搶），但它看起來像是被停用的 —— 玩家不會
   去點一顆看起來點不下去的按鈕，而這是一百多位既有玩家唯一進得來的門。能不能點比階層
   重要。
   不掛 .btn 再來覆蓋它：全域的 .btn.secondary 跟這支 scoped class 權重一樣，誰贏取決
   於樣式表的載入順序，那是賭的不是寫的。 */
.la-legacy-toggle {
  width: 100%;
  padding: 0.5625rem 0.75rem;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 800;
  color: #fff;
  background: #1F1F1D;
  border: none;
  border-radius: var(--radius-sm);
  box-shadow: 0 0.125rem 0.5rem rgba(0, 0, 0, 0.22);
  cursor: pointer;
}
.la-legacy-toggle:active { transform: scale(0.96); }
/* 沒勾條款時關起來。淡到剩下 0.45 會讓人以為壞了（那是上一版踩過的），所以只淡一點，
   靠游標告訴他現在按不得。底下那個勾選框就是解鎖它的地方。 */
.la-legacy-toggle:disabled { opacity: 0.6; cursor: not-allowed; }
.la-legacy-toggle:disabled:active { transform: none; }

.la-link { color: inherit; font-weight: 800; text-decoration: underline; white-space: nowrap; }

.la-hint { margin: 0; font-size: 0.6875rem; color: var(--sub); line-height: 1.6; }

/* 條款一律中文，所以這一區不跟著介面語言走 —— 見 data/legalDocs.js。 */
.la-legal {
  display: flex;
  align-items: flex-start;
  gap: 0.4375rem;
  margin: 0.75rem 0 0;
}
.la-legal > input {
  flex: none;
  margin: 0.1875rem 0 0;
  width: 1rem;
  height: 1rem;
  accent-color: var(--accent-strong, #1F1F1D);
}
.la-agree-text {
  font-size: 0.75rem;
  line-height: 1.7;
  color: var(--ink);
}
.la-agree-text label { cursor: pointer; }
.la-link {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: inherit;
  color: var(--ink);
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.la-error { margin: 0.625rem 0 0; font-size: 0.75rem; font-weight: 700; color: #C0392B; }

.la-foot { flex: none; padding: 1rem 0 0.25rem; }
</style>
