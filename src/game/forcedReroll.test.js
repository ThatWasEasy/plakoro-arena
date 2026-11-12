// 逼對手重擲（ほりかえす / ジュエルフラッシュ）的骰面數學與估值。
import { describe, it, expect } from 'vitest'
import { forcedRerollRolls, enumerateRolls, payableCount } from './energyPayment'
import { pureDie } from './suggestedDice'

const steel = pureDie('はがね', 'あく')
const dice = [steel, steel, steel]
const odds = (rolls, cost) => { const c = payableCount(rolls, cost); return c.payable / c.total }

describe('forcedRerollRolls', () => {
  it('keeps every original outcome at equal weight', () => {
    expect(forcedRerollRolls(dice, ['はがね'], 1).length).toBe(216 * 6)
    expect(forcedRerollRolls(dice, ['はがね'], 2).length).toBe(216 * 36)
  })

  it('a single die rerolled is just a fresh throw', () => {
    expect(odds(forcedRerollRolls([steel], ['はがね'], 1), ['はがね'])).toBeCloseTo(odds(enumerateRolls([steel]), ['はがね']))
  })

  it('hurts, but less than taking the die away', () => {
    const cost = ['はがね', 'はがね', 'はがね']
    const base = odds(enumerateRolls(dice), cost)
    const rerolled = odds(forcedRerollRolls(dice, cost, 1), cost)
    const denied = odds(enumerateRolls(dice.slice(0, 2)), cost)
    expect(rerolled).toBeLessThan(base)
    expect(rerolled).toBeGreaterThan(denied)
  })

  it('a move with no cost cannot be broken', () => {
    expect(odds(forcedRerollRolls(dice, [], 2), [])).toBe(1)
  })
})
