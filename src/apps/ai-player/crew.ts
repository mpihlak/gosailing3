import { boatEndStarboardStart, pinEndPortStart, Skipper } from '@/agents/ai'
import { standings, type Simulation } from '@/sim'
import { OnlineRace, type Socket } from '@/net'
import { GAME_PACE } from '@/apps/game/scenario'

/** Names handed out in order, one to a boat, enough for a full fleet. */
export const CREW_NAMES: readonly string[] = [
  'Alice',
  'Bob',
  'Carol',
  'Dan',
  'Eve',
  'Finn',
  'Greta',
  'Hal',
  'Ida',
  'Jan',
]

/** The name for the nth robot, numbered once the list runs out. */
export function crewName(index: number): string {
  const name = CREW_NAMES[index % CREW_NAMES.length]!
  const lap = Math.floor(index / CREW_NAMES.length)
  return lap === 0 ? name : `${name}${lap + 1}`
}

export interface RobotOptions {
  readonly url: string
  readonly name: string
  /**
   * Which end of the line she goes for. Alternating them down the fleet is what stops
   * the robots sailing the same path in a line, and puts boats on both tacks at the
   * gun, which is a good deal more to sail through than a procession.
   */
  readonly end?: 'pin' | 'committee'
  /** Swapped out in tests; node needs nothing here. */
  readonly open?: (url: string) => Socket
  readonly now?: () => number
}

/**
 * A sailor who is not a person.
 *
 * She joins over a socket like anybody else and is told no more than anybody else is:
 * the scenario when a race starts and where the boats are thirty times a second. What
 * she steers by is the view a player is shown, interpolated and a frame behind, so she
 * sails under the same lag rather than a privileged one.
 */
export class Robot {
  readonly race: OnlineRace
  /** Assigned in the constructor: a field initialiser runs before `options` exists. */
  private skipper: Skipper
  /** The race the current skipper was made for, so a new one gets a fresh head. */
  private sailing: Simulation | undefined

  constructor(private readonly options: RobotOptions) {
    this.skipper = this.freshSkipper()
    this.race = new OnlineRace({
      url: options.url,
      name: options.name,
      // So the regatta hands the race controls to a person instead of to her.
      robot: true,
      helm: () => this.rudder(),
      pace: GAME_PACE,
      ...(options.open ? { open: options.open } : {}),
      ...(options.now ? { now: options.now } : {}),
    })
  }

  get name(): string {
    return this.options.name
  }

  get end(): string {
    return this.options.end ?? 'pin'
  }

  join(): void {
    this.race.join()
  }

  /** One turn of the loop the browser would run on a frame. */
  step(): void {
    this.race.sendHelm()
  }

  leave(): void {
    this.race.leave()
  }

  /** Where she is and what she is doing, for somebody watching the output instead. */
  standing(): string | undefined {
    const { simulation, you } = this.race
    if (!simulation || !you) return undefined
    const world = this.race.frameAt((this.options.now ?? (() => performance.now()))())
    const boat = world?.boats.find((one) => one.id === you)
    if (!world || !boat) return undefined
    const place = standings(simulation.ctx, world).find((one) => one.boatId === you)
    const progress = world.race.progress[you]
    const owed = progress && progress.penalties > 0 ? ` ${progress.penalties} owed` : ''
    const leg = progress ? ` leg ${progress.stageIndex}${progress.passedMark ? '+' : ''}` : ''
    return `${place?.place ?? '-'}${leg} ${boat.speed.toFixed(1)}kn${owed}`
  }

  private freshSkipper(): Skipper {
    const start = this.options.end === 'committee' ? boatEndStarboardStart() : pinEndPortStart()
    return new Skipper({ start })
  }

  private rudder(): number {
    const { simulation, you } = this.race
    if (!simulation || !you) return 0
    if (simulation !== this.sailing) {
      this.sailing = simulation
      this.skipper = this.freshSkipper()
    }
    const world = this.race.frameAt((this.options.now ?? (() => performance.now()))())
    // Nothing to steer until two snapshots have arrived, and nothing to steer with while
    // she waits out a race she arrived too late for: her boat is not in the water.
    if (!world) return 0
    return this.skipper.inputFor(you, world, simulation.ctx).rudder
  }
}
