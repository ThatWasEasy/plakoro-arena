import { ref, computed } from 'vue'
import { preloadEssentialImages, preloadCharacterImages } from '../data/imagePreload'
import { i18n } from '../i18n'
import { asset } from '../data/assetPath'
import charaGenerated from '../data/generated/chara.json'
import wazaGenerated from '../data/generated/waza.json'
import localCards from '../data/localCards.json'
import { reportEffectCoverage } from '../game/effectCoverage'
import translationsEn from '../data/translations/en.json'
import translationsZhTW from '../data/translations/zh-TW.json'

const TRANSLATIONS = { en: translationsEn, 'zh-TW': translationsZhTW }

// Two sources, and the split is not cosmetic: `generated/` is overwritten wholesale by
// `npm run fetch-data`, so anything written there by hand is gone the next time someone syncs.
// `localCards.json` is the hand-maintained half — cards that aren't upstream yet, and
// corrections to ones that are. It is never generated, so it is the only safe place to edit.
//
// Local wins on a shared id, which is what makes it usable as a correction layer: once a card
// does arrive upstream, delete its local row and the upstream one takes over.
function overlay(generated, local) {
  const byId = new Map(generated.map(r => [String(r.id).trim(), r]))
  for (const r of local) byId.set(String(r.id).trim(), r)
  return [...byId.values()]
}

const charaRaw = overlay(charaGenerated, localCards.chara || [])
const wazaRaw = overlay(wazaGenerated, localCards.waza || [])

// Fresh data can introduce effect types the engine has no handler for, and an unhandled effect
// fails silently in play. Surfaced here, at import time, so it shows up the moment a dev opens
// the app rather than only when someone happens to use that one move.
if (import.meta.env?.DEV) reportEffectCoverage(wazaRaw)

// The generated JSON mirrors whatever the Supabase rows hold, and those have historically
// carried stray whitespace (e.g. a waza id of "STW05-002\n"). Anything used as a lookup key
// or matched by string gets trimmed here, so a dirty row can't silently break translation
// overlays, the waza-id comparisons in `DAMAGE_*_SUCCESS_SELF_<id>` effects, or the
// chara_name -> character join below — even after a fresh `npm run fetch-data`.
function cleanKey(value) {
  return value === null || value === undefined ? value : String(value).trim()
}

// Applied when a row's weakness damage is missing or unparseable — every card printed so
// far uses 20, so that's the safe assumption for a half-filled row.
export const DEFAULT_WEAKNESS_DAMAGE = 20

// A character can be printed with more than one weakness, each carrying its own bonus
// damage, so the Supabase row spreads them across numbered column pairs
// (weakness_type1/weakness_damage1, weakness_type2/weakness_damage2). They collapse into one
// `weaknesses` array here; a character with a single weakness just gets a 1-entry array, and
// rows with no weakness at all get an empty one. `weakness` (no suffix) is accepted as a
// legacy alias for the first slot's type, matching what the original fork's data used.
function buildWeaknesses(c) {
  const columns = [
    { type: c.weakness_type1 ?? c.weakness, damage: c.weakness_damage1 ?? c.weakness_damage },
    { type: c.weakness_type2, damage: c.weakness_damage2 }
  ]
  const out = []
  const seenTypes = new Set()
  columns.forEach(col => {
    const type = cleanKey(col.type)
    // Skip empty slots, and guard against a row that repeats the same type in both columns —
    // otherwise one move would collect the same weakness bonus twice.
    if (!type || seenTypes.has(type)) return
    seenTypes.add(type)
    out.push({ type, damage: parseInt(col.damage, 10) || DEFAULT_WEAKNESS_DAMAGE })
  })
  return out
}

function buildCharaEffect(die, effectStr, type, val) {
  if (!die || String(die) === "0") return null
  const orientations = String(die).replace(/"/g, '').split(',').map(s => s.trim())
  return {
    orientations,
    text: effectStr || "",
    type: type || "",
    value: parseInt(val, 10) || 0
  }
}

const MOVES_BASE = {}
wazaRaw.forEach(w => {
  const chara = []
  const c1 = buildCharaEffect(w.chara_die1, w.chara_effect1, w.chara_effect_type1, w.chara_effect_value1)
  if (c1) chara.push(c1)
  const c2 = buildCharaEffect(w.chara_die2, w.chara_effect2, w.chara_effect_type2, w.chara_effect_value2)
  if (c2) chara.push(c2)
  const c3 = buildCharaEffect(w.chara_die3, w.chara_effect3, w.chara_effect_type3, w.chara_effect_value3)
  if (c3) chara.push(c3)
  let cost = []
  if (w.waza_energy && String(w.waza_energy) !== "0") {
    cost = String(w.waza_energy).replace(/"/g, '').split(',').map(s => s.trim()).filter(s => s !== "")
  }
  const id = cleanKey(w.id)
  MOVES_BASE[id] = {
    id,
    chara_name: cleanKey(w.chara_name),
    name: w.waza_name,
    // 卡面上印的原文名。localizedMoves 會把 name 換成當地語言，這一欄不換 ——
    // 查卡、對照日文卡表、跟別人講哪一招的時候，中文譯名對不上印刷品。
    nameJa: w.waza_name,
    type: w.waza_type,
    cost,
    baseDamage: parseInt(w.waza_damage, 10) || 0,
    effect: w.waza_effect || "",
    effectType: w.waza_effect_type || "",
    effectValue: parseInt(w.waza_effect_value, 10) || 0,
    chara
  }
})

const CHARACTERS_BASE = charaRaw.map(c => {
  const name = cleanKey(c.name)
  const charaMoves = Object.values(MOVES_BASE)
    .filter(m => m.chara_name === name)
    .map(m => m.id)
    .sort((a, b) => {
      const na = Number(a), nb = Number(b)
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return String(a).localeCompare(String(b))
    })
  return {
    id: cleanKey(c.id),
    name,
    type: c.type,
    weaknesses: buildWeaknesses(c),
    hp: parseInt(c.HP, 10) || 100,
    // 只存相對路徑，網址留到 localizedCharacters 裡才用 asset() 組 —— 在這裡組的話
    // 低流量模式的開關會被定死在模組載入的那一刻，之後切換不會生效。
    imagePath: `image/CHARA/${name}.jpg`,
    moves: charaMoves,
    // Whether this one can be taken into a battle yet. Opt-out, so a card is playable unless
    // localCards.json says otherwise and `npm run fetch-data` can never silently bench one.
    //
    // Only the two battle pickers read it. Everything else — the odds sheet, the tier maker,
    // the type chart — shows the full roster on purpose: a card you cannot play yet is still
    // a card people want to look up.
    battleReady: c.battle_ready !== false
  }
})

/**
 * 中文名 → 角色 id。
 *
 * 秘笈手冊是中文寫的，章節標題永遠是中文名；`characters` 的 `name` 則跟著介面語言走。
 * 兩者要接得起來，中間就得有一份不隨語言改變的對照 —— 書架的封面圖與屬性底色都靠它。
 *
 * 沒有中文譯名的角色退回原名，對照表因此一定涵蓋整份名冊。
 */
export const CHARACTER_ID_BY_ZH_NAME = new Map(
  CHARACTERS_BASE.map(c => [TRANSLATIONS['zh-TW']?.chara?.[c.id]?.name || c.name, c.id])
)

function localizedMoves(locale) {
  const overlay = TRANSLATIONS[locale] && TRANSLATIONS[locale].waza
  if (!overlay) return MOVES_BASE
  const out = {}
  for (const id in MOVES_BASE) {
    const base = MOVES_BASE[id]
    const tr = overlay[id]
    if (!tr) {
      out[id] = base
      continue
    }
    out[id] = {
      ...base,
      name: tr.name || base.name,
      effect: tr.effect !== undefined ? tr.effect : base.effect,
      chara: base.chara.map((ce, i) => {
        const key = `chara_effect${i + 1}`
        return tr[key] !== undefined ? { ...ce, text: tr[key] } : ce
      })
    }
  }
  return out
}

function localizedCharacters(locale) {
  const overlay = TRANSLATIONS[locale] && TRANSLATIONS[locale].chara
  // 沒有譯名也要走一遍：imageUrl 是在這裡才組的（asset() 在這裡讀 lowData，低流量模式
  // 的開關才跟得上），日文介面沒有 overlay，直接回 CHARACTERS_BASE 會變成每個角色都沒有圖。
  return CHARACTERS_BASE.map(c => {
    const tr = overlay && overlay[c.id]
    return { ...c, name: tr && tr.name ? tr.name : c.name, imageUrl: asset(c.imagePath) }
  })
}

const locale = i18n.global.locale
const characters = computed(() => localizedCharacters(locale.value))
const moves = computed(() => localizedMoves(locale.value))
const isLoading = ref(true)
const loadError = ref(null)
let imagesPreloaded = false

export function useCharacterData() {
  async function initCharacterData() {
    if (imagesPreloaded) {
      isLoading.value = false
      return
    }
    isLoading.value = true
    loadError.value = null
    await Promise.all([preloadEssentialImages(), preloadCharacterImages(CHARACTERS_BASE)])
    imagesPreloaded = true
    isLoading.value = false
  }

  return { characters, moves, isLoading, loadError, loadData: initCharacterData }
}
