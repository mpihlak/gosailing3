import { normalizeBearing } from '@/foundation/geom'
import type { Degrees, Seconds } from '@/foundation/units'
import type { BoatId, BoatInput, BoatSpec, BoatState } from '@/domain/boat'
import type { WindSample } from '@/domain/wind'
import { specFor, type InputSource, type SimContext, type WorldState } from '@/sim'
import { giveWay } from './avoidance'
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

  constructor(options: SkipperOptions = {}) {
    this.start = options.start ?? pinEndPortStart()
    this.degreesForFullRudder = options.degreesForFullRudder ?? 12
    this.personality = options.personality ?? PLAIN
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

    /*
     * Then she keeps clear of anyone with right of way over her. Not while turning a
     * penalty circle, which asked for its own room, nor in a tack, which asked for its
     * own, nor at the start, for the same reason as above.
     */
    const free =
      !plan.spin &&
      plan.reason !== 'starting' &&
      world.race.progress[boatId]?.tacking !== true &&
      !wouldTack(boat, wanted, wind.direction)
    const bearing = free ? this.keepClear(ctx, world, boat, spec, wind, wanted) : wanted
    if (!free) this.keepingClear = undefined

    this.lastPlan = bearing === plan.bearing ? plan : { ...plan, bearing }
    this.lastStartPhase = plan.startPhase

    return { rudder: rudderToHold(boat.heading, bearing, this.degreesForFullRudder) }
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
}
