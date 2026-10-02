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
  type Phase,
  type Placing,
  type RaceReport,
  type Role,
  type Sailor,
  type ServerMessage,
} from '@/net'

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
  /** Where the tiller is. Asked for every time the helm goes up the wire. */
  readonly helm: () => number
  /** Swapped out in tests; a browser needs nothing here. */
  readonly open?: (url: string) => Socket
  /** The clock snapshots are stamped with, in milliseconds. */
  readonly now?: () => number
}

/**
 * How far behind the newest snapshot the fleet is drawn: one message, so there is always
 * a later one to slide towards. Any less and a message arriving late leaves nothing to
 * draw but the last position, and the fleet stutters.
 */
const PLAYBACK_DELAY = 1000 / SNAPSHOT_HZ

/**
 * A seat in the regatta.
 *
 * The server sails the race and says where the boats are twenty times a second. Between
 * those the fleet is drawn moving, by playing back one message behind and sliding from
 * the one before it to the one after — so what is on screen is always a moment old and
 * never a guess. Guessing is what prediction is for, and a hundred milliseconds is two
 * degrees of heading on a boat that turns at twenty-two a second.
 */
export class OnlineRace {
  private socket: Socket | undefined
  private frames: { readonly at: number; readonly world: WorldState }[] = []
  private report: RaceReport = {}
  /** What the race has done since anyone last asked: the banners are made from these. */
  private events: TimedEvent[] = []

  simulation: Simulation | undefined
  you: BoatId | undefined
  role: Role = 'racer'
  phase: Phase = 'lobby'
  fleet: readonly Sailor[] = []
  results: readonly Placing[] | undefined
  /** Whose instruments are shown: your own boat, or whoever an observer is following. */
  watching: BoatId | undefined
  /** What went wrong, if the socket did. */
  trouble: string | undefined
  /** Whether there is a socket to write to. Nothing is sent before there is. */
  private connected = false

  constructor(private readonly options: OnlineOptions) {}

  join(): void {
    const open = this.options.open ?? ((url: string) => new WebSocket(url) as unknown as Socket)
    const socket = open(this.options.url)
    this.socket = socket
    socket.addEventListener('open', (() => {
      this.connected = true
      socket.send(
        JSON.stringify({ kind: 'join', name: this.options.name, role: this.options.role ?? 'racer' }),
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

  /** Where the helm is. Sent whether or not it has moved: silence means gone. */
  sendHelm(): void {
    const racing = this.phase === 'racing' && this.role === 'racer'
    // A sailor in the lobby still has to say she is there, so something goes up the wire
    // either way; only the helm in it differs.
    this.say({ kind: 'helm', rudder: racing ? this.options.helm() : 0 })
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

  leave(): void {
    this.connected = false
    this.socket?.close()
    this.socket = undefined
  }

  /** Everything the race has done since this was last called. */
  takeEvents(): readonly TimedEvent[] {
    const since = this.events
    this.events = []
    return since
  }

  /**
   * The fleet as it should be drawn at this moment, or nothing until two snapshots have
   * arrived and there is something to slide between.
   */
  frameAt(now: number): WorldState | undefined {
    const [previous, latest] = this.frames
    if (!previous || !latest) return this.frames[0]?.world
    const playAt = now - PLAYBACK_DELAY
    const span = latest.at - previous.at
    const t = span > 0 ? (playAt - previous.at) / span : 1
    return interpolateWorld(previous.world, latest.world, Math.max(0, Math.min(1, t)))
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
        this.fleet = message.fleet
        return
      case 'fleet':
        this.phase = message.phase
        this.fleet = message.fleet
        return
      case 'racing':
        this.simulation = createSimulation(message.scenario)
        this.frames = []
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
      case 'results':
        this.results = message.places
        this.phase = 'results'
        return
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
    // Two is all that is needed to slide between, and a third would only be drawn later.
    // Stamped with when it arrived rather than when it was meant to: a clock of our own
    // would drift away from the server's for as long as the two disagreed.
    const at = (this.options.now ?? (() => performance.now()))()
    this.frames = [...this.frames.slice(-1), { at, world }]
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
        // Nobody watching reads these, and the server does not send them.
        passedMark: false,
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

export { HELM_HZ }
