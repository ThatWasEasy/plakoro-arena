<!-- Always present, on every screen — not gated by `mode`, because background music
     (data/backgroundMusic.js) plays everywhere and muting it shouldn't require backing out to
     the home screen first.

     Owns the stage's top-right corner outright. A screen that needs its own UI in that same
     corner (see OnlineRoomPanel.vue) positions itself below this bar rather than this bar trying
     to guess which modes to hide behind — the collision is this component's to avoid, once,
     not every other screen's to rediscover by hardcoding the same `top/right` offset. -->
<script setup>
import LanguageSwitcher from './LanguageSwitcher.vue'
import VolumeToggle from './VolumeToggle.vue'
</script>

<template>
  <div class="global-topbar">
    <VolumeToggle />
    <LanguageSwitcher />
  </div>
</template>

<style scoped>
.global-topbar {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  z-index: 300;
  display: flex;
  gap: 0.375rem;
}
</style>
