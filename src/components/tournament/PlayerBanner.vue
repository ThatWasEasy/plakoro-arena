<script setup>
// Renders one nameplate. Everything shown arrives in the `nameplate` object — this component
// derives nothing, which is what lets the same shape be stored, edited and sent elsewhere
// without the rendering and the data drifting apart.
//
// Its one job beyond layout is resolving ids to assets: the object carries `background:
// "champion"`, not a URL, because a bundled URL carries a content hash and changes on every
// rebuild.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { backgroundUrl, avatarUrl, avatarBorderUrl } from '../../data/nameplateAssets'

const props = defineProps({
  nameplate: { type: Object, required: true },
  size: { type: String, default: 'md' }
})

const { t } = useI18n()

const flagBg = computed(() => backgroundUrl(props.nameplate.background))
const avatar = computed(() => avatarUrl(props.nameplate.avatar))
const avatarBorder = computed(() => avatarBorderUrl(props.nameplate.avatar))

// Literal text wins over a key: an event-specific title names a tournament, which no
// translation key can carry.
const titleText = computed(() => {
  const ti = props.nameplate.title
  if (!ti) return ''
  return ti.text || t(`tournament.banner.title.${ti.key}`)
})

// One number instead of three. Gold/silver/bronze split across a strip this small reads as
// clutter, and on a plate carrying "Meetup#1 優勝" the placement is already stated — what the
// strip adds is how often it has happened.
const top3 = computed(() => {
  const m = props.nameplate.medals || {}
  return (m.gold || 0) + (m.silver || 0) + (m.bronze || 0)
})

</script>

<template>
  <span :class="['flag', size]" :style="{ '--bg': `url(${flagBg})` }">
    <!-- A scrim under the text. The artwork is busiest where it is brightest, and a name laid
         straight onto it is unreadable wherever that falls. -->
    <span class="scrim" aria-hidden="true"></span>

    <span class="main">
      <span :class="['av', { framed: avatarBorder }]">
        <img class="avatar" :src="avatar" alt="" loading="lazy" decoding="async">
        <img v-if="avatarBorder" class="av-frame" :src="avatarBorder" alt="" aria-hidden="true" loading="lazy" decoding="async">
      </span>
      <span class="body">
        <span class="name">{{ nameplate.name }}</span>
        <span v-if="titleText" :class="['title', nameplate.title.rank]">{{ titleText }}</span>
      </span>
    </span>

    <!-- Under the avatar, spanning the flag: what the player has won, and how often they win. -->
    <span class="stats">
      <span v-if="nameplate.winRate !== null" class="stat">
        {{ t('tournament.banner.winRate') }} {{ nameplate.winRate }}%
      </span>
      <span v-if="top3" class="stat">{{ t('tournament.banner.top3') }} {{ top3 }}</span>
    </span>
  </span>
</template>

<style scoped>
/* One number drives the flag; everything on it is a fraction of that, so resizing is a single
   edit rather than a sweep. */
.flag {
  --h: 3.75rem;
  --border: 0.125rem;
  position: relative;
  display: inline-flex;
  /* Two registers stacked: the avatar and name on top, the stats strip under them. A row
     would put the stats beside the name instead of below the avatar. No align-items, so the
     children stretch to the full width and the strip starts at the left edge. */
  flex-direction: column;
  /* Pinned apart rather than centred: the strip belongs at the foot of the flag, and centring
     floated it up against the name. */
  justify-content: space-between;
  height: var(--h);
  /* The artwork's own 2048x768, so `cover` has nothing to crop. Written as an explicit width
     rather than aspect-ratio: on an inline-flex box the ratio loses to the content's
     min-content width, which is how the plates ended up 325-418px wide depending on how long
     each player's title happened to be. A stated width wins, and the text truncates instead. */
  width: calc(var(--h) * 2048 / 768);
  max-width: 100%;
  padding: 0.375rem 0.5rem 0.3125rem;
  vertical-align: middle;
  line-height: 1;
  background: var(--bg) center / cover no-repeat;
  /* A real border rather than an inset shadow, so artwork can take it over later: set
     border-image-source (plus slice/repeat) and these same widths become the frame. Until then
     it is a flat edge. box-sizing keeps --h the outer height either way. */
  box-sizing: border-box;
  border: var(--border) solid rgba(255, 255, 255, 0.22);
  box-shadow: 0 0.0625rem 0.1875rem rgba(60, 60, 50, 0.3);
}
/* Sizes live here, not in each caller's stylesheet. Overriding --h from outside looks like it
   works and then does not: the width is derived from it, so a consumer that also sets `width`
   breaks the 8:3 the artwork is drawn at. */
.flag.lg { --h: 4.5rem; }

.scrim {
  position: absolute;
  /* Not inset:0 — that resolves against the padding box and leaves the border ring showing
     raw artwork. Pulled out by the border width so the scrim reaches the outer edge. */
  inset: calc(-1 * var(--border));
  pointer-events: none;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0.5) 55%, rgba(0, 0, 0, 0.15) 100%);
}

/* How far the frame overhangs the avatar. Measured from the artwork: its clear window is
   80.5% of its width, so the frame has to be drawn ~1.24x the avatar for the opening to line
   up with the picture's edge. One variable, because tuning it by eye is one number. */
.av {
  --frame-scale: 1.24;
  position: relative;
  flex-shrink: 0;
  display: block;
  width: calc(var(--h) * 0.42);
  height: calc(var(--h) * 0.42);
}
.avatar {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 0.25rem;
  object-fit: cover;
  /* The avatar art is as dark as the flag it sits on, so the ring is what separates them —
     a white backing would only show through as a halo at the rounded corners. */
  box-shadow: 0 0 0 0.0625rem rgba(255, 255, 255, 0.45), 0 0.0625rem 0.1875rem rgba(0, 0, 0, 0.5);
}
/* A framed avatar drops the ring: the frame is already the edge, and a white line under gold
   ornament reads as a mistake. */
.av.framed .avatar {
  box-shadow: none;
  border-radius: 0.1875rem;
}
.av-frame {
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(100% * var(--frame-scale));
  height: calc(100% * var(--frame-scale));
  transform: translate(-50%, -50%);
  pointer-events: none;
  /* Above the picture, but the strip below must still be clickable through the overhang. */
  z-index: 1;
}

.main {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-height: 0;
  gap: 0.4375rem;
  min-width: 0;
}
.body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
}

/* The strip under the avatar. No rule above it — a line there separated the strip from the
   avatar it belongs to, and the smaller type already reads as a second register. */
.stats {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
  min-width: 0;
  overflow: hidden;
}
/* One weight, one colour. The strip is a footnote to the name above it; colouring the
   numbers made it compete with the title, which is the part that is supposed to stand out. */
.stat {
  font-size: 0.375rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.58);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  text-shadow: 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.6);
}

.name {
  font-size: 0.8125rem;
  font-weight: 500;
  color: #fff;
  line-height: 1.2;
  letter-spacing: 0.01em;
  text-shadow: 0 0.0625rem 0.1875rem rgba(0, 0, 0, 0.7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Coloured by what the title is worth. The scarce colours have to stay scarce — most players
   carry a plain one, which is what makes the gold on a champion's banner mean anything. */
.title {
  font-size: 0.5rem;
  font-weight: 500;
  color: var(--tint);
  border: 0.0625rem solid color-mix(in srgb, var(--tint) 40%, transparent);
  background: rgba(0, 0, 0, 0.4);
  border-radius: 0.1875rem;
  padding: 0.03125rem 0.25rem;
  white-space: nowrap;
  /* Allowed to shrink and clip. Pinned at flex-shrink:0 it would push the plate wider than
     the artwork's ratio, which is the thing the fixed width exists to prevent. */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.6);
}
.title.plain  { --tint: rgba(255, 255, 255, 0.78); }
.title.silver { --tint: #D5DAE3; }
.title.bronze { --tint: #DB9A68; }
.title.epic   { --tint: #CE93E8; }
.title.gold   { --tint: #F0C244; }
/* The only one that gets a glow — one tier above gold, and there is no colour left that reads
   as rarer than gold on its own. */
.title.legend {
  --tint: #FFDC73;
  background: linear-gradient(180deg, rgba(120, 85, 0, 0.55), rgba(0, 0, 0, 0.45));
  border-color: rgba(255, 220, 115, 0.65);
  box-shadow: 0 0 0.375rem rgba(255, 210, 90, 0.45);
}
.code {
  position: absolute;
  right: 0.5rem;
  bottom: 0.3125rem;
  font-size: 0.4375rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: #fff;
  text-shadow: 0 0.0625rem 0.1875rem rgba(0, 0, 0, 0.9);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}


</style>
