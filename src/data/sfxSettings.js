// Button sound-effect volume/mute — deliberately its own setting, not shared with
// audioSettings.js (which is background-music only). Muting the music shouldn't silence every
// tap in the UI, and someone who wants clicks but no music (or the other way round) needs the
// two to move independently. Same persistence shape as audioSettings.js on purpose, just a
// different storage key and a different set of readers (buttonSfx.js, this file's own slider).
import { computed, ref } from 'vue'

const STORAGE_KEY = 'plakoro_sfx_settings_v1'
const DEFAULT_VOLUME = 0.5

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { volume: DEFAULT_VOLUME, muted: false }
    const parsed = JSON.parse(raw)
    const volume = Number(parsed.volume)
    return {
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_VOLUME,
      muted: !!parsed.muted
    }
  } catch (e) {
    return { volume: DEFAULT_VOLUME, muted: false }
  }
}

const state = ref(load())

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value))
  } catch (e) {
    // A full or disabled store just means the setting won't survive a reload.
  }
}

export const sfxSettings = computed(() => state.value)

export function setSfxVolume(v) {
  state.value = { ...state.value, volume: Math.min(1, Math.max(0, v)) }
  persist()
}

export function setSfxMuted(muted) {
  state.value = { ...state.value, muted: !!muted }
  persist()
}
