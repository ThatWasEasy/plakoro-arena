<script setup>
// One energy chip, drawn the way the physical piece looks.
//
// Single chip: the icon PNG is already a finished badge — coloured rounded square, white outline,
// white glyph — so it's shown as-is. Wrapping it in another bordered box, as this used to, framed
// something that was already framed.
//
// Dual chip: one square printed with two types split corner to corner. The tile is filled with a
// hard-edged diagonal gradient of the two type colours and a white glyph is laid in each half.
// The glyphs come from image/ICON/glyph/ — the same artwork with its coloured plate and outline
// removed — because reusing the full badges here is what made this look wrong: each badge brought
// its own fill, rounding and outline, so one chip read as two.
import { computed } from 'vue'
import { asset } from '../../data/assetPath'
import { typeChipColor } from '../../data/constants'

const props = defineProps({
  types: { type: Array, required: true },
  // Tile edge, in rem.
  size: { type: Number, default: 2.25 }
})

const isDual = computed(() => props.types.length > 1)
const box = computed(() => `${props.size}rem`)
const radius = computed(() => `${(props.size * 0.23).toFixed(3)}rem`)
// 49%/51% rather than a single stop: a hard stop leaves a visibly aliased seam, while a 2% ramp
// reads as a clean edge at every size.
const split = computed(() =>
  `linear-gradient(135deg, ${typeChipColor(props.types[0])} 49%, ${typeChipColor(props.types[1])} 51%)`)
const glyph = computed(() => `${(props.size * 0.52).toFixed(3)}rem`)
const inset = computed(() => `${(props.size * 0.03).toFixed(3)}rem`)
const hairline = computed(() => `${Math.max(0.0625, props.size * 0.038).toFixed(4)}rem`)
</script>

<template>
  <div
    :style="{
      position: 'relative', width: box, height: box, borderRadius: radius, flexShrink: 0,
      border: hairline + ' solid rgba(0,0,0,.18)', overflow: 'hidden',
      background: isDual ? split : 'transparent'
    }"
  >
    <template v-if="isDual">
      <img
        :src="asset(`image/ICON/glyph/${types[0]}.png`)"
        class="img-icon"
        :alt="types[0]"
        :style="{ position: 'absolute', top: inset, left: inset, width: glyph, height: glyph }"
      >
      <img
        :src="asset(`image/ICON/glyph/${types[1]}.png`)"
        class="img-icon"
        :alt="types[1]"
        :style="{ position: 'absolute', bottom: inset, right: inset, width: glyph, height: glyph }"
      >
    </template>
    <img
      v-else
      :src="asset(`image/ICON/${types[0]}.png`)"
      class="img-icon"
      :alt="types[0]"
      :style="{ width: '100%', height: '100%', display: 'block' }"
    >
  </div>
</template>
