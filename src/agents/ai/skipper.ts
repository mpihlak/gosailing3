import { angleDelta, normalizeBearing } from '@/foundation/geom'
import { createRng, type Rng } from '@/foundation/rng'
import type { Degrees, Seconds } from '@/foundation/units'
import type { BoatId, BoatInput, BoatSpec, BoatState } from '@/domain/boat'
import { sideOfLine } from '@/domain/course'
import type { WindSample } from '@/domain/wind'
import { specFor, type InputSource, type SimContext, type WorldState } from '@/sim'
import { giveWay } from './avoidance'
import { GybePlan } from './gybing'
import { rudderToHold } from './helm'
import { planCourse, type NavigationPlan, type Spin } from './navigator'
import { PLAIN, type Personality } from './personality'
import { clearToTack, wouldTack } from './tacking'
import { pinEndPortStart, type StartPhase, type StartStrategy } from './start'

/** How often, in simulated seconds, she looks again at a boat she is keeping clear of. */
const RECHECK: Seconds = 0.25
/** How much more room she wants before she stops keeping clear. */
const RELEASE = 1.5

export interface SkipperOptions {
  /** How she goes about starting. Different boats can be given different ideas. */
  readonly start?: StartStrategy
  readonly degreesForFullRudder?: number
  /** How she sails where the course leaves room for taste. */
  readonly personality?: Personality
  /**
   * Where her chance decisions come from. Give a race's skipper the race's seed and she
   * decides differently each race and the same way twice in the same one.
   */
  readonly seed?: string
}

/**
 * An AI boat. It produces the same input a player does, so from the simulation's point
 * of view there is no difference between the two, and nothing in the physics or the race
 * rules needs to know which is which.
 */
export class Skipper implements InputSource {
  /** The most recent decision, for the lab and the debug overlay to show. */
  lastPlan?: NavigationPlan
  /** What she was doing about her start, when she was doing anything about it. */
  lastStartPhase: StartPhase | undefined

  private readonly start: StartStrategy
  private readonly degreesForFullRudder: number
  private readonly personality: Personality
  /**
   * The way she is going round a turn she owes, and how many she owed when she began.
   * Held between ticks because the direction cannot be decided afresh each time: see
   * the note in planCourse.
   */
  private spin: { readonly way: Spin; readonly owed: number } | undefined
  /** The course she is steering to keep clear of somebody, and when she chose it. */
  private keepingClear: { readonly bearing: Degrees; readonly since: Seconds } | undefined
  private readonly rng: Rng
  /**
   * The gybes she means to make on the run to the finish, drawn when she starts it, and
   * the side she was on when she began the one under way, if one is.
   */
  private run:
    { readonly stage: number; readonly from: Seconds; readonly plan: GybePlan } | undefined
  private gybingFrom: number | undefined

  constructor(options: SkipperOptions = {}) {
    this.start = options.start ?? pinEndPortStart()
    this.degreesForFullRudder = options.degreesForFullRudder ?? 12
    this.personality = options.personality ?? PLAIN
    this.rng = createRng(options.seed ?? 'skipper')
  }

  inputFor(boatId: BoatId, world: WorldState, ctx: SimContext): BoatInput {
    const boat = world.boats.find((candidate) => candidate.id === boatId)
    if (!boat) return { rudder: 0 }

    const spec = specFor(ctx, boatId)
    const wind = ctx.wind.sample(boat.position, world.time)

    // One turn, one direction. A turn paid off leaves a different number owing, which
    // is when she is free to choose again.
    const owed = world.race.progress[boatId]?.penalties ?? 0
    if (owed === 0 || this.spin?.owed !== owed) this.spin = undefined

    const plan = planCourse(
      ctx,
      world,
      boat,
      spec,
      wind,
      this.start,
      this.spin?.way,
      this.personality,
    )
    if (plan.spin) this.spin = { way: plan.spin, owed }

    /*
     * A tack into somebody is hers to answer for: from head to wind until she is
     * close-hauled she keeps clear of everyone. If it is not clear she stands on,
     * close-hauled on the tack she has, and asks again next tick. A penalty turn has
     * already asked for its own room. A start is left to its strategy: it times the run
     * at the line to the second, and a tack held back there put a boat into the pin.
     */
    const blocked =
      !plan.spin &&
      plan.reason !== 'starting' &&
      wouldTack(boat, plan.bearing, wind.direction) &&
      !clearToTack(world, boat, spec, plan.bearing)
    const wanted = blocked
      ? normalizeBearing(
          wind.direction + Math.sign(boat.twa || 1) * spec.polar.beatAngle(wind.speed),
        )
      : plan.bearing
    const course = this.gybeOnSchedule(ctx, world, boat, spec, wind, plan, wanted)

    /*
     * Then she keeps clear of anyone with right of way over her. Not while turning a
     * penalty circle, which asked for its own room, nor in a tack, which asked for its
     * own, nor at the start, for the same reason as above.
     */
    const free =
      !plan.spin &&
      plan.reason !== 'starting' &&
      world.race.progress[boatId]?.tacking !== true &&
      !wouldTack(boat, course, wind.direction)
    const bearing = free ? this.keepClear(ctx, world, boat, spec, wind, course) : course
    if (!free) this.keepingClear = undefined

    this.lastPlan = bearing === plan.bearing ? plan : { ...plan, bearing }
    this.lastStartPhase = plan.startPhase

    // The start strategies time their run at the line against the helm they were built
    // with, which does not allow for the turn she is making. Allowing for it there had a
    // boat over early.
    const lead = plan.reason === 'starting' ? 0 : spec.turnResponse
    return {
      rudder: rudderToHold(boat.heading, bearing, this.degreesForFullRudder, boat.turnRate, lead),
    }
  }

  /**
   * The course that keeps her clear, decided a few times a second rather than every tick
   * and held in between: she cannot turn faster than that would matter, and choosing
   * afresh each tick had her swing between two courses. Once she is keeping clear she
   * asks for half as much room again before going back to her own course, or she would
   * turn straight back into the boat she had just avoided.
   */
  private keepClear(
    ctx: SimContext,
    world: WorldState,
    boat: BoatState,
    spec: BoatSpec,
    wind: WindSample,
    wanted: Degrees,
  ): Degrees {
    const held = this.keepingClear
    if (held && world.time - held.since < RECHECK) return held.bearing
    const margin = held ? RELEASE : 1
    const away = giveWay(ctx, world, boat, spec, wind, wanted, margin)
    this.keepingClear = away && { bearing: away.bearing, since: world.time }
    return away?.bearing ?? wanted
  }

  /**
   * On the run to the finish, the gybes she planned at random, each made only when the
   * water is clear for it. Left to the navigator alone every boat holds the gybe she
   * rounded on, and a fleet that rounds together sails one line to the finish.
   */
  private gybeOnSchedule(
    ctx: SimContext,
    world: WorldState,
    boat: BoatState,
    spec: BoatSpec,
    wind: WindSample,
    plan: NavigationPlan,
    wanted: Degrees,
  ): Degrees {
    const progress = world.race.progress[boat.id]
    const stage = progress && ctx.course.stages[progress.stageIndex]
    // A boat owing turns is making for clear water to take them, not racing to the line.
    if (
      !progress ||
      stage?.kind !== 'finish' ||
      plan.reason !== 'running' ||
      progress.penalties > 0
    ) {
      return wanted
    }

    const toGo = -sideOfLine(stage.line, boat.position)
    const run = this.run
    // A new run, or a new race: a clock that went backwards is a race begun again.
    if (!run || run.stage !== progress.stageIndex || world.time < run.from) {
      const fresh = new GybePlan(this.rng, this.personality.gybing, toGo)
      this.run = { stage: progress.stageIndex, from: world.time, plan: fresh }
      this.gybingFrom = undefined
    }
    const gybes = this.run!.plan
    const side = Math.sign(boat.twa || 1)

    // The navigator holds whichever gybe she is on, so a gybe is done once she is on
    // the other one, and until then she is steered across.
    if (this.gybingFrom !== undefined) {
      if (side !== this.gybingFrom) {
        gybes.made()
        this.gybingFrom = undefined
        return wanted
      }
      return normalizeBearing(wind.direction - angleDelta(wind.direction, wanted))
    }

    if (!gybes.due(toGo)) return wanted
    const twa = angleDelta(wind.direction, wanted)
    // Already sent across by the navigator: nothing to add.
    if (Math.sign(twa || 1) !== side) return wanted
    const across = normalizeBearing(wind.direction - twa)
    // The same look at the traffic as before a tack. If it is not clear, she waits.
    if (!clearToTack(world, boat, spec, across)) return wanted
    this.gybingFrom = side
    return across
  }
}
