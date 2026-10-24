import { computed, ref, watch } from 'vue'
import { joinRoom } from 'trystero/nostr'
import { setOnlineMode } from './useBattleState'

// Spike: proves out host-authoritative sync for duel mode over trystero (WebRTC, Nostr
// signaling — no server to run, fits the GitHub Pages static deploy). Not wired into any
// menu; call useOnlineRoom(battle).host()/.join(code) from devtools or a temporary button
// to try it in two tabs.

const APP_ID = 'plakoro-arena-duel'

// The only battle methods components call that mutate shared state (see grep of `battle.*(`
// across src/components + App.vue). Everything else (hpBarClass, computeDisplayDamage,
// opponentKey, bothLocked) is a pure read and stays local on both sides.
const MUTATING_ACTIONS = [
  'openCharSelect', 'openMoveSelect', 'closeModal', 'toggleMoveInModal',
  'confirmCharacterMoves', 'onCardTap', 'startBattle', 'setReadyForFirst', 'setEnergyDice',
  'pickMove', 'backToMoveSelect', 'setDiceRollResult', 'resolveTurn', 'submitEffectPrompt',
  'pickBindWazaMove', 'confirmTurnResult', 'submitCharaThrowResult', 'submitEnergyThrowResult',
  'toggleEnergyRerollPick', 'confirmEnergyRerollPick', 'submitEnergyRerollResult', 'rerollCharaDie',
  'resetGame'
]

// Must match (or slightly exceed) FirstPickWheel's own spin duration so the wheel has
// visually landed on both screens before the host moves the game on to move-select.
const FIRST_PICK_SPIN_MS = 4500

function randomRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

// state.effectPrompt carries onPick/onDone callbacks (see submitEffectPrompt /
// pickBindWazaMove) so the raw state isn't JSON-safe. The guest never invokes those
// callbacks itself — only the host runs them, when it later receives the matching intent —
// so dropping functions here is enough; the guest just renders what's left.
function stripFns(value) {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'function' ? undefined : v)))
}

export function useOnlineRoom(battle) {
  const role = ref(null) // 'host' | 'guest' | null (not in a room)
  const roomCode = ref('')
  const peerCount = ref(0)
  const connected = ref(false)

  // Fixed seat assignment: whoever opens the room is trainer A, whoever joins is B. Lets the
  // UI tell "my side" from "their side" without any extra handshake.
  const myKey = computed(() => (role.value === 'host' ? 'A' : role.value === 'guest' ? 'B' : null))

  let room = null
  let stateAction = null
  let intentAction = null
  let stopStateWatch = null
  let stopReadyWatch = null
  let firstPickTimer = null

  function broadcastState(target) {
    if (role.value !== 'host' || !stateAction) return
    stateAction.send(stripFns(battle.state), target ? { target } : undefined)
  }

  function applySnapshot(snapshot) {
    Object.keys(snapshot).forEach(key => { battle.state[key] = snapshot[key] })
  }

  function setupRoom(code) {
    room = joinRoom({ appId: APP_ID }, code)
    stateAction = room.makeAction('state')
    intentAction = room.makeAction('intent')

    room.onPeerJoin = peerId => {
      peerCount.value++
      connected.value = true
      broadcastState(peerId)
    }
    room.onPeerLeave = () => {
      peerCount.value = Math.max(0, peerCount.value - 1)
      if (peerCount.value === 0) connected.value = false
    }

    stateAction.onMessage = data => {
      if (role.value === 'guest') applySnapshot(data)
    }
    intentAction.onMessage = data => {
      if (role.value !== 'host') return
      const fn = battle[data.fn]
      if (typeof fn === 'function') fn(...(data.args || []))
    }
  }

  function host() {
    leave()
    role.value = 'host'
    setOnlineMode(true)
    roomCode.value = randomRoomCode()
    setupRoom(roomCode.value)
    // Broadcast-whole-state-on-any-change: simplest correct thing for a spike. Revisit with
    // diffs only if payload size becomes a problem.
    stopStateWatch = watch(() => battle.state, () => broadcastState(), { deep: true })

    // Host-only: once both sides have tapped ready, draw the first player instead of letting
    // either side pick themselves. `pendingFirstPick` is set immediately so both clients'
    // wheel animate toward the same already-decided result; `startBattle` only runs once the
    // wheel has had time to visually land.
    stopReadyWatch = watch(
      () => [battle.state.phase, battle.state.players.A.readyForFirst, battle.state.players.B.readyForFirst],
      ([phase, readyA, readyB]) => {
        if (phase !== 'select' || !readyA || !readyB) return
        const winner = Math.random() < 0.5 ? 'A' : 'B'
        battle.state.pendingFirstPick = winner
        battle.state.phase = 'drawingFirst'
        firstPickTimer = setTimeout(() => battle.startBattle(winner), FIRST_PICK_SPIN_MS)
      }
    )
  }

  function join(code) {
    leave()
    role.value = 'guest'
    setOnlineMode(true)
    roomCode.value = code.trim().toUpperCase()
    setupRoom(roomCode.value)
  }

  function leave() {
    stopStateWatch?.()
    stopStateWatch = null
    stopReadyWatch?.()
    stopReadyWatch = null
    clearTimeout(firstPickTimer)
    firstPickTimer = null
    room?.leave()
    room = null
    stateAction = null
    intentAction = null
    role.value = null
    roomCode.value = ''
    peerCount.value = 0
    connected.value = false
    setOnlineMode(false)
  }

  // What components call instead of battle[name] directly once online: on the host it just
  // runs locally (the watcher above broadcasts the result); on the guest it ships the call
  // to the host and waits for the resulting state snapshot instead of touching local state.
  function dispatch(name, ...args) {
    if (role.value === 'guest') {
      intentAction?.send({ fn: name, args })
      return
    }
    battle[name]?.(...args)
  }

  // Drop-in replacement for `battle` to provide()/inject() unchanged: identical when not in
  // a room or when hosting, routes mutating calls through dispatch() when a guest.
  const onlineBattle = { ...battle }
  for (const name of MUTATING_ACTIONS) {
    onlineBattle[name] = (...args) => dispatch(name, ...args)
  }

  return { role, roomCode, peerCount, connected, myKey, host, join, leave, battle: onlineBattle }
}
