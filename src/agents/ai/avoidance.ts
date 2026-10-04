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
import {
  clamp,
  knotsToMps,
  type Degrees,
  type Knots,
  type Meters,
  type Seconds,
} from '@/foundation/units'
import type { BoatSpec, BoatState } from '@/domain/boat'
import type { WindSample } from '@/domain/wind'
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
/**
 * The turns tried away from the course she wants, smallest first. A duck behind a boat
 * crossing ahead needs a few degrees, not a run square away from her.
 */
const TURNS: readonly Degrees[] = [5, 10, 15, 20, 30]
/**
 * Larger turns, for when none of the small ones keeps her even a length away: about where
 * the hulls would touch, and a penalty costs more than a hard turn.
 */
const HARD_TURNS: readonly Degrees[] = [45, 60]
/** The room, in her own lengths, short of which she makes a hard turn rather than a small one. */
const TOUCHING = 1
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
 * Each other boat is taken to hold her course and speed. That is what a right-of-way boat
 * is expected to do, and the only forecast that needs nothing but where she is now. Her
 * own speed on a new course is taken halfway to what the polar gives there: luffed close
 * to the wind she slows, and a forecast that kept her speed had her luff to head to wind
 * to cross ahead of a boat she should have ducked.
 *
 * Of the courses she could turn to, she takes the smallest turn that keeps her clear of
 * everyone, turning first the way the rule makes cheapest: under rule 10 upwind she bears
 * away to pass astern, under rule 11 she luffs away from the boat to leeward. When nothing
 * keeps her clear she takes whatever leaves the most room, turning harder only when even
 * that would leave less than a length.
 *
 * `margin` scales the room that sets her keeping clear, not the room she turns to find.
 * A boat already keeping clear asks for more before she goes back to her course, or she
 * would turn back into the boat she just avoided. Asked of every course she might turn
 * to as well, the larger room is seldom there, and she would run off square looking for it.
 */
export function giveWay(
  ctx: SimContext,
  world: WorldState,
  boat: BoatState,
  spec: BoatSpec,
  wind: WindSample,
  bearing: Degrees,
  margin = 1,
): GiveWay | undefined {
  const windDirection = wind.direction
  const speedOn = (heading: Degrees) =>
    (boat.speed + spec.polar.boatSpeed(angleDelta(windDirection, heading), wind.speed)) / 2
  const room = SEPARATION * spec.length
  const limit = room * margin
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
    speedOn(bearing),
    giving.map(({ other }) => other),
  )
  if (!pressing || pressing.gap >= limit) return undefined
  const rule = giving.find(({ other }) => other === pressing.other)!.verdict.rule

  // Turning towards the wind is a luff. Her heading is the wind's direction plus her
  // angle to it, so on port that is a turn to port and on starboard one to starboard.
  const luff = boat.twa >= 0 ? -1 : 1
  const upwind = Math.abs(boat.twa) < 90
  // A port tack boat meeting starboard upwind ducks. Luffing instead stops her head to
  // wind in front of the boat she is meant to be avoiding.
  const ducking = rule === 10 && upwind
  const first = rule === 11 ? luff : ducking ? -luff : 1

  const sailable = (heading: Degrees) => {
    const twa = angleDelta(windDirection, heading)
    return (
      Math.sign(twa) === Math.sign(boat.twa || 1) &&
      Math.abs(twa) >= NEAREST_TWA &&
      Math.abs(twa) <= FURTHEST_TWA
    )
  }
  const headings = (turns: readonly Degrees[]) =>
    turns
      .flatMap((turn) => (ducking ? [first * turn] : [first * turn, -first * turn]))
      .map((turn) => normalizeBearing(bearing + turn))
      .filter(sailable)

  let best = { bearing, gap: pressing.gap }
  const tryAll = (candidates: readonly Degrees[]) => {
    for (const candidate of candidates) {
      const gap =
        closest(boat, candidate, speedOn(candidate), near)?.gap ?? Number.POSITIVE_INFINITY
      if (gap >= room) return candidate
      if (gap > best.gap) best = { bearing: candidate, gap }
    }
    return undefined
  }
  const small = tryAll(headings(TURNS))
  if (small !== undefined) return { bearing: small, rule }
  if (best.gap >= TOUCHING * spec.length) return { bearing: best.bearing, rule }
  const hard = tryAll(headings(HARD_TURNS))
  return { bearing: hard ?? best.bearing, rule }
}

/**
 * The nearest any of `others` comes to her over the look-ahead if she sails `heading`,
 * counting only those she is closing on. A boat alongside and drawing away is no meeting,
 * however close she is now.
 */
function closest(
  boat: BoatState,
  heading: Degrees,
  speed: Knots,
  others: readonly BoatState[],
): { readonly other: BoatState; readonly gap: Meters } | undefined {
  const mine = scale(bearingToVector(heading), knotsToMps(speed))
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
