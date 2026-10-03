import type { Seconds } from '@/foundation/units'
import type { BoatId } from '@/domain/boat'
import {
  createSimulation,
  SimulationRunner,
  raceTime,
  timeToStart,
  type InputSource,
  type ScenarioSpec,
  type Simulation,
  type TimedEvent,
} from '@/sim'
import { Skipper } from '@/agents/ai'
import {
  SNAPSHOT_HZ,
  type Addressed,
  type Command,
  type FleetColor,
  type ClientMessage,
  type BoatReport,
  type Outcome,
  type Phase,
  type Placing,
  type RaceReport,
  type Role,
  type Sailor,
} from './protocol'

export interface RegattaLimits {
  /** Racers wanted before a race starts. */
  readonly fleetSize: number
  /**
   * And the most that will ever sail one. Whoever arrives after that is seated as an
   * observer: she sees the racing and is told what she is, rather than being turned away
   * at a door that cannot explain itself.
   */
  readonly maxRacers: number
  /** What the rest of the fleet gets after the winner, as a fraction of her time. */
  readonly timeLimitFraction: number
  /**
   * A race nobody finishes is abandoned after this, in the player's seconds.
   *
   * The time limit above only starts when somebody crosses the line, and a boat can fail
   * to finish without ever retiring — sail past the end of the line and she is neither
   * started nor over early nor coming back. One of those on her own cannot hold the rest
   * up, because they finish and the limit runs; a fleet of them would wait for ever.
   */
  readonly abandonAfter: Seconds
  /** Silence this long, in the player's seconds, and a sailor is treated as gone. */
  readonly idleAfter: Seconds
  /**
   * How long the results stand before the next race is made up. The fleet is counting
   * down to it, so it is short enough to count: five, four, three, two, one.
   */
  readonly resultsFor: Seconds
}

const DEFAULTS: RegattaLimits = {
  fleetSize: 2,
  maxRacers: 10,
  timeLimitFraction: 0.3,
  abandonAfter: 600,
  idleAfter: 10,
  resultsFor: 5,
}

export interface RegattaOptions {
  /** Make the race these sailors are about to sail. */
  readonly race: (seed: string, sailors: readonly { id: BoatId; name: string }[]) => ScenarioSpec
  readonly seed: () => string
  /** Simulated seconds per second of a player's time. */
  readonly pace: number
  /** Handed out as sailors arrive, one boat to a color. */
  readonly colors: readonly FleetColor[]
  /** What an onlooker is marked with, who is not racing and needs no boat color. */
  readonly watcherColor: FleetColor
  readonly limits?: Partial<RegattaLimits>
}

interface Entry {
  /** What the fleet calls her: her color, and the name she gave in brackets after it. */
  readonly name: string
  readonly role: Role
  readonly color: FleetColor
  /** Set while she is waiting for the race being sailed to end. */
  waiting: boolean
  /** When she was last heard from, in the player's seconds since the server started. */
  heard: Seconds
  rudder: number
  robot?: Skipper
}

/** Where she came, with everyone who never crossed the line behind everyone who did. */
function place(placing: { readonly place?: number }): number {
  return placing.place ?? Number.POSITIVE_INFINITY
}

/** The name she gave, or her colour when she gave none. */
function markedAs(color: FleetColor, given: string): string {
  return given || color.name
}

/**
 * One regatta: a lobby, a race, a result, and round again.
 *
 * It owns the race and the clock and knows nothing of sockets. Time only moves when
 * `tick` is called, so a test can sail a whole race in a loop and read every message the
 * server would have sent.
 */
export class Regatta {
  private readonly limits: RegattaLimits
  private readonly entries = new Map<BoatId, Entry>()
  private phase: Phase = 'lobby'
  private simulation: Simulation | undefined
  private runner: SimulationRunner | undefined
  /**
   * Who is in the race being sailed, and under what name. Held here rather than looked up
   * when the results are made, because a sailor who leaves is still on the result sheet
   * and her name went with her connection.
   */
  private starters = new Map<BoatId, string>()
  private retired = new Set<BoatId>()
  /**
   * What each sailor has taken from the regatta, kept for as long as she is connected.
   * Nothing writes it down: a server that restarts starts the scoring again, and a
   * sailor who leaves and comes back is a new sailor with nothing to her name.
   */
  private readonly tally = new Map<BoatId, number>()
  private pending: TimedEvent[] = []
  /** The last report written out, so an unchanged one is not written again. */
  private lastRace: string | undefined
  private sinceSnapshot = 0
  private resultsSince = 0
  /** The player's seconds since the server started. */
  private now: Seconds = 0

  constructor(private readonly options: RegattaOptions) {
    this.limits = { ...DEFAULTS, ...options.limits }
  }

  get state(): Phase {
    return this.phase
  }

  get fleet(): readonly Sailor[] {
    const host = this.host()
    return [...this.entries].map(([id, entry]) => ({
      id,
      name: entry.name,
      colorName: entry.color.name,
      role: entry.role,
      color: entry.color.hex,
      waiting: entry.waiting,
      host: id === host,
    }))
  }

  /**
   * Who answers for the regatta: the racer who has been here longest, since the entries
   * are held in the order they arrived. Nobody, when there is no racer to ask.
   */
  private host(): BoatId | undefined {
    return this.racers()[0]?.[0]
  }

  /** A sailor says something. Her connection id is the id her boat will race under. */
  say(id: BoatId, message: ClientMessage): Addressed[] {
    if (message.kind === 'join') return this.join(id, message.name, message.role ?? 'racer')
    const entry = this.entries.get(id)
    if (!entry) return []
    entry.heard = this.now
    if (message.kind === 'helm') entry.rudder = Math.max(-1, Math.min(1, message.rudder))
    if (message.kind === 'command') return this.obey(id, message.command)
    return []
  }

  /**
   * A race can drag on with nobody able to finish it, so the host may cut it short. Only
   * the host, and only when there is a race to cut.
   */
  private obey(id: BoatId, command: Command): Addressed[] {
    if (id !== this.host()) return []
    if (command === 'restart') {
      if (this.phase === 'lobby') return []
      this.abandon()
      return this.startIfReady()
    }
    if (this.phase !== 'racing') return []
    return this.callItOff()
  }

  /** Score the race where it stands and put the results up. */
  private callItOff(): Addressed[] {
    const places = this.scoreTheRace()
    if (!places) return []
    this.phase = 'results'
    this.resultsSince = 0
    return [
      {
        to: this.everyone(),
        message: { kind: 'results', places, nextRaceIn: this.limits.resultsFor },
      },
      this.announceFleet(),
    ]
  }

  /** Throw the race away without scoring it. */
  private abandon(): void {
    this.phase = 'lobby'
    this.simulation = undefined
    this.runner = undefined
    this.starters.clear()
    this.retired.clear()
    for (const [, entry] of this.entries) entry.waiting = false
  }

  /** A boat sailed by nobody, for trying the thing out with one human or none. */
  addRobot(name: string): BoatId {
    const id = `robot-${this.entries.size + 1}`
    const color = this.colorFor('racer')
    this.entries.set(id, {
      name: markedAs(color, name),
      role: 'racer',
      color,
      waiting: this.phase !== 'lobby',
      heard: Number.POSITIVE_INFINITY,
      rudder: 0,
      robot: new Skipper(),
    })
    return id
  }

  leave(id: BoatId): Addressed[] {
    this.tally.delete(id)
    if (!this.entries.delete(id)) return []
    if (this.starters.has(id)) {
      /*
       * A boat already home has not given up; her sailor has shut the laptop. She keeps
       * her finish and stays on the water, because her place and her time live in the
       * race state her boat carries.
       *
       * One still sailing has given up, and goes off the water with her sailor. Left
       * there she is handed a helm amidships and holds her last heading out of the
       * course and over the horizon, which reads as a boat gone wrong rather than a
       * boat with nobody aboard.
       */
      const home = this.runner?.world.race.progress[id]?.status === 'finished'
      if (!home) {
        this.retired.add(id)
        this.runner?.withdraw(id)
      }
    }
    return [this.announceFleet()]
  }

  /** Move the regatta on by this much of the player's time. */
  tick(dt: Seconds): Addressed[] {
    this.now += dt
    const out: Addressed[] = [...this.dropTheSilent()]

    if (this.phase === 'racing') out.push(...this.sailOn(dt))
    else if (this.phase === 'results') {
      this.resultsSince += dt
      if (this.resultsSince >= this.limits.resultsFor) out.push(...this.backToTheLobby())
    } else out.push(...this.startIfReady())

    return out
  }

  private join(id: BoatId, name: string, role: Role): Addressed[] {
    // One join to a connection. A second is ignored rather than answered, because every
    // join tells the whole fleet and a client repeating it turns one frame into as many
    // as there are sailors.
    if (this.entries.has(id)) return []

    const seated = role === 'racer' && this.racers().length < this.limits.maxRacers
    // Nobody has crossed a line yet, so she has missed nothing and can be let in.
    const inTime = seated && this.beforeTheGun()
    const color = this.colorFor(seated ? 'racer' : 'observer')
    const entry: Entry = {
      name: markedAs(color, name),
      role: seated ? 'racer' : 'observer',
      color,
      waiting: seated && this.phase !== 'lobby' && !inTime,
      heard: this.now,
      rudder: 0,
    }
    this.entries.set(id, entry)

    const out: Addressed[] = [
      {
        to: [id],
        message: {
          kind: 'welcome',
          you: id,
          role: entry.role,
          phase: this.phase,
          fleet: this.fleet,
        },
      },
    ]

    // The fleet is still manoeuvring for the line, so the start is made again with her
    // in it and the clock goes back to the top. Starting her on a countdown already run
    // down would put her on the line with no time to reach it.
    if (inTime) return [...out, ...this.startIfReady()]

    // A late arrival is shown the race in progress: she waits, but she watches.
    if (this.simulation && this.phase === 'racing') {
      out.push({ to: [id], message: { kind: 'racing', scenario: this.simulation.spec } })
    }
    out.push(this.announceFleet())
    return out
  }

  /** Whether the race on the water has yet to start. */
  private beforeTheGun(): boolean {
    if (this.phase !== 'racing' || !this.runner || !this.simulation) return false
    return timeToStart(this.simulation.ctx, this.runner.world) > 0
  }

  /**
   * The first color no boat is wearing, so a sailor told she is Blue is the only Blue.
   * An onlooker is not a boat and takes none of them.
   */
  private colorFor(role: Role): FleetColor {
    const { colors, watcherColor } = this.options
    if (role === 'observer') return watcherColor
    const worn = new Set(this.racers().map(([, entry]) => entry.color.hex))
    return colors.find((color) => !worn.has(color.hex)) ?? watcherColor
  }

  private announceFleet(): Addressed {
    return { to: this.everyone(), message: { kind: 'fleet', phase: this.phase, fleet: this.fleet } }
  }

  private everyone(): BoatId[] {
    return [...this.entries].filter(([, entry]) => !entry.robot).map(([id]) => id)
  }

  /** Nobody has heard from her, so she is not there to sail. */
  private dropTheSilent(): Addressed[] {
    const gone = [...this.entries]
      .filter(([, entry]) => this.now - entry.heard > this.limits.idleAfter)
      .map(([id]) => id)
    return gone.flatMap((id) => this.leave(id))
  }

  private racers(): [BoatId, Entry][] {
    return [...this.entries].filter(([, entry]) => entry.role === 'racer')
  }

  private startIfReady(): Addressed[] {
    const racers = this.racers()
    if (racers.length < this.limits.fleetSize) return []

    const spec = this.options.race(
      this.options.seed(),
      racers.map(([id, entry]) => ({ id, name: entry.name })),
    )
    this.simulation = createSimulation(spec)
    this.runner = new SimulationRunner(this.simulation.ctx, this.simulation.world)
    this.starters = new Map(racers.map(([id, entry]) => [id, entry.name]))
    this.retired.clear()
    this.pending = []
    this.lastRace = undefined
    this.sinceSnapshot = 0
    this.phase = 'racing'
    for (const [, entry] of racers) entry.waiting = false

    return [
      { to: this.everyone(), message: { kind: 'racing', scenario: spec } },
      this.announceFleet(),
    ]
  }

  private helms(): Record<BoatId, InputSource> {
    const helms: Record<BoatId, InputSource> = {}
    for (const id of this.starters.keys()) {
      const entry = this.entries.get(id)
      if (entry?.robot) helms[id] = entry.robot
      // A boat whose sailor has gone sails on with her helm amidships until the race
      // stops waiting for her.
      else helms[id] = { inputFor: () => ({ rudder: entry?.rudder ?? 0 }) }
    }
    return helms
  }

  private sailOn(dt: Seconds): Addressed[] {
    const runner = this.runner
    const simulation = this.simulation
    if (!runner || !simulation) return []

    const { pace } = this.options
    this.pending.push(...runner.advance(dt * pace, this.helms(), 0.25 * pace))

    const out: Addressed[] = []
    const interval = 1 / SNAPSHOT_HZ
    this.sinceSnapshot += dt
    if (this.sinceSnapshot >= interval) {
      /*
       * The remainder is carried rather than thrown away, and capped so a stall cannot
       * make it burst afterwards. Zeroing it rounded the rate up to a whole number of
       * ticks: at thirty a second that is two sixty-hertz ticks or three, it took three,
       * and asking for thirty delivered twenty.
       */
      this.sinceSnapshot = Math.min(this.sinceSnapshot - interval, interval)
      const { boats, time } = runner.world
      const race = this.report()
      const written = JSON.stringify(race)
      const changed = written !== this.lastRace
      this.lastRace = written
      out.push({
        to: this.everyone(),
        message: {
          kind: 'snapshot',
          time,
          boats,
          events: this.pending,
          ...(changed ? { race } : {}),
        },
      })
      this.pending = []
    }

    const places = this.settle()
    if (places) {
      this.phase = 'results'
      this.resultsSince = 0
      out.push({
        to: this.everyone(),
        message: { kind: 'results', places, nextRaceIn: this.limits.resultsFor },
      })
      out.push(this.announceFleet())
    }
    return out
  }

  /** Where every boat stands, in the few fields anyone watching needs. */
  private report(): RaceReport {
    const progress = this.runner?.world.race.progress ?? {}
    const report: Record<BoatId, BoatReport> = {}
    for (const id of this.starters.keys()) {
      const boat = progress[id]
      if (!boat) continue
      report[id] = {
        status: boat.status,
        stageIndex: boat.stageIndex,
        penalties: boat.penalties,
        passedMark: boat.passedMark,
        ...(boat.place === undefined ? {} : { place: boat.place }),
        ...(boat.finishTime === undefined ? {} : { finishTime: boat.finishTime }),
      }
    }
    return report
  }

  /** Whether the race is over, and how it came out. */
  private settle(): Placing[] | undefined {
    const runner = this.runner
    const simulation = this.simulation
    if (!runner || !simulation) return undefined

    const progress = runner.world.race.progress
    const done = (id: BoatId) => this.retired.has(id) || progress[id]?.status === 'finished'
    const elapsed = raceTime(simulation.ctx, runner.world) / this.options.pace

    const finishTimes = [...this.starters.keys()]
      .map((id) => progress[id]?.finishTime)
      .filter((at): at is Seconds => at !== undefined)
    const winner = finishTimes.length > 0 ? Math.min(...finishTimes) / this.options.pace : undefined

    const everyoneHome = [...this.starters.keys()].every(done)
    const outOfTime = winner !== undefined && elapsed > winner * (1 + this.limits.timeLimitFraction)
    const abandoned = winner === undefined && elapsed > this.limits.abandonAfter
    if (!everyoneHome && !outOfTime && !abandoned) return undefined

    return this.scoreTheRace()
  }

  /**
   * The race scored as it stands, whether or not it was going to end here, in the order
   * they crossed. Whoever never crossed comes after those who did, in the order they
   * joined, since nothing else distinguishes them.
   *
   * This adds to the tally, so it is called once a race and nowhere else.
   */
  private scoreTheRace(): Placing[] | undefined {
    const progress = this.runner?.world.race.progress
    if (!progress) return undefined

    const sailed = [...this.starters].map(([id, name]) => {
      const boat = progress[id]
      const outcome: Outcome = this.retired.has(id)
        ? 'retired'
        : boat?.status === 'finished'
          ? 'finished'
          : 'timedOut'
      return {
        boatId: id,
        name,
        outcome,
        ...(boat?.place === undefined ? {} : { place: boat.place }),
        ...(boat?.finishTime === undefined ? {} : { elapsed: boat.finishTime / this.options.pace }),
      }
    })

    // Sorting is stable, so boats with no place keep the order they joined in.
    const home = [...sailed].sort((one, two) => place(one) - place(two))

    return home.map((placing, index) => {
      // The fleet's size to the winner, down to one for the boat at the back.
      const points = home.length - index
      const total = (this.tally.get(placing.boatId) ?? 0) + points
      this.tally.set(placing.boatId, total)
      return { ...placing, points, total }
    })
  }

  private backToTheLobby(): Addressed[] {
    this.abandon()
    return [this.announceFleet(), ...this.startIfReady()]
  }
}
