// How each character plays, as four ratings.
//
// 這五根是遊戲自己的概念，不是通用的 RPG 詞：
//   攻擊 attack  —— 角色骰沒幫忙也打得到的那一段，平常的輸出
//   爆擊 crit    —— 單招打得出來的最大一擊，機率低但打出來就很大
//   控制 control —— 動到「對方」的資源：抽能量骰、禁招、禁角色骰
//   耐久 endure  —— 撐得住多少：減傷、回血、避開攻擊，扣掉自己燒自己的
//   增益 boost   —— 動到「自己」的資源：多拿能量骰、重擲或指定自己的角色骰
//
// 攻擊跟爆擊要分開，是因為同一隻可以兩個都有：巨金怪平常就有輸出，四則配大爆炸是另外
// 一條線，混成一個數字就把它講成了一隻普通的輸出角。
//
// 曾經有第六根「穩定」（主力招多常付得出能量），拿掉了：攻擊本來就是「一招多大 ×
// 多常打得出來」，把右邊那個因子單獨拉成一根軸，等於同一件事講兩次。而且這遊戲的招式
// 定價本來就是貴的大、便宜的小（兩個因子相關 -0.53），拆開看會像在講同一件事的兩面。
//
// 順序讓攻擊與耐久分站兩邊（對方的血／自己的血），控制與增益相鄰（對方的資源／自己的
// 資源）。五根軸沒有正對面，所以靠的是相鄰關係，不是對角。
//
// 數值是判斷，不是量出來的。遊戲資料裡沒有任何一個欄位說某隻角色「很會控制」—— 那是
// 把牠的招式跟骰面一起讀出來的結論，而且講得通的人會有不同意見。所以它們由後台填，
// 存在資料庫裡，不是由程式算出來 —— 算出來只會把一個意見包裝成一個計算。
//
// 順序就是圖的形狀，改順序等於改掉每一隻角色的剪影，不是一串可以隨便排的清單。
// 軸名在伺服器那邊是字串，加一根、換一根只要改這一行。
import { ref } from 'vue'

const API_BASE = import.meta.env.VITE_API_URL || ''

export const TRAIT_AXES = ['attack', 'crit', 'control', 'endure', 'boost']

export const TRAIT_MIN = 0
export const TRAIT_MAX = 5
export const TRAIT_STEP = 0.5

// Keyed by character id, not by name. `characters` carries the name already translated into
// the reader's language, so a name key would resolve in Japanese and come up empty in Chinese
// and English — the chart would silently vanish for most readers. The id is the same in every
// locale, and is what the translation tables key off too.
const store = ref({})

export const characterTraits = store

/**
 * 跟伺服器要整份數值。所有人都讀得到，寫得動的只有後台。
 *
 * 拿不到就當作還沒填 —— 一張畫不出來的圖比「這隻還沒填」難懂得多。
 */
export async function refreshCharacterTraits() {
  try {
    const res = await fetch(`${API_BASE}/api/character-traits`)
    if (!res.ok) throw new Error(String(res.status))
    store.value = (await res.json()).traits || {}
  } catch (e) {
    store.value = {}
  }
}

/**
 * 這隻角色的五個數字，或 null（整隻都還沒填）。
 *
 * 填過但缺某一根軸的算 0：那是新加了一根軸、舊資料還沒跟上，圖上畫成 0 是對的 ——
 * 它確實還沒有被評過。整隻都沒有才是「還沒填」。
 */
export function traitsOf(id) {
  const row = store.value[id]
  if (!row) return null
  return Object.fromEntries(TRAIT_AXES.map(axis => [axis, Number(row[axis]) || 0]))
}

export function hasTraits(id) {
  return !!store.value[id]
}

/** 後台存檔之後把手上這份換掉，不用為了一隻角色再跟伺服器要一次整份。 */
export function applyTraits(id, traits) {
  store.value = { ...store.value, [id]: { ...traits } }
}

// Values outside the scale, or off the half-point grid, are a typo rather than something to
// render. The server rejects both, so this is here for the editor to say so before sending.
export function traitProblem(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '不是數字'
  if (v < TRAIT_MIN || v > TRAIT_MAX) return `超出 ${TRAIT_MIN}-${TRAIT_MAX}`
  if (Math.round(v / TRAIT_STEP) * TRAIT_STEP !== v) return `不是 ${TRAIT_STEP} 的倍數`
  return null
}
