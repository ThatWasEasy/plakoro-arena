<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, SUPPORTED_LOCALES } from '../i18n'
import Icon from './Icon.vue'

const { t, locale } = useI18n()
const LABELS = { ja: '日本語', en: 'English', 'zh-TW': '繁體中文' }

const open = ref(false)
const root = ref(null)

function pick(loc) {
  setLocale(loc)
  open.value = false
}

// Closes on a tap anywhere outside the switcher, same as any other dropdown — without this it
// only ever closes by picking a language.
function onDocClick(e) {
  if (root.value && !root.value.contains(e.target)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', onDocClick))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocClick))
</script>

<template>
  <div ref="root" class="lang-switcher">
    <button class="lang-globe-btn" :aria-label="t('app.language')" @click="open = !open"><Icon name="globe" /></button>
    <div v-if="open" class="lang-menu">
      <button
        v-for="loc in SUPPORTED_LOCALES"
        :key="loc"
        class="lang-menu-item"
        :class="{ active: locale === loc }"
        @click="pick(loc)"
      >{{ LABELS[loc] }}</button>
    </div>
  </div>
</template>

<style scoped>
.lang-switcher { position: relative; }

.lang-globe-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border: none;
  border-radius: 0.4375rem;
  background: rgba(0, 0, 0, .35);
  color: #fff;
  font-size: 0.9375rem;
  line-height: 1;
  cursor: pointer;
}

.lang-menu {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
  background: #1F1F1D;
  border-radius: 0.5rem;
  padding: 0.25rem;
  box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, .3);
  white-space: nowrap;
}
.lang-menu-item {
  border: none;
  border-radius: 0.3125rem;
  padding: 0.3125rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: #fff;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.lang-menu-item.active { background: #AEFF3E; color: #2A2A2A; }
</style>
