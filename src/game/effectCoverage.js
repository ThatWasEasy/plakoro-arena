// Checks the move data against what the effect engine can actually dispatch.
//
// Effect types are plain strings in the data, matched by whole-string `case`s and anchored
// regexes in effectQueue. Nothing dispatches on the `MOD_` / `DAMAGE_` / `FIX_` prefix, so a new
// type that merely *looks* like a handled one — MOD_REDUCE_TAKEN_80HP_LOW next to
// MOD_REDUCE_TAKEN — falls through to the default branch and is dropped without a sound. The
// move still lands and deals damage; only its special effect quietly never happens, which is
// almost impossible for a player to describe and easy for us to miss.
//
// So rather than waiting for a bug report, walk every effect type in the data at startup and
// report the ones no handler claims.
import { isEffectTypeHandled } from './effectQueue'

// Every effect type in the move table, with the moves that carry it.
export function collectEffectTypes(wazaRows) {
  const found = new Map()
  const add = (type, row, where) => {
    if (!type) return
    if (!found.has(type)) found.set(type, [])
    found.get(type).push({ id: row.id, chara: row.chara_name, waza: row.waza_name, where })
  }
  wazaRows.forEach(row => {
    add(row.waza_effect_type, row, 'waza')
    ;[1, 2, 3].forEach(i => add(row[`chara_effect_type${i}`], row, `charaDie${i}`))
  })
  return found
}

export function findUnhandledEffects(wazaRows) {
  return [...collectEffectTypes(wazaRows)]
    .filter(([type]) => !isEffectTypeHandled(type))
    .map(([type, sources]) => ({ type, sources }))
}

// Called once at startup in dev. Silent when everything is covered.
export function reportEffectCoverage(wazaRows) {
  const missing = findUnhandledEffects(wazaRows)
  if (missing.length === 0) return missing
  console.warn(
    `[effectCoverage] ${missing.length} 種效果類型沒有對應的處理，這些招式的附加效果不會生效：`
  )
  missing.forEach(({ type, sources }) => {
    const who = sources.map(s => `${s.chara}「${s.waza}」(${s.id})`).join('、')
    console.warn(`  ✗ ${type}\n      ${who}`)
  })
  return missing
}
