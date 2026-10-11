// A sound on every button tap, chosen by what kind of button it is — not wired up per-button
// (there are hundreds across the app), but globally, in App.vue's one delegated click listener,
// so a new screen gets this for free the moment its buttons use the shared .btn classes.
import clickUrl from '../assets/sound/button-click.mp3'
import confirmUrl from '../assets/sound/button-confirm.mp3'
import cancelUrl from '../assets/sound/button-cancel.mp3'
import { sfxSettings } from './sfxSettings'
import { i18n } from '../i18n'

// One shared element per sound rather than `new Audio()` per tap, same reasoning as the dice
// tray's roll sound (useDiceRoll3D.js) — restarting playback from the top on a repeat tap (via
// currentTime = 0) is what lets a fast double-click still produce two taps instead of the second
// being dropped because the first hadn't finished.
const clickAudio = new Audio(clickUrl)
const confirmAudio = new Audio(confirmUrl)
const cancelAudio = new Audio(cancelUrl)

function play(audio) {
  // Its own setting (sfxSettings.js), independent of the background-music volume/mute — the two
  // are meant to move separately, not share one knob.
  if (sfxSettings.value.muted) return
  try {
    audio.currentTime = 0
    audio.volume = sfxSettings.value.volume
    audio.play().catch(() => {})
  } catch (e) {
    // Same stance as every other Audio() call in this app: a browser that refuses to play
    // (autoplay policy, no audio hardware) just means silence, not a crash.
  }
}

export function playClickSound() { play(clickAudio) }
export function playConfirmSound() { play(confirmAudio) }
export function playCancelSound() { play(cancelAudio) }

// `.btn` alone (not `.secondary`) is this app's own existing convention for the affirmative/
// primary action in a given screen — Save, Confirm, Upload, Login, the red destructive-confirm
// — everywhere from PlayerProfileApp.vue to every admin screen built this session. `.secondary`
// and anything else (tabs, swatches, cards, list rows) reads as a regular tap unless it's a
// cancel (see below).
function isConfirmButton(el) {
  return el.classList.contains('btn') && !el.classList.contains('secondary')
}

// No shared class marks a "cancel" out of the app's many confirm dialogs — they're all built as
// a `.btn.secondary` with `t('common.cancel')` as its label, which is indistinguishable from any
// other secondary button by class alone. Matched by text instead, against the *current* locale's
// own translation (not a hardcoded string), so this keeps working if the wording changes or the
// language switches. The "✕" dismiss buttons on every modal are the same gesture by a different
// label, so they're included too.
function isCancelButton(el) {
  const text = el.textContent.trim()
  return text === '✕' || text === i18n.global.t('common.cancel')
}

// Delegated rather than attached per-element: a `<button>` or `<a>` added anywhere, today or in
// a future screen, gets a sound the moment it exists — nothing to remember to wire up. Capture
// phase so a component's own handler calling stopPropagation() can't silence it.
export function installButtonSfx() {
  function onClick(e) {
    const el = e.target.closest('button, a')
    if (!el || el.disabled) return
    if (isConfirmButton(el)) playConfirmSound()
    else if (isCancelButton(el)) playCancelSound()
    else playClickSound()
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
