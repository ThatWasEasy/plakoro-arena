<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  online: { type: Object, required: true }
})

const expanded = ref(false)
const joinCode = ref('')

const { online } = props

const statusLabel = computed(() => {
  if (online.role.value === 'host') return `房主・${online.roomCode.value}`
  if (online.role.value === 'guest') return online.connected.value ? '訪客・已連線' : '訪客・連線中'
  return '連線對戰'
})

function copyCode() {
  navigator.clipboard?.writeText(online.roomCode.value)
}

function join() {
  if (!joinCode.value) return
  online.join(joinCode.value)
  joinCode.value = ''
  expanded.value = false
}

function leave() {
  online.leave()
  expanded.value = false
}
</script>

<template>
  <div class="online-room-panel">
    <button class="room-toggle-btn" :class="{ active: !!online.role.value }" @click="expanded = !expanded">
      {{ statusLabel }}
    </button>

    <div v-if="expanded" class="room-popover">
      <template v-if="!online.role.value">
        <button class="btn wide" @click="online.host(); expanded = false">開房間</button>
        <div class="join-row">
          <input v-model="joinCode" placeholder="房間代碼" maxlength="6" @keyup.enter="join" />
          <button class="btn secondary" :disabled="!joinCode" @click="join">加入</button>
        </div>
      </template>
      <template v-else>
        <div v-if="online.role.value === 'host'" class="room-code" @click="copyCode">房號 {{ online.roomCode.value }}（點擊複製）</div>
        <div class="room-status">{{ online.connected.value ? `已連線（${online.peerCount.value} 人）` : '等待對方加入…' }}</div>
        <button class="btn secondary wide" @click="leave">離開房間</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Below both GlobalTopBar.vue (0.375rem–2.125rem) and the music player row its volume button can
   open (2.375rem–~4.375rem when open) — reserved whether or not that panel actually happens to
   be open right now, so this never has to know or care. */
.online-room-panel {
  position: absolute;
  top: 4.625rem;
  right: 0.375rem;
  z-index: 300;
}
.room-toggle-btn {
  border: none;
  border-radius: 0.625rem;
  background: rgba(0, 0, 0, .35);
  color: #fff;
  font-size: 0.625rem;
  font-weight: 700;
  line-height: 1;
  padding: 0.3125rem 0.5rem;
  cursor: pointer;
  white-space: nowrap;
}
.room-toggle-btn.active { background: rgba(63, 143, 63, .65); }
.room-toggle-btn:active { transform: scale(.96); }

.room-popover {
  position: absolute;
  top: calc(100% + 0.25rem);
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  background: var(--bg);
  color: var(--ink);
  box-shadow: var(--shadow);
  border-radius: 0.75rem;
  padding: 0.625rem;
  width: 10rem;
  font-size: 0.6875rem;
}
.join-row { display: flex; gap: 0.375rem; }
.join-row input {
  flex: 1;
  min-width: 0;
  font-size: 0.6875rem;
  padding: 0.25rem 0.375rem;
  border-radius: 0.375rem;
  border: 1px solid #ccc;
}
.room-code { cursor: pointer; text-decoration: underline dotted; word-break: break-all; }
.room-status { color: var(--sub); }
.wide { width: 100%; }
</style>
