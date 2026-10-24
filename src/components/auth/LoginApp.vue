<!-- A standalone login/register/claim screen — talks to server/index.mjs. No OAuth, no email: a
     player logs in with an account handle they pick (not their P###### code — nobody remembers
     that) plus a PIN, kept separate from their display nickname (not unique, shown on banners —
     see docs/data-model.md「登入與註冊流程」). Deliberately just the forms: no nameplate preview,
     no avatar/flag/title editor, no save button — that's PlayerProfileApp.vue, reached only once
     an account exists. -->
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as authApi from '../../data/authApi'
import { setCurrentPlayer } from '../../data/currentPlayer'
import { FALLBACK_AVATAR, FALLBACK_BACKGROUND } from '../../data/nameplateAssets'
import { setToken } from '../../data/session'

const emit = defineEmits(['back', 'done'])
const { t } = useI18n()

const TABS = ['login', 'register', 'claim']
const tab = ref('login')

const loginAccount = ref('')
const loginPin = ref('')
const registerAccount = ref('')
const registerName = ref('')
const registerPin = ref('')
const claimAccount = ref('')
const claimCode = ref('')
const claimPin = ref('')

const busy = ref(false)
const error = ref('')

// The API's error strings are plain English (see server/index.mjs) — translated here rather
// than there, so the server stays free of i18n concerns. Anything not in this list (a network
// failure, a 500) falls back to a generic message rather than showing raw English.
const KNOWN_ERRORS = {
  'wrong account or pin': 'errorWrongCredentials',
  'account is required': 'errorAccountRequired',
  'account already taken': 'errorAccountTaken',
  'name is required': 'errorNameRequired',
  'claimCode is required': 'errorClaimCodeRequired',
  'claim code not found': 'errorClaimNotFound',
  'claim code already used': 'errorClaimUsed',
  'claim code expired': 'errorClaimExpired'
}

function translateError(message) {
  if (KNOWN_ERRORS[message]) return t(`account.${KNOWN_ERRORS[message]}`)
  if (message?.startsWith('pin must be at least')) return t('account.errorPinTooShort')
  return t('account.errorGeneric')
}

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
    error.value = translateError(e.message)
  } finally {
    busy.value = false
  }
}

const doLogin = () => run(async () => afterAuth(await authApi.login(loginAccount.value.trim(), loginPin.value)))
const doRegister = () => run(async () =>
  afterAuth(await authApi.register(registerAccount.value.trim(), registerName.value.trim(), registerPin.value)))
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
        <button class="btn" type="submit" :disabled="busy">{{ t('account.loginSubmit') }}</button>
        <p class="la-hint">{{ t('account.forgotPin') }}</p>
      </form>

      <form v-else-if="tab === 'register'" class="la-form" @submit.prevent="doRegister">
        <input v-model="registerAccount" class="la-input" :placeholder="t('account.accountPlaceholder')" autocapitalize="none" maxlength="20">
        <input v-model="registerName" class="la-input" :placeholder="t('account.namePlaceholder')" maxlength="20">
        <input v-model="registerPin" type="password" class="la-input" :placeholder="t('account.pinPlaceholder')">
        <button class="btn" type="submit" :disabled="busy">{{ t('account.registerSubmit') }}</button>
      </form>

      <form v-else class="la-form" @submit.prevent="doClaim">
        <p class="la-hint">{{ t('account.claimHint') }}</p>
        <input v-model="claimAccount" class="la-input" :placeholder="t('account.accountPlaceholder')" autocapitalize="none" maxlength="20">
        <input v-model="claimCode" class="la-input" :placeholder="t('account.claimCodePlaceholder')" autocapitalize="characters">
        <input v-model="claimPin" type="password" class="la-input" :placeholder="t('account.pinPlaceholder')">
        <button class="btn" type="submit" :disabled="busy">{{ t('account.claimSubmit') }}</button>
      </form>

      <p v-if="error" class="la-error">{{ error }}</p>
    </div>

    <div class="la-foot">
      <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
    </div>
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

.la-hint { margin: 0; font-size: 0.6875rem; color: var(--sub); line-height: 1.6; }
.la-error { margin: 0.625rem 0 0; font-size: 0.75rem; font-weight: 700; color: #C0392B; }

.la-foot { padding-top: 1rem; }
</style>
