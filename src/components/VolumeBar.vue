<!-- A row of filled/empty blocks instead of a native <input type="range"> — reads at a glance
     from across a table the way a slider's thumb position doesn't, and the chevrons give it a
     discrete step instead of a drag gesture, which matches how this app's own volume settings
     are used (nudged a notch, not fine-tuned to an exact percentage). -->
<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'

const props = defineProps({
  modelValue: { type: Number, required: true }, // 0–1
  steps: { type: Number, default: 10 },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const filled = computed(() => Math.round(props.modelValue * props.steps))

function setStep(n) {
  if (props.disabled) return
  const clamped = Math.min(props.steps, Math.max(0, n))
  emit('update:modelValue', clamped / props.steps)
}

function nudge(delta) {
  setStep(filled.value + delta)
}
</script>

<template>
  <div class="vb-row" :class="{ disabled }">
    <button class="vb-arrow" :disabled="disabled || filled === 0" @click="nudge(-1)">
      <Icon name="chevron-left" />
    </button>

    <button
      v-for="n in steps"
      :key="n"
      class="vb-block"
      :class="{ on: n <= filled }"
      :disabled="disabled"
      @click="setStep(n)"
    ></button>

    <button class="vb-arrow" :disabled="disabled || filled === steps" @click="nudge(1)">
      <Icon name="chevron-right" />
    </button>
  </div>
</template>

<style scoped>
.vb-row { display: flex; align-items: center; gap: 0.25rem; }
.vb-row.disabled { opacity: 0.5; }

.vb-arrow {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  border: none;
  border-radius: 0.3125rem;
  background: var(--card);
  color: var(--ink);
  font-size: 0.75rem;
  cursor: pointer;
}
.vb-arrow:disabled { cursor: default; opacity: 0.4; }

.vb-block {
  flex: 1;
  min-width: 0;
  height: 1.125rem;
  border: 0.0625rem solid var(--line);
  border-radius: 0.125rem;
  background: #fff;
  padding: 0;
  cursor: pointer;
}
.vb-block.on { background: #1F1F1D; border-color: #1F1F1D; }
.vb-block:disabled { cursor: default; }
</style>
