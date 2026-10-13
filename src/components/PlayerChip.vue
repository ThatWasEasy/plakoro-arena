<script setup>
// Who you are, in the corner of the home screen: the face, the name, and the two numbers that
// change often enough to be worth seeing without opening anything.
//
// Stacked rather than strung along one line — the name is read, the numbers are glanced at, and
// a long name would push the numbers off the edge if they shared a row.
//
// A button: the profile screen is behind it.
import { useI18n } from 'vue-i18n'
import { currentIdentity, isSignedIn } from '../data/currentPlayer'
import { avatarUrl } from '../data/nameplateAssets'
import { playerLevel } from '../data/playerLevel'
import { ptpBalance } from '../data/points'

const emit = defineEmits(['open'])
const { t } = useI18n()
</script>

<template>
  <button class="player-chip" :aria-label="t('profile.title')" @click="emit('open')">
    <img class="pc-avatar" :src="avatarUrl(currentIdentity.avatar)" alt="" aria-hidden="true">
    <span class="pc-lines">
      <span class="pc-name">{{ isSignedIn ? currentIdentity.name : t('player.guest') }}</span>
      <!-- Both hidden for a guest: there is no record behind either number, and a Lv.1 that
           everyone starts at would read as something earned. -->
      <template v-if="isSignedIn">
        <span class="pc-stat">{{ t('player.level', { n: playerLevel }) }}</span>
        <span class="pc-stat">{{ ptpBalance }} PTP</span>
      </template>
    </span>
  </button>
</template>

<style scoped>
/* No plate behind it. The avatar and the name sit straight on the board — a backing pill only
   added a second shape to look at in a corner that should be glanceable. */
.player-chip {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  z-index: 300;
  display: flex;
  /* Stretch, so the text column is exactly as tall as the avatar and can space its own lines
     against that height rather than against their own. */
  align-items: stretch;
  gap: 0.5rem;
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
}
.player-chip:active { transform: scale(.97); }
.player-chip:focus-visible { outline: 0.125rem solid var(--accent-strong); outline-offset: 0.1875rem; border-radius: 0.5rem; }

.pc-avatar {
  width: 3.5rem;
  height: 3.5rem;
  flex-shrink: 0;
  border-radius: 0.4375rem;
  /* contain, not cover: the artwork is composed as a whole square and cropping it would cut
     the edges of whatever a player has chosen to represent them. */
  object-fit: contain;
  /* A hairline rather than a border: enough to separate the artwork from the board without
     reading as a frame around it. */
  box-shadow: 0 0 0 0.0625rem rgba(255, 255, 255, .5), 0 0.0625rem 0.25rem rgba(60, 60, 50, .25);
}

.pc-lines {
  display: flex;
  flex-direction: column;
  /* The column is the avatar's height, and the three lines are spread across it: the name's
     cap-height starts at the top edge of the artwork and the last number ends at the bottom,
     so the block reads as one shape with the square beside it rather than as text that happens
     to begin near it.
     An explicit line-height on all three (below) keeps the two resulting gaps equal — left to
     each font-size's own line box, the one under the larger name comes out wider. */
  justify-content: space-between;
  min-width: 0;
  /* Trims the half-leading above the first line and below the last, so space-between measures
     from the glyphs rather than from their line boxes. */
  padding: 0.0625rem 0;
}

/* Dark on the board, not white on a pill — there is no pill to be white against. */
.pc-name {
  font-size: 0.875rem;
  line-height: 1.15;
  font-weight: 800;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 9rem;
}

/* Same size and colour as the name — the three lines are one block about one person, and
   greying the numbers made them read as a caption on it. Weight alone separates them: the name
   is what you look for, the numbers are what you check. */
.pc-stat {
  /* Smaller than the name so all three clear the avatar's height. Same colour, same rhythm —
     only the size and the weight separate them. */
  font-size: 0.6875rem;
  line-height: 1.15;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
