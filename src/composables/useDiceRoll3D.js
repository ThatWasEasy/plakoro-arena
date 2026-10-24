// A small physics-backed 3D dice tray: hands it canvas textures for each die's 6 faces, it
// drops the dice onto a table with random spin/velocity, waits for them to settle, and
// reports which logical face ended up on top of each one.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import * as CANNON from 'cannon-es'
import woodTableUrl from '../assets/wooden-table.png'
import rollSound1Url from '../assets/rolling-dice-01.mp3'
import rollSound2Url from '../assets/rolling-dice-02.mp3'

const DIE_SIZE = 0.72
const DIE_CORNER_RADIUS = DIE_SIZE * 0.12
const GROUND_HALF = 5.25
const WALL_HEIGHT = 6
// The tray sits this far in front of the origin (along -Z, away from the camera) rather than
// centered on it. At a tight 45° FOV, the tray's near edge (closest to camera) would otherwise
// sit low enough in the camera's view to fall outside the frustum; shifting the whole tray back
// brings that edge closer to the camera's look-at center instead of widening the FOV to cover it.
const TABLE_Z_OFFSET = 2.25
const GATHER_HEIGHT = 2.2 // hand height the invisible gather sphere floats at while held
// While gathered, dice are just ordinary DYNAMIC bodies — gravity, mutual dice-dice collisions,
// all of it stays completely normal. The only special rule is an invisible sphere around
// gatherCenter that bounces them off its inner wall (see animate()) instead of letting them
// fly out — so holding still just lets them settle under real gravity, and moving the sphere
// around jostles them off its walls exactly like shaking dice in a cupped hand.
const GATHER_RADIUS = 1.5
const GATHER_WALL_RESTITUTION = 0.5
const DIE_BOUNDING_RADIUS = DIE_SIZE * 0.87 // ~half a die's corner-to-corner diagonal

// The 6 local face normals in BoxGeometry's material-index order ([+X, -X, +Y, -Y, +Z, -Z]) —
// used after the physics settles to work out which face is pointing up.
const LOCAL_FACE_NORMALS = [
  new CANNON.Vec3(1, 0, 0),
  new CANNON.Vec3(-1, 0, 0),
  new CANNON.Vec3(0, 1, 0),
  new CANNON.Vec3(0, -1, 0),
  new CANNON.Vec3(0, 0, 1),
  new CANNON.Vec3(0, 0, -1)
]

// One shared audio element rather than one per die — playing several overlapping instances at
// once (e.g. two dice landing within the same frame) sounded muddled, so only one impact sound
// plays at a time; collisions that land while it's still playing are simply skipped.
const rollAudio = new Audio()
rollAudio.volume = 0.6

function playRollSound() {
  if (!rollAudio.paused) return
  rollAudio.src = Math.random() < 0.5 ? rollSound1Url : rollSound2Url
  rollAudio.play().catch(() => {}) // browsers may reject autoplay outside a user gesture; safe to ignore
}

export function useDiceRoll3D(canvasEl) {
  let renderer, scene, camera, world
  let groundMaterial, diceMaterial
  let dice = [] // { mesh, body, faceByAxis }
  // Non-physics stand-ins for a peer's throw (see replay()) — tweened straight to a given final
  // pose instead of being simulated, so two different clients can render the identical result.
  let replayDice = [] // { mesh, fromPos, toPos, fromQuat, toQuat, startTime, duration }
  let lastTransforms = []
  let frameId = null
  let resizeObserver = null
  let rollResolve = null
  let settleCheckActive = false
  // A die can occasionally settle into a near-static wobble that never quite crosses
  // allSettled()'s velocity threshold (most often a single die with nothing else to collide
  // with and damp it) — this caps how long the check window waits before forcing a result off
  // whatever orientation the die currently reads, rather than leaving the caller waiting forever.
  let settleDeadline = 0
  const MAX_SETTLE_WAIT_MS = 6000
  let rollSoundPlayed = false // only the first table impact of a roll makes a sound, not every bounce
  // (x, z) followed by the pointer while gathering; y stays fixed at GATHER_HEIGHT.
  const gatherCenter = new CANNON.Vec3(0, GATHER_HEIGHT, -TABLE_Z_OFFSET)
  // Last frame's gatherCenter, to work out how fast the invisible sphere itself is moving —
  // needed so a die bouncing off its wall inherits some of that motion instead of the wall
  // feeling like it's standing still.
  let prevGatherCenterX = gatherCenter.x
  let prevGatherCenterZ = gatherCenter.z
  const raycaster = new THREE.Raycaster()
  const gatherPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GATHER_HEIGHT)
  const gatherRayHit = new THREE.Vector3()

  function init() {
    scene = new THREE.Scene()
    scene.background = null

    // Aspect ratio here is just a placeholder — reading getBoundingClientRect() synchronously
    // in onMounted can race ahead of the browser's layout pass and come back 0x0 (0/0 = NaN
    // breaks the whole projection matrix, rendering nothing at all). The real size comes from
    // the ResizeObserver below, whose first callback is guaranteed to fire with the element's
    // actual laid-out size.
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 8.5, 7.3)
    camera.lookAt(0, 0, -1.35)

    renderer = new THREE.WebGLRenderer({ canvas: canvasEl.value, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    // No shadow map was enabled before, so nothing ever grounded the dice with a contact shadow —
    // lighting alone can't sell depth/contact, which read as "fake". Soft shadows from the key
    // light fix that; the hemisphere/fill lights stay shadow-free so there's only one shadow
    // direction (multiple overlapping shadow casters looks messy, not more realistic).
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb0a08c, 1.3))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.3)
    keyLight.position.set(4, 10, 6)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.bias = -0.002
    keyLight.shadow.camera.near = 1
    keyLight.shadow.camera.far = 30
    keyLight.shadow.camera.left = -GROUND_HALF - 1
    keyLight.shadow.camera.right = GROUND_HALF + 1
    keyLight.shadow.camera.top = GROUND_HALF + 1
    keyLight.shadow.camera.bottom = -GROUND_HALF - 1
    keyLight.target.position.set(0, 0, -TABLE_Z_OFFSET)
    scene.add(keyLight)
    scene.add(keyLight.target)
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.7)
    fillLight.position.set(0, 8, 10)
    scene.add(fillLight)

    const tableTexture = new THREE.TextureLoader().load(woodTableUrl)
    tableTexture.colorSpace = THREE.SRGBColorSpace

    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2),
      new THREE.MeshStandardMaterial({ map: tableTexture })
    )
    groundMesh.rotation.x = -Math.PI / 2
    groundMesh.position.set(0, 0, -TABLE_Z_OFFSET)
    groundMesh.receiveShadow = true
    scene.add(groundMesh)

    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -50, 0) })
    world.broadphase = new CANNON.SAPBroadphase(world)
    world.allowSleep = true

    groundMaterial = new CANNON.Material('ground')
    diceMaterial = new CANNON.Material('dice')
    world.addContactMaterial(new CANNON.ContactMaterial(groundMaterial, diceMaterial, {
      friction: 0.4,
      restitution: 0.6
    }))
    world.addContactMaterial(new CANNON.ContactMaterial(diceMaterial, diceMaterial, {
      friction: 0.3,
      restitution: 0.7
    }))

    const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: groundMaterial })
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
    groundBody.position.set(0, 0, -TABLE_Z_OFFSET)
    world.addBody(groundBody)

    // 4 invisible walls so a hard throw can't send a die flying off-screen.
    const wallDefs = [
      { pos: [GROUND_HALF, WALL_HEIGHT / 2, -TABLE_Z_OFFSET], rot: [0, -Math.PI / 2, 0] },
      { pos: [-GROUND_HALF, WALL_HEIGHT / 2, -TABLE_Z_OFFSET], rot: [0, Math.PI / 2, 0] },
      { pos: [0, WALL_HEIGHT / 2, GROUND_HALF - TABLE_Z_OFFSET], rot: [0, Math.PI, 0] },
      { pos: [0, WALL_HEIGHT / 2, -GROUND_HALF - TABLE_Z_OFFSET], rot: [0, 0, 0] }
    ]
    wallDefs.forEach(({ pos, rot }) => {
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: groundMaterial })
      body.position.set(...pos)
      body.quaternion.setFromEuler(...rot)
      world.addBody(body)
    })

    resizeObserver = new ResizeObserver(entries => onResize(entries[0]))
    resizeObserver.observe(canvasEl.value)

    animate()
  }

  // Reads the size from the ResizeObserver entry's contentRect rather than
  // canvasEl.value.getBoundingClientRect() — the app rotates its whole #stage 90° via CSS
  // transform on portrait devices (see useStageLayout.js), and getBoundingClientRect() reports
  // the post-transform (rotated) box, which comes back with width/height effectively swapped.
  // contentRect isn't affected by ancestor transforms, so it stays correct either way.
  function onResize(entry) {
    if (!renderer) return
    const { width, height } = entry.contentRect
    if (width === 0 || height === 0) return
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }

  // `faces` is the { canvases, faceByAxis } shape from diceTextures.js. `offsetX`/`offsetZ` are
  // relative to the tray center.
  function addDie(faces, offsetX, offsetZ) {
    const materials = faces.canvases.map(canvas => new THREE.MeshStandardMaterial({
      map: new THREE.CanvasTexture(canvas)
    }))
    const mesh = new THREE.Mesh(
      new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 3, DIE_CORNER_RADIUS),
      materials
    )
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)

    const body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(new CANNON.Vec3(DIE_SIZE / 2, DIE_SIZE / 2, DIE_SIZE / 2)),
      material: diceMaterial
    })
    // Randomizing height too (not just x/z) matters here: setDice()'s cluster packs dice close
    // enough in x/z that, all starting at the exact same y, several would spawn overlapping —
    // the physics engine's de-penetration response to that looks like an explosion, flinging
    // dice sideways instead of just letting them drop.
    body.position.set(offsetX, 4 + Math.random() * 1.2, -TABLE_Z_OFFSET + offsetZ)
    // Every die otherwise starts from the same identity orientation, and the small drop from here
    // rarely tumbles a cube far enough to change which face ends up on top — so without this, a
    // fresh setDice() (every online dice-system throw, not just the drag-and-throw roll() path
    // below) settles on the same face over and over instead of landing anywhere close to a fair
    // 1-in-6 spread. Matches the randomized starting quaternion roll() already uses for its own
    // throw.
    body.quaternion.setFromEuler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2)
    // A little random drift/spin on the initial drop — otherwise every die falls from the exact
    // same height with zero velocity and lands in an identical, robotic-looking pose every time
    // setDice() places a fresh set (before the player has thrown anything themselves).
    body.velocity.set((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5)
    body.angularVelocity.set(
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6
    )

    // Only the very first table/wall impact across the whole roll plays a sound — not every
    // bounce of every die — so `rollSoundPlayed` (reset per roll()) gates it to once per throw.
    body.addEventListener('collide', event => {
      if (rollSoundPlayed || event.body.material !== groundMaterial) return
      const impactSpeed = Math.abs(event.contact.getImpactVelocityAlongNormal())
      if (impactSpeed < 1.5) return
      rollSoundPlayed = true
      playRollSound()
    })

    world.addBody(body)

    // `held` marks a die as currently contained by the invisible gather sphere (see
    // gather()/roll()/animate()) — set for the whole gather + staggered-launch window, cleared
    // exactly when its own toss is applied, so a die waiting its turn to launch stays inside
    // the sphere instead of falling out early.
    const entry = { mesh, body, faceByAxis: faces.faceByAxis, held: false }
    dice.push(entry)
    return entry
  }

  function clearDice() {
    dice.forEach(({ mesh, body }) => {
      scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.forEach(m => {
        if (m.map) m.map.dispose()
        m.dispose()
      })
      world.removeBody(body)
    })
    dice = []
    clearReplayDice()
  }

  function clearReplayDice() {
    replayDice.forEach(({ mesh }) => {
      scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.forEach(m => {
        if (m.map) m.map.dispose()
        m.dispose()
      })
    })
    replayDice = []
  }

  // Reproduces a peer's throw exactly: same face textures, tweened (no physics) straight to the
  // exact final position/quaternion their real physics roll settled on — see getLastTransforms().
  // `transforms[i]` is `{ position: [x,y,z], quaternion: [x,y,z,w] }`, one per die in `faceList`.
  const REPLAY_DURATION_MS = 900
  function replay(faceList, transforms) {
    abandonPendingRoll()
    clearDice()
    const now = performance.now()
    faceList.forEach((faces, i) => {
      const t = transforms[i]
      if (!t) return
      const materials = faces.canvases.map(canvas => new THREE.MeshStandardMaterial({
        map: new THREE.CanvasTexture(canvas)
      }))
      const mesh = new THREE.Mesh(
        new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 3, DIE_CORNER_RADIUS),
        materials
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)

      const toPos = new THREE.Vector3(...t.position)
      const toQuat = new THREE.Quaternion(...t.quaternion)
      const fromPos = new THREE.Vector3(toPos.x, toPos.y + 4 + Math.random() * 1.2, toPos.z)
      const fromQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2
      ))
      mesh.position.copy(fromPos)
      mesh.quaternion.copy(fromQuat)
      replayDice.push({ mesh, fromPos, toPos, fromQuat, toQuat, startTime: now, duration: REPLAY_DURATION_MS })
    })
  }

  function getLastTransforms() {
    return lastTransforms
  }

  // Sets up (or replaces) the dice in the tray from a list of { canvases, faceByAxis }. Placed
  // close together with a small random scatter — like a hand grabbing them as a bundle — rather
  // than spread out in a neat row.
  // A placement or throw that gets superseded before its dice settle (the player re-throws mid-
  // fall, or the tray is torn down) would otherwise leave its promise pending forever, and any
  // caller awaiting it stuck. Settle it with null so "no result" is distinguishable from a real
  // one, and callers can stop waiting.
  function abandonPendingRoll() {
    if (!rollResolve) return
    const resolve = rollResolve
    rollResolve = null
    settleCheckActive = false
    resolve(null)
  }

  // Long enough that the dice are unmistakably in motion before allSettled() is consulted —
  // they spawn above the table with no downward velocity, so the first frames read as "at rest".
  const SETTLE_CHECK_DELAY_MS = 300

  // Drops a fresh set of dice in from above the table. They fall, tumble and come to rest under
  // ordinary gravity, and the returned promise reports the faces they land on — placement is a
  // roll in its own right, not just staging for a later throw.
  function setDice(faceList) {
    abandonPendingRoll()
    clearDice()
    // Otherwise this stays whatever roll() last left it as, so every placement after the very
    // first one silently skips its landing sound (the collide-sound gate never sees a reset).
    rollSoundPlayed = false
    const clusterRadius = 0.95
    faceList.forEach(faces => {
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * clusterRadius
      addDie(faces, Math.cos(angle) * r, Math.sin(angle) * r)
    })
    return new Promise(resolve => {
      rollResolve = resolve
      settleCheckActive = false
      setTimeout(() => {
        settleCheckActive = true
        settleDeadline = performance.now() + MAX_SETTLE_WAIT_MS
      }, SETTLE_CHECK_DELAY_MS)
    })
  }

  function topFaceOf(body) {
    let best = null
    let bestY = -Infinity
    LOCAL_FACE_NORMALS.forEach((normal, i) => {
      const world = body.quaternion.vmult(normal)
      if (world.y > bestY) {
        bestY = world.y
        best = i
      }
    })
    return best
  }

  function allSettled() {
    return dice.every(({ body }) =>
      body.velocity.length() < 0.08 && body.angularVelocity.length() < 0.08
    )
  }

  // Scoops every die straight into the (about-to-appear) invisible sphere around gatherCenter,
  // with a little scatter/velocity so it reads as picked up off the table in one motion. After
  // this one-time snap, nothing here scripts their motion any further — animate()'s sphere-wall
  // bounce plus ordinary gravity and dice-dice collisions are all that move them from here on.
  function gather() {
    dice.forEach(entry => {
      entry.held = true
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * GATHER_RADIUS * 0.4
      entry.body.position.set(
        gatherCenter.x + Math.cos(angle) * r,
        GATHER_HEIGHT + (Math.random() - 0.5) * 0.4,
        gatherCenter.z + Math.sin(angle) * r
      )
      entry.body.velocity.set((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2)
      entry.body.angularVelocity.set(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      )
      entry.body.wakeUp()
    })
  }

  // `ndcX`/`ndcY` are normalized device coordinates (-1..1) of the pointer, raycast onto the
  // horizontal plane the invisible sphere floats at, so it (and everything held inside it)
  // follows the pointer around the tray.
  function moveGatherTarget(ndcX, ndcY) {
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera)
    if (!raycaster.ray.intersectPlane(gatherPlane, gatherRayHit)) return
    const margin = GATHER_RADIUS + 0.3
    gatherCenter.x = Math.max(-GROUND_HALF + margin, Math.min(GROUND_HALF - margin, gatherRayHit.x))
    gatherCenter.z = Math.max(
      -GROUND_HALF - TABLE_Z_OFFSET + margin,
      Math.min(GROUND_HALF - TABLE_Z_OFFSET - margin, gatherRayHit.z)
    )
  }

  const THROW_SCALE = 3.5 // world units/sec of throw speed per screen px/ms of release velocity
  const MAX_THROW_SPEED = 20
  const throwRight = new THREE.Vector3()
  const throwForward = new THREE.Vector3()

  // Gives every die a toss from wherever it currently sits — normally mid-huddle from gather()
  // — and resolves once physics has settled with which logical face landed face-up on each one.
  // `screenVX`/`screenVY` is the pointer's release velocity in screen px/ms (see
  // DiceRoll3DCanvas.vue) — converted into a world-space throw direction via the camera's own
  // right/forward basis (flattened to the ground plane) so flicking the mouse toward the far
  // side of the tray actually throws the dice that way, not just a random scatter.
  function roll(screenVX = 0, screenVY = 0) {
    // A gesture throw can land mid-fall, while setDice()'s drop is still awaiting its result.
    abandonPendingRoll()
    return new Promise(resolve => {
      throwRight.setFromMatrixColumn(camera.matrixWorld, 0)
      throwForward.setFromMatrixColumn(camera.matrixWorld, 2).negate()
      throwRight.y = 0
      throwForward.y = 0
      throwRight.normalize()
      throwForward.normalize()

      // screenVY is raw screen px/ms (positive = pointer moving down the screen). Dragging up
      // (negative screenVY) should throw the dice toward the far/deep side of the tray — i.e.
      // along the camera's forward vector — so forward's contribution uses +screenVY here, not
      // -screenVY (that inverted version had a flick "forward" land the dice backward instead).
      let throwX = (throwRight.x * screenVX + throwForward.x * screenVY) * THROW_SCALE
      let throwZ = (throwRight.z * screenVX + throwForward.z * screenVY) * THROW_SCALE
      const throwSpeed = Math.hypot(throwX, throwZ)
      if (throwSpeed > MAX_THROW_SPEED) {
        const clampScale = MAX_THROW_SPEED / throwSpeed
        throwX *= clampScale
        throwZ *= clampScale
      }
      // Vertical launch speed is mostly driven by throwSpeed now — a gentle/no-motion release
      // gets only a small hop (baseHop), so the toss reads as "flies the way you moved it" first
      // and "arcs upward" second, not a big fixed pop straight up regardless of direction.
      // Gravity here is a strong -50 (tuned earlier for a snappier fall), so even the scaled arc
      // needs a real multiplier — v²/(2·50) shrinks a modest launch speed to almost nothing.
      const baseHop = 2 + Math.random() * 1.5
      const arcLift = throwSpeed * 0.55

      const STAGGER_MS = 90 // slight lag between each die's launch instead of dropping in lockstep
      rollResolve = resolve
      settleCheckActive = false
      rollSoundPlayed = false

      dice.forEach((entry, i) => {
        setTimeout(() => {
          entry.held = false
          const body = entry.body
          body.wakeUp()
          body.quaternion.setFromEuler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2)
          body.velocity.set(
            throwX + (Math.random() - 0.5) * 1,
            baseHop + arcLift,
            throwZ + (Math.random() - 0.5) * 1
          )
          body.angularVelocity.set(
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20
          )
        }, i * STAGGER_MS)
      })
      // Give the last die a moment to actually leave the ground before checking for "settled",
      // otherwise a die that hasn't launched yet reads as already at rest.
      setTimeout(() => {
        settleCheckActive = true
        settleDeadline = performance.now() + MAX_SETTLE_WAIT_MS
      }, (dice.length - 1) * STAGGER_MS + 300)
    })
  }

  function animate() {
    frameId = requestAnimationFrame(animate)

    // Gravity, dice-dice collisions — all completely ordinary physics, held or not.
    world.step(1 / 60)

    // How fast the invisible sphere itself is moving this frame, so a die bouncing off its wall
    // inherits some of that motion (like a ball bouncing off a moving paddle) instead of the
    // wall feeling stationary.
    const sphereVelX = (gatherCenter.x - prevGatherCenterX) * 60
    const sphereVelZ = (gatherCenter.z - prevGatherCenterZ) * 60
    prevGatherCenterX = gatherCenter.x
    prevGatherCenterZ = gatherCenter.z

    dice.forEach(entry => {
      if (entry.held) {
        const body = entry.body
        const dx = body.position.x - gatherCenter.x
        const dy = body.position.y - GATHER_HEIGHT
        const dz = body.position.z - gatherCenter.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        const limit = GATHER_RADIUS - DIE_BOUNDING_RADIUS
        if (dist > limit && dist > 0) {
          const nx = dx / dist
          const ny = dy / dist
          const nz = dz / dist
          body.position.set(gatherCenter.x + nx * limit, GATHER_HEIGHT + ny * limit, gatherCenter.z + nz * limit)
          // Bounce off the wall relative to the wall's own velocity, then convert back to a
          // world-space velocity — this is what carries the container's motion into the dice.
          const relVX = body.velocity.x - sphereVelX
          const relVY = body.velocity.y
          const relVZ = body.velocity.z - sphereVelZ
          const relDotN = relVX * nx + relVY * ny + relVZ * nz
          if (relDotN > 0) {
            const bounce = (1 + GATHER_WALL_RESTITUTION) * relDotN
            body.velocity.set(
              sphereVelX + relVX - bounce * nx,
              relVY - bounce * ny,
              sphereVelZ + relVZ - bounce * nz
            )
          }
        }
      }
      entry.mesh.position.copy(entry.body.position)
      entry.mesh.quaternion.copy(entry.body.quaternion)
    })

    const replayNow = performance.now()
    replayDice.forEach(entry => {
      const t = Math.min(1, (replayNow - entry.startTime) / entry.duration)
      const eased = 1 - Math.pow(1 - t, 3)
      entry.mesh.position.lerpVectors(entry.fromPos, entry.toPos, eased)
      entry.mesh.quaternion.slerpQuaternions(entry.fromQuat, entry.toQuat, eased)
    })

    renderer.render(scene, camera)

    if (settleCheckActive && rollResolve && (allSettled() || performance.now() > settleDeadline)) {
      settleCheckActive = false
      const results = dice.map(({ body, faceByAxis }) => faceByAxis[topFaceOf(body)])
      lastTransforms = dice.map(({ body }) => ({
        position: [body.position.x, body.position.y, body.position.z],
        quaternion: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w]
      }))
      const resolve = rollResolve
      rollResolve = null
      resolve(results)
    }
  }

  function dispose() {
    if (frameId) cancelAnimationFrame(frameId)
    if (resizeObserver) resizeObserver.disconnect()
    // The animation loop is gone, so nothing is left to detect the dice settling — anyone still
    // awaiting a result would wait forever (e.g. leaving the tray mid-throw).
    abandonPendingRoll()
    clearDice()
    if (renderer) renderer.dispose()
  }

  return { init, setDice, gather, moveGatherTarget, roll, replay, getLastTransforms, dispose }
}
