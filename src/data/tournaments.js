const TOURNAMENTS_STORAGE_KEY = "plakoro_tournaments_v1"

// One player per line, optionally `name;code`. The code is theirs to keep across events — it is
// what lets the same person's results be recognised as theirs when they register under a
// different name months later.
//
// Parsed here rather than in each screen so the registration box and the late-entrant field
// can't drift apart on what they accept. A tab counts as a separator too, so two columns pasted
// straight out of a spreadsheet work without reformatting.
const PLAYER_FIELD_SEPARATOR = /[;；\t]/

export function parsePlayerLine(line) {
  const [name, code] = String(line ?? '').split(PLAYER_FIELD_SEPARATOR)
  return {
    name: (name || '').trim(),
    // Uppercased because a player code is a case-insensitive identifier, and a lowercase letter
    // typed at a busy sign-in desk would otherwise fail to match.
    code: (code || '').trim().toUpperCase()
  }
}

export function loadTournaments() {
  try {
    const raw = localStorage.getItem(TOURNAMENTS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

function persist(tournaments) {
  try {
    localStorage.setItem(TOURNAMENTS_STORAGE_KEY, JSON.stringify(tournaments))
  } catch (e) {}
}

export function saveTournament(tournament) {
  const all = loadTournaments()
  const idx = all.findIndex(t => t.id === tournament.id)
  if (idx >= 0) all[idx] = tournament
  else all.push(tournament)
  persist(all)
}

export function deleteTournament(id) {
  persist(loadTournaments().filter(t => t.id !== id))
}
