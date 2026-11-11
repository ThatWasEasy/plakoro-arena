<!-- A standalone login/register/claim screen — talks to server/index.mjs. No OAuth: a
     player logs in with an account handle they pick (not their P###### code — nobody remembers
     that) plus a PIN, kept separate from their display nickname (not unique, shown on banners —
     see design/data-model.md「登入與註冊流程」). Deliberately just the forms: no nameplate preview,
     no avatar/flag/title editor, no save button — that's PlayerProfileApp.vue, reached only once
     an account exists.

     註冊要留信箱，不是拿來登入的 —— 是忘記 PIN 時唯一能認回帳號的線索（現在由管理員代為
     重設，之後接寄信）。既有玩家沒有信箱，補的路在 PlayerProfileApp.vue。 -->
<script setup>
import { ref } from 'vue'
import { LINE_COMMUNITY_URL } from '../../data/community'
import { translateApiError } from '../../data/apiErrors'
import { useI18n } from 'vue-i18n'
import * as authApi from '../../data/authApi'
import { setCurrentPlayer } from '../../data/currentPlayer'
import { FALLBACK_AVATAR, FALLBACK_BACKGROUND } from '../../data/nameplateAssets'
import { setToken } from '../../data/session'
import LegalView from '../legal/LegalView.vue'

const emit = defineEmits(['back', 'done'])
const { t } = useI18n()

const TABS = ['login', 'register', 'claim']
const tab = ref('login')

const loginAccount = ref('')
const loginPin = ref('')
const registerAccount = ref('')
const registerName = ref('')
const registerPin = ref('')
const registerEmail = ref('')
const claimAccount = ref('')
const claimCode = ref('')
const claimPin = ref('')

const busy = ref(false)
const error = ref('')

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

const doLogin = () => run(async () => afterAuth(await authApi.login(loginAccount.value.trim(), loginPin.value)))
const doRegister = () => run(async () =>
  afterAuth(await authApi.register(registerAccount.value.trim(), registerName.value.trim(), registerPin.value, registerEmail.value.trim())))
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
          @click="tab = tb; error = ''"
        >{{ t(`account.tab${tb[0].toUpperCase()}${tb.slice(1)}`) }}</button>
      </div>

      <form v-if="tab === 'login'" class="la-form" @submit.prevent="doLogin">
        <input v-model="loginAccount" class="la-input" :placeholder="t('account.accountPlaceholder')" autocapitalize="none">
        <input v-model="loginPin" type="password" class="la-input" :placeholder="t('account.pinPlaceholder')">
        <button class="btn" type="submit" :disabled="busy || !agreedLegal">{{ t('account.loginSubmit') }}</button>
        <p class="la-hint">
          {{ t('account.forgotPin') }}
          <a class="la-link" :href="LINE_COMMUNITY_URL" target="_blank" rel="noopener">{{ t('mode.line') }}</a>
        </p>
      </form>

      <form v-else-if="tab === 'register'" class="la-form" @submit.prevent="doRegister">
        <input v-model="registerAccount" class="la-input" :placeholder="t('account.accountPlaceholder')" autocapitalize="none" maxlength="20">
        <input v-model="registerName" class="la-input" :placeholder="t('account.namePlaceholder')" maxlength="20">
        <input v-model="registerPin" type="password" class="la-input" :placeholder="t('account.pinPlaceholder')">
        <!-- 信箱是找回帳號的唯一自動管道。沒有它，忘記 PIN 或忘記帳號名的人只能到
             Line 社群報代號、等人工重設。 -->
        <input v-model="registerEmail" type="email" class="la-input" inputmode="email"
               autocapitalize="none" :placeholder="t('account.emailPlaceholder')" maxlength="254">
        <p class="la-hint">{{ t('account.emailHint') }}</p>
        <button class="btn" type="submit" :disabled="busy || !agreedLegal">{{ t('account.registerSubmit') }}</button>
      </form>

      <form v-else class="la-form" @submit.prevent="doClaim">
        <p class="la-hint">{{ t('account.claimHint') }}</p>
        <input v-model="claimAccount" class="la-input" :placeholder="t('account.accountPlaceholder')" autocapitalize="none" maxlength="20">
        <input v-model="claimCode" class="la-input" :placeholder="t('account.claimCodePlaceholder')" autocapitalize="characters">
        <input v-model="claimPin" type="password" class="la-input" :placeholder="t('account.pinPlaceholder')">
        <button class="btn" type="submit" :disabled="busy || !agreedLegal">{{ t('account.claimSubmit') }}</button>
      </form>

      <!-- 一份，三個分頁共用。放在表單外面是因為它問的不是「你要做哪一件事」，而是
           「你同不同意這份條款」—— 那個答案在登入、註冊、認領之間不會改變。 -->

      <!-- 欄位填完、按下去之前，就是同意的位置。
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

.la-panel {
  width: 100%;
  max-width: 24rem;
  margin-top: 0.5rem;
  padding: 0.875rem;
  border: 0.0625rem solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--card);
}

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
.la-link { color: inherit; font-weight: 800; text-decoration: underline; white-space: nowrap; }

.la-hint { margin: 0; font-size: 0.6875rem; color: var(--sub); line-height: 1.6; }

/* 條款一律中文，所以這一區不跟著介面語言走 —— 見 data/legalDocs.js。 */
.la-legal {
  display: flex;
  align-items: flex-start;
  gap: 0.4375rem;
  margin-top: 0.75rem;
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
