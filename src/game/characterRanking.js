// Every character measured against the others, each on the dice a player would build for
// them, scored by the average of their best few moves.
//
// Comparing characters at all needs a fixed answer to "on what dice?", because a build that
// suits one is a poor build for another — rank the roster on a single shared build and the
// ranking mostly reports whose type that build happened to be. Each character therefore gets
// their own suggested build (see suggestedDice.js), which is what makes the numbers
// comparable rather than merely different.
//
// The average of the top few, rather than the single best, because one strong move doesn't
// carry a character through a game: a turn where the best move is unaffordable or was just
// used is a turn spent on the next one down.
import { enumerateRolls } from './energyPayment'
import { moveExpectedValue } from './moveExpectedValue'
import { ASSUMED_ENEMY_LAST_DAMAGE, suggestedBuild } from './suggestedDice'

export const DEFAULT_TOP_N = 3

/**
 * @param {Array}  characters roster entries
 * @param {object} movesById  every move, keyed by id
 * @param {object} [options]
 * @param {number} [options.topN]        how many of each character's moves to average
 * @param {object} [options.tempoValues] table from buildTempoTable, to price the moves that
 *                                       take a die or a move away from the opponent; omit to
 *                                       score damage and HP only
 * @returns {Array} one entry per character, best average first
 */
export function rankCharacters(characters, movesById, { topN = DEFAULT_TOP_N, tempoValues = null } = {}) {
  return characters
    .map(character => {
      const build = suggestedBuild(character, movesById)
      if (!build) return null
      const rolls = enumerateRolls(build.dice)
      const scored = build.moveList
        .map(mv => ({ mv, result: moveExpectedValue(mv, { rolls, enemyDice: build.dice, tempoValues, enemyLastDamage: ASSUMED_ENEMY_LAST_DAMAGE }) }))
        .map(entry => ({ mv: entry.mv, ev: entry.result.ev, odds: entry.result.odds }))
        .sort((a, b) => b.ev - a.ev)
      const top = scored.slice(0, topN)
      if (top.length === 0) return null
      return {
        character,
        mainType: build.mainType,
        secondaryType: build.secondaryType,
        top,
        moveCount: scored.length,
        // Averaged over however many moves the character actually has, so a character with
        // fewer than topN isn't flattered by dividing a short list by a full-length divisor.
        average: top.reduce((sum, entry) => sum + entry.ev, 0) / top.length
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.average - a.average)
}
