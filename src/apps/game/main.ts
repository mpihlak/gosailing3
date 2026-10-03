import { vec } from '@/foundation/geom'
import type { BoatId, BoatState } from '@/domain/boat'
import type { Mark } from '@/domain/course'
import {
  type InputSource,
  type WorldState,
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
import { Helm, Tiller, type HelmCommand } from '@/presentation/input'
import { formatRate } from '@/presentation/view/timescale'
import {
  clock,
  cssColor,
  escapeHtml,
  Hud,
  OCS,
  StandingsBoard,
  targetVmgRatio,
  type CrewReading,
  timing,
} from '@/presentation/ui'
import { Skipper } from '@/agents/ai'
import { HELM_HZ, OnlineRace, type Placing } from '@/net'
import { DEFAULT_SERVER, duel, GAME_PACE, playerSeconds, PLAYER_ID, randomSeed } from './scenario'

const canvas = requireElement<HTMLCanvasElement>('#stage')
const hud = new Hud(
  requireElement<HTMLElement>('#hud'),
  requireElement<HTMLElement>('[data-banner]'),
)
const overlay = requireElement<HTMLElement>('#overlay')
const hostControls = requireElement<HTMLElement>('#host')
const standingsPanel = requireElement<HTMLElement>('#standings')
/** The telltales are drawn on the canvas; this is the place the page keeps for them. */
const telltalesSlot = requireElement<HTMLElement>('#telltales')

/** How much water to show across the short edge of the screen. */
const METERS_ACROSS = 420
/** However small the screen, the boat is drawn at least this long. */
const LEAST_BOAT_PIXELS = 20

/** Whether this is a finger rather than a mouse, which decides what the cards say. */
const BY_TOUCH = window.matchMedia('(pointer: coarse)').matches

/** How much faster the race runs while the boost key is held. */
const BOOST = 2

/**
 * The angle the laylines are drawn at: the forty-five degrees sailors use to judge a
 * tack, rather than the polar beat angle.
 *
 * A boat does not travel along her heading. Leeway carries her to leeward, so where she
 * points 37 to 43 degrees off the wind depending on the breeze, her track over the
 * ground runs 42 to 46. Drawing the laylines at the pointing angle put them where no
 * boat could lay the mark.
 */
/** The least time between two notices of who is being watched. */
const WATCHING_NOTICE_GAP = 3000

const LAYLINE_ANGLE = 45

/** How to sail her, written once so no two cards can drift apart. */
const CONTROLS = BY_TOUCH
  ? `Pull the <b>tiller</b> at the foot of the screen to steer — hold it over and she
     keeps turning, let go and it centres.
     <br />Tap the water to stop and carry on. Tap this card to start.`
  : `<b>← →</b> or <b>A D</b> steer · <b>Space</b> start and pause · <b>R</b> new race
     <br /><b>W</b> wind shadows · <b>L</b> laylines · <b>H</b> or <b>?</b> these keys
     <br />Hold <b>Shift</b> to watch the race run on`

/** The same list, less what a race on a server has no answer for. */
const REGATTA_CONTROLS = BY_TOUCH
  ? `Pull the <b>tiller</b> at the foot of the screen to steer — hold it over and she
     keeps turning, let go and it centres.
     <br />The race is sailed on the server, so there is nothing here to pause.`
  : `<b>← →</b> or <b>A D</b> steer · <b>W</b> wind shadows · <b>L</b> laylines
     <br /><b>H</b> or <b>?</b> these keys
     <br />The race is sailed on the server: it cannot be paused or hurried, and the
     host is the one who ends it or starts another.`

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
/** Whether the boost key was down last frame, so the change is announced once. */
let boosting = false
/** Where the telltales sit, measured off the place the page keeps for them. */
let panelAnchor = { left: 16, top: 16 }
/**
 * What tapping the card does. There is no keyboard on a phone, so it has to do
 * something. Declared here with the rest of the state and not beside the function that
 * sets it: the first card goes up while this module is still being evaluated, and a let
 * further down the file is not yet alive to be assigned to.
 */
let onCardTap: (() => void) | undefined
let measuredAt = ''
/**
 * The race as it stands, and the boat the screen belongs to.
 *
 * Set from the runner when the race is sailed here and from the last snapshot when it is
 * sailed on a server, so everything that draws or reads an instrument asks these two and
 * never asks where the race came from.
 */
let latest: WorldState
let watching: BoatId = PLAYER_ID
/** How long her colour is held up before the regatta is shown at all. */
const GREETING = 1000
/** When she was told which boat is hers, so it is told once and only once. */
let greetedAt: number | undefined

/** The boat a sailor with none of her own was last told she is watching. */
let following: BoatId | undefined
let followingSince = 0

const helm = new Helm({ onCommand: handleCommand })
helm.attach(canvas)

const tillerBar = document.querySelector<HTMLElement>('#tiller')
if (tillerBar) {
  const tiller = new Tiller()
  tiller.attach(tillerBar)
  helm.tiller = tiller
}
overlay.addEventListener('pointerup', () => onCardTap?.())


/**
 * A regatta to join, if there is one. Without it the race is sailed here against the
 * computer, which is the game as it was.
 *
 *   index.html?network                       the regatta everyone else is in
 *   index.html?network&name=Ann              and say who you are
 *   index.html?server=ws://localhost:8080    one of your own, for development
 *   index.html?network&watch=1               watch rather than sail
 *
 * A name is optional on purpose. There is no comfortable way to type one on a phone, so
 * the server gives every sailor a color and that is what she is called.
 */
const asked = new URLSearchParams(window.location.search)
const server = asked.has('network') ? DEFAULT_SERVER : asked.get('server')
let online: OnlineRace | undefined

if (server) joinRegatta(server, asked.get('name') ?? '', asked.get('watch') !== null)
else start(randomSeed())
requestAnimationFrame(frame)

function joinRegatta(url: string, name: string, watching: boolean): void {
  const role = watching ? 'observer' : 'racer'
  online = new OnlineRace({
    url,
    name,
    role,
    helm: () => helm.rudder,
  })
  online.join()
  hostControls.addEventListener('click', (event) => {
    const command = (event.target as HTMLElement).closest('button')?.dataset.command
    if (command === 'endRace' || command === 'restart') return online?.order(command)
    if (command === 'toggleShadows' || command === 'toggleLaylines') handleCommand(command)
  })
  // The toggles carry their setting from the start, not only once one is tapped.
  paintViewToggles()
  // A tab that has stopped drawing gets no frames, and silence is how the server decides
  // a sailor has gone. This keeps her alive; the frame loop is what makes her quick.
  window.setInterval(() => online?.sendHelm(), 1000 / HELM_HZ)
  showLobby()
}

/** The host's buttons belong on the water, where there is a race to cut short. */
function showHostControls(visible: boolean): void {
  hostControls.dataset.visible = visible ? 'true' : 'false'
}

/** Which way the two view aids are set, since a button says nothing by being tapped. */
function paintViewToggles(): void {
  const mark = (command: string, on: boolean) => {
    const button = hostControls.querySelector<HTMLElement>(`[data-command="${command}"]`)
    if (button) button.dataset.on = on ? 'true' : 'false'
  }
  mark('toggleShadows', showShadows)
  mark('toggleLaylines', showLaylines)
}

/** What the card says while there is no race to draw. */
function showLobby(): void {
  const race = online
  if (!race) return
  if (race.trouble) return showOverlay('Disconnected', `<p>${race.trouble}</p>`, () => undefined)

  const crew = race.fleet
    .map((sailor) => {
      const mine = sailor.id === race.you ? ' — you' : ''
      const waiting = sailor.waiting ? ' (next race)' : ''
      const color = cssColor(sailor.color)
      const paint = color ? ` style="color: ${color}"` : ''
      return `<b${paint}>${escapeHtml(sailor.name)}</b>${mine}${waiting}`
    })
    .join('<br />')

  const waitingForARace =
    race.phase === 'racing'
      ? 'A race is on. You are in the next one.'
      : `Waiting for another boat. ${race.fleet.length} here.`

  showOverlay('Regatta', `<p>${waitingForARace}<br /><br />${crew || 'Nobody yet.'}</p>`, () =>
    undefined,
  )
}

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
  latest = runner.world
  watching = PLAYER_ID

  const surface = resizeSurface(canvas)
  const player = playerBoat(latest.boats)
  camera = createCamera(surface.viewport, player?.position ?? vec(0, 0), METERS_ACROSS, boatFloor())

  if (immediate) {
    running = true
    hideOverlay()
    return
  }

  showOverlay(
    'Ready to race',
    `<p>You are <b style="color: ${PALETTE.hullBlue}">Blue</b>, racing
     <b style="color: ${PALETTE.hullRed}">Red</b>.
     <br />The gun is in thirty seconds. Cross the line, leave the orange mark to port,
     and come back through the line to finish.
     <br /><br />${CONTROLS}</p>`,
    () => handleCommand('toggleRun'),
  )
}

function handleCommand(command: HelmCommand): void {
  if (command === 'restart') {
    /*
     * A regatta is the server's to restart, and it has a button for it. Starting a race
     * here would have dropped a sailor out of the one she is in and into a race against
     * the computer, with the socket still open behind it.
     */
    if (online) {
      if (online.hosting) online.order('restart')
      else hud.showBanner('Only the host can restart a network race', 'info', 2200)
      return
    }
    // Straight into the next race: restarting is what you do when you want another go,
    // not something to be asked about.
    start(randomSeed(), true)
    return
  }
  if (command === 'toggleRun') {
    /*
     * The race is being sailed on a server and runs on whether or not this page is
     * watching, so there is nothing here to stop. A Paused card over a race still
     * running is a worse answer than saying so.
     */
    if (online) {
      hud.showBanner('A network race cannot be paused', 'info', 2200)
      return
    }
    running = !running
    if (running) hideOverlay()
    else {
      showOverlay(
        'Paused',
        `<p>${BY_TOUCH ? 'Tap to carry on.' : 'Press <b>Space</b> to carry on.'}</p>`,
        () => handleCommand('toggleRun'),
      )
    }
  }
  if (command === 'help') {
    // Online the card is the only thing to put away, since there is no race here to
    // carry on with. Dismissing through toggleRun would leave it stuck on the screen.
    showOverlay('Controls', `<p>${online ? REGATTA_CONTROLS : CONTROLS}</p>`, () =>
      online ? hideOverlay() : handleCommand('toggleRun'),
    )
    if (!online) running = false
  }
  if (command === 'toggleShadows') {
    showShadows = !showShadows
    hud.showBanner(`Wind shadows ${showShadows ? 'on' : 'off'}`, 'info', 1400)
    paintViewToggles()
  }
  if (command === 'toggleLaylines') {
    showLaylines = !showLaylines
    hud.showBanner(`Laylines ${showLaylines ? 'on' : 'off'}`, 'info', 1400)
    paintViewToggles()
  }
}

/** The rate the player is watching at: her own, or doubled while she holds the key. */
function watchRate(): number {
  // A regatta runs at the server's pace. Nothing here can hurry it, so the key that
  // hurries a race at home is left out rather than reported as doing something.
  return helm.boost && !online ? BOOST : 1
}

/**
 * Put the telltales where the page has left room for them. The stylesheet decides where
 * that is — beside the instruments on a laptop, under them on a phone — so the renderer
 * follows the layout rather than repeating its arithmetic. Reading a layout is not free,
 * so it is done when the viewport changes and not every frame.
 */
function measurePanels(width: number, height: number): void {
  const key = `${width}x${height}`
  if (key === measuredAt) return
  measuredAt = key

  const canvasBox = canvas.getBoundingClientRect()
  const slot = telltalesSlot.getBoundingClientRect()
  panelAnchor = {
    left: Math.max(0, Math.round(slot.left - canvasBox.left)),
    top: Math.max(0, Math.round(slot.top - canvasBox.top)),
  }
}

/**
 * One frame, and the next one asked for whatever happened in it. A frame that threw
 * before asking used to stop the race for good, which on a bad snapshot meant a screen
 * that never moved again.
 */
function frame(timestamp: number): void {
  try {
    // Before drawing, so a tiller that has just moved is on its way while this frame is
    // still being painted. It sends only when the helm has moved or the beat is due.
    online?.sendHelm()
    drawFrame(timestamp)
  } catch (trouble) {
    console.error(trouble)
  }
  requestAnimationFrame(frame)
}

function drawFrame(timestamp: number): void {
  if (online && !takeFromRegatta(timestamp)) return
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

  if (!online && helm.boost !== boosting) {
    boosting = helm.boost
    hud.showBanner(`Watching at ${formatRate(watchRate())}`, 'info', 1200)
  }

  if (running && !online) {
    // Scale the catch-up cap alongside the rate, or running fast would be throttled by
    // the stall guard rather than by the rate itself.
    const pace = GAME_PACE * watchRate()
    const events = runner.advance(elapsed * pace, sources, 0.25 * pace)
    // Before the events are read out: one of them may be the finish, and the card it
    // puts up is written from where the race stands now.
    latest = runner.world
    for (const event of events) announce(event)
  }

  const world = online
    ? latest
    : interpolateWorld(runner.previous, runner.world, running ? runner.alpha : 1)
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
    latest,
    player?.position ?? camera.center,
    player?.id,
  )
  const target = nextMark()
  drawScene(surface.ctx, {
    ctx: simulation.ctx,
    world,
    camera,
    trails,
    playerId: watching,
    styles,
    started: raceTime(simulation.ctx, world) >= 0,
    medianWindSpeed: simulation.wind.median.speed,
    displayTime: playerSeconds(world.time),
    panelAnchor,
    beatAngle: specOfPlayer().polar.beatAngle(wind.speed),
    runAngle: specOfPlayer().polar.runAngle(wind.speed),
    showShadows,
    showLaylines,
    laylineAngle: LAYLINE_ANGLE,
    ...(target === undefined ? {} : { targetMark: target }),
  })

  if (player) updateInstruments(player, wind.speed)
  board.update(standings(simulation.ctx, latest), watching, boardReadings(world.boats))
}

/**
 * Take the fleet as the server last had it. False while there is nothing to draw — before
 * a race, between races, or before the first two snapshots have arrived.
 */
function takeFromRegatta(timestamp: number): boolean {
  const race = online
  if (!race) return false

  /*
   * Which boat is hers, before anything else reaches the screen. A sailor on a phone
   * never typed a name, so the colour is the only thing telling her which of the boats
   * on the water to steer, and she should not have to find it in a list.
   */
  const hers = race.fleet.find((sailor) => sailor.id === race.you)
  if (hers && greetedAt === undefined) {
    greetedAt = timestamp
    const paint = cssColor(hers.color)
    showOverlay(
      'You are',
      `<p class="yours"${paint ? ` style="color: ${paint}"` : ''}>${escapeHtml(hers.name)}</p>`,
      () => undefined,
    )
  }
  if (greetedAt !== undefined && timestamp - greetedAt < GREETING) return false

  if (race.phase !== 'racing' || !race.simulation) {
    showHostControls(false)
    if (race.phase === 'results' && race.results) {
      showRegattaResults(race.results, race.secondsToNextRace(timestamp))
    }
    else showLobby()
    return false
  }

  const drawn = race.frameAt(timestamp)
  if (!drawn) return false

  /*
   * Whose boat the view sits on. Her own, when she has one in the water: an onlooker
   * never does, and neither does a sailor who arrived while this race was already being
   * sailed and is waiting for the next. Both of those follow whoever is leading.
   *
   * Asking for her own boat regardless is what put a late third sailor in front of a
   * blank screen: the camera went to a boat that was not in the race, and every frame
   * threw before it drew anything.
   */
  const own = race.watching
  const hasBoat = own !== undefined && drawn.boats.some((boat) => boat.id === own)
  const follow = hasBoat ? own : standings(race.simulation.ctx, drawn)[0]?.boatId
  if (!follow) return false

  const fresh = simulation !== race.simulation
  simulation = race.simulation
  latest = drawn
  watching = follow

  if (fresh) {
    trails = new TrailStore()
    styles = stylesFromFleet(race)
    board = new StandingsBoard(
      standingsPanel,
      simulation.names,
      Object.fromEntries(Object.entries(styles).map(([id, style]) => [id, style.hull])),
    )
    // The camera is made here as well as at the start of a race sailed at home: this
    // page may never have sailed one, and there is nothing to spread over.
    const surface = resizeSurface(canvas)
    const mine = drawn.boats.find((boat) => boat.id === watching)
    camera = createCamera(surface.viewport, mine?.position ?? vec(0, 0), METERS_ACROSS, boatFloor())
    hideOverlay()
    running = true
    following = undefined
  }

  if (!hasBoat) noteFollowing(follow, race.role === 'observer', timestamp)
  showHostControls(race.hosting)

  /*
   * The banners are made from what the race did, and what it did comes down the wire with
   * the boats. The finish is the exception: the server scores that one, because it knows
   * about a boat who was timed out or who left, and the simulation only knows who crossed.
   */
  for (const event of race.takeEvents()) {
    if (event.kind !== 'raceFinished') announce(event)
  }
  return true
}

/**
 * Colours come from the regatta, not from who is the player here: online there is no
 * opponent, only a fleet, and every boat in it was given a colour when she joined.
 */
function stylesFromFleet(race: OnlineRace): Record<string, BoatStyle> {
  return Object.fromEntries(
    race.fleet
      .filter((sailor) => sailor.role === 'racer')
      .map((sailor) => [
        sailor.id,
        { hull: sailor.color, trail: sailor.color, trailWidth: sailor.id === race.you ? 2 : 1.5 },
      ]),
  )
}

/**
 * Tell whoever has no boat in this race what she is looking at.
 *
 * The view follows the leader and the lead changes hands, so it is said again when it
 * does — but not twice in a breath, or a pair swapping places down a run would say
 * nothing else.
 */
function noteFollowing(boatId: BoatId, spectating: boolean, timestamp: number): void {
  if (boatId === following) return
  if (following !== undefined && timestamp - followingSince < WATCHING_NOTICE_GAP) return
  following = boatId
  followingSince = timestamp
  const name = simulation.names[boatId] ?? boatId
  hud.showBanner(
    spectating ? `Watching the leader, ${name}` : `In the next race — watching ${name}`,
    'info',
  )
}

/** The finishing order as the server scored it, which is not always by crossing a line. */
function showRegattaResults(places: readonly Placing[], startsIn: number | undefined): void {
  const rows = places
    .map((one) => {
      const how =
        one.outcome === 'finished' ? timing(one.elapsed ?? 0) : one.outcome === 'retired' ? 'left' : 'DNF'
      const mine = one.boatId === online?.you ? ' class="mine"' : ''
      return `<tr${mine}><td>${escapeHtml(one.place ?? '')}</td><td>${escapeHtml(one.name)}</td><td>${how}</td></tr>`
    })
    .join('')
  showOverlay('Results', `<table class="results">${rows}</table>${comingUp(startsIn)}`, () =>
    undefined,
  )
}

/** The wait before the next race, counted down, so nobody is left wondering. */
function comingUp(startsIn: number | undefined): string {
  if (startsIn === undefined) return '<p>The next race is coming.</p>'
  if (startsIn <= 0) return '<p>The next race is starting.</p>'
  return `<p>The next race is coming in <b class="count">${startsIn}</b></p>`
}

function updateInstruments(player: BoatState, windSpeed: number): void {
  const spec = specOfPlayer()
  const progress = latest.race.progress[watching]

  hud.update({
    speed: player.speed,
    twa: player.twa,
    windSpeed,
    vmgRatio: targetVmgRatio(spec.polar, player.speed, player.twa, windSpeed),
    timeToStart: playerSeconds(timeToStart(simulation.ctx, latest)),
    raceTime: playerSeconds(raceTime(simulation.ctx, latest)),
    ...(progress?.place === undefined ? {} : { place: progress.place }),
  })
}

/** What the board says about each boat. Speeds come from the interpolated frame, so they
 *  read as smoothly as the boats move. */
function boardReadings(boats: readonly BoatState[]): Record<string, CrewReading> {
  return Object.fromEntries(
    boats.map((boat) => [boat.id, { doing: doingText(boat.id), speed: boat.speed }]),
  )
}

/** What a boat is sailing for now, said the way the board says it. */
function doingText(boatId: string): string {
  const progress = latest.race.progress[boatId]
  if (!progress) return ''
  if (progress.status === 'overEarly') return OCS
  if (progress.status === 'finished') return 'finished'
  const stage = simulation.ctx.course.stages[progress.stageIndex]
  if (!stage) return 'finished'
  if (stage.kind === 'start') return 'to start'
  if (stage.kind === 'mark') return `to ${stage.mark.name.toLowerCase()}`
  return 'to finish'
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
  const mine = !('boatId' in event) || event.boatId === watching
  /*
   * What happens to a rival is mostly not news: told about all of it, the player gets a
   * report of her mark rounding and a finish card when she crosses the line. Her penalty
   * is the exception. It decides who wins, and nothing else on the water shows it — a
   * mark gives way rather than stopping her, so she sails through it and sails on.
   */
  if (!mine && event.kind !== 'penalised') return

  switch (event.kind) {
    case 'raceStarted':
      return hud.showBanner('Go!', 'good', 1600)
    case 'overEarly':
      return hud.showBanner('Over early — go back and cross again', 'warn', 3200)
    case 'cleared':
      return hud.showBanner('Cleared', 'good', 1600)
    case 'boatStarted':
      return hud.showBanner(`Started ${playerSeconds(event.late).toFixed(1)}s after the gun`, 'info')
    case 'markRounded':
      return hud.showBanner('Mark rounded — head for the line', 'good')
    case 'penalised': {
      const cause = event.rule === undefined ? 'touched a mark' : `rule ${event.rule}`
      // Named rather than addressed, because the same line reports a rival's penalty.
      return hud.showBanner(
        `Penalty to ${nameOf(event.boatId)} — ${cause}`,
        mine ? 'warn' : 'info',
        mine ? 3600 : 3000,
      )
    }
    case 'penaltiesCancelled':
      return hud.showBanner('Penalties cancel — nothing owed', 'good', 2600)
    // A coming-together is reported as the penalty it earns. Announcing the contact as
    // well overwrote that with a vaguer line naming a boat by her id.
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
    case 'boatFinished': {
      // Her own finish is worth saying, but the race is not over until the rest of the
      // fleet is home, and it carries on until it is.
      const elapsed = playerSeconds(latest.race.progress[watching]?.finishTime ?? 0)
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

function nameOf(boatId: string): string {
  return simulation.names[boatId] ?? boatId
}

function nextMark(): Mark | undefined {
  const progress = latest.race.progress[watching]
  const stage = progress && simulation.ctx.course.stages[progress.stageIndex]
  return stage?.kind === 'mark' ? stage.mark : undefined
}

function boatFloor() {
  return { boatLength: simulation.ctx.specs[watching]?.length ?? 10, leastPixels: LEAST_BOAT_PIXELS }
}

function playerBoat(boats: readonly BoatState[]): BoatState | undefined {
  return boats.find((boat) => boat.id === watching)
}

function specOfPlayer() {
  const spec = simulation.ctx.specs[watching]
  if (!spec) throw new Error('the player has no boat')
  return spec
}

/** The finishing order, once the last boat is home. */
function showResults(): void {
  const { race } = latest
  const rows = race.finishOrder
    .map((boatId) => {
      const progress = race.progress[boatId]
      const elapsed = playerSeconds(progress?.finishTime ?? 0)
      const name = escapeHtml(simulation.names[boatId] ?? boatId)
      const color = cssColor(styles[boatId]?.hull)
      const paint = color ? ` style="color: ${color}"` : ''
      const mine = boatId === watching ? ' class="mine"' : ''
      return `<tr${mine}><td>${escapeHtml(progress?.place ?? '')}</td><td${paint}>${name}</td><td>${timing(elapsed)}</td></tr>`
    })
    .join('')

  showOverlay(
    'Results',
    `<table class="results">${rows}</table>
     <p>${BY_TOUCH ? 'Tap for another race.' : 'Press <b>R</b> to race again.'}</p>`,
    () => handleCommand('restart'),
  )
}

/**
 * The only way a card goes up, and `onTap` is not optional: there is no keyboard on a
 * phone, so a card that does not say what tapping it does is a dead end. The results card
 * was exactly that — it invited a tap for another race and answered nothing.
 *
 * `body` is the card's own markup, headline apart, because the results are a table and
 * everything else is a paragraph.
 */
function showOverlay(title: string, body: string, onTap: () => void): void {
  overlay.innerHTML = `<div class="card"><h1>${title}</h1>${body}</div>`
  overlay.dataset.visible = 'true'
  onCardTap = onTap
}

function hideOverlay(): void {
  overlay.dataset.visible = 'false'
  onCardTap = undefined
}


function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`the page is missing ${selector}`)
  return element
}
