<!-- The quick-access icon in GlobalTopBar.vue — clicking it opens/closes the music player panel
     (MusicPlayer.vue) rather than muting directly; actual mute lives as a control inside that
     panel now. The icon itself still reflects mute state at a glance either way. -->
<script setup>
import { useI18n } from 'vue-i18n'
import { audioSettings } from '../data/audioSettings'
import { toggleMusicPlayer } from '../data/musicPlayerUi'
import Icon from './Icon.vue'
import '../data/backgroundMusic'

const { t } = useI18n()
</script>

<template>
  <button
    class="volume-toggle"
    :aria-label="t('app.musicPlayer')"
    @click="toggleMusicPlayer"
  ><Icon :name="audioSettings.muted ? 'volume-off' : 'volume'" /></button>
</template>

<style scoped>
.volume-toggle {
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
</style>
