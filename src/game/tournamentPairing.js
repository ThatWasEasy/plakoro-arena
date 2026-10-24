// Pure Swiss-system and single-elimination pairing/bracket logic for the tournament scheduler.
// Everything here takes plain data in and returns plain data out — no Vue reactivity — so it's
// trivial to reason about (and console-test) even though this repo has no test runner.

export function shuffle(arr) {
  const copy = arr.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const POINTS = { win: 3, draw: 1, loss: 0 }
// Official Play! Pokemon Swiss tiebreakers, applied after raw points: Opponents' Match Win %
// (OMW%), then Opponents' Opponents' Match Win % (OOMW%). Any player's own match-win % is
// floored at 25% before being averaged into someone else's OMW%/OOMW% — otherwise one very weak
// opponent (or a bye-heavy record) could unfairly tank another player's schedule-strength score.
const MATCH_WIN_FLOOR = 0.25

function allMatches(tournament) {
  return tournament.rounds.flatMap(r => r.matches)
}

function averageOver(ids, table) {
  if (ids.length === 0) return 0
  return ids.reduce((sum, id) => sum + (table.get(id) ?? MATCH_WIN_FLOOR), 0) / ids.length
}

// One row per player: wins/losses/draws/points/byes plus the omwp/oomwp tiebreakers, sorted by
// points desc then omwp then oomwp (final tie broken by a stable id compare, never re-shuffled)
// — safe to call every render, since it recomputes from scratch instead of tracking running
// totals that could go stale after an edited result.
export function computeStandings(tournament) {
  const stats = new Map(tournament.players.map(p => [
    p.id,
    { playerId: p.id, name: p.name, wins: 0, losses: 0, draws: 0, points: 0, byes: 0, opponents: [] }
  ]))
  allMatches(tournament).forEach(m => {
    if (m.player2Id === null) {
      const s = stats.get(m.player1Id)
      if (s) { s.wins++; s.points += POINTS.win; s.byes++ }
      return
    }
    if (!m.result) return
    const s1 = stats.get(m.player1Id)
    const s2 = stats.get(m.player2Id)
    if (!s1 || !s2) return
    s1.opponents.push(m.player2Id)
    s2.opponents.push(m.player1Id)
    if (m.result === 'draw') {
      s1.draws++; s2.draws++
      s1.points += POINTS.draw; s2.points += POINTS.draw
    } else {
      const winner = m.result === 'p1' ? s1 : s2
      const loser = m.result === 'p1' ? s2 : s1
      winner.wins++; winner.points += POINTS.win
      loser.losses++
    }
  })

  const matchWinPct = new Map()
  stats.forEach((s, id) => {
    const rounds = s.wins + s.losses + s.draws
    const pct = rounds === 0 ? MATCH_WIN_FLOOR : s.points / (rounds * 3)
    matchWinPct.set(id, Math.max(pct, MATCH_WIN_FLOOR))
  })

  const omwp = new Map()
  stats.forEach((s, id) => omwp.set(id, averageOver(s.opponents, matchWinPct)))

  const oomwp = new Map()
  stats.forEach((s, id) => oomwp.set(id, averageOver(s.opponents, omwp)))

  return [...stats.values()]
    .map(s => ({ ...s, omwp: omwp.get(s.playerId), oomwp: oomwp.get(s.playerId) }))
    .sort((a, b) =>
      b.points - a.points ||
      b.omwp - a.omwp ||
      b.oomwp - a.oomwp ||
      (a.playerId < b.playerId ? -1 : 1)
    )
}

// Players still to be paired. A player who drops mid-event is flagged rather than deleted:
// their played matches stay on the record, because removing them would silently rewrite every
// opponent's OMW%/OOMW% — a drop in round 3 must not change who won on tiebreakers in round 2.
export function activePlayers(tournament) {
  return tournament.players.filter(p => !p.dropped)
}

// "Has A already played B" — bye matches don't count as an opponent. `exceptRound` leaves one
// round out, which is what re-pairing that round needs: its own current pairings must not count
// as history when deciding what would be a rematch.
function playedPairsOf(tournament, exceptRound = null) {
  const pairs = new Set()
  tournament.rounds.forEach(r => {
    if (exceptRound && r === exceptRound) return
    r.matches.forEach(m => {
      if (m.player2Id === null) return
      pairs.add(m.player1Id + '|' + m.player2Id)
      pairs.add(m.player2Id + '|' + m.player1Id)
    })
  })
  return pairs
}

function hasHadBye(tournament, playerId) {
  return allMatches(tournament).some(m => m.player1Id === playerId && m.player2Id === null)
}

// Round 1: random shuffle, paired adjacently (bye assigned first if the count is odd). Round
// N>1: rank by current standings, shuffle within each point-group (so ranking isn't rigid),
// then greedily pair top-to-bottom, scanning for the first opponent not yet faced. If a player
// reaches the end of the list with no valid (non-rematch) opponent, they're paired with the
// nearest-ranked remaining player anyway and the match is flagged `rematch: true` — a real
// backtracking solver would avoid this in more cases, but is more machinery than this admin
// tool needs; the flagged fallback is honest about the compromise instead of hiding it.
export function pairSwissRound(tournament) {
  const isFirstRound = tournament.rounds.length === 0
  const played = playedPairsOf(tournament)

  const eligible = new Set(activePlayers(tournament).map(p => p.id))

  let pool
  if (isFirstRound) {
    pool = shuffle([...eligible])
  } else {
    const standings = computeStandings(tournament)
    const groups = new Map()
    standings.forEach(s => {
      // Dropped players keep their standings row but take no further pairings.
      if (!eligible.has(s.playerId)) return
      if (!groups.has(s.points)) groups.set(s.points, [])
      groups.get(s.points).push(s.playerId)
    })
    pool = [...groups.keys()].sort((a, b) => b - a).flatMap(points => shuffle(groups.get(points)))
  }

  const matches = []
  if (pool.length % 2 === 1) {
    // Bye goes to the lowest-ranked player who hasn't had one yet — falling back to the
    // lowest-ranked player overall if everyone already has (rare, but must resolve to someone).
    let byePlayerId = null
    for (let i = pool.length - 1; i >= 0; i--) {
      if (!hasHadBye(tournament, pool[i])) { byePlayerId = pool[i]; break }
    }
    if (byePlayerId === null) byePlayerId = pool[pool.length - 1]
    pool = pool.filter(id => id !== byePlayerId)
    matches.push({ id: crypto.randomUUID(), player1Id: byePlayerId, player2Id: null, result: null, rematch: false })
  }

  const remaining = pool.slice()
  while (remaining.length > 0) {
    const a = remaining.shift()
    let idx = remaining.findIndex(b => !played.has(a + '|' + b))
    let rematch = false
    if (idx === -1) { idx = 0; rematch = true }
    const b = remaining.splice(idx, 1)[0]
    matches.push({ id: crypto.randomUUID(), player1Id: a, player2Id: b, result: null, rematch })
  }

  return { roundNumber: tournament.rounds.length + 1, matches }
}

export function nextPowerOfTwo(n) {
  let p = 1
  while (p < n) p *= 2
  return p
}

// A bye's lone player counts as an immediate winner, same as a recorded result — null means a
// real match still awaiting one.
function winnerOf(match) {
  if (match.player2Id === null) return match.player1Id
  if (match.result === 'p1') return match.player1Id
  if (match.result === 'p2') return match.player2Id
  return null
}

// Round 1: one shuffle decides both bracket order and who gets a bye (the first `byeCount`
// shuffled players). Round N>1: resolve every match in round N to a winner and pair
// winners[2i] vs winners[2i+1] — returns null if round N isn't fully resolved yet.
export function pairEliminationRound(tournament) {
  if (tournament.rounds.length === 0) {
    const order = shuffle(activePlayers(tournament).map(p => p.id))
    const size = nextPowerOfTwo(order.length)
    const byeCount = size - order.length
    const byes = order.slice(0, byeCount)
    const rest = order.slice(byeCount)
    const matches = byes.map(id => (
      { id: crypto.randomUUID(), player1Id: id, player2Id: null, result: null, rematch: false }
    ))
    for (let i = 0; i < rest.length; i += 2) {
      matches.push({ id: crypto.randomUUID(), player1Id: rest[i], player2Id: rest[i + 1], result: null, rematch: false })
    }
    return { roundNumber: 1, matches }
  }

  const prevRound = tournament.rounds[tournament.rounds.length - 1]
  const winners = prevRound.matches.map(winnerOf)
  if (winners.some(w => w === null)) return null

  const matches = []
  for (let i = 0; i < winners.length; i += 2) {
    matches.push({ id: crypto.randomUUID(), player1Id: winners[i], player2Id: winners[i + 1] ?? null, result: null, rematch: false })
  }
  return { roundNumber: tournament.rounds.length + 1, matches }
}

export function isTournamentComplete(tournament) {
  if (tournament.rounds.length === 0) return false
  if (tournament.format === 'swiss') return tournament.rounds.length >= tournament.swissTotalRounds
  const last = tournament.rounds[tournament.rounds.length - 1]
  return last.matches.length === 1 && winnerOf(last.matches[0]) !== null
}

export function championOf(tournament) {
  if (tournament.format !== 'elimination' || !isTournamentComplete(tournament)) return null
  const last = tournament.rounds[tournament.rounds.length - 1]
  const winnerId = winnerOf(last.matches[0])
  return tournament.players.find(p => p.id === winnerId) || null
}

// Whether every non-bye match in a round has a recorded result — the gate for "generate next
// round" in the UI.
export function isRoundComplete(round) {
  return round.matches.every(m => m.player2Id === null || m.result !== null)
}

// Discards every round after `roundNumber`, making that round current again so its results can
// be corrected and the rounds after it re-paired from the corrected standings.
//
// Swiss doesn't need this to fix a mis-entered result — computeStandings recomputes from
// scratch, so editing a past result already updates the table, and matches people actually
// played shouldn't be unplayed. Rewinding is for the other case: the pairing itself was wrong,
// or a correction is early enough that re-pairing from it is what the organizer wants.
//
// For elimination it's the only correct repair at all. Round N+1's participants ARE round N's
// winners, so changing one of those results leaves a bracket where someone who lost is still
// playing. Returns the discarded rounds so the caller can say what will be lost.
export function rewindToRound(tournament, roundNumber) {
  const discarded = tournament.rounds.slice(roundNumber)
  tournament.rounds = tournament.rounds.slice(0, roundNumber)
  return discarded
}

// Rounds that would be discarded by rewinding to `roundNumber`, without changing anything —
// for the confirmation prompt, so "this deletes 2 rounds / 7 matches" can be said up front.
export function roundsAfter(tournament, roundNumber) {
  return tournament.rounds.slice(roundNumber)
}

function slotsOf(round) {
  const slots = []
  round.matches.forEach(m => {
    slots.push({ match: m, side: 'player1Id' })
    if (m.player2Id !== null) slots.push({ match: m, side: 'player2Id' })
  })
  return slots
}

// Swaps where two players sit in a round. Every possible re-pairing of a round is reachable by
// repeated swaps, so this one operation covers "these two shouldn't be playing each other",
// "give the bye to someone else" and "undo that rematch" alike.
//
// Both matches lose their recorded result: it described a fixture that no longer exists, and
// silently keeping it would credit a win against an opponent who was never played. `rematch` is
// recomputed against the other rounds only, so the round being edited isn't its own history.
export function swapPlayers(tournament, round, playerAId, playerBId) {
  if (playerAId === playerBId) return false
  const slots = slotsOf(round)
  const a = slots.find(s => s.match[s.side] === playerAId)
  const b = slots.find(s => s.match[s.side] === playerBId)
  if (!a || !b) return false

  a.match[a.side] = playerBId
  b.match[b.side] = playerAId
  ;[a.match, b.match].forEach(m => { m.result = null })

  const played = playedPairsOf(tournament, round)
  round.matches.forEach(m => {
    m.rematch = m.player2Id !== null && played.has(m.player1Id + '|' + m.player2Id)
  })
  return true
}

// Slots a player into a round that's already under way, rather than making them wait.
//
// If someone is sitting out, the newcomer takes them on — which is the better outcome for both,
// since a bye is a free win nobody wanted to be given. Otherwise the round is even and the
// newcomer is the one who sits out. Either way the rest of the round is untouched: results
// already recorded elsewhere stand, and only the match that actually changed loses its result.
//
// Returns 'paired' | 'bye' | false (already in this round).
export function addPlayerToRound(tournament, round, playerId) {
  const already = round.matches.some(m => m.player1Id === playerId || m.player2Id === playerId)
  if (already) return false

  const byeMatch = round.matches.find(m => m.player2Id === null)
  if (byeMatch) {
    byeMatch.player2Id = playerId
    byeMatch.result = null
    // It's a real match now, so it needs a table — the next free number, since renumbering the
    // whole round would move players who are already seated and playing.
    const maxTable = round.matches.reduce((n, m) => Math.max(n, m.table || 0), 0)
    byeMatch.table = maxTable + 1
    const played = playedPairsOf(tournament, round)
    byeMatch.rematch = played.has(byeMatch.player1Id + '|' + byeMatch.player2Id)
    return 'paired'
  }

  round.matches.push({
    id: crypto.randomUUID(), player1Id: playerId, player2Id: null, result: null, rematch: false, table: null
  })
  return 'bye'
}

// Moves the bye onto `playerId`, swapping whoever currently has it into the vacated seat.
export function giveByeTo(tournament, round, playerId) {
  const byeMatch = round.matches.find(m => m.player2Id === null)
  if (!byeMatch || byeMatch.player1Id === playerId) return false
  return swapPlayers(tournament, round, byeMatch.player1Id, playerId)
}

// Stamps a fixed `table` number onto each of a freshly-generated round's matches (null for
// byes, which don't need one) and reorders `round.matches` to match — done ONCE, right after
// the round is generated, using standings as of *before* this round (the tournament object
// passed in must not yet include `round`). This must not be recomputed later from live
// standings: results recorded during this same round would otherwise reshuffle table numbers
// as they come in, which is exactly the bug this avoids. For Swiss, the table order follows the
// better-ranked player of each match (organizers seat the top of the standings at the front
// tables); for elimination, natural bracket order is kept since it already carries structural
// meaning. Either way, byes move to the end since they don't need a table at all. Mutates and
// returns `round`.
/**
 * The table a match was played on, for display.
 *
 * Normally just `m.table`, stamped once when the round was generated. Falls back to the match's
 * position among the round's real matches when that is missing — which is every round uploaded
 * before the server had anywhere to store it (migration 0011). Position is the right fallback
 * and not a guess: assignTableNumbers reorders `round.matches` into table order before anything
 * is saved, and both the file format and the API return them in that order, so counting them
 * off reproduces the numbers that were on the tables.
 *
 * Returns null only for a bye, which never had a table.
 */
export function tableNumberOf(round, match) {
  if (match.player2Id === null) return null
  if (Number.isInteger(match.table)) return match.table
  const real = (round?.matches || []).filter(m => m.player2Id !== null)
  const i = real.indexOf(match)
  return i >= 0 ? i + 1 : null
}

export function assignTableNumbers(tournament, round) {
  const real = round.matches.filter(m => m.player2Id !== null)
  const byes = round.matches.filter(m => m.player2Id === null)
  if (tournament.format === 'swiss') {
    const standings = computeStandings(tournament)
    const rankIndex = new Map(standings.map((s, i) => [s.playerId, i]))
    const bestRank = m => Math.min(rankIndex.get(m.player1Id) ?? Infinity, rankIndex.get(m.player2Id) ?? Infinity)
    real.sort((a, b) => bestRank(a) - bestRank(b))
  }
  real.forEach((m, i) => { m.table = i + 1 })
  byes.forEach(m => { m.table = null })
  round.matches = [...real, ...byes]
  return round
}
