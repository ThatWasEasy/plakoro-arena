<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor, typeChipColor } from '../data/constants'
import { lowData } from '../data/lowDataMode'
import { isCharaColorConditionMet } from '../game/damage'
import { asset } from '../data/assetPath'

const props = defineProps({
  mv: { type: Object, required: true },
  // 名稱底下再印一行（招式機率表用來放日文原名）。預設空字串：對戰中的卡片只要一行，
  // 多一行會把本來就在擠的卡面再切掉一塊。
  subName: { type: String, default: '' },
  dmgInfo: { type: Object, default: null },
  owner: { type: Object, default: null },
  opponent: { type: Object, default: null },
  selected: { type: Boolean, default: false },
  order: { type: Number, default: null },
  disabled: { type: Boolean, default: false },
  disableBadge: { type: Object, default: null }, // { kind: 'lastused' | 'bind', label }
  clickable: { type: Boolean, default: true }
})
const emit = defineEmits(['pick'])
const { t } = useI18n()

// 低流量模式下卡面上所有屬性都只剩透明像素 —— 圖示是這張卡辨識屬性的唯一管道，
// 沒了就看不出這招是什麼屬性、要付什麼能量。一個字的代號頂上去（草火水雷鋼惡鬥超飛無，
// 本來就是這個專案講這些屬性時用的說法）。
function typeShort(type) {
  const key = `typeShort.${type}`
  const label = t(key)
  return label === key ? type : label
}

const dmg = computed(() => props.dmgInfo || { display: props.mv.baseDamage, raw: props.mv.baseDamage, orig: props.mv.baseDamage, mode: 'normal' })
const dmgClass = computed(() => {
  const m = dmg.value.mode
  return m === 'weak' ? 'weak' : m === 'up' ? 'up' : m === 'down' ? 'down' : ''
})
const dmgDiffLabel = computed(() => {
  const diff = dmg.value.raw - dmg.value.orig
  const sign = diff >= 0 ? '+' : '-'
  return `${dmg.value.orig}${sign}${Math.abs(diff)}`
})

function charaHighlighted(ce) {
  return isCharaColorConditionMet(ce.type, props.owner, props.opponent)
}

function onClick() {
  if (props.disabled || !props.clickable) return
  emit('pick', props.mv.id)
}
</script>

<template>
  <div
    class="move-card"
    :class="{ disabled, selected }"
    :data-select-order="order != null ? order : null"
    :style="clickable && !disabled ? '' : 'cursor:default;'"
    @click="onClick"
  >
    <div
      class="mc-top"
      :class="{ low: lowData }"
      :style="lowData
        ? {}
        : { backgroundColor: typeBgColor(mv.type), backgroundImage: `url('${asset(`image/BACK/back_${mv.type}.png`)}')`, backgroundSize: 'cover', backgroundPosition: 'center' }"
    >
      <div class="mc-top-row">
        <div class="mc-typename">
          <div class="mc-type-icon">
            <span v-if="lowData" class="mc-type-text" :style="{ background: typeChipColor(mv.type) }">{{ typeShort(mv.type) }}</span>
            <img v-else :src="asset(`image/ICON/${mv.type}.png`)" class="img-icon" :alt="mv.type">
          </div>
          <div class="mc-names">
            <div class="mc-name-big">{{ mv.name }}</div>
            <div v-if="subName" class="mc-name-ja">{{ subName }}</div>
          </div>
        </div>
        <div class="mc-right-stack">
          <div class="mc-cost">
            <div v-for="(cost, i) in mv.cost" :key="i" class="cost-dot">
              <!-- 底色是 CSS 畫的，不耗流量，而顏色本來就是這些晶片最快的辨識方式；
                   代號只是補上「到底是哪一種」。 -->
              <span v-if="lowData" class="cost-text" :style="{ background: typeChipColor(cost) }">{{ typeShort(cost) }}</span>
              <img v-else :src="asset(`image/ICON/${cost}.png`)" class="img-icon" :alt="cost">
            </div>
          </div>
          <div class="mc-dmg" :class="dmgClass">
            {{ dmg.display }}<span v-if="dmg.mode !== 'normal'" class="orig">({{ dmgDiffLabel }})</span>
          </div>
        </div>
      </div>
      <div v-if="mv.effect" class="mc-effect">{{ mv.effect }}</div>
    </div>
    <div class="mc-bottom">
      <div v-for="(ce, i) in mv.chara" :key="i" class="mc-chara-row">
        <div style="display:flex; gap:0.125rem; flex-shrink:0;">
          <div v-for="(ori, j) in ce.orientations" :key="j" class="oi">
            <span v-if="lowData" class="oi-text">{{ ori }}</span>
            <img v-else :src="asset(`image/ICON/${ori}.png`)" class="img-icon" :alt="ori">
          </div>
        </div>
        <div class="txt" :style="charaHighlighted(ce) ? 'color:#F5F842;' : ''">{{ ce.text }}</div>
      </div>
    </div>
    <div v-if="disableBadge" class="move-disable-badge" :class="disableBadge.kind">{{ disableBadge.label }}</div>
  </div>
</template>
