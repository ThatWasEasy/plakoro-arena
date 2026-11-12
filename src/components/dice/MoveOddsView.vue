<script setup>
import { computed, inject, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { typeBgColor } from '../../data/constants'
import { asset } from '../../data/assetPath'
import { enumerateRolls, charaEffectOdds, jointOdds } from '../../game/energyPayment'
import { moveExpectedValue } from '../../game/moveExpectedValue'
import { buildTempoTable, selfDiceValues } from '../../game/tempoValue'
import { ASSUMED_ENEMY_LAST_DAMAGE } from '../../game/suggestedDice'
import MoveCard from '../MoveCard.vue'
import { exportElementAsPng } from '../../data/exportImage'

// Which dice sets exist upstream, and their labels, so this view can report a move's odds
// under each configuration side by side.
const props = defineProps({
  sets: { type: Array, required: true },
  setLabels: { type: Array, required: true },
  // Set when another screen opened this view for one character, so it lands on that
  // character's moves instead of the picker. Read once, at setup: after that the selection is
  // the player's, including their going back to the picker.
  initialCharacterId: { type: String, default: null }
})
const emit = defineEmits(['back'])

const { characters, moves } = inject('characterData')
const { t } = useI18n()

const selectedCharacterId = ref(props.initialCharacterId)
const selectedCharacter = computed(() =>
  characters.value.find(c => c.id === selectedCharacterId.value) || null
)

// How many times each die gets rolled. Some game rules let a player roll a die more than
// once, and it's the player's own call how many times each one goes — not just an on/off
// switch — so this is a per-die count, defaulting to 1 each (i.e. today's normal roll).
const diceCounts = ref([1, 1, 1])
const activeCount = computed(() => diceCounts.value.reduce((a, b) => a + b, 0))

// Each extra roll multiplies the outcome space by 6 (enumerateRolls is 6^n), so the per-die
// and total caps keep worst case (all 3 dice at MAX_PER_DIE) at 6^9 ≈ 10M — comfortably fast
// for a single synchronous pass, even doubled for a 2-set comparison.
const MAX_PER_DIE = 4
const MAX_TOTAL = 9

function incrementDie(index) {
  if (diceCounts.value[index] >= MAX_PER_DIE) return
  if (activeCount.value >= MAX_TOTAL) return
  diceCounts.value[index] += 1
}
function decrementDie(index) {
  // At least one roll has to stay in play for the odds to mean anything.
  if (diceCounts.value[index] <= 0) return
  if (diceCounts.value[index] <= 1 && activeCount.value <= 1) return
  diceCounts.value[index] -= 1
}

const hasCompare = computed(() => props.sets.length > 1)

// Rolling a die twice is statistically identical to two dice built the same way each rolled
// once, so a die just gets repeated in the list per its count.
function expandDiceByCounts(dice, counts) {
  const expanded = []
  dice.forEach((die, i) => {
    for (let n = 0; n < counts[i]; n++) expanded.push(die)
  })
  return expanded
}

// One roll-outcome list per dice set, covering each die as many times as it's set to roll.
const rollsPerSet = computed(() =>
  props.sets.map(set => enumerateRolls(expandDiceByCounts(set.dice, diceCounts.value)))
)

const showCounts = ref(false)
const showBreakdownDetail = ref(false)

// 逐顆加上去的讀數：只有骰 1、骰 1+2、全部。
//
// 組骰時真正的問題不是「這個配置多少成功率」，而是「第二顆、第三顆到底幫了多少」——
// 一招從 11% 變 56% 跟從 50% 變 56%，決定的是要不要為它多帶一顆骰。單一個最終數字
// 回答不了，自己把骰子一顆一顆減掉再看一次也不該是使用方式。
const showDiceRamp = ref(false)

// 要列哪幾階。次數是 0 的骰子不會自成一階 —— 那一階跟上一階是同一組骰，列出來只是噪音。
const rampSteps = computed(() => {
  if (!showDiceRamp.value) return []
  const counts = diceCounts.value
  const steps = []
  let prev = 0
  for (let k = 1; k <= counts.length; k++) {
    const used = counts.slice(0, k).reduce((a, b) => a + b, 0)
    if (used === 0 || used === prev) continue
    prev = used
    steps.push({ k, used })
  }
  // 只剩一階時整份不值得列 —— 那一階就是上面那個數字本身。
  return steps.length > 1 ? steps : []
})

// 每一階各自的擲骰結果空間。最後一階如果就是目前的完整配置，直接沿用 rollsPerSet：
// enumerateRolls 是 6^n，最大的那一份算兩次是這個畫面唯一真的會卡住的地方。
const rampRollsPerSet = computed(() =>
  props.sets.map((set, si) => rampSteps.value.map(step => (
    step.used === activeCount.value
      ? rollsPerSet.value[si]
      : enumerateRolls(expandDiceByCounts(set.dice, diceCounts.value.map((c, i) => (i < step.k ? c : 0))))
  )))
)

function rampLabel(step, i) {
  if (i === rampSteps.value.length - 1) return t('diceBuilder.moveOdds.rampAll')
  if (step.k === 1) return t('diceBuilder.moveOdds.rampOnly', { n: 1 })
  return t('diceBuilder.moveOdds.rampUpTo', { n: step.k })
}

// Premises the expected value depends on but the dice can't supply: a few moves only pay out
// below an HP threshold or after a particular previous turn, and the two kinds of non-damage
// worth are only counted if the player wants them counted.
//
// They all start on. The figures a player comes here for are "what is each of these moves
// worth", and the fullest reading of that is the useful default — anyone who wants the bare
// damage can switch a premise off, which is a cheaper action than discovering that six
// switches were quietly suppressing part of every number. 40 HP is the threshold the printed
// low-HP moves key off, so it's the value at which that premise means anything.
const showSettings = ref(false)
const sortByEv = ref(true)
// The same switch, stated the way a player thinks about it: "leave the list in card order".
// Two refs would be two sources of truth for one question and would eventually disagree.
const sortByNumber = computed({
  get: () => !sortByEv.value,
  set: v => { sortByEv.value = !v }
})
// 兩組以上的骰時，期望值排序要照哪一組。並排比較的重點常常是「B 把哪幾招推上來了」，
// 鎖死在 A 的話得自己在兩欄之間用眼睛重排一次。
const sortSetIndex = ref(0)
const countDefensiveValue = ref(true)
const countTempoValue = ref(true)
// 「期望值只算傷害」—— 設定面板裡那兩個折算開關的快捷鍵，外加扣掉回復。
// 回復沒有自己的開關（它不是折算，是真的回血），所以那一項是在 evaluate 裡減掉的。
const pureDamage = ref(false)
const selfHpText = ref('40')
const enemyLastDamageText = ref(String(ASSUMED_ENEMY_LAST_DAMAGE))
const prevEnemyFailed = ref(true)
const prevSelfFailed = ref(true)
const prevPrereqSucceeded = ref(true)
const prevSelfUnhurt = ref(true)
// 角色骰的兩種受限狀態。被禁用時整顆不擲，固定朝下時它不再是機率 —— 下面那一列判定
// 每次都成立，其餘每次都落空。兩個同時成立沒有意義（禁用了就沒有面可以固定），
// 所以禁用優先，面向那個會被停用。
const showDisplayOptions = ref(false)
const charaDieBlocked = ref(false)
const charaDieFaceDown = ref(false)
const CHARA_DIE_DOWN = '下'

// Pricing what a move denies the opponent means running the whole roster against itself
// several times over — about a second, enough to drop frames. It's held outside
// the reactive graph and built once after the first paint, so the list appears immediately
// and the tempo terms join it a moment later rather than delaying everything.
const tempoTable = shallowRef(null)
const tempoPending = ref(false)

function ensureTempoTable() {
  if (tempoTable.value || tempoPending.value) return
  tempoPending.value = true
  setTimeout(() => {
    tempoTable.value = buildTempoTable(characters.value, moves.value)
    tempoPending.value = false
  }, 0)
}

onMounted(() => {
  if (countTempoValue.value) ensureTempoTable()
})
watch(countTempoValue, on => {
  if (on) ensureTempoTable()
})

const waitingForTempo = computed(() => countTempoValue.value && !tempoTable.value)

// 換算表攤開來給人看。節奏價值是整個期望值裡唯一「不是從卡面數字直接推出來」的一項，
// 藏著它等於要讀的人相信一個沒寫出來的常數 —— 擺在計算前提裡，至少改不改得動是一回事，
// 知不知道它是多少是另一回事。`self` 是 null 的列代表那個效果只會落在對手身上。
const TEMPO_ROWS = [
  { key: 'denyDice1', label: 'tempoDenyDice1', self: true },
  { key: 'denyDice2', label: 'tempoDenyDice2', self: true },
  { key: 'denyCharaDie', label: 'tempoDenyCharaDie', self: true },
  { key: 'denyDice2AndChara', label: 'tempoDenyDice2AndChara', self: false },
  { key: 'nullifyDamage', label: 'tempoNullifyDamage', self: false },
  { key: 'bindMove', label: 'tempoBindMove', self: false },
  { key: 'gainDice1', label: 'tempoGainDice1', self: true },
  { key: 'gainDice2', label: 'tempoGainDice2', self: true },
  { key: 'forcedReroll1', label: 'tempoForcedReroll1', self: false },
  { key: 'forcedReroll2', label: 'tempoForcedReroll2', self: false }
]
const tempoPriceRows = computed(() => {
  const table = tempoTable.value
  if (!table) return []
  return TEMPO_ROWS.map(row => ({
    label: t(`diceBuilder.moveOdds.${row.label}`),
    enemy: table[row.key],
    self: selfTempoPerSet.value.map(own => (row.self && own ? own[row.key] : null))
  }))
})

// 對手那張表是「對最強幾隻的平均」，因為對手是誰不知道。自己少一顆骰值多少則沒有未知數
// —— 選了誰、帶了哪組骰子，這個畫面上都有，所以針對自己的效果用算得出來的那個數字。
// 一組骰子一份；牌組只有四張，比整張對手表便宜兩個數量級，不用延後到 paint 之後。
const selfTempoPerSet = computed(() => {
  const character = selectedCharacter.value
  if (!character || !tempoTable.value) return props.sets.map(() => null)
  return props.sets.map(set => selfDiceValues(character, moves.value, set.dice, tempoTable.value))
})

// Left blank, HP conditions stay unmet and say so on the affected moves, rather than the
// view quietly picking a number on the player's behalf.
const selfHp = computed(() => {
  const parsed = parseInt(selfHpText.value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
})

// Cleared, the move that copies the opponent's last attack goes back to being uncountable
// rather than the view inventing a number for it.
const enemyLastDamage = computed(() => {
  const parsed = parseInt(enemyLastDamageText.value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
})

// A note earns its line only by saying something the screen doesn't already. The move's own
// card sits directly below the figure and the breakdown sits directly above it, so anything
// those two already state is left out: `tempo` (the card spells out what a dice-count change
// or move lock does), `unknown` (the card says it copies the opponent's move, or nullifies
// their damage), and `defensive` (the breakdown itemises the reduction as a number). What is
// left is the four things only the calculation knows about its own assumptions.
const NOTE_LABEL_KEYS = {
  needsHp: 'noteNeedsHp',
  needsPrev: 'noteNeedsPrev',
  mirrorDice: 'noteMirrorDice',
  // Shown even though the breakdown itemises the figure, unlike `defensive`: the number
  // there is already capped by the HP premise, and without this nothing says that a heal is
  // worth its printed value only to someone who is actually that hurt.
  heal: 'noteHeal',
  unsupported: 'noteUnsupported'
}

function pct(payable, total) {
  return (payable / total * 100).toFixed(1)
}

function oddsText(payable, total) {
  const percentage = `${pct(payable, total)}%`
  return showCounts.value ? `${payable}/${total}（${percentage}）` : percentage
}

// The move's own success rate, then one more figure per character-die effect it has (joint
// with that effect actually landing) — slash-joined into one number so the two readings sit
// together without needing the die's own orientation icons repeated up here.
//
// 吃的是一組機率而不是一整列，因為骰子階梯要用同一份寫法把每一階都印成這個樣子 ——
// 階梯只印招式本身的成功率的話，「多帶一顆骰幫了多少」只回答得了一半：卡片下半部那
// 幾條角色骰效果，才是多數招式真正在等的東西。
function successText(moveOdds, charaOddsList) {
  const parts = [oddsText(moveOdds.payable, moveOdds.total)]
  charaOddsList.forEach(charaOdds => {
    const j = jointOdds(moveOdds, charaOdds)
    parts.push(oddsText(j.payable, j.total))
  })
  // Counts-on readings already contain their own "/" (as in "120/216"), so joining those with
  // "/" too reads as one long ambiguous fraction. "・" stays a list separator either way; plain
  // percentages have no "/" of their own, so "/" is left alone there since it's shorter and
  // already unambiguous.
  return parts.join(showCounts.value ? '・' : '/')
}

// Rounding leaves the odd -0.00000001 behind, which would print as a startling "-0.0".
function clean(value) {
  return Math.abs(value) < 0.05 ? 0 : value
}

function evText(value) {
  return clean(value).toFixed(1)
}

function signedText(value) {
  const rounded = clean(value)
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`
}

// Where a move's expected value comes from. The parts are signed and add up to the headline
// figure, so the line reads as its arithmetic rather than as four loose statistics: the
// printed damage first, then what the character die is worth on top, then whatever the move
// costs or gives back in own HP. Parts worth nothing are dropped instead of printing zeroes.
//
// One entry is not an addend: the damage subtotal restates what the two damage parts before
// it come to, because once a move also charges its own HP the reader can no longer see what
// it actually deals without adding two figures in their head. Unsigned is what marks it as a
// running total — every term that really is added to the line carries its sign.
//
// It earns its place only when it says something neither neighbour already does, which needs
// both halves of the sum present AND something non-damage after it (own HP, damage
// reduction, or what the move denies the opponent). With no character-die
// share it would merely repeat the printed damage; with nothing following it, it would be the
// last number on the line, where the damage total is already the only thing on show. That
// also keeps the line at today's length everywhere except the one case it exists to help —
// worth having, since it is set `nowrap` in a grid column it must not outgrow.
function breakdownText(result) {
  const parts = [`${t('diceBuilder.moveOdds.evPartBase')} ${evText(result.evDamageBase)}`]
  const splitDamage = clean(result.evDamageChara) !== 0
  const hasDefensive = clean(result.evDefensive) !== 0
  const hasHeal = clean(result.evHeal) !== 0
  const hasSelf = clean(result.evSelf) !== 0
  const hasTempo = clean(result.evTempo) !== 0
  if (splitDamage) {
    parts.push(`${t('diceBuilder.moveOdds.evPartChara')} ${signedText(result.evDamageChara)}`)
  }
  if (splitDamage && (hasDefensive || hasHeal || hasSelf || hasTempo)) {
    parts.push(`${t('diceBuilder.moveOdds.evPartDamageTotal')} ${evText(result.evDamage)}`)
  }
  if (hasDefensive) {
    parts.push(`${t('diceBuilder.moveOdds.evPartDefensive')} ${signedText(result.evDefensive)}`)
  }
  if (hasHeal) {
    parts.push(`${t('diceBuilder.moveOdds.evPartHeal')} ${signedText(result.evHeal)}`)
  }
  if (hasSelf) {
    parts.push(`${t('diceBuilder.moveOdds.evPartSelf')} ${signedText(-result.evSelf)}`)
  }
  if (clean(result.evTempo) !== 0) {
    parts.push(`${t('diceBuilder.moveOdds.evPartTempo')} ${signedText(result.evTempo)}`)
  }
  return parts.join('　')
}

// Nothing to break down when the printed damage is the whole story.
function hasBreakdown(result) {
  return clean(result.evDamageChara) !== 0 || clean(result.evSelf) !== 0 ||
    clean(result.evDefensive) !== 0 || clean(result.evHeal) !== 0 || clean(result.evTempo) !== 0
}

// Every move the character has, in the order the roster defines — including ones that are
// unpayable with the current dice, since "this build can't cast it at all" is the point.
const moveRows = computed(() => {
  const character = selectedCharacter.value
  if (!character) return []
  // 同一套前提，只有擲骰空間不同 —— 抽出來，骰子階梯才不用把這一大包抄第二份，
  // 也才不會有「主數字算了防禦價值、階梯沒算」這種兩邊前提悄悄走岔的情形。
  const evaluateRaw = (mv, rolls, si) => moveExpectedValue(mv, {
    rolls,
    // The one move that makes the opponent throw energy dice has no other build to go on,
    // so it assumes a mirror of this set and flags that it did.
    enemyDice: props.sets[si].dice,
    charaDiceInPlay: !charaDieBlocked.value,
    charaDieFace: !charaDieBlocked.value && charaDieFaceDown.value ? CHARA_DIE_DOWN : null,
    selfHp: selfHp.value,
    // The character's own printed HP, so a heal can be capped at what is actually missing
    // rather than counted at its face value.
    maxHp: character.hp ?? null,
    enemyLastDamage: enemyLastDamage.value,
    prev: {
      enemyMoveFailed: prevEnemyFailed.value,
      selfMoveFailed: prevSelfFailed.value,
      prereqMoveSucceeded: prevPrereqSucceeded.value,
      selfUnhurt: prevSelfUnhurt.value
    },
    countDefensiveValue: countDefensiveValue.value && !pureDamage.value,
    tempoValues: countTempoValue.value && !pureDamage.value ? tempoTable.value : null,
    selfTempoValues: countTempoValue.value && !pureDamage.value ? selfTempoPerSet.value[si] : null
  })

  // 折算類的兩項靠前提關掉（引擎本來就會連帶不產生那些註記），回復只能在這裡扣。
  // 自傷留著 —— 那也是傷害，只是方向相反。
  const evaluate = (mv, rolls, si) => {
    const result = evaluateRaw(mv, rolls, si)
    if (!pureDamage.value || result.evHeal === 0) return result
    return { ...result, evHeal: 0, ev: result.ev - result.evHeal }
  }

  const rows = character.moves.map(id => moves.value[id]).filter(Boolean).map(mv => {
    // moveExpectedValue reports the payability it had to work out anyway, so the success
    // rate and the expected value share a single pass over the roll space.
    const evs = rollsPerSet.value.map((rolls, si) => evaluate(mv, rolls, si))
    const odds = evs.map(result => result.odds)
    const noteKinds = [...new Set(evs.flatMap(result => result.notes.map(note => note.kind)))]
    return {
      mv,
      odds,
      evs,
      // Drives whether the breakdown is shown or merely held open — the cards sit in a
      // two-column grid, so a line that appears on one move and not its neighbour would
      // knock the two cards out of alignment.
      showBreakdown: evs.some(hasBreakdown),
      // 一顆一顆加上去的讀數。關掉時 rampSteps 是空的，整段不會進到計算。
      ramp: rampSteps.value.map((step, ri) => ({
        label: rampLabel(step, ri),
        perSet: rampRollsPerSet.value.map((rolls, si) => evaluate(mv, rolls[ri], si))
      })),
      noteKeys: noteKinds.map(kind => NOTE_LABEL_KEYS[kind]).filter(Boolean),
      // 角色骰自己的面數，與能量骰無關 —— 每一組骰、每一階骰數都是同一份，聯合機率在
      // 要印的時候才跟當下那組成功率相乘。
      charaOddsList: mv.chara.map(ce => charaEffectOdds(ce.orientations))
    }
  })
  // 並排的兩組骰只能有一個順序，照哪一組由玩家挑（預設 A，比較本來就是以它為基準）。
  // 夾一下上限：這個畫面是 v-if 掛上來的，骰組在它開著的時候不會變，但讀到不存在的那
  // 一組會是 undefined.ev —— 整份排序連同畫面一起垮，不值得賭在別處的掛載方式不變。
  if (sortByEv.value) {
    const si = Math.min(sortSetIndex.value, rollsPerSet.value.length - 1)
    rows.sort((a, b) => b.evs[si].ev - a.evs[si].ev)
  }
  return rows
})

// Snapshots the character header + dice controls + move list as a PNG, so a player can share
// exactly the reading they're looking at (this build, this character) without a screenshot
// tool cropping in the surrounding UI chrome. Excludes the "Back" button below it on purpose —
// that control has no meaning once this is a static image.
const exportTargetRef = ref(null)
const exporting = ref(false)

async function exportImage() {
  if (!exportTargetRef.value || exporting.value) return
  exporting.value = true
  try {
    // 等 .odds-exporting 真的套上去再截圖，否則截到的還是釘住的狀態。
    await nextTick()
    await exportElementAsPng(exportTargetRef.value, `plakoro-move-odds-${selectedCharacter.value.name}`)
  } finally {
    exporting.value = false
  }
}

</script>

<template>
  <!-- padding-top 歸零：捲動容器的上緣內距是在捲動區「裡面」的，內容會從那條縫底下經過，
       釘住的表頭上方就會有一條滑動的字。標題本來就有自己的 margin，少這 0.625rem 不影響。 -->
  <div class="board select-board" style="overflow-y:auto; align-items:center; padding-top:0;">
    <div class="modal-title" style="margin:0.5rem 0 0.25rem;">{{ t('diceBuilder.moveOdds.title') }}</div>

    <!-- character picker -->
    <template v-if="!selectedCharacter">
      <div class="grid-2">
        <div v-for="c in characters" :key="c.id" class="pick-card" @click="selectedCharacterId = c.id">
          <div class="pick-top" :style="{ background: typeBgColor(c.type) }">
            <div class="pick-type-icon"><img :src="asset(`image/ICON/${c.type}.png`)" class="img-icon" :alt="c.type"></div>
            <div class="ic"><img :src="c.imageUrl || asset(`image/CHARA/${c.name}.png`)" class="img-icon" :alt="c.name"></div>
          </div>
          <div class="pick-bottom">
            <div class="nm-row"><span class="nm">{{ c.name }}</span></div>
          </div>
        </div>
      </div>
      <div style="display:flex; justify-content:center; padding:0.875rem 0 0.25rem;">
        <button class="btn secondary" @click="emit('back')">{{ t('common.back') }}</button>
      </div>
    </template>

    <!-- odds table -->
    <template v-else>
      <div
        ref="exportTargetRef"
        :class="{ 'odds-exporting': exporting }"
        style="display:flex; flex-direction:column; align-items:center; width:100%;"
      >
      <!-- A column, not a space-between row: each of these is its own line (who is selected,
           which dice are in play, what the table shows). Side by side they shared a line and
           re-flowed into each other at every width. -->
      <!-- 誰被選到：捲走就捲走，往下讀的時候封面上就只有那隻的招式，不會記錯。 -->
      <div class="odds-who">
        <div style="display:flex; align-items:center; gap:0.375rem;">
          <div style="width:2rem; height:2rem; border-radius:0.375rem; overflow:hidden; flex-shrink:0;">
            <img :src="selectedCharacter.imageUrl || asset(`image/CHARA/${selectedCharacter.name}.png`)" class="img-icon" :alt="selectedCharacter.name">
          </div>
          <span style="font-size:0.875rem; font-weight:800;">{{ selectedCharacter.name }}</span>
          <button class="btn secondary" style="padding:0.1875rem 0.5rem; font-size:0.625rem;" @click="selectedCharacterId = null">{{ t('diceBuilder.moveOdds.changeCharacter') }}</button>
        </div>
      </div>

      <div class="odds-head">
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <span style="font-size:0.75rem; font-weight:800; color:var(--sub);">{{ t('diceBuilder.moveOdds.diceInPlay') }}</span>
          <div
            v-for="(count, di) in diceCounts"
            :key="di"
            style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub);"
          >
            <span>{{ t('diceBuilder.die', { n: di + 1 }) }}</span>
            <button
              type="button"
              @click="decrementDie(di)"
              style="width:1rem; height:1rem; line-height:1; border:1px solid var(--line); border-radius:0.25rem; background:#fff; font-weight:800; cursor:pointer; padding:0;"
            >−</button>
            <span style="min-width:0.75rem; text-align:center; color:var(--ink);">{{ count }}</span>
            <button
              type="button"
              @click="incrementDie(di)"
              style="width:1rem; height:1rem; line-height:1; border:1px solid var(--line); border-radius:0.25rem; background:#fff; font-weight:800; cursor:pointer; padding:0;"
            >+</button>
          </div>
        </div>

        <!-- 排序自成一行，標題跟上面的擲骰數同一個字級：兩者都在講「這張表是怎麼算出來、
             怎麼排出來的」，跟下面那排「畫面上要顯示什麼」不是同一件事。
             照哪一組骰排，只有兩組以上時才有得選；照編號排的時候與骰組無關。 -->
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <span style="font-size:0.75rem; font-weight:800; color:var(--sub);">{{ t('diceBuilder.moveOdds.sortLabel') }}</span>
          <label style="display:flex; align-items:center; gap:0.1875rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="sortByNumber" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.sortByNumber') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.1875rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="sortByEv" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.sortBySet') }}
          </label>
          <!-- 下拉放在 label 外面：包進去的話點開選單等於點到那個勾選框。 -->
          <select v-if="hasCompare && sortByEv" v-model.number="sortSetIndex" class="odds-sort-select">
            <option v-for="(label, si) in setLabels" :key="si" :value="si">{{ t('diceBuilder.set', { label }) }}</option>
          </select>
        </div>

        <!-- What the table shows, kept off the dice line above. Those steppers are the thing
             being adjusted most often, and burying them behind a row of checkboxes that wrap
             differently at every width made them hard to find twice in a row. -->
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
          <label style="display:flex; align-items:center; gap:0.1875rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="pureDamage" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.pureDamage') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.1875rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="charaDieBlocked" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.charaDieBlocked') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.1875rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;"
                 :style="{ opacity: charaDieBlocked ? 0.45 : 1 }">
            <input type="checkbox" v-model="charaDieFaceDown" :disabled="charaDieBlocked" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.charaDieFaceDown') }}
          </label>
          <button class="btn secondary" style="padding:0.1875rem 0.5rem; font-size:0.625rem;" @click="showDisplayOptions = !showDisplayOptions">
            {{ t('diceBuilder.moveOdds.displayOptions') }}
          </button>
          <button class="btn secondary" style="padding:0.1875rem 0.5rem; font-size:0.625rem;" @click="showSettings = !showSettings">
            {{ t('diceBuilder.moveOdds.settings') }}
          </button>
          <button class="btn secondary" style="padding:0.1875rem 0.5rem; font-size:0.625rem;" :disabled="exporting" @click="exportImage">
            {{ exporting ? t('diceBuilder.moveOdds.exportingImage') : t('diceBuilder.moveOdds.exportImage') }}
          </button>
        </div>

        <!-- 純粹改變清單長相的兩個，收在自己的按鈕裡 —— 它們不影響任何數字，
             跟旁邊那些會改變算法的前提擺在一起只會讓那一排更難掃。 -->
        <div v-if="showDisplayOptions" class="odds-settings">
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="showBreakdownDetail" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.showBreakdownDetail') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="showCounts" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.showCountsLabel') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="showDiceRamp" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.showDiceRamp') }}
          </label>
        </div>

        <!-- what the expected value is allowed to assume; folded away because the defaults are
             the honest ones and most players never need to touch them.
             在 .odds-head 裡面，不是它的兄弟 —— 放外面的話，捲到清單中段再點開，面板是
             展開在文件原本的位置（早就捲出畫面上方了），按下去看起來像沒反應。 -->
        <div
          v-if="showSettings"
          class="odds-settings"
        >
        <div style="display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;"
                 :style="{ opacity: pureDamage ? 0.45 : 1 }">
            <input type="checkbox" v-model="countDefensiveValue" :disabled="pureDamage" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.countDefensive') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;"
                 :style="{ opacity: pureDamage ? 0.45 : 1 }">
            <input type="checkbox" v-model="countTempoValue" :disabled="pureDamage" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.countTempo') }}
            <span v-if="waitingForTempo" style="font-weight:700;">{{ t('diceBuilder.moveOdds.tempoCalculating') }}</span>
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub);">
            {{ t('diceBuilder.moveOdds.enemyLastDamageLabel') }}
            <input
              type="number"
              min="0"
              v-model="enemyLastDamageText"
              :placeholder="t('diceBuilder.moveOdds.selfHpAny')"
              style="width:4.5rem; font-size:0.625rem; font-weight:800; padding:0.125rem 0.25rem; border:0.0625rem solid var(--line); border-radius:0.25rem; background:#fff; color:var(--ink);"
            >
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub);">
            {{ t('diceBuilder.moveOdds.selfHpLabel') }}
            <input
              type="number"
              min="0"
              v-model="selfHpText"
              :placeholder="t('diceBuilder.moveOdds.selfHpAny')"
              style="width:4.5rem; font-size:0.625rem; font-weight:800; padding:0.125rem 0.25rem; border:0.0625rem solid var(--line); border-radius:0.25rem; background:#fff; color:var(--ink);"
            >
          </label>
        </div>
        <div style="display:flex; flex-direction:column; gap:0.1875rem;">
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="prevEnemyFailed" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.prevEnemyFailed') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="prevSelfFailed" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.prevSelfFailed') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="prevPrereqSucceeded" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.prevPrereqSucceeded') }}
          </label>
          <label style="display:flex; align-items:center; gap:0.25rem; font-size:0.625rem; font-weight:800; color:var(--sub); cursor:pointer;">
            <input type="checkbox" v-model="prevSelfUnhurt" style="width:0.75rem; height:0.75rem; margin:0;">
            {{ t('diceBuilder.moveOdds.prevSelfUnhurt') }}
          </label>
        </div>
          <div v-if="countTempoValue && !pureDamage && tempoPriceRows.length" class="odds-tempo">
            <div class="odds-tempo-title">{{ t('diceBuilder.moveOdds.tempoPricesTitle') }}</div>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>{{ t('diceBuilder.moveOdds.tempoColEnemy') }}</th>
                  <th v-for="(set, si) in sets" :key="si">
                    {{ sets.length > 1 ? t('diceBuilder.moveOdds.tempoColSelfSet', { n: si + 1 }) : t('diceBuilder.moveOdds.tempoColSelf') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in tempoPriceRows" :key="row.label">
                  <td class="odds-tempo-label">{{ row.label }}</td>
                  <td>{{ row.enemy.toFixed(1) }}</td>
                  <td v-for="(value, si) in row.self" :key="si">{{ value === null ? '—' : value.toFixed(1) }}</td>
                </tr>
              </tbody>
            </table>
            <div class="odds-tempo-hint">{{ t('diceBuilder.moveOdds.tempoPricesHint') }}</div>
          </div>
          <div style="font-size:0.5625rem; font-weight:600; color:var(--sub); line-height:1.5;">
            {{ t('diceBuilder.moveOdds.evHint') }}
          </div>
        </div>
      </div>

      <div style="width:100%; max-width:40rem; padding:0 0.625rem;">
        <div class="move-pick-list">
          <div v-for="row in moveRows" :key="row.mv.id" style="display:flex; flex-direction:column; gap:0.25rem; min-width:0;">
            <!-- one row per dice set, success rate on its left edge and expected value on its
                 right edge; a single set already fills the width on its own, and a second
                 set gets its own row underneath rather than squeezing both into one line -->
            <div style="display:flex; flex-direction:column; gap:0.125rem;">
              <!-- Counts make the success reading long, sometimes several payable/total pairs
                   long — one per character-die effect — so it stacks above the expected value
                   instead of sharing a line with it, which is what used to send the two
                   crashing into each other once the text outgrew the row's width. -->
              <div
                v-for="(o, si) in row.odds"
                :key="si"
                :style="{
                  display: 'flex',
                  flexDirection: showCounts ? 'column' : 'row',
                  alignItems: showCounts ? 'flex-start' : 'center',
                  justifyContent: showCounts ? 'flex-start' : 'space-between',
                  gap: showCounts ? '0.125rem' : '0.5rem',
                  padding: '0 0.125rem'
                }"
              >
                <div style="display:flex; align-items:baseline; flex-wrap:wrap; gap:0.25rem; min-width:0;">
                  <span v-if="hasCompare" style="font-size:0.5625rem; font-weight:800; color:var(--sub); flex-shrink:0;">{{ setLabels[si] }}</span>
                  <span style="font-size:0.5625rem; font-weight:800; color:var(--sub); flex-shrink:0;">{{ t('diceBuilder.moveOdds.successRate') }}</span>
                  <!-- the move's own success rate, joined with one more figure per character-die
                       effect it has (joint with that effect actually landing too) -->
                  <span :style="{ fontSize: '0.8125rem', fontWeight: 900, whiteSpace: showCounts ? 'normal' : 'nowrap', color: o.payable === 0 ? 'var(--line)' : 'var(--ink)' }">{{ successText(row.odds[si], row.charaOddsList) }}</span>
                </div>

                <!-- the headline figure: what the move is worth per cast -->
                <div style="display:flex; align-items:baseline; gap:0.25rem; min-width:0;">
                  <span style="font-size:0.5625rem; font-weight:800; color:var(--sub); flex-shrink:0;">{{ t('diceBuilder.moveOdds.expectedValue') }}</span>
                  <span :style="{ fontSize: '0.8125rem', fontWeight: 900, whiteSpace: 'nowrap', color: row.evs[si].ev === 0 ? 'var(--line)' : 'var(--ink)' }">{{ evText(row.evs[si].ev) }}</span>
                </div>
              </div>
            </div>

            <!-- 一顆一顆加上去的讀數，每一階各自的成功率與期望效益。放在主讀數底下、
                 卡片上方：它是同一個數字的展開，不是另一段獨立資訊。 -->
            <div v-if="row.ramp.length" class="odds-ramp" :class="{ wide: showCounts }">
              <div v-for="(step, ri) in row.ramp" :key="ri" class="odds-ramp-row">
                <span class="odds-ramp-label">{{ step.label }}</span>
                <template v-for="(result, si) in step.perSet" :key="si">
                  <span v-if="hasCompare" class="odds-ramp-set">{{ setLabels[si] }}</span>
                  <span :class="['odds-ramp-pct', { nil: result.odds.payable === 0 }]">
                    {{ successText(result.odds, row.charaOddsList) }}
                  </span>
                  <span :class="['odds-ramp-ev', { nil: clean(result.ev) === 0 }]">{{ evText(result.ev) }}</span>
                </template>
              </div>
            </div>

            <!-- where that figure came from, shown only on request — turned off by default
                 like showCounts, since most players read the headline figure and move on.
                 One line per dice set whether or not it has anything to say, so every card
                 in the grid starts at the same height. -->
            <div
              v-if="showBreakdownDetail"
              :style="{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '0.0625rem',
                padding: '0 0.125rem',
                fontSize: '0.5625rem',
                fontWeight: 700,
                color: 'var(--sub)',
                visibility: row.showBreakdown ? 'visible' : 'hidden'
              }"
              :aria-hidden="!row.showBreakdown"
            >
              <div v-for="(result, si) in row.evs" :key="si" style="white-space:nowrap;">
                <span v-if="hasCompare" style="font-weight:800;">{{ setLabels[si] }} </span>{{ breakdownText(result) }}
              </div>
            </div>

            <!-- 日文原名只在這裡印：這是查表用的畫面，對照日文卡表、跟別人講哪一招的時候，
                 中文譯名對不上印刷品。日文介面下 name 就是原名，再印一次只是重複。 -->
            <div class="odds-card">
              <MoveCard
                :mv="row.mv"
                :sub-name="row.mv.nameJa !== row.mv.name ? row.mv.nameJa : ''"
                :clickable="false"
              />
            </div>

            <!-- what the figure above had to assume, or had to leave out -->
            <div v-if="row.noteKeys.length > 0" style="display:flex; flex-direction:column; gap:0.0625rem; padding:0 0.125rem;">
              <div
                v-for="key in row.noteKeys"
                :key="key"
                style="font-size:0.5rem; font-weight:700; color:var(--sub); line-height:1.4;"
              >＊{{ t(`diceBuilder.moveOdds.${key}`) }}</div>
            </div>
          </div>
        </div>
      </div>
      </div>

      <!-- 兩條退路分開給：看完一隻想換下一隻看，跟看完想回去改骰子，是兩件不同的事，
           以前共用一顆「返回」等於每次都要多繞一層選單。 -->
      <div style="display:flex; justify-content:center; gap:0.5rem; flex-wrap:wrap; padding:0.875rem 0 0.25rem;">
        <button class="btn secondary" @click="selectedCharacterId = null">{{ t('diceBuilder.moveOdds.backToCharacters') }}</button>
        <button class="btn secondary" @click="emit('back')">{{ t('diceBuilder.moveOdds.backToBuilder') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.odds-who {
  width: 100%; max-width: 40rem;
  padding: 0 0.625rem 0.375rem;
}
/* 參與擲骰那排以下（骰子數量、顯示選項）釘在捲動區最上面，只讓招式清單捲動。
   這兩排是調整用的，會一邊看數字一邊改；上面「是誰」那排捲走沒差，往下讀的時候
   畫面上就只剩那隻的招式，不會記錯。
   用 sticky 而不是改成「固定表頭 + 內層捲動容器」：內層捲動會把匯出圖片裁成可視範圍，
   而這張圖的重點正是整份清單。sticky 不切斷文件流，匯出照樣是完整的。 */
.odds-head {
  position: sticky;
  /* 0 對齊的是捲動容器的 padding box 上緣 —— 貼齊最上方，上面不會留一條縫讓文字穿過去。 */
  top: 0;
  z-index: 2;
  display: flex; flex-direction: column; gap: 0.375rem;
  width: 100%; max-width: 40rem;
  padding: 0.375rem 0.625rem 0.5rem;
  background: var(--bg);
  border-bottom: 0.0625rem solid var(--line);
}
/* 前提面板。釘住的區塊會因為它變高，所以給一個上限再自己捲，
   免得在手機上整個畫面都被表頭吃掉、看不到底下的招式。 */
.odds-settings {
  padding: 0.5rem 0.625rem;
  border: 0.0625rem solid var(--line);
  border-radius: 0.5rem;
  display: flex; flex-direction: column; gap: 0.375rem;
  max-height: 45vh; max-height: 45dvh;
  overflow-y: auto;
}
.odds-tempo { display: flex; flex-direction: column; gap: 0.1875rem; }
.odds-tempo-title { font-size: 0.5625rem; font-weight: 800; color: var(--sub); }
.odds-tempo table {
  border-collapse: collapse;
  font-size: 0.5625rem; font-weight: 800; color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.odds-tempo th, .odds-tempo td {
  padding: 0.125rem 0 0.125rem 0.75rem;
  text-align: right; white-space: nowrap;
}
.odds-tempo th { font-weight: 800; color: var(--sub); }
/* 名稱靠左、數字靠右，短名稱那幾列中間會空一大段，眼睛接不起來。
   每列拉一條虛線把兩端連住 —— 比把數字也靠左好，欄位對齊才能上下比。 */
.odds-tempo tbody tr { border-bottom: 0.0625rem dotted var(--line); }
.odds-tempo tbody tr:last-child { border-bottom: 0; }
.odds-tempo th:first-child, .odds-tempo .odds-tempo-label {
  text-align: left; color: var(--sub); font-weight: 700; padding-left: 0;
}
.odds-tempo td:not(.odds-tempo-label) { min-width: 2.5rem; }
.odds-tempo-hint { font-size: 0.5625rem; font-weight: 600; color: var(--sub); line-height: 1.5; }
/* 匯出時攤平。html2canvas 是照版面位置畫的，釘住的元素會疊在清單開頭上面。 */
.odds-exporting .odds-head { position: static; border-bottom: 0; }

/* The odds are the point of this view, so the card is scaled down to a reference thumbnail.
   MoveCard sizes everything in rem (root-relative), so a parent font-size can't scale it —
   each size has to be overridden explicitly. */
.odds-card :deep(.move-card) { min-height: 7.25rem; }
.odds-card :deep(.mc-top) { padding: 0.25rem 0.375rem 0.1875rem; }
.odds-card :deep(.mc-bottom) { padding: 0.125rem 0.375rem 0.25rem; }
.odds-card :deep(.mc-type-icon) { width: 1.125rem; height: 1.125rem; }
.odds-card :deep(.mc-name-big) { font-size: 0.8125rem; }
.odds-card :deep(.mc-name-ja) { font-size: 0.5625rem; }

/* 照哪一組骰排。長得跟旁邊那兩個勾選項同一個分量 —— 它是同一排的設定，不是主按鈕。 */
.odds-sort-select {
  padding: 0.0625rem 0.25rem;
  border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: #fff; color: var(--ink);
  font: inherit; font-size: 0.625rem; font-weight: 800; cursor: pointer;
}

/* 骰子階梯。欄位對齊成一張小表，三行要能用掃的看出「第二顆加了多少」—— 數字各自
   靠左擺的話，就得一行一行讀。 */
.odds-ramp {
  display: flex; flex-direction: column; gap: 0.0625rem;
  margin: 0.125rem 0.125rem 0;
  padding: 0.1875rem 0.25rem;
  border-left: 0.125rem solid var(--line);
  font-size: 0.5625rem; font-weight: 700; color: var(--sub);
}
.odds-ramp-row { display: flex; align-items: baseline; gap: 0.25rem; }
/* 讀數比預期長的時候讓標題先讓位 —— 被切掉半個「全部骰子」還讀得出來，數字被壓住就不行。 */
.odds-ramp-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.odds-ramp-set { flex: none; font-weight: 800; }
.odds-ramp-pct, .odds-ramp-ev {
  flex: none; text-align: right; color: var(--ink);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.odds-ramp-pct { min-width: 2.75rem; }
.odds-ramp-ev { min-width: 2rem; }
.odds-ramp-pct.nil, .odds-ramp-ev.nil { color: var(--line); }

/* 顯示次數時一個讀數就是「66/216（30.6%）・198/1296（15.3%）」那麼長，三欄排不回一行。
   標題自己一行、數字接在下面 —— 跟上方主讀數在同一個開關下改成直排是同一個決定。 */
.odds-ramp.wide .odds-ramp-row { flex-wrap: wrap; }
.odds-ramp.wide .odds-ramp-label { flex: 1 1 100%; }
.odds-ramp.wide .odds-ramp-pct {
  flex: 1 1 auto; min-width: 0; text-align: left; white-space: normal;
}
/* 換行後期望效益會自己落成一行，推到右邊才看得出它是那一階的另一欄，而不是被遺忘的數字。 */
.odds-ramp.wide .odds-ramp-ev { margin-left: auto; }
.odds-card :deep(.cost-dot) { width: 0.8125rem; height: 0.8125rem; }
.odds-card :deep(.mc-dmg) { font-size: 1rem; }
.odds-card :deep(.mc-dmg .orig) { font-size: 0.5rem; }
.odds-card :deep(.mc-effect) { font-size: 0.5rem; }
.odds-card :deep(.mc-chara-row) { font-size: 0.5rem; gap: 0.1875rem; padding-top: 0.125rem; }
.odds-card :deep(.mc-chara-row .oi) { width: 0.75rem; height: 0.75rem; }
</style>
