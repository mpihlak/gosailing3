import {
  add,
  angleDelta,
  bearingToVector,
  distance,
  normalizeBearing,
  scale,
  sub,
  vectorToBearing,
  type Vec2,
} from '@/foundation/geom'
import type { Degrees, Meters } from '@/foundation/units'
import type { BoatSpec, BoatState } from '@/domain/boat'
import { lineMidpoint, pastMark, sideOfMark, type CourseStage } from '@/domain/course'
import type { WindSample } from '@/domain/wind'
import { raceTime, type SimContext, type WorldState } from '@/sim'
import type { StartPhase, StartStrategy } from './start'

/**
 * How wide to leave the mark when passing it. It has to cover the boat's own length and
 * the ground she makes while turning, or she clips the thing she is rounding.
 */
const ROUNDING_OFFSET: Meters = 24
/**
 * How far off the direct line the boat may stray before it tacks back, as a fraction of
 * the distance still to run. A cone rather than a fixed width: long tacks early, short
 * ones near the mark, which is how the leg is actually sailed.
 */
const CORRIDOR_FRACTION = 0.42
const CORRIDOR_MIN: Meters = 35
const CORRIDOR_MAX: Meters = 320

export interface NavigationPlan {
  readonly bearing: Degrees
  readonly reason: 'starting' | 'beating' | 'running' | 'fetching' | 'rounding' | 'holding'
  /** Set while a start strategy is in charge, for the lab and the tests to read. */
  readonly startPhase?: StartPhase
}

/**
 * Decides where a boat should be pointing. It knows nothing about rudders: it produces a
 * bearing, and the helm works out how to get there. Splitting them this way means tactics
 * can be tested against a fixed wind without any physics in the picture.
 */
export function planCourse(
  ctx: SimContext,
  world: WorldState,
  boat: BoatState,
  spec: BoatSpec,
  wind: WindSample,
  start: StartStrategy,
): NavigationPlan {
  const progress = world.race.progress[boat.id]
  const stage = progress && ctx.course.stages[progress.stageIndex]
  if (!stage) return { bearing: boat.heading, reason: 'holding' }

  if (stage.kind === 'start') {
    // Getting off the line is its own problem, and there is more than one way to go
    // about it, so it belongs to a strategy rather than to the navigator.
    const plan = start.plan({
      boat,
      spec,
      wind,
      line: stage.line,
      timeToStart: -raceTime(ctx, world),
      gunFired: raceTime(ctx, world) >= 0,
    })
    return { bearing: plan.bearing, reason: 'starting', startPhase: plan.phase }
  }
  if (stage.kind === 'mark') return planMark(boat, spec, wind, stage, progress.passedMark)
  return planFor(boat, spec, wind, lineMidpoint(stage.line), 'running')
}

function planMark(
  boat: BoatState,
  spec: BoatSpec,
  wind: WindSample,
  stage: Extract<CourseStage, { kind: 'mark' }>,
  passedMark: boolean,
): NavigationPlan {
  const { mark, approach } = stage
  const clearingSide = approach + (mark.rounding === 'port' ? 90 : -90)
  const along = bearingToVector(approach)
  const beside = bearingToVector(clearingSide)

  const offMark = (across: Meters, ahead: Meters): Vec2 =>
    add(add(mark.position, scale(beside, across)), scale(along, ahead))

  // Get onto the correct side of the mark before trying to pass it: a boat that arrives
  // on the wrong side has to cross the mark's nose to round it, which on a beat means
  // sailing angles she has not got.
  const required = mark.rounding === 'port' ? -1 : 1
  const onApproachSide = Math.sign(sideOfMark(mark.position, approach, boat.position)) === required
  const alreadyPast = pastMark(mark.position, approach, boat.position) > 0

  // A boat that slipped by on the wrong side, or overshot the mark without the pass
  // counting, has to drop back downwind and come at it again. Without this she sits on a
  // target she has already reached and waits for a rounding that cannot happen.
  const mustComeAgain = !passedMark && (alreadyPast || !onApproachSide)

  const target = !passedMark
    ? mustComeAgain
      ? offMark(ROUNDING_OFFSET * 2, -ROUNDING_OFFSET * 3) // back below the mark, correct side
      : offMark(ROUNDING_OFFSET, ROUNDING_OFFSET) // up past it, correct side
    : onApproachSide
      ? offMark(-ROUNDING_OFFSET, ROUNDING_OFFSET * 1.3) // cross over, well clear to windward
      : offMark(-ROUNDING_OFFSET, -ROUNDING_OFFSET * 4) // away onto the next leg

  const plan = planFor(boat, spec, wind, target, 'beating')
  return distance(boat.position, mark.position) < ROUNDING_OFFSET * 6
    ? { ...plan, reason: 'rounding' }
    : plan
}

/**
 * Sail toward a point as directly as the boat allows. Inside the no-go zone that means
 * beating, dead downwind it means gybing, and the choice of tack comes from staying
 * inside a corridor either side of the direct line.
 */
function planFor(
  boat: BoatState,
  spec: BoatSpec,
  wind: WindSample,
  destination: Vec2,
  reason: NavigationPlan['reason'],
): NavigationPlan {
  const toDestination = sub(destination, boat.position)
  const direct = vectorToBearing(toDestination)
  const twaDirect = angleDelta(wind.direction, direct)
  const beatAngle = spec.polar.beatAngle(wind.speed)
  const runAngle = spec.polar.runAngle(wind.speed)

  const sailingAngle =
    Math.abs(twaDirect) < beatAngle ? beatAngle : Math.abs(twaDirect) > runAngle ? runAngle : null

  // Close enough to lay it: point at it and stop thinking.
  if (sailingAngle === null) return { bearing: direct, reason: reason === 'holding' ? reason : 'fetching' }

  // Hold the current tack until the boat strays outside the corridor, then take the one
  // that works back toward the direct line. Port tack carries you east of it, starboard
  // west, whether the leg is a beat or a run.
  const offset = crossTrack(boat.position, destination, direct)
  const corridor = Math.min(
    CORRIDOR_MAX,
    Math.max(CORRIDOR_MIN, Math.hypot(toDestination.x, toDestination.y) * CORRIDOR_FRACTION),
  )
  const onPort = Math.abs(offset) > corridor ? offset < 0 : boat.twa >= 0

  return {
    bearing: normalizeBearing(wind.direction + (onPort ? sailingAngle : -sailingAngle)),
    reason: Math.abs(twaDirect) < beatAngle ? 'beating' : 'running',
  }
}

/** Signed distance from the direct line to the destination. Positive means east of it. */
function crossTrack(position: Vec2, destination: Vec2, direct: Degrees): Meters {
  const along = bearingToVector(direct)
  const offset = sub(position, destination)
  return offset.x * along.y - offset.y * along.x
}

export function stageOf(ctx: SimContext, world: WorldState, boatId: string): CourseStage | undefined {
  const progress = world.race.progress[boatId]
  return progress ? ctx.course.stages[progress.stageIndex] : undefined
}
