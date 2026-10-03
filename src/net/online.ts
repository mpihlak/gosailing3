import { nearestRank } from '@/foundation/rank'
import type { Seconds } from '@/foundation/units'
import type { BoatId } from '@/domain/boat'
import {
  createSimulation,
  interpolateWorld,
  type BoatProgress,
  type RaceState,
  type Simulation,
  type TimedEvent,
  type WorldState,
} from '@/sim'
import {
  HELM_HZ,
  SNAPSHOT_HZ,
  STATS_EVERY,
  type Command,
  type Phase,
  type Placing,
  type PlaybackStats,
  type RaceReport,
  type Role,
  type Sailor,
  type ServerMessage,
} from './protocol'

/** Enough of a socket to be swapped for one in a test. */
export interface Socket {
  send(text: string): void
  close(): void
  addEventListener(type: 'open' | 'message' | 'close', listen: (event: never) => void): void
}

export interface OnlineOptions {
  readonly url: string
  readonly name: string
  readonly role?: Role
  /** Set by a sailor who is not a person, so she is not handed the race controls. */
  readonly robot?: boolean
  /** Where the tiller is. Asked for every time the helm goes up the wire. */
  readonly helm: () => number
  /** Simulated seconds to a second of the player's time: how the server runs the race. */
  readonly pace: number
  /** Swapped out in tests; a browser needs nothing here. */
  readonly open?: (url: string) => Socket
  /** The clock snapshots are stamped with, in milliseconds. */
  readonly now?: () => number
}

/**
 * The least the fleet is drawn behind the newest snapshot: one message, so on a steady
 * line there is always a later one to slide towards.
 */
const MIN_DELAY = 1000 / SNAPSHOT_HZ
/**
 * The most. Every millisecond of it is a millisecond before her own helm shows, and past
 * this a sailor feels the boat answer late; a stall now and then is the better trade.
 */
const MAX_DELAY = 250
/**
 * How many snapshots lateness is judged over: ten seconds of them. The worst of them is
 * allowed for, not a percentile: a stall makes only its first snapshot that late, and a
 * line that stalls every few seconds needs the stalls covered.
 */
const LATENESS_WINDOW = SNAPSHOT_HZ * 10
/**
 * How fast a delay no longer needed is given back, as a share of the time passing. The
 * fleet plays that much faster until it has caught up, which nobody can see at five
 * percent.
 */
const DELAY_RELEASE = 0.05
/** Snapshots kept to draw from: enough to reach back the longest delay and one more. */
const FRAMES_KEPT = Math.ceil(MAX_DELAY / MIN_DELAY) + 2

/**
 * How far the helm must move before it is worth a message of its own. A tiller under a
 * thumb changes by a hair every frame, and a hair does not steer a boat.
 */
const HELM_STEP = 0.01

/**
 * A seat in the regatta.
 *
 * The server sails the race and says where the boats are thirty times a second. Between
 * those the fleet is drawn moving, by playing back a little behind the newest message
 * and sliding from the one before to the one after — so what is on screen is always a
 * moment old and never a guess. Guessing is what prediction is for, and a hundred
 * milliseconds is two degrees of heading on a boat that turns at twenty-two a second.
 */
export class OnlineRace {
  private socket: Socket | undefined
  private frames: WorldState[] = []
  /**
   * How late each recent snapshot arrived: when it came, less when the server says it was
   * sent. The two clocks have nothing in common, so only the differences between these
   * mean anything, and the earliest is taken as on time. Kept for a window rather than
   * for ever, so two clocks running at slightly different rates are followed, not lost.
   */
  private lateness: number[] = []
  /** How far behind the newest snapshot the fleet is drawn now, in milliseconds. */
  private delay = MIN_DELAY
  /** The simulated moment last drawn. The fleet is never drawn going backwards. */
  private playhead = Number.NEGATIVE_INFINITY
  /** When the last frame was drawn, and when the last snapshot arrived. */
  private lastFrameAt: number | undefined
  private lastSnapshotAt: number | undefined
  /** What has been seen since the last report went up. */
  private frameGaps: number[] = []
  private snapshotGaps: number[] = []
  private held = 0
  private lastStatsAt: number | undefined
  private report: RaceReport = {}
  /** What the race has done since anyone last asked: the banners are made from these. */
  private events: TimedEvent[] = []
  /** Sailors who have gone since anyone last asked. */
  private departed: Sailor[] = []

  simulation: Simulation | undefined
  you: BoatId | undefined
  role: Role = 'racer'
  phase: Phase = 'lobby'
  fleet: readonly Sailor[] = []
  results: readonly Placing[] | undefined
  /** When the next race is due, on the same clock the frames are stamped with. */
  private nextRaceAt: number | undefined
  /** Whose instruments are shown: your own boat, or whoever an observer is following. */
  watching: BoatId | undefined
  /** What went wrong, if the socket did. */
  trouble: string | undefined
  /**
   * How long a message takes to reach the server and come back, in milliseconds, as the
   * server last measured it. Undefined until it has said.
   */
  rtt: number | undefined
  /** Whether there is a socket to write to. Nothing is sent before there is. */
  private connected = false
  /** The helm as the server last heard it, and when, so a still tiller is not resent. */
  private lastRudder = 0
  /** Far enough back that the first helm after joining goes out at once. */
  private lastHelmAt = Number.NEGATIVE_INFINITY

  /** Whether the regatta answers to this page, which is what shows the host's buttons. */
  get hosting(): boolean {
    return this.fleet.some((sailor) => sailor.id === this.you && sailor.host)
  }

  constructor(private readonly options: OnlineOptions) {}

  join(): void {
    const open = this.options.open ?? ((url: string) => new WebSocket(url) as unknown as Socket)
    const socket = open(this.options.url)
    this.socket = socket
    socket.addEventListener('open', (() => {
      this.connected = true
      socket.send(
        JSON.stringify({
          kind: 'join',
          name: this.options.name,
          role: this.options.role ?? 'racer',
          ...(this.options.robot ? { robot: true } : {}),
        }),
      )
    }) as (event: never) => void)
    socket.addEventListener('message', ((event: { data: string }) => {
      this.heard(event.data)
    }) as unknown as (event: never) => void)
    socket.addEventListener('close', (() => {
      this.connected = false
      this.trouble = 'The connection to the regatta closed.'
    }) as (event: never) => void)
  }

  /**
   * Where the helm is.
   *
   * Called every frame, and sent the moment the tiller moves rather than waiting for the
   * next turn of a fixed cadence: waiting cost twenty-five milliseconds on average for
   * nothing, on a message of thirty bytes. When it has not moved this falls back to the
   * slow beat, because silence is how the server decides a sailor has gone.
   */
  sendHelm(): void {
    const racing = this.phase === 'racing' && this.role === 'racer'
    // A sailor in the lobby still has to say she is there; only the helm in it differs.
    const rudder = racing ? this.options.helm() : 0
    const at = this.clock()
    const moved = Math.abs(rudder - this.lastRudder) >= HELM_STEP
    if (!moved && at - this.lastHelmAt < 1000 / HELM_HZ) return
    this.lastRudder = rudder
    this.lastHelmAt = at
    this.say({ kind: 'helm', rudder })
    this.sendStats(at)
  }

  /**
   * What the playback has been like, once every so often while there is a race to play.
   * Asked from the helm because the helm is asked often whatever the page is doing.
   */
  private sendStats(at: number): void {
    this.lastStatsAt ??= at
    if (at - this.lastStatsAt < STATS_EVERY) return
    this.lastStatsAt = at
    if (this.frameGaps.length > 0 || this.snapshotGaps.length > 0) {
      this.say({ kind: 'stats', ...this.takeStats() })
    }
  }

  private takeStats(): PlaybackStats {
    const frames = [...this.frameGaps].sort((a, b) => a - b)
    const gaps = [...this.snapshotGaps].sort((a, b) => a - b)
    const whole = (ms: number | undefined) => Math.round(ms ?? 0)
    const stats = {
      frames: frames.length,
      frameP90: whole(frames.length ? nearestRank(frames, 0.9) : 0),
      frameMax: whole(frames.at(-1)),
      gapP90: whole(gaps.length ? nearestRank(gaps, 0.9) : 0),
      gapMax: whole(gaps.at(-1)),
      held: whole(this.held),
      delay: whole(this.delay),
    }
    this.frameGaps = []
    this.snapshotGaps = []
    this.held = 0
    return stats
  }

  /**
   * Write to the socket, if there is one yet to write to.
   *
   * The helm goes up twenty times a second from the moment she asks to join, which is
   * well before the socket has opened. Sending into one that is still connecting throws,
   * and a server that never answers made it throw every fifty milliseconds for ever.
   */
  private say(message: unknown): void {
    if (!this.connected) return
    this.socket?.send(JSON.stringify(message))
  }

  /** Ask the regatta to cut the race short. Ignored by the server unless we are host. */
  order(command: Command): void {
    this.say({ kind: 'command', command })
  }

  leave(): void {
    this.connected = false
    this.socket?.close()
    this.socket = undefined
  }

  /**
   * Seconds until the next race, counting down to one and then nothing. Undefined when
   * the server never said, which is the only case the card falls back to a plain line.
   */
  secondsToNextRace(now: number): number | undefined {
    if (this.nextRaceAt === undefined) return undefined
    return Math.max(0, Math.ceil((this.nextRaceAt - now) / 1000))
  }

  /**
   * Take the fleet as it now stands, noting who is no longer in it.
   *
   * A boat whose sailor has gone keeps sailing: the server hands her a helm amidships,
   * so she holds her last heading and stands off towards the horizon. Anyone watching
   * deserves to be told why, rather than left to wonder what she is up to.
   */
  private muster(fleet: readonly Sailor[]): void {
    const still = new Set(fleet.map((sailor) => sailor.id))
    this.departed.push(...this.fleet.filter((sailor) => !still.has(sailor.id)))
    this.fleet = fleet
  }

  /** Who has gone since this was last called. */
  takeDepartures(): readonly Sailor[] {
    const since = this.departed
    this.departed = []
    return since
  }

  /** Everything the race has done since this was last called. */
  takeEvents(): readonly TimedEvent[] {
    const since = this.events
    this.events = []
    return since
  }

  /**
   * The fleet as it should be drawn at this moment, or nothing until a snapshot has
   * arrived.
   *
   * Snapshots are placed on the server's timeline, not by when they arrived, and drawn
   * far enough behind the newest to ride out the lateness the line has lately shown. One
   * that arrives late then changes nothing on screen, where stamping by arrival made the
   * fleet stop and then jump.
   */
  frameAt(now: number): WorldState | undefined {
    const elapsed = this.lastFrameAt === undefined ? 0 : now - this.lastFrameAt
    if (this.lastFrameAt !== undefined) this.frameGaps.push(elapsed)
    this.lastFrameAt = now
    const latest = this.frames.at(-1)
    if (!latest) return undefined

    this.delay = Math.max(this.wantedDelay(), this.delay - DELAY_RELEASE * elapsed)
    const onTime = Math.min(...this.lateness)
    const wanted = this.simulated(now - onTime - this.delay)
    this.playhead = Math.max(this.playhead, wanted)
    if (this.playhead > latest.time) this.held += elapsed
    const at = Math.min(this.playhead, latest.time)

    const next = this.frames.findIndex((frame) => frame.time > at)
    if (next === -1) return latest
    const before = this.frames[next - 1]
    const after = this.frames[next]!
    if (!before) return after
    return interpolateWorld(before, after, (at - before.time) / (after.time - before.time))
  }

  /** The fleet as the newest snapshot has it, for steering rather than drawing. */
  newest(): WorldState | undefined {
    return this.frames.at(-1)
  }

  /** How far behind to draw to cover the lateness lately seen. */
  private wantedDelay(): number {
    const allowance = Math.max(...this.lateness) - Math.min(...this.lateness)
    return Math.min(MAX_DELAY, MIN_DELAY + allowance)
  }

  /** The server's clock, in milliseconds, as simulated seconds. */
  private simulated(ms: number): Seconds {
    return (ms / 1000) * this.options.pace
  }

  private clock(): number {
    return (this.options.now ?? (() => performance.now()))()
  }

  private heard(text: string): void {
    let message: ServerMessage
    try {
      message = JSON.parse(text) as ServerMessage
    } catch {
      return
    }
    switch (message.kind) {
      case 'welcome':
        this.you = message.you
        this.role = message.role
        this.watching = message.role === 'racer' ? message.you : undefined
        this.phase = message.phase
        this.muster(message.fleet)
        return
      case 'fleet':
        this.phase = message.phase
        this.muster(message.fleet)
        return
      case 'racing':
        this.simulation = createSimulation(message.scenario)
        // A new race starts its clock at nought, so what was learnt of the last one's is no use.
        this.frames = []
        this.lateness = []
        this.playhead = Number.NEGATIVE_INFINITY
        this.lastSnapshotAt = undefined
        this.report = {}
        this.events = []
        this.results = undefined
        this.phase = 'racing'
        return
      case 'snapshot':
        if (message.race) this.report = message.race
        this.events.push(...message.events)
        this.remember(message.time, message.boats)
        return
      case 'timing':
        // Whatever the far end says is only data. A number or nothing.
        this.rtt = Number.isFinite(message.rtt) ? message.rtt : undefined
        return
      case 'results': {
        this.results = message.places
        this.phase = 'results'
        const due = message.nextRaceIn
        // A server that does not say loses the countdown and nothing else.
        this.nextRaceAt =
          typeof due === 'number' && Number.isFinite(due) ? this.clock() + due * 1000 : undefined
        return
      }
    }
  }

  private remember(time: Seconds, boats: WorldState['boats']): void {
    const world: WorldState = {
      tick: 0,
      time,
      boats,
      race: this.raceState(),
      contacts: [],
      incidents: {},
    }
    const at = this.clock()
    if (this.lastSnapshotAt !== undefined) this.snapshotGaps.push(at - this.lastSnapshotAt)
    this.lastSnapshotAt = at
    this.lateness = [
      ...this.lateness.slice(1 - LATENESS_WINDOW),
      at - (time / this.options.pace) * 1000,
    ]
    this.frames = [...this.frames.slice(1 - FRAMES_KEPT), world]
  }

  /** The race as the simulation would hold it, from the little the server sends. */
  private raceState(): RaceState {
    const progress: Record<BoatId, BoatProgress> = {}
    for (const [id, boat] of Object.entries(this.report)) {
      progress[id] = {
        boatId: id,
        status: boat.status,
        stageIndex: boat.stageIndex,
        penalties: boat.penalties,
        passedMark: boat.passedMark,
        // Nobody watching reads these, and the server does not send them.
        clearedPreStart: true,
        clearedToFinish: false,
        distanceSailed: 0,
        ...(boat.place === undefined ? {} : { place: boat.place }),
        ...(boat.finishTime === undefined ? {} : { finishTime: boat.finishTime }),
      }
    }
    const home = Object.entries(this.report)
      .filter(([, boat]) => boat.place !== undefined)
      .sort((one, two) => (one[1].place ?? 0) - (two[1].place ?? 0))
      .map(([id]) => id)
    return {
      phase: home.length > 0 && home.length === Object.keys(progress).length ? 'complete' : 'racing',
      progress,
      finishOrder: home,
    }
  }
}

