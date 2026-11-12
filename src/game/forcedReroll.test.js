// 逼對手重擲（ほりかえす / ジュエルフラッシュ）的骰面數學與估值。
import { describe, it, expect } from 'vitest'
import { forcedRerollRolls, enumerateRolls, payableCount } from './energyPayment'
import { pureDie } from './suggestedDice'

const steel = pureDie('はがね', 'あく')
const dice = [steel, steel, steel]
const odds = (rolls, cost) => { const c = payableCount(rolls, cost); return c.payable / c.total }

describe('forcedRerollRolls', () => {
  // 獨立的暴力解：逐一列舉骰面，算出「挑最難付的 n 顆」後的付費機率，跟合併過的清單比。
  it('matches a brute-force payable probability', () => {
    const mixed = { ...steel, dualSlots: [{ types: ['はがね', 'あく'] }, { types: ['あく', 'あく'] }] }
    const set = [steel, mixed, steel]
    const faces = set.map(d => enumerateRolls([d]))
    for (const cost of [['はがね', 'はがね', 'はがね'], ['はがね', 'あく', '無色'], ['あく', 'あく']]) {
      for (const n of [1, 2]) {
        let total = 0
        for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) {
          const shown = [a, b, c]
          const subsets = n === 1 ? [[0], [1], [2]] : [[0, 1], [0, 2], [1, 2]]
          total += Math.min(...subsets.map(sub => {
            const options = shown.map((f, i) => (sub.includes(i) ? faces[i] : [faces[i][f]]))
            let pay = 0, all = 0
            for (const x of options[0]) for (const y of options[1]) for (const z of options[2]) {
              all += 1
              if (payableCount([[...x, ...y, ...z]], cost).payable) pay += 1
            }
            return pay / all
          }))
        }
        expect(odds(forcedRerollRolls(set, cost, n), cost)).toBeCloseTo(total / 216, 10)
      }
    }
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
