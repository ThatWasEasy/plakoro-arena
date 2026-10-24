<script setup>
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../data/constants'
import { asset } from '../data/assetPath'

const props = defineProps({
  playerKey: { type: String, required: true }
})

const battle = inject('battle')
const { characters } = inject('characterData')
const { t } = useI18n()

function pick(c) {
  battle.openMoveSelect(props.playerKey, c)
}
</script>

<template>
  <div class="modal-title">{{ t('charSelect.title') }}</div>
  <div v-if="characters.length === 0" style="text-align:center; color:var(--sub); font-size:0.75rem; padding:1rem 0.625rem; line-height:1.6;">
    {{ t('charSelect.empty') }}
  </div>
  <div v-else class="grid-2">
    <div v-for="c in characters" :key="c.id" class="pick-card" @click="pick(c)">
      <div class="pick-top" :style="{ background: typeBgColor(c.type) }">
        <div class="pick-type-icon"><img :src="asset(`image/ICON/${c.type}.png`)" class="img-icon" :alt="c.type"></div>
        <div class="ic"><img :src="c.imageUrl || asset(`image/CHARA/${c.name}.png`)" class="img-icon" :alt="c.name"></div>
      </div>
      <div class="pick-bottom">
        <div class="nm-row">
          <span class="nm">{{ c.name }}</span>
          <span v-if="c.weaknesses.length > 0" class="nm-wk">{{ t('charSelect.weaknessPrefix') }}<img v-for="w in c.weaknesses" :key="w.type" :src="asset(`image/ICON/${w.type}.png`)" class="img-icon nm-wk-icon" :alt="w.type">)</span>
        </div>
      </div>
    </div>
  </div>
</template>
