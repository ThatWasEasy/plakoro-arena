<script setup>
// Where the turn is, and whose move it is.
//
// Every piece of this is read straight off battle state — `phase` is the step, `actorKey` is
// who it is waiting on, `mods` are what the step has to honour. None of it is derived here,
// which is the point: the moment any of those three had to be guessed at by a screen, it was
// guessed wrong (see enterPhase's comment).
//
// It earns its place by answering the two questions a player at a table actually asks mid-
// turn — "is it me?" and "what happens next?" — which until now were only answerable by
// recognising which overlay happened to be on screen.
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { modsFor, STEP } from '../game/turnMods'
import { TURN_STEPS, stepIndexOf } from '../game/turnSteps'

const battle = inject('battle')
const online = inject('online', null)
const { t } = useI18n()
const state = battle.state

const STEPS = TURN_STEPS

const currentIndex = computed(() => stepIndexOf(state.phase))
const visible = computed(() => currentIndex.value >= 0)

const actor = computed(() => (state.actorKey ? state.players[state.actorKey] : null))
const actorName = computed(() => actor.value?.character?.name || state.actorKey || '')

// Online only. In hotseat both players share the screen, so "is it me" is not a question the
// app can answer — the trainer label already says whose turn it is.
const mine = computed(() => !!online?.myKey?.value && online.myKey.value === state.actorKey)
const showsWhoseTurn = computed(() => !!online?.myKey?.value)

// What this step has been told to do differently, named by the move that did it. Until now
// none of this was visible anywhere: a player lost a die with nothing on screen saying why.
const activeMods = computed(() => {
  const step = STEPS[currentIndex.value]
  if (!step || !actor.value) return []
  const forStep = step.key === 'damage' ? STEP.DAMAGE
    : step.key === 'diceRoll' ? STEP.DICE_ROLL
      : step.key === 'moveSelect' ? STEP.MOVE_SELECT
        : null
  if (!forStep) return []
  return modsFor(actor.value, forStep).filter(m => m.from)
})
</script>

<template>
  <div v-if="visible" class="ts">
    <div class="ts-track">
      <template v-for="(s, i) in STEPS" :key="s.key">
        <span v-if="i > 0" class="ts-sep" aria-hidden="true"></span>
        <span
          class="ts-step"
          :class="{ on: i === currentIndex, done: i < currentIndex }"
        >{{ t('stepper.step.' + s.key) }}</span>
      </template>
    </div>

    <div class="ts-who">
      <span v-if="showsWhoseTurn" class="ts-badge" :class="{ mine }">
        {{ t(mine ? 'stepper.yourTurn' : 'stepper.theirTurn') }}
      </span>
      <span class="ts-actor">{{ actorName }}</span>
      <!-- Each one names the move that caused it: "lost a die" is only actionable if you
           know which card took it. -->
      <span v-for="(m, i) in activeMods" :key="i" class="ts-mod">{{ m.from }}</span>
    </div>
  </div>
</template>

<style scoped>
/* A band in the column, not a thing lying on top of it.
 *
 * It used to be `position:absolute; bottom:0` with `flex-wrap:wrap`, which is two mistakes
 * compounding: it took no share of the stage's height, so it covered whatever was beneath it,
 * and wrapping let it grow upward without limit — a long trainer name plus two modifier chips
 * was enough to put a second line of bar across the player cards.
 *
 * Now it declares a height and holds it. Nothing inside wraps; anything too long truncates,
 * because a bar that reports the turn is worth less than the board it would otherwise hide. */
.ts {
  flex: 0 0 auto;
  height: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  flex-wrap: nowrap;
  overflow: hidden;
  padding: 0 0.5rem;
  background: rgba(31, 31, 29, 0.88);
  pointer-events: none;
}

/* The step row is the point of the bar, so it never shrinks. */
.ts-track { display: flex; align-items: center; gap: 0.25rem; flex: 0 0 auto; }
.ts-step {
  font-size: 0.5rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  /* Three states, three weights of the same colour rather than three colours: the row is a
     progress indicator, not a traffic light. */
  color: rgba(255, 255, 255, 0.35);
  white-space: nowrap;
}
.ts-step.done { color: rgba(255, 255, 255, 0.6); }
.ts-step.on {
  color: #1F1F1D;
  background: #fff;
  border-radius: 999px;
  padding: 0.0625rem 0.4375rem;
}
.ts-sep { width: 0.5rem; height: 0.0625rem; background: rgba(255, 255, 255, 0.28); }

/* Everything here can be cut: the name ellipsises, the chips drop off the end. */
.ts-who { display: flex; align-items: center; gap: 0.3125rem; min-width: 0; flex: 0 1 auto; overflow: hidden; }
.ts-badge {
  flex: none;
  font-size: 0.5rem;
  font-weight: 900;
  padding: 0.0625rem 0.375rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  white-space: nowrap;
}
/* The one thing worth a colour: whether the app is waiting on you. */
.ts-badge.mine { background: #AEFF3E; color: #1F1F1D; }
.ts-actor {
  flex: 0 1 auto;
  max-width: 6rem;
  font-size: 0.5rem;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.85);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ts-mod {
  flex: none;
  font-size: 0.4375rem;
  font-weight: 700;
  padding: 0.0625rem 0.3125rem;
  border-radius: 0.1875rem;
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.78);
  white-space: nowrap;
}
</style>
