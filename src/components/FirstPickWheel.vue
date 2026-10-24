<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

// Online-only: shown while state.phase === "drawingFirst". `winnerKey` is already decided by
// the host (see useOnlineRoom's ready watcher) — this only has to animate a believable-looking
// draw that lands on it, the same "decide first, then animate to match" approach as the
// tournament lottery wheel, just fixed to exactly these two entries and a forced winner.
const props = defineProps({
  winnerKey: { type: String, required: true }
})

const { t } = useI18n()
const players = computed(() => ([
  { id: 'A', name: t('player.trainerA'), color: 'var(--trainerA-btn)' },
  { id: 'B', name: t('player.trainerB'), color: 'var(--trainerB-btn)' }
]))

const wheelRotation = ref(0)
const landed = ref(false)

const ACCEL_SEC = 1
const DECEL_SEC = 3.5
const TOTAL_SEC = ACCEL_SEC + DECEL_SEC

let rafId = null

function startSpin() {
  const winnerIndex = players.value.findIndex(p => p.id === props.winnerKey)
  const seg = 180
  const withinSlice = 0.15 + Math.random() * 0.7
  const targetMod = (((-(winnerIndex + withinSlice) * seg) % 360) + 360) % 360
  const EXTRA_SPINS = 5
  const totalSpinDelta = targetMod + EXTRA_SPINS * 360

  const spinStartTime = performance.now()
  const maxVel = (2 * totalSpinDelta) / TOTAL_SEC
  const accel1 = maxVel / ACCEL_SEC
  const accel2 = maxVel / DECEL_SEC
  const dist1 = 0.5 * accel1 * ACCEL_SEC * ACCEL_SEC

  const frame = now => {
    const elapsed = (now - spinStartTime) / 1000
    if (elapsed >= TOTAL_SEC) {
      wheelRotation.value = totalSpinDelta
      landed.value = true
      rafId = null
      return
    }
    let angle
    if (elapsed <= ACCEL_SEC) {
      angle = 0.5 * accel1 * elapsed * elapsed
    } else {
      const t2 = elapsed - ACCEL_SEC
      angle = dist1 + maxVel * t2 - 0.5 * accel2 * t2 * t2
    }
    wheelRotation.value = angle
    rafId = requestAnimationFrame(frame)
  }
  rafId = requestAnimationFrame(frame)
}

onMounted(startSpin)
onBeforeUnmount(() => { if (rafId) cancelAnimationFrame(rafId) })
</script>

<template>
  <div class="first-pick-wheel">
    <div class="first-pick-title">{{ t('select.firstPickTitle') }}</div>
    <div class="wheel-wrap">
      <div class="wheel-pointer">▼</div>
      <div
        class="wheel-disc"
        :style="{ transform: `rotate(${wheelRotation}deg)`, background: `conic-gradient(${players[0].color} 0deg 180deg, ${players[1].color} 180deg 360deg)` }"
      >
        <div v-for="(p, i) in players" :key="p.id" class="wheel-label-wrap" :style="{ transform: `rotate(${i * 180 + 90}deg)` }">
          <span class="wheel-label">{{ p.name }}</span>
        </div>
      </div>
    </div>
    <div class="first-pick-result" :class="{ visible: landed }">{{ t('select.firstPickResult', { name: players.find(p => p.id === winnerKey)?.name }) }}</div>
  </div>
</template>

<style scoped>
.first-pick-wheel {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 1rem;
}
.first-pick-title { font-size: 1.125rem; font-weight: 800; color: var(--ink); }
.wheel-wrap { position: relative; width: 60%; max-width: 12rem; }
.wheel-pointer {
  position: absolute; top: -0.625rem; left: 50%; transform: translateX(-50%);
  font-size: 1.25rem; z-index: 2; color: var(--ink); line-height: 1;
}
.wheel-disc {
  position: relative; width: 100%; aspect-ratio: 1; border-radius: 50%;
  overflow: hidden; box-shadow: var(--shadow); border: 0.1875rem solid #fff;
}
.wheel-label-wrap { position: absolute; inset: 0; }
.wheel-label {
  position: absolute; top: 14%; left: 50%; transform: translateX(-50%);
  font-size: 0.8125rem; font-weight: 800; color: #fff; white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,.45);
}
.first-pick-result {
  font-size: 1rem; font-weight: 800; color: var(--ink); opacity: 0; transition: opacity .3s;
}
.first-pick-result.visible { opacity: 1; }
</style>
