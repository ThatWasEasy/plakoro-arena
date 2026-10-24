// Background music: one Audio element, a fixed playlist, looping forever. A module-level
// singleton rather than a composable — there is exactly one soundtrack for the whole app
// regardless of how many components come and go, the same reasoning useDiceRoll3D.js's shared
// `rollAudio` already follows. Exposes reactive state (current track, playing/paused) and
// transport controls so a player widget can show and drive it.
import { ref, watch } from 'vue'
import { asset } from './assetPath'
import { audioSettings } from './audioSettings'

// Filenames read as `<artist>-<title words>.mp3` — not a format this project defined, just
// what the three tracks already dropped into public/music/ happen to follow.
const TRACK_FILES = [
  'Kolomna-nice-on-the-soul.mp3',
  'ShimaFM-why-no.mp3',
  'lnplusmusic-urban-street-city.mp3'
]

function parseTrack(file) {
  const [artist, ...words] = file.replace(/\.[^.]+$/, '').split('-')
  const title = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  return { artist, title, url: asset(`music/${file}`) }
}

export const TRACKS = TRACK_FILES.map(parseTrack)

const player = new Audio()
export const currentIndex = ref(0)
export const isPlaying = ref(false)
let started = false

function applyVolume() {
  player.volume = audioSettings.value.muted ? 0 : audioSettings.value.volume
}

function loadTrack(i, autoplay) {
  currentIndex.value = ((i % TRACKS.length) + TRACKS.length) % TRACKS.length
  player.src = TRACKS[currentIndex.value].url
  applyVolume()
  if (autoplay) player.play().catch(() => {})
}

player.addEventListener('ended', () => loadTrack(currentIndex.value + 1, true))
player.addEventListener('play', () => { isPlaying.value = true })
player.addEventListener('pause', () => { isPlaying.value = false })

// Reacts immediately to the slider/mute toggle regardless of whether music has started yet.
watch(audioSettings, applyVolume, { immediate: true })

export function nextTrack() {
  loadTrack(currentIndex.value + 1, true)
}
export function prevTrack() {
  loadTrack(currentIndex.value - 1, true)
}
export function togglePlay() {
  if (player.paused) player.play().catch(() => {})
  else player.pause()
}

function unlock() {
  if (started) return
  started = true
  loadTrack(0, true)
}

// Browsers block audio until the page has had some user interaction — start on the first one,
// anywhere, rather than requiring a dedicated "play music" button nobody asked for.
window.addEventListener('pointerdown', unlock, { once: true })
window.addEventListener('keydown', unlock, { once: true })
