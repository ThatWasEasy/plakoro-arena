// 一個回合，從選招走到傷害真的進去 —— 單人爬塔與對戰模式各一次。
//
// 這兩個模式的回合流程是一份一份對著抄的（13 個同名函式，220 行），但狀態的形狀不一樣：
// 對戰把兩方放在 state.players 這張表裡，單人爬塔是 state.player 與 state.ai 兩個鍵。
// 抄到寫死形狀的那一行就會讀到 undefined，而且要等效果佇列真的跑起來 —— 也就是玩家
// 點下招式之後 —— 才會炸，所以選角、進戰鬥、選招全部正常，看起來沒事。
//
// 這裡不驗傷害公式（damage.test.js 的工作），只驗「這條路走得完」：選招 → 判定 →
// 對手的血真的少了 → 回合換手。流程被接錯的時候，這支會在第一次跑就紅。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { useSoloRun } from './useSoloRun'
import { useBattleState } from './useBattleState'

const CHAR = {
  id: 'T-001', name: 'テスト', type: 'かみなり',
  weaknesses: [], hp: 120, moves: ['M1', 'M2', 'M3', 'M4']
}
const move = (id, baseDamage) => ({
  id, chara_name: 'テスト', name: id, nameJa: id, type: 'かみなり',
  cost: ['かみなり'], baseDamage, effect: '', effectType: '', effectValue: 0, chara: []
})
const MOVES = {
  M1: move('M1', 30), M2: move('M2', 20), M3: move('M3', 10), M4: move('M4', 40)
}
const charactersRef = ref([CHAR])
const movesRef = ref(MOVES)

// 動畫是用 setTimeout 串的，傷害在鏈子的尾端才進去（攻擊動畫 550ms + 命中 550ms）。
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('單人爬塔：一個回合', () => {
  it('選招、判定成功，對手就會掉血，然後換手', () => {
    const solo = useSoloRun(charactersRef, movesRef)
    solo.resetRun()

    solo.selectCharacter(CHAR)
    solo.toggleStartingMove('M1')
    solo.toggleStartingMove('M2')
    solo.confirmStartingSetup()

    // 地圖是隨機生成的，所以走第一個怪物節點，而不是寫死某個 id。
    const monster = solo.state.reachableNodeIds.find(id => solo.state.map.nodes[id].type === 'monster')
    expect(monster, '第一層應該要有怪物節點').toBeDefined()
    solo.enterNode(monster)
    expect(solo.state.phase).toBe('moveSelect')

    const before = solo.state.ai.hp
    expect(before).toBeGreaterThan(0)

    solo.pickMove('M1')
    // 這一行就是當初壞掉的地方：它會跑 hydrateEffectCtx。
    expect(() => solo.chooseSuccessOnly()).not.toThrow()

    vi.advanceTimersByTime(1500)
    expect(solo.state.ai.hp).toBeLessThan(before)
    vi.advanceTimersByTime(1500)
    expect(solo.state.turn).toBe('ai')
  })
})

describe('對戰模式：一個回合', () => {
  it('選招、判定成功，對手就會掉血', () => {
    const duel = useBattleState(movesRef)
    duel.resetGame()

    for (const key of ['A', 'B']) {
      const p = duel.state.players[key]
      p.character = CHAR
      p.moveIds = ['M1', 'M2', 'M3', 'M4']
      p.hp = p.maxHp = CHAR.hp
      p.locked = true
    }
    duel.startBattle('A')
    duel.setEnergyDice('A', [['かみなり', 'かみなり', 'かみなり', 'かみなり', 'かみなり', 'かみなり']])

    const before = duel.state.players.B.hp
    duel.pickMove('M1')
    duel.setDiceRollResult('立', ['かみなり'], true, null)

    // 對戰這邊的 resolveTurn 要求呼叫端自己算好 dmgInfo（DiceOverlay.vue 就是這樣傳的），
    // 單人爬塔那邊沒給會自己補算。兩邊的介面不一樣，這一行就是證據。
    const dmgInfo = duel.computeDisplayDamage(MOVES.M1, duel.state.players.A, duel.state.players.B)
    expect(() => duel.resolveTurn({ kind: 'success', dmgInfo })).not.toThrow()

    vi.advanceTimersByTime(1500)
    expect(duel.state.players.B.hp).toBeLessThan(before)
  })
})
