// Whether the music player panel (MusicPlayer.vue) is open — session-only UI state, not
// persisted, shared between GlobalTopBar.vue's volume button (which toggles it) and App.vue
// (which mounts the panel when it's open). Two different places in the tree, hence a tiny shared
// module rather than prop-drilling or an event bus.
import { ref } from 'vue'

export const showMusicPlayer = ref(false)

export function toggleMusicPlayer() {
  showMusicPlayer.value = !showMusicPlayer.value
}
