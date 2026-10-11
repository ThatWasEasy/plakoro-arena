<!-- Triggered by App.vue's triple-tap on the version number. Checks the PIN against the server
     (db/migrations/0003_admin_pin.sql), not a value baked into the bundle — anyone reading the
     frontend code learns nothing. -->
<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as adminApi from '../../data/adminApi'
import { setAdminToken } from '../../data/adminSession'

const emit = defineEmits(['close'])
const { t } = useI18n()

const pin = ref('')
const busy = ref(false)
const error = ref('')

async function submit() {
  if (!pin.value || busy.value) return
  error.value = ''
  busy.value = true
  try {
    const { token } = await adminApi.login(pin.value)
    setAdminToken(token)
    emit('close')
  } catch (e) {
    error.value = t('admin.wrongPin')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" style="z-index:500; align-items:center;" @click.self="emit('close')">
    <div class="admin-pin-sheet">
      <div class="modal-title">{{ t('admin.pinTitle') }}</div>
      <form class="admin-pin-form" @submit.prevent="submit">
        <input
          v-model="pin"
          type="password"
          inputmode="numeric"
          autocomplete="off"
          class="admin-pin-input"
          :placeholder="t('admin.pinPlaceholder')"
          autofocus
        >
        <p v-if="error" class="admin-pin-error">{{ error }}</p>
        <div class="admin-pin-actions">
          <button type="button" class="btn secondary" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button type="submit" class="btn" :disabled="busy || !pin">{{ t('common.confirm') }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.admin-pin-sheet {
  background: var(--bg);
  border-radius: 1.125rem;
  box-shadow: var(--shadow);
  padding: 1.25rem 1.5rem;
  width: 100%;
  max-width: 18rem;
}
.admin-pin-form { display: flex; flex-direction: column; gap: 0.5rem; }
.admin-pin-input {
  width: 100%;
  font-size: 1rem;
  font-weight: 700;
  color: var(--ink);
  text-align: center;
  letter-spacing: 0.3em;
  padding: 0.5625rem 0.625rem;
  border: 0.125rem solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
  box-sizing: border-box;
  font-family: inherit;
}
.admin-pin-input:focus { outline: none; border-color: var(--accent-strong); }
.admin-pin-error { margin: 0; font-size: 0.75rem; font-weight: 700; color: #C0392B; text-align: center; }
.admin-pin-actions { display: flex; gap: 0.625rem; justify-content: center; margin-top: 0.3125rem; }
</style>
