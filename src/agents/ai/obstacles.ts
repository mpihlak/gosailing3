import {
  add,
  angleDelta,
  bearingToVector,
  closestBetweenSegments,
  normalizeBearing,
  scale,
  sub,
  vectorToBearing,
  type Segment,
  type Vec2,
} from '@/foundation/geom'
import { knotsToMps, type Degrees, type Meters, type Seconds } from '@/foundation/units'
import { hullCentreline, hullRadius, type BoatSpec, type BoatState } from '@/domain/boat'
import { lineEndBodies } from '@/domain/course'
import type { WindSample } from '@/domain/wind'
import type { SimContext } from '@/sim'

/** The water, in her own lengths and hull to hull, she keeps from the committee boat or an obstacle. */
const ROOM = 0.5
/** How far ahead she looks for a mark in her way, and how often. */
const LOOKAHEAD: Seconds = 6
const STEP: Seconds = 0.25
/** The turns tried to clear one, smallest first, either way. */
const TURNS: readonly Degrees[] = [5, 10, 15, 20, 30, 45, 60, 90]
/** Short of head to wind and of dead downwind, so that clearing one never tacks or gybes her. */
const NEAREST_TWA: Degrees = 15
const FURTHEST_TWA: Degrees = 170

interface Body {
  readonly centreline: Segment
  readonly radius: Meters
}

/**
 * The committee boat and the course's obstacles: what she can hit that is solid.
 *
 * Marks she rounds are left to the rounding, which passes a close-hauled boat about a
 * length off the windward mark: asked for room from it, she luffed away until she
 * stopped. So is the pin, which the pin end starts aim close by: turned away from it,
 * she came back to the line at another moment and tacked into it.
 */
function bodiesOf(ctx: SimContext): Body[] {
  const point = (position: { x: number; y: number }) => ({ from: position, to: position })
  return [
    ...lineEndBodies(ctx.course.stages)
      .filter((end) => end.solid)
      .map((end) => ({
        centreline: end.centreline ?? point(end.position),
        radius: end.radius,
      })),
    ...ctx.course.obstacles.map((obstacle) => ({
      centreline: point(obstacle.position),
      radius: obstacle.radius,
    })),
  ]
}

/**
 * How much of the room she wants from the committee boat and obstacles she keeps over the
 * look-ahead on `heading`: one or more is enough. Only those she is closing on count, or
 * those she is already too close to. Her speed is taken as at least half what the polar
 * gives on that heading, so a boat stopped against the committee boat still sees it.
 */
export function obstacleShare(
  ctx: SimContext,
  boat: BoatState,
  spec: BoatSpec,
  wind: WindSample,
  heading: Degrees,
): number {
  const polar = spec.polar.boatSpeed(angleDelta(wind.direction, heading), wind.speed)
  const velocity = scale(bearingToVector(heading), knotsToMps(Math.max(boat.speed, polar / 2)))
  const room = ROOM * spec.length
  const radius = hullRadius(spec)
  let share = Number.POSITIVE_INFINITY
  for (const body of bodiesOf(ctx)) {
    const gapAt = (t: Seconds) =>
      closestBetweenSegments(
        hullCentreline(
          { ...boat, heading, position: add(boat.position, scale(velocity, t)) },
          spec,
        ),
        body.centreline,
      ).distance -
      radius -
      body.radius
    const now = gapAt(0)
    let nearest = Number.POSITIVE_INFINITY
    for (let t = STEP; t <= LOOKAHEAD; t += STEP) nearest = Math.min(nearest, gapAt(t))
    if (nearest < now || now < room) share = Math.min(share, Math.max(0, nearest) / room)
  }
  return share
}

/**
 * `bearing`, or the smallest turn from it on the same tack that keeps her clear of the
 * committee boat and obstacles, turning away from the nearest first. When none does,
 * the one that leaves her most room.
 */
export function clearOfObstacles(
  ctx: SimContext,
  boat: BoatState,
  spec: BoatSpec,
  wind: WindSample,
  bearing: Degrees,
): Degrees {
  const share = (heading: Degrees) => obstacleShare(ctx, boat, spec, wind, heading)
  let best = { bearing, share: share(bearing) }
  if (best.share >= 1) return bearing
  const side = Math.sign(boat.twa || 1)
  const towards = angleDelta(
    bearing,
    vectorToBearing(sub(nearestBody(ctx, boat, spec), boat.position)),
  )
  const away = towards > 0 ? -1 : 1
  for (const turn of TURNS) {
    for (const way of [away, -away]) {
      const heading = normalizeBearing(bearing + way * turn)
      const twa = angleDelta(wind.direction, heading)
      if (Math.sign(twa) !== side || Math.abs(twa) < NEAREST_TWA || Math.abs(twa) > FURTHEST_TWA) {
        continue
      }
      const room = share(heading)
      if (room >= 1) return heading
      if (room > best.share) best = { bearing: heading, share: room }
    }
  }
  return best.bearing
}

/** The nearest point of the nearest of the committee boat and obstacles to her hull. */
function nearestBody(ctx: SimContext, boat: BoatState, spec: BoatSpec): Vec2 {
  const hull = hullCentreline(boat, spec)
  let found = { point: boat.position, gap: Number.POSITIVE_INFINITY }
  for (const body of bodiesOf(ctx)) {
    const closest = closestBetweenSegments(hull, body.centreline)
    const gap = closest.distance - body.radius
    if (gap < found.gap) found = { point: closest.onSecond, gap }
  }
  return found.point
}
