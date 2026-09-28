import type { Seconds } from '@/foundation/units'
import type { BoatId } from '@/domain/boat'
import {
  createSimulation,
  SimulationRunner,
  raceTime,
  type InputSource,
  type ScenarioSpec,
  type Simulation,
  type TimedEvent,
} from '@/sim'
import { Skipper } from '@/agents/ai'
import {
  SNAPSHOT_HZ,
  type Addressed,
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
  /** How long the results stand before the next race is made up. */
  readonly resultsFor: Seconds
}

const DEFAULTS: RegattaLimits = {
  fleetSize: 2,
  timeLimitFraction: 0.3,
  abandonAfter: 600,
  idleAfter: 10,
  resultsFor: 10,
}

export interface RegattaOptions {
  /** Make the race these sailors are about to sail. */
  readonly race: (seed: string, sailors: readonly { id: BoatId; name: string }[]) => ScenarioSpec
  readonly seed: () => string
  /** Simulated seconds per second of a player's time. */
  readonly pace: number
  /** Handed out in the order sailors arrive. */
  readonly colors: readonly string[]
  readonly limits?: Partial<RegattaLimits>
}

interface Entry {
  readonly name: string
  readonly role: Role
  readonly color: string
  /** Set while she is waiting for the race being sailed to end. */
  waiting: boolean
  /** When she was last heard from, in the player's seconds since the server started. */
  heard: Seconds
  rudder: number
  robot?: Skipper
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
    return [...this.entries].map(([id, entry]) => ({
      id,
      name: entry.name,
      role: entry.role,
      color: entry.color,
      waiting: entry.waiting,
    }))
  }

  /** A sailor says something. Her connection id is the id her boat will race under. */
  say(id: BoatId, message: ClientMessage): Addressed[] {
    if (message.kind === 'join') return this.join(id, message.name, message.role ?? 'racer')
    const entry = this.entries.get(id)
    if (!entry) return []
    entry.heard = this.now
    if (message.kind === 'helm') entry.rudder = Math.max(-1, Math.min(1, message.rudder))
    return []
  }

  /** A boat sailed by nobody, for trying the thing out with one human or none. */
  addRobot(name: string): BoatId {
    const id = `robot-${this.entries.size + 1}`
    this.entries.set(id, {
      name,
      role: 'racer',
      color: this.colorFor(),
      waiting: this.phase !== 'lobby',
      heard: Number.POSITIVE_INFINITY,
      rudder: 0,
      robot: new Skipper(),
    })
    return id
  }

  leave(id: BoatId): Addressed[] {
    if (!this.entries.delete(id)) return []
    if (this.starters.has(id)) this.retired.add(id)
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
    const entry: Entry = {
      name,
      role,
      color: this.colorFor(),
      waiting: role === 'racer' && this.phase !== 'lobby',
      heard: this.now,
      rudder: 0,
    }
    this.entries.set(id, entry)

    const out: Addressed[] = [
      { to: [id], message: { kind: 'welcome', you: id, role, phase: this.phase, fleet: this.fleet } },
    ]
    // A late arrival is shown the race in progress: she waits, but she watches.
    if (this.simulation && this.phase === 'racing') {
      out.push({ to: [id], message: { kind: 'racing', scenario: this.simulation.spec } })
    }
    out.push(this.announceFleet())
    return out
  }

  private colorFor(): string {
    const { colors } = this.options
    return colors[this.entries.size % colors.length] ?? '#ffffff'
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

  private startIfReady(): Addressed[] {
    const racers = [...this.entries].filter(([, entry]) => entry.role === 'racer')
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
    this.sinceSnapshot += dt
    if (this.sinceSnapshot >= 1 / SNAPSHOT_HZ) {
      this.sinceSnapshot = 0
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
      out.push({ to: this.everyone(), message: { kind: 'results', places } })
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

    return [...this.starters].map(([id, name]) => {
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
  }

  private backToTheLobby(): Addressed[] {
    this.phase = 'lobby'
    this.simulation = undefined
    this.runner = undefined
    this.starters.clear()
    this.retired.clear()
    for (const [, entry] of this.entries) entry.waiting = false
    return [this.announceFleet(), ...this.startIfReady()]
  }
}
