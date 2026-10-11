// Background-music volume and mute state — one place both the home screen's speaker icon and
// the profile page's volume slider read from and write to, persisted the same way
// currentPlayer.js persists identity: a ref seeded from localStorage, mutated only through the
// exported setters so every caller stays in sync.
import { computed, ref } from 'vue'

const STORAGE_KEY = 'plakoro_audio_settings_v1'
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

export const audioSettings = computed(() => state.value)

export function setVolume(v) {
  state.value = { ...state.value, volume: Math.min(1, Math.max(0, v)) }
  persist()
}

export function setMuted(muted) {
  state.value = { ...state.value, muted: !!muted }
  persist()
}

export function toggleMuted() {
  setMuted(!state.value.muted)
}
