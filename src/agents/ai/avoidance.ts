import {
  add,
  angleDelta,
  bearingToVector,
  distance,
  dot,
  length,
  normalizeBearing,
  scale,
  sub,
} from '@/foundation/geom'
import { clamp, knotsToMps, type Degrees, type Meters, type Seconds } from '@/foundation/units'
import type { BoatSpec, BoatState } from '@/domain/boat'
import { encounter, type Contender, type RightOfWayRule } from '@/domain/rules'
import { specFor, type SimContext, type WorldState } from '@/sim'

/**
 * How far ahead a meeting is looked for. Far enough to turn away in time — she comes
 * round at about twenty degrees a second at speed — and not so far that a boat who will
 * have tacked or rounded a mark by then is still taken to be coming.
 */
const LOOKAHEAD: Seconds = 8
/** How close, in her own lengths, a boat may come before it is a meeting to avoid. */
const SEPARATION = 2
/** The turns tried away from the course she wants, smallest first. */
const TURNS: readonly Degrees[] = [10, 20, 30, 45, 60]
/**
 * The angles to the wind she may be turned to: short of head to wind and of dead
 * downwind, so that keeping clear never tacks or gybes her and changes who has right of
 * way. Luffing hard up to slow down is allowed; going through the wind is not.
 */
const NEAREST_TWA: Degrees = 15
const FURTHEST_TWA: Degrees = 170

export interface GiveWay {
  readonly bearing: Degrees
  /** The rule she is keeping clear under, for whoever wants to show it. */
  readonly rule: RightOfWayRule
}

/**
 * The course to steer instead of `bearing` when holding it would bring her too close to a
 * boat she has to keep clear of, or nothing when it would not.
 *
 * Each boat is taken to hold her course and speed. That is what a right-of-way boat is
 * expected to do, and the only forecast that needs nothing but where she is now.
 *
 * Of the courses she could turn to, she takes the smallest turn that keeps her clear of
 * everyone, turning first the way the rule makes cheapest: under rule 10 upwind she bears
 * away to pass astern, under rule 11 she luffs away from the boat to leeward. When nothing
 * keeps her clear she takes whatever leaves the most room.
 *
 * `margin` scales the room asked for. A boat already keeping clear asks for more before
 * she goes back to her course, or she would turn back into the boat she just avoided.
 */
export function giveWay(
  ctx: SimContext,
  world: WorldState,
  boat: BoatState,
  spec: BoatSpec,
  windDirection: Degrees,
  bearing: Degrees,
  margin = 1,
): GiveWay | undefined {
  const limit = SEPARATION * spec.length * margin
  const near = world.boats.filter(
    (other) =>
      other.id !== boat.id &&
      distance(other.position, boat.position) <
        limit + knotsToMps(boat.speed + other.speed) * LOOKAHEAD,
  )
  if (near.length === 0) return undefined

  const contender = (of: BoatState): Contender => {
    const progress = world.race.progress[of.id]
    return {
      boat: of,
      spec: specFor(ctx, of.id),
      racing: progress?.status !== 'finished',
      tacking: progress?.tacking === true,
    }
  }
  const me = contender(boat)
  const verdicts = near.map((other) => ({ other, verdict: encounter(me, contender(other)) }))
  const giving = verdicts.filter(({ verdict }) => verdict.keepClear === boat.id)

  const pressing = closest(
    boat,
    bearing,
    giving.map(({ other }) => other),
  )
  if (!pressing || pressing.gap >= limit) return undefined
  const rule = giving.find(({ other }) => other === pressing.other)!.verdict.rule

  // Turning towards the wind is a luff. Her heading is the wind's direction plus her
  // angle to it, so on port that is a turn to port and on starboard one to starboard.
  const luff = boat.twa >= 0 ? -1 : 1
  const upwind = Math.abs(boat.twa) < 90
  const first = rule === 11 ? luff : rule === 10 && upwind ? -luff : 1

  const sailable = (heading: Degrees) => {
    const twa = angleDelta(windDirection, heading)
    return (
      Math.sign(twa) === Math.sign(boat.twa || 1) &&
      Math.abs(twa) >= NEAREST_TWA &&
      Math.abs(twa) <= FURTHEST_TWA
    )
  }
  const candidates = TURNS.flatMap((turn) => [first * turn, -first * turn])
    .map((turn) => normalizeBearing(bearing + turn))
    .filter(sailable)

  let best = { bearing, gap: pressing.gap }
  for (const candidate of candidates) {
    const gap = closest(boat, candidate, near)?.gap ?? Number.POSITIVE_INFINITY
    if (gap >= limit) return { bearing: candidate, rule }
    if (gap > best.gap) best = { bearing: candidate, gap }
  }
  return { bearing: best.bearing, rule }
}

/**
 * The nearest any of `others` comes to her over the look-ahead if she sails `heading`,
 * counting only those she is closing on. A boat alongside and drawing away is no meeting,
 * however close she is now.
 */
function closest(
  boat: BoatState,
  heading: Degrees,
  others: readonly BoatState[],
): { readonly other: BoatState; readonly gap: Meters } | undefined {
  const mine = scale(bearingToVector(heading), knotsToMps(boat.speed))
  let found: { other: BoatState; gap: Meters } | undefined
  for (const other of others) {
    const apart = sub(other.position, boat.position)
    const closing = sub(scale(bearingToVector(other.heading), knotsToMps(other.speed)), mine)
    const speed = dot(closing, closing)
    // The moment they are nearest, on straight courses, and how near that is.
    const when = speed > 0 ? clamp(-dot(apart, closing) / speed, 0, LOOKAHEAD) : 0
    if (when === 0) continue
    const gap = length(add(apart, scale(closing, when)))
    if (!found || gap < found.gap) found = { other, gap }
  }
  return found
}
