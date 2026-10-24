<script setup>
// Online battle — the shell the lobby and rooms will be built into.
//
// Here now, empty, on purpose: the menu card is already announcing this to players, and a
// card that leads nowhere is worse than one that leads somewhere unfinished. Only the
// organiser's account can reach this screen (see ModeSelect's `comingSoon`), so what it says
// is addressed to the one person who will see it before it is real.
import { useI18n } from 'vue-i18n'

const emit = defineEmits(['back'])
const { t } = useI18n()
</script>

<template>
  <div class="board select-board on-board">
    <h2 class="on-title">{{ t('mode.online') }}</h2>
    <p class="on-note">{{ t('online.underConstruction') }}</p>
    <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
  </div>
</template>

<style scoped>
.on-board {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}
.on-title { margin: 0; font-size: 1.25rem; font-weight: 900; color: var(--ink); }
.on-note { margin: 0; font-size: 0.75rem; font-weight: 700; color: var(--sub); text-align: center; }
</style>
