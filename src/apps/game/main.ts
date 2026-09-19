import { vec } from '@/foundation/geom'
import { clamp } from '@/foundation/units'
import { bowPosition, type BoatState } from '@/domain/boat'
import { distanceToLine, type Mark } from '@/domain/course'
import {
  createSimulation,
  interpolateWorld,
  raceTime,
  timeToStart,
  SimulationRunner,
  type Simulation,
  type TimedEvent,
} from '@/sim'
import { createCamera, follow, type Camera } from '@/presentation/view/camera'
import { drawScene, resizeSurface, TrailStore } from '@/presentation/render'
import { Helm, type HelmCommand } from '@/presentation/input'
import { fasterThan, formatRate, NORMAL_RATE, slowerThan } from '@/presentation/view/timescale'
import { clock, Hud, velocityMadeGood } from '@/presentation/ui'
import { PLAYER_ID, randomSeed, soloRace } from './scenario'

const canvas = requireElement<HTMLCanvasElement>('#stage')
const hud = new Hud(
  requireElement<HTMLElement>('#hud'),
  requireElement<HTMLElement>('[data-banner]'),
)
const overlay = requireElement<HTMLElement>('#overlay')

/** How much water to show across the short edge of the screen. */
const METERS_ACROSS = 420

/**
 * A lap takes about eleven minutes of sailing, which is a long time to sit through, so
 * the game opens at four times speed. The 0 key still means normal speed, not this.
 */
const STARTING_RATE = 4

let simulation: Simulation
let runner: SimulationRunner
let camera: Camera
let trails = new TrailStore()
let running = false
let lastFrame = 0
let timeScale = STARTING_RATE
/**
 * Seconds the player has actually sat through since the gun. Accumulated rather than
 * derived from race time, because the rate can change mid-race and dividing by whatever
 * it happens to be now would rewrite the part already sailed.
 */
let wallClockSinceGun = 0
let wallClockAtFinish = 0

const helm = new Helm({ onCommand: handleCommand })
helm.attach(canvas)

start(randomSeed())
requestAnimationFrame(frame)

function start(seed: string): void {
  simulation = createSimulation(soloRace(seed))
  runner = new SimulationRunner(simulation.ctx, simulation.world)
  trails = new TrailStore()
  running = false
  timeScale = STARTING_RATE
  wallClockSinceGun = 0
  wallClockAtFinish = 0

  const surface = resizeSurface(canvas)
  const player = playerBoat(runner.world.boats)
  camera = createCamera(surface.viewport, player?.position ?? vec(0, 0), METERS_ACROSS)

  showOverlay(
    'Ready to race',
    `The gun is in one minute. Cross the line, leave the orange mark to port, and come back through the line to finish.
     <b>← →</b> or <b>A D</b> to steer · <b>Space</b> to start and pause · <b>R</b> for a new race
     <br /><b>+</b> and <b>−</b> change how fast the race runs · <b>0</b> puts it back to normal`,
  )
}

function handleCommand(command: HelmCommand): void {
  if (command === 'restart') {
    start(randomSeed())
    return
  }
  if (command === 'toggleRun') {
    running = !running
    if (running) hideOverlay()
    else showOverlay('Paused', 'Press <b>Space</b> to carry on.')
  }
  if (command === 'help') {
    showOverlay(
      'Controls',
      '<b>← →</b> steer · <b>Space</b> pause · <b>R</b> new race · <b>+ −</b> race speed · <b>0</b> normal speed',
    )
    running = false
  }
  if (command === 'faster' || command === 'slower' || command === 'normalRate') {
    timeScale =
      command === 'faster'
        ? fasterThan(timeScale)
        : command === 'slower'
          ? slowerThan(timeScale)
          : NORMAL_RATE
    hud.showBanner(`Running at ${formatRate(timeScale)}`, 'info', 1400)
  }
}

function frame(timestamp: number): void {
  const surface = resizeSurface(canvas)
  camera = { ...camera, viewport: surface.viewport }

  const elapsed = lastFrame === 0 ? 0 : (timestamp - lastFrame) / 1000
  lastFrame = timestamp

  if (running) {
    // Scale the catch-up cap alongside the rate, or running fast would be throttled by
    // the stall guard rather than by the rate itself.
    const events = runner.advance(elapsed * timeScale, { [PLAYER_ID]: helm }, 0.25 * timeScale)
    if (raceTime(simulation.ctx, runner.world) >= 0) wallClockSinceGun += elapsed
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

  const wind = simulation.ctx.wind.sample(player?.position ?? camera.center, world.time)
  const target = nextMark()
  drawScene(surface.ctx, {
    ctx: simulation.ctx,
    world,
    camera,
    trails,
    playerId: PLAYER_ID,
    started: raceTime(simulation.ctx, world) >= 0,
    medianWindSpeed: simulation.wind.median.speed,
    beatAngle: specOfPlayer().polar.beatAngle(wind.speed),
    ...(target === undefined ? {} : { targetMark: target }),
  })

  if (player) updateInstruments(player, wind.direction, wind.speed)
  requestAnimationFrame(frame)
}

function updateInstruments(player: BoatState, windDirection: number, windSpeed: number): void {
  const spec = specOfPlayer()
  const target = spec.polar.boatSpeed(player.twa, windSpeed)
  const progress = runner.world.race.progress[PLAYER_ID]

  const toLine = startLineDistance(player)
  hud.update({
    speed: player.speed,
    twa: player.twa,
    windDirection,
    windSpeed,
    vmg: Math.abs(velocityMadeGood(player.speed, player.twa)),
    polarRatio: target > 0.1 ? clamp(player.speed / target, 0, 1.5) : 0,
    // Shown in real seconds. What is left of the countdown depends on the rate it will
    // be run off at, so it is projected; what has already gone is what was actually sat
    // through.
    timeToStart: timeToStart(simulation.ctx, runner.world) / timeScale,
    raceTime: wallClockSinceGun,
    status: statusText(),
    timeScale,
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

function announce(event: TimedEvent): void {
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
    case 'contact':
      return hud.showBanner(`Contact with the ${event.otherId}`, 'warn')
    case 'boatFinished': {
      wallClockAtFinish = wallClockSinceGun
      const sailed = runner.world.race.progress[PLAYER_ID]?.finishTime ?? 0
      running = false
      showOverlay(
        'Finished',
        `<b>${wallClockAtFinish.toFixed(1)}s</b> of your time, at ${formatRate(timeScale)}.
         That is <b>${clock(sailed)}</b> of sailing. Press <b>R</b> to race again.`,
      )
      return
    }
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

function playerBoat(boats: readonly BoatState[]): BoatState | undefined {
  return boats.find((boat) => boat.id === PLAYER_ID)
}

function specOfPlayer() {
  const spec = simulation.ctx.specs[PLAYER_ID]
  if (!spec) throw new Error('the player has no boat')
  return spec
}

function showOverlay(title: string, body: string): void {
  overlay.innerHTML = `<div class="card"><h1>${title}</h1><p>${body}</p></div>`
  overlay.dataset.visible = 'true'
}

function hideOverlay(): void {
  overlay.dataset.visible = 'false'
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`the page is missing ${selector}`)
  return element
}
