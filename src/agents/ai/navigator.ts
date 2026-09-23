import {
  add,
  angleDelta,
  bearingToVector,
  closestPointOnSegment,
  distance,
  normalize,
  normalizeBearing,
  toRadians,
  scale,
  sub,
  vectorToBearing,
  type Vec2,
} from '@/foundation/geom'
import { clamp, knotsToMps, type Degrees, type Meters, type Seconds } from '@/foundation/units'
import { tackOf, type BoatSpec, type BoatState } from '@/domain/boat'
import {
  lineEndBodies,
  lineMidpoint,
  pastMark,
  sideOfMark,
  type CourseBody,
  type CourseStage,
  type RaceLine,
} from '@/domain/course'
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
  readonly reason:
    | 'starting'
    | 'beating'
    | 'running'
    | 'fetching'
    | 'rounding'
    | 'penalty'
    | 'returning'
    | 'holding'
  /** Set while a start strategy is in charge, for the lab and the tests to read. */
  readonly startPhase?: StartPhase
}

/*
 * TODO: she knows nothing of wind shadows. She will sail into another boat's dirty air
 * and sit in it, and she will never use her own to hold anyone off. Most of what match
 * racing is turns on that, and `shade` in domain/wind is the same function a tactical
 * tier would ask.
 */

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

  /*
   * Turns owed are carried rather than paid at once: this is match racing, where an
   * opponent's penalty cancels yours, and a turn spent early is a chance thrown away.
   * They come due on the last leg, because she may not finish owing any.
   */
  const direction = progress.penaltyTurn?.direction ?? (tackOf(boat.twa) === 'port' ? 1 : -1)
  /*
   * Room is asked for every tick, not only on the tick she begins. The simulation opens a
   * turn on any rotation while she owes one, so a mark rounding opens it for her, and
   * treating an open turn as a decision already taken had her commit to a circle ten
   * meters off the mark she had just been round. The circle she would sweep barely moves
   * as she goes round it, so asking repeatedly gives the same answer until something
   * else moves — which is exactly when she should think again.
   */
  if (
    progress.penalties > 0 &&
    stage.kind === 'finish' &&
    roomToSpin(ctx, world, boat, spec, direction)
  ) {
    // Aiming a quarter turn ahead keeps the helm hard over all the way round.
    return { bearing: normalizeBearing(boat.heading + direction * 90), reason: 'penalty' }
  }

  /*
   * Over the line at the gun, and nothing else matters until she has been behind it
   * again: she cannot start, so she cannot round a mark or finish either. Here rather
   * than in the start strategy because every strategy needs it and none of them differ
   * about it, which is the same reason the penalty turn sits above.
   */
  if (stage.kind === 'start' && progress.status === 'overEarly') {
    const back = returnPoint(stage.line, boat.position, spec)
    return { bearing: vectorToBearing(sub(back, boat.position)), reason: 'returning' }
  }

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

/**
 * Where she has to get to before she may start again: square back over the line and a
 * length beyond it, which puts her whole hull on the pre-start side however she is lying.
 *
 * Straight back rather than round an end, which is the shorter way and an allowed one
 * while no flag says otherwise. She aims at the line itself rather than at its extension,
 * so she comes back between the marks and can start from where she lands — but short of
 * the ends, because square across the line at the end is square into the boat or the buoy
 * that marks it. Sent there she leans on the committee boat and stops dead.
 *
 * The course side is upwind, so the way back is a bear away and a run: no tack to make
 * and no layline to judge.
 */
function returnPoint(line: RaceLine, at: Vec2, spec: BoatSpec): Vec2 {
  const along = sub(line.to, line.from)
  const inset = Math.min(spec.length * 2, distance(line.from, line.to) / 2)
  const off = scale(normalize(along), inset)
  const onLine = closestPointOnSegment({ from: add(line.from, off), to: sub(line.to, off) }, at)
  return add(onLine, scale(line.normal, -spec.length))
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

/** Water she wants beyond the circle itself, for the ground she loses going round. */
const TURN_MARGIN: Meters = 12

/** How fast she comes round with the helm hard over, which is slower the slower she goes. */
function turnRate(spec: BoatSpec, boat: BoatState): number {
  return spec.maxTurnRate * clamp(boat.speed / spec.steerageSpeed, 0.12, 1)
}

/**
 * The water she will occupy going round: a circle to the side she turns towards, of the
 * radius her speed and her helm give her, widened by her own length and the ground she
 * sags to leeward while she is slow.
 *
 * A circle rather than a radius around where she is now. Her turn is not centred on her —
 * it is centred a radius off her beam — so a plain distance is too strict on the side she
 * is turning away from and too kind on the side she is turning into.
 */
function turnCircle(
  boat: BoatState,
  spec: BoatSpec,
  direction: 1 | -1,
): { readonly centre: Vec2; readonly radius: Meters } {
  const radius = knotsToMps(boat.speed) / toRadians(turnRate(spec, boat))
  const abeam = bearingToVector(normalizeBearing(boat.heading + direction * 90))
  return {
    centre: add(boat.position, scale(abeam, radius)),
    radius: radius + spec.length / 2 + TURN_MARGIN,
  }
}

/** Nearest approach to a fixed body, which may be a vessel lying along a line. */
function gapTo(centre: Vec2, body: CourseBody): Meters {
  const at = body.centreline
    ? closestPointOnSegment(body.centreline, centre)
    : body.position
  return distance(centre, at) - body.radius
}

/**
 * Whether she can go round from here without hitting anything, for as long as it takes.
 *
 * Marks and the ends of the line have to be outside the circle she will sweep. So does
 * every other boat, and not only where she is now: a boat standing on cannot be expected
 * to have gone round, so her track for the length of the turn is checked as well.
 */
function roomToSpin(
  ctx: SimContext,
  world: WorldState,
  boat: BoatState,
  spec: BoatSpec,
  direction: 1 | -1,
): boolean {
  const circle = turnCircle(boat, spec, direction)
  const rate = turnRate(spec, boat)
  if (!(rate > 0)) return false
  const seconds: Seconds = 360 / rate

  for (const mark of ctx.course.marks) {
    if (distance(circle.centre, mark.position) - mark.radius < circle.radius) return false
  }
  for (const end of lineEndBodies(ctx.course.stages)) {
    if (gapTo(circle.centre, end) < circle.radius) return false
  }

  for (const other of world.boats) {
    if (other.id === boat.id) continue
    const reach = (ctx.specs[other.id]?.length ?? spec.length) / 2
    const run = scale(bearingToVector(other.heading), knotsToMps(other.speed) * seconds)
    const track = { from: other.position, to: add(other.position, run) }
    const nearest = closestPointOnSegment(track, circle.centre)
    if (distance(circle.centre, nearest) < circle.radius + reach) return false
  }
  return true
}
