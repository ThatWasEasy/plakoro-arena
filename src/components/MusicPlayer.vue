<!-- Bottom-left, toggled by the volume icon in GlobalTopBar.vue (not tied to any one screen,
     since that trigger is global too). Shows what's playing and the transport — the actual
     playback (playlist, looping, autoplay-unlock) all lives in data/backgroundMusic.js; this is
     just the face of it, plus the one mute control that used to live on the icon itself. -->
<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { audioSettings, toggleMuted } from '../data/audioSettings'
import { TRACKS, currentIndex, isPlaying, nextTrack, prevTrack, togglePlay } from '../data/backgroundMusic'
import Icon from './Icon.vue'

const { t } = useI18n()
const current = computed(() => TRACKS[currentIndex.value])

// Only scrolls a title that's actually too wide for the box — measured rather than assumed,
// since the three tracks' names aren't all the same length. Re-measured whenever the track
// changes; the box itself never resizes, so nothing else has to trigger it.
const label = ref(null)
const scrollDistance = ref(0)

async function measure() {
  await nextTick()
  const el = label.value
  if (!el) return
  const overflow = el.scrollWidth - el.parentElement.clientWidth
  scrollDistance.value = overflow > 0 ? overflow : 0
}

onMounted(measure)
watch(current, measure)
</script>

<template>
  <div class="music-player">
    <div class="music-label">
      <span
        ref="label"
        class="music-label-text"
        :class="{ scrolling: scrollDistance > 0 }"
        :style="{ '--scroll-distance': `-${scrollDistance}px` }"
      >{{ current.artist }} - {{ current.title }}</span>
    </div>
    <div class="music-controls">
      <button class="music-btn" :aria-label="t('app.prevTrack')" @click="prevTrack">
        <Icon name="skip-back" />
      </button>
      <button class="music-btn" :aria-label="t(isPlaying ? 'app.pause' : 'app.play')" @click="togglePlay">
        <Icon :name="isPlaying ? 'pause' : 'play'" />
      </button>
      <button class="music-btn" :aria-label="t('app.nextTrack')" @click="nextTrack">
        <Icon name="skip-forward" />
      </button>
      <button
        class="music-btn"
        :aria-label="t(audioSettings.muted ? 'app.unmute' : 'app.mute')"
        @click="toggleMuted"
      ><Icon :name="audioSettings.muted ? 'volume-off' : 'volume'" /></button>
    </div>
  </div>
</template>

<style scoped>
/* Below GlobalTopBar.vue, same corner — a row under the icons that opened it rather than off in
   a different corner of the screen. */
.music-player {
  position: absolute;
  top: 2.375rem;
  right: 0.375rem;
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  max-width: 15rem;
  background: #000;
  color: #fff;
  border-radius: 0.5rem;
  padding: 0.3125rem 0.5rem;
  box-shadow: 0 0.125rem 0.5rem rgba(0, 0, 0, .3);
}

.music-label {
  min-width: 0;
  overflow: hidden;
}

.music-label-text {
  display: inline-block;
  font-size: 0.5625rem;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
}
/* Back and forth, not a one-way loop like the home screen's announcement ticker — `alternate`
   is what turns a single 0-to-end keyframe into "slide to the end, slide back, repeat" without
   needing a second copy of the text. */
.music-label-text.scrolling {
  animation: music-marquee 5s ease-in-out infinite alternate;
}
@keyframes music-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(var(--scroll-distance)); }
}

.music-controls {
  flex-shrink: 0;
  display: flex;
  gap: 0.1875rem;
}

.music-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  border: none;
  border-radius: 0.3125rem;
  background: rgba(255, 255, 255, .14);
  color: #fff;
  font-size: 0.6875rem;
  cursor: pointer;
}
</style>
