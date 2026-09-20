import { vec } from '@/foundation/geom'
import { bowPosition, type BoatState } from '@/domain/boat'
import { distanceToLine, type Mark } from '@/domain/course'
import {
  type InputSource,
  createSimulation,
  standings,
  windAt,
  interpolateWorld,
  raceTime,
  timeToStart,
  SimulationRunner,
  type Simulation,
  type TimedEvent,
} from '@/sim'
import { createCamera, follow, zoomForBoats, type Camera } from '@/presentation/view/camera'
import { drawScene, PALETTE, resizeSurface, TrailStore, type BoatStyle } from '@/presentation/render'
import { Helm, type HelmCommand } from '@/presentation/input'
import { fasterThan, formatRate, NORMAL_RATE, slowerThan } from '@/presentation/view/timescale'
import {
  clock,
  Hud,
  StandingsBoard,
  targetVmgRatio,
  timing,
  velocityMadeGood,
} from '@/presentation/ui'
import { Skipper } from '@/agents/ai'
import { duel, GAME_PACE, PLAYER_ID, randomSeed } from './scenario'

const canvas = requireElement<HTMLCanvasElement>('#stage')
const hud = new Hud(
  requireElement<HTMLElement>('#hud'),
  requireElement<HTMLElement>('[data-banner]'),
)
const overlay = requireElement<HTMLElement>('#overlay')
const standingsPanel = requireElement<HTMLElement>('#standings')

/** How much water to show across the short edge of the screen. */
const METERS_ACROSS = 420
/** However small the screen, the boat is drawn at least this long. */
const LEAST_BOAT_PIXELS = 20

/** Whether this is a finger rather than a mouse, which decides what the cards say. */
const BY_TOUCH = window.matchMedia('(pointer: coarse)').matches

/**
 * A debugging aid: watch the race faster or slower than it is meant to be played. It is
 * not part of the game and is expected to come out again. The pace the game actually
 * runs at is GAME_PACE, which this multiplies on top of.
 */
const STARTING_DEBUG_RATE = 1

/**
 * The angle the laylines are drawn at: the forty-five degrees sailors use to judge a
 * tack, rather than the polar beat angle.
 *
 * A boat does not travel along her heading. Leeway carries her to leeward, so where she
 * points 37 to 43 degrees off the wind depending on the breeze, her track over the
 * ground runs 42 to 46. Drawing the laylines at the pointing angle put them where no
 * boat could lay the mark.
 */
const LAYLINE_ANGLE = 45

/** How to sail her, written once so no two cards can drift apart. */
const CONTROLS = BY_TOUCH
  ? `Touch the <b>left</b> or <b>right</b> of the screen to steer.
     <br />Tap this card to start.`
  : `<b>← →</b> or <b>A D</b> steer · <b>Space</b> start and pause · <b>R</b> new race
     <br /><b>W</b> wind shadows · <b>L</b> laylines · <b>H</b> or <b>?</b> these keys
     <br />Debug: <b>+ −</b> watch faster or slower · <b>0</b> normal speed`

const PLAYER_STYLE: BoatStyle = { hull: PALETTE.hullBlue, trail: PALETTE.trailBlue, trailWidth: 2 }

/** Colors for the boats the player is racing against, handed out in order. */
const OPPONENT_STYLES: BoatStyle[] = [
  { hull: PALETTE.hullRed, trail: PALETTE.trailRed, trailWidth: 1.5 },
]

let simulation: Simulation
let runner: SimulationRunner
let camera: Camera
let trails = new TrailStore()
let sources: Record<string, InputSource> = {}
let styles: Record<string, BoatStyle> = {}
let board: StandingsBoard
// What the player has asked to see. Kept across races, being a preference and not a
// part of any one of them.
let showShadows = true
let showLaylines = true
let running = false
let lastFrame = 0
let debugRate = STARTING_DEBUG_RATE
/** Where the telltales sit: at the top of the screen, lined up with the first gauge. */
let panelAnchor = { left: 16, top: 16 }
let measuredAt = ''

const helm = new Helm({ onCommand: handleCommand })
helm.attach(canvas)

start(randomSeed())
requestAnimationFrame(frame)

function start(seed: string, immediate = false): void {
  simulation = createSimulation(duel(seed))
  runner = new SimulationRunner(simulation.ctx, simulation.world)
  trails = new TrailStore()
  sources = helmsFor(simulation)
  styles = stylesFor(simulation)
  board = new StandingsBoard(
    standingsPanel,
    simulation.names,
    Object.fromEntries(Object.entries(styles).map(([id, style]) => [id, style.hull])),
  )
  running = false
  debugRate = STARTING_DEBUG_RATE

  const surface = resizeSurface(canvas)
  const player = playerBoat(runner.world.boats)
  camera = createCamera(surface.viewport, player?.position ?? vec(0, 0), METERS_ACROSS, boatFloor())

  if (immediate) {
    running = true
    hideOverlay()
    return
  }

  showOverlay(
    'Ready to race',
    `You are <b style="color: ${PALETTE.hullBlue}">Blue</b>, racing
     <b style="color: ${PALETTE.hullRed}">Red</b>.
     <br />The gun is in thirty seconds. Cross the line, leave the orange mark to port,
     and come back through the line to finish.
     <br /><br />${CONTROLS}`,
    () => handleCommand('toggleRun'),
  )
}

function handleCommand(command: HelmCommand): void {
  if (command === 'restart') {
    // Straight into the next race: restarting is what you do when you want another go,
    // not something to be asked about.
    start(randomSeed(), true)
    return
  }
  if (command === 'toggleRun') {
    running = !running
    if (running) hideOverlay()
    else {
      showOverlay('Paused', BY_TOUCH ? 'Tap to carry on.' : 'Press <b>Space</b> to carry on.', () =>
        handleCommand('toggleRun'),
      )
    }
  }
  if (command === 'help') {
    showOverlay('Controls', CONTROLS, () => handleCommand('toggleRun'))
    running = false
  }
  if (command === 'toggleShadows') {
    showShadows = !showShadows
    hud.showBanner(`Wind shadows ${showShadows ? 'on' : 'off'}`, 'info', 1400)
  }
  if (command === 'toggleLaylines') {
    showLaylines = !showLaylines
    hud.showBanner(`Laylines ${showLaylines ? 'on' : 'off'}`, 'info', 1400)
  }
  if (command === 'faster' || command === 'slower' || command === 'normalRate') {
    debugRate =
      command === 'faster'
        ? fasterThan(debugRate)
        : command === 'slower'
          ? slowerThan(debugRate)
          : NORMAL_RATE
    hud.showBanner(`Debug: watching at ${formatRate(debugRate)}`, 'info', 1400)
  }
}

/**
 * Line the two corner panels up with the instruments: the telltales with the left of the
 * first gauge, the standings with the right of the last, both at the top of the screen.
 * Reading a layout is not free, so it is done when the viewport changes and not every
 * frame.
 */
function measurePanels(width: number, height: number): void {
  const key = `${width}x${height}`
  if (key === measuredAt) return
  measuredAt = key

  const canvasBox = canvas.getBoundingClientRect()

  const last = document.querySelector('[data-field="status"]')
  if (last) {
    const inset = canvasBox.right - last.getBoundingClientRect().right
    standingsPanel.style.right = `${Math.max(8, Math.round(inset))}px`
  }

  // The board's own top, so whatever the stylesheet says about safe areas, the telltales
  // agree with it rather than guessing.
  const board = standingsPanel.getBoundingClientRect()
  const first = document.querySelector('[data-field="timer"]')
  panelAnchor = {
    left: first ? Math.max(8, first.getBoundingClientRect().left - canvasBox.left) : 16,
    top: Math.max(8, Math.round(board.top - canvasBox.top)),
  }
}

function frame(timestamp: number): void {
  const surface = resizeSurface(canvas)
  // Recomputed rather than kept, so turning the phone or dragging the window resizes the
  // view rather than leaving it at whatever it was when the race began.
  camera = {
    ...camera,
    viewport: surface.viewport,
    pixelsPerMeter: zoomForBoats(surface.viewport, METERS_ACROSS, boatFloor()),
  }
  measurePanels(surface.viewport.width, surface.viewport.height)

  const elapsed = lastFrame === 0 ? 0 : (timestamp - lastFrame) / 1000
  lastFrame = timestamp

  if (running) {
    // Scale the catch-up cap alongside the rate, or running fast would be throttled by
    // the stall guard rather than by the rate itself.
    const pace = GAME_PACE * debugRate
    const events = runner.advance(elapsed * pace, sources, 0.25 * pace)
    for (const event of events) announce(event)
  }

  const world = interpolateWorld(runner.previous, runner.world, running ? runner.alpha : 1)
  trails.record(world.boats, world.time)

  const player = playerBoat(world.boats)
  if (player) {
    camera = follow(camera, player.position, Math.max(elapsed, 1 / 120), {
      bounds: simulation.ctx.course.bounds,
      deadzone: 0.22,
    })
  }

  // What she is sailing in, shadows included, which is what the instruments should read.
  const wind = windAt(
    simulation.ctx,
    runner.world,
    player?.position ?? camera.center,
    player?.id,
  )
  const target = nextMark()
  drawScene(surface.ctx, {
    ctx: simulation.ctx,
    world,
    camera,
    trails,
    playerId: PLAYER_ID,
    styles,
    started: raceTime(simulation.ctx, world) >= 0,
    medianWindSpeed: simulation.wind.median.speed,
    displayTime: world.time / GAME_PACE,
    panelAnchor,
    beatAngle: specOfPlayer().polar.beatAngle(wind.speed),
    runAngle: specOfPlayer().polar.runAngle(wind.speed),
    showShadows,
    showLaylines,
    laylineAngle: LAYLINE_ANGLE,
    ...(target === undefined ? {} : { targetMark: target }),
  })

  if (player) updateInstruments(player, wind.direction, wind.speed)
  board.update(standings(simulation.ctx, runner.world), PLAYER_ID)
  requestAnimationFrame(frame)
}

function updateInstruments(player: BoatState, windDirection: number, windSpeed: number): void {
  const spec = specOfPlayer()
  const progress = runner.world.race.progress[PLAYER_ID]

  const toLine = startLineDistance(player)
  hud.update({
    speed: player.speed,
    twa: player.twa,
    windDirection,
    windSpeed,
    vmg: Math.abs(velocityMadeGood(player.speed, player.twa)),
    vmgRatio: targetVmgRatio(spec.polar, player.speed, player.twa, windSpeed),
    timeToStart: timeToStart(simulation.ctx, runner.world) / GAME_PACE,
    raceTime: raceTime(simulation.ctx, runner.world) / GAME_PACE,
    status: statusText(),
    ...(toLine === undefined ? {} : { distanceToLine: toLine }),
    ...(progress?.place === undefined ? {} : { place: progress.place }),
  })
}

function statusText(): string {
  const progress = runner.world.race.progress[PLAYER_ID]
  if (!progress) return '—'
  if (progress.status === 'overEarly') return 'OVER EARLY'
  if (progress.status === 'finished') return 'FINISHED'
  const stage = simulation.ctx.course.stages[progress.stageIndex]
  if (!stage) return 'FINISHED'
  if (stage.kind === 'start') return 'To the line'
  if (stage.kind === 'mark') return `To ${stage.mark.name.toLowerCase()}`
  return 'To the finish'
}

/**
 * Who steers which boat. A boat left out of this sails on whatever helm she was given
 * and no more, which is what an idle competitor does.
 */
function helmsFor(sim: Simulation): Record<string, InputSource> {
  const helms: Record<string, InputSource> = {}
  for (const [boatId, controller] of Object.entries(sim.controllers)) {
    if (controller === 'human') helms[boatId] = helm
    if (controller === 'ai') helms[boatId] = new Skipper()
  }
  return helms
}

function stylesFor(sim: Simulation): Record<string, BoatStyle> {
  const assigned: Record<string, BoatStyle> = {}
  let opponent = 0
  for (const boat of sim.world.boats) {
    if (boat.id === PLAYER_ID) {
      assigned[boat.id] = PLAYER_STYLE
    } else {
      assigned[boat.id] = OPPONENT_STYLES[opponent % OPPONENT_STYLES.length] as BoatStyle
      opponent++
    }
  }
  return assigned
}

function announce(event: TimedEvent): void {
  // An event that names a boat is only news when it names this one. Without this the
  // player is told about a rival's mark rounding, and handed a finish card when she
  // crosses the line.
  if ('boatId' in event && event.boatId !== PLAYER_ID) return

  switch (event.kind) {
    case 'raceStarted':
      return hud.showBanner('Go!', 'good', 1600)
    case 'overEarly':
      return hud.showBanner('Over early — go back and cross again', 'warn', 3200)
    case 'cleared':
      return hud.showBanner('Cleared', 'good', 1600)
    case 'boatStarted':
      return hud.showBanner(`Started ${event.late.toFixed(1)}s after the gun`, 'info')
    case 'markRounded':
      return hud.showBanner('Mark rounded — head for the line', 'good')
    case 'penalised':
      return hud.showBanner(
        event.rule === undefined
          ? 'Penalty — you touched a mark. One turn owed.'
          : `Penalty — rule ${event.rule}. One turn owed.`,
        'warn',
        3600,
      )
    case 'penaltiesCancelled':
      return hud.showBanner('Penalties cancel — nothing owed', 'good', 2600)
    case 'penaltyCleared':
      return hud.showBanner(
        event.remaining > 0 ? `Turn taken — ${event.remaining} still owed` : 'Turn taken — you are clear',
        'good',
        2600,
      )
    case 'finishRefused':
      return hud.showBanner(
        'Penalty outstanding — take your turn and cross again',
        'warn',
        4200,
      )
    case 'contact':
      return hud.showBanner(`Contact with the ${event.otherId}`, 'warn')
    case 'boatFinished': {
      // Her own finish is worth saying, but the race is not over until the rest of the
      // fleet is home, and it carries on until it is.
      const elapsed = (runner.world.race.progress[PLAYER_ID]?.finishTime ?? 0) / GAME_PACE
      return hud.showBanner(`Finished in ${clock(elapsed)}`, 'good', 3200)
    }
    case 'raceFinished':
      running = false
      showResults()
      return
    default:
      return
  }
}

function nextMark(): Mark | undefined {
  const progress = runner.world.race.progress[PLAYER_ID]
  const stage = progress && simulation.ctx.course.stages[progress.stageIndex]
  return stage?.kind === 'mark' ? stage.mark : undefined
}

/** Distance from the bow to the line, shown only while it still matters. */
function startLineDistance(player: BoatState): number | undefined {
  const progress = runner.world.race.progress[PLAYER_ID]
  if (!progress || progress.stageIndex !== 0) return undefined
  const stage = simulation.ctx.course.stages[0]
  if (stage?.kind !== 'start') return undefined
  return distanceToLine(stage.line, bowPosition(player, specOfPlayer()))
}

function boatFloor() {
  return { boatLength: simulation.ctx.specs[PLAYER_ID]?.length ?? 10, leastPixels: LEAST_BOAT_PIXELS }
}

function playerBoat(boats: readonly BoatState[]): BoatState | undefined {
  return boats.find((boat) => boat.id === PLAYER_ID)
}

function specOfPlayer() {
  const spec = simulation.ctx.specs[PLAYER_ID]
  if (!spec) throw new Error('the player has no boat')
  return spec
}

/** The finishing order, once the last boat is home. */
function showResults(): void {
  const { race } = runner.world
  const rows = race.finishOrder
    .map((boatId) => {
      const progress = race.progress[boatId]
      const elapsed = (progress?.finishTime ?? 0) / GAME_PACE
      const name = simulation.names[boatId] ?? boatId
      const color = styles[boatId]?.hull ?? ''
      const mine = boatId === PLAYER_ID ? ' class="mine"' : ''
      return `<tr${mine}><td>${progress?.place ?? ''}</td><td style="color: ${color}">${name}</td><td>${timing(elapsed)}</td></tr>`
    })
    .join('')

  overlay.innerHTML = `<div class="card">
    <h1>Results</h1>
    <table class="results">${rows}</table>
    <p>${BY_TOUCH ? 'Tap for another race.' : 'Press <b>R</b> to race again.'}</p>
  </div>`
  overlay.dataset.visible = 'true'
}

/** What tapping the card does. There is no keyboard on a phone, so it has to do something. */
let onCardTap: (() => void) | undefined

function showOverlay(title: string, body: string, onTap?: () => void): void {
  overlay.innerHTML = `<div class="card"><h1>${title}</h1><p>${body}</p></div>`
  overlay.dataset.visible = 'true'
  onCardTap = onTap
}

function hideOverlay(): void {
  overlay.dataset.visible = 'false'
  onCardTap = undefined
}

overlay.addEventListener('pointerup', () => onCardTap?.())

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`the page is missing ${selector}`)
  return element
}
