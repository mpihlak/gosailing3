import {
  add,
  angleDelta,
  bearingToVector,
  closestBetweenSegments,
  distance,
  dot,
  length,
  normalizeBearing,
  scale,
  sub,
  type Vec2,
} from '@/foundation/geom'
import {
  clamp,
  knotsToMps,
  type Degrees,
  type Knots,
  type Meters,
  type Seconds,
} from '@/foundation/units'
import { hullCentreline, hullRadius, type BoatSpec, type BoatState } from '@/domain/boat'
import type { WindSample } from '@/domain/wind'
import { encounter, type Contender, type RightOfWayRule } from '@/domain/rules'
import { specFor, type SimContext, type WorldState } from '@/sim'
import { clearToTack } from './tacking'

/**
 * How far ahead a meeting is looked for. Far enough to turn away in time — she comes
 * round at about twenty degrees a second at speed — and not so far that a boat who will
 * have tacked or rounded a mark by then is still taken to be coming.
 */
const LOOKAHEAD: Seconds = 8
/** How close, in her own lengths, a boat may come before it is a meeting to avoid. */
const SEPARATION = 2
/**
 * The room, in her own lengths and hull to hull, she keeps from a boat she is clear
 * astern of. Behind a boat she can luff or bear away past either side of her. Asked for
 * two lengths between the boats' middles, she sat behind a slow boat to the gun.
 */
const ASTERN_ROOM = 0.5
/** How often, in seconds, the look-ahead checks the gap between two hulls. */
const STEP: Seconds = 0.25
/**
 * The turns tried away from the course she wants, smallest first. A duck behind a boat
 * crossing ahead needs a few degrees, not a run square away from her.
 */
const TURNS: readonly Degrees[] = [5, 10, 15, 20, 30]
/**
 * Larger turns, for when none of the small ones keeps her even half the room she wants:
 * about where the hulls would touch, and a penalty costs more than a hard turn.
 */
const HARD_TURNS: readonly Degrees[] = [45, 60]
/** The share of the room she wants short of which she makes a hard turn rather than a small one. */
const TOUCHING = 0.5
/**
 * The angles to the wind she may be turned to: short of head to wind and of dead
 * downwind, so that keeping clear never tacks or gybes her and changes who has right of
 * way. Luffing hard up to slow down is allowed; going through the wind is not.
 */
const NEAREST_TWA: Degrees = 15
const FURTHEST_TWA: Degrees = 170
/**
 * How far above close-hauled a boat may luff her before the gun before she tacks away
 * instead, if the tack is clear. Followed further up she stops head to wind beside the
 * boat luffing her. After the gun she stays on the tack she is racing on.
 */
const LUFFED_PAST: Degrees = 10
/**
 * How close, in her own lengths, the boat to leeward has to be for her to count as
 * luffing her. Further off, the luff is her own keeping clear of a forecast, and a tack
 * there only throws away her start.
 */
const LUFFED_WITHIN = 1.5

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
 * The room is two lengths between the boats' middles, except from a boat she is clear
 * astern of, where it is `ASTERN_ROOM` between the hulls.
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
  const astern = new Set(
    giving.filter(({ verdict }) => verdict.rule === 12).map(({ other }) => other.id),
  )
  const meeting = (heading: Degrees, others: readonly BoatState[]) =>
    closest(ctx, boat, spec, heading, speedOn(heading), others, astern, room)

  const pressing = meeting(
    bearing,
    giving.map(({ other }) => other),
  )
  if (!pressing || pressing.share >= margin) return undefined
  const rule = giving.find(({ other }) => other === pressing.other)!.verdict.rule

  const luffedBy =
    rule === 11 &&
    world.race.progress[boat.id]?.status === 'prestart' &&
    distance(pressing.other.position, boat.position) < LUFFED_WITHIN * spec.length
  const away = luffedBy ? tackAway(world, boat, spec, wind) : undefined
  if (away !== undefined) return { bearing: away, rule }

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

  let best = { bearing, share: pressing.share }
  const tryAll = (candidates: readonly Degrees[]) => {
    for (const candidate of candidates) {
      const share = meeting(candidate, near)?.share ?? Number.POSITIVE_INFINITY
      if (share >= 1) return candidate
      if (share > best.share) best = { bearing: candidate, share }
    }
    return undefined
  }
  const small = tryAll(headings(TURNS))
  if (small !== undefined) return { bearing: small, rule }
  if (best.share >= TOUCHING) return { bearing: best.bearing, rule }
  const hard = tryAll(headings(HARD_TURNS))
  return { bearing: hard ?? best.bearing, rule }
}

/** Close-hauled on the other tack, when she has been luffed past `LUFFED_PAST` and it is clear. */
function tackAway(
  world: WorldState,
  boat: BoatState,
  spec: BoatSpec,
  wind: WindSample,
): Degrees | undefined {
  const beat = spec.polar.beatAngle(wind.speed)
  if (Math.abs(boat.twa) > beat - LUFFED_PAST) return undefined
  const heading = normalizeBearing(wind.direction - Math.sign(boat.twa || 1) * beat)
  return clearToTack(world, boat, spec, heading) ? heading : undefined
}

/**
 * The boat among `others` who comes nearest her over the look-ahead if she sails
 * `heading`, and what share of the room she wants that leaves, counting only those she is
 * closing on. A boat alongside and drawing away is no meeting, however close she is now.
 */
function closest(
  ctx: SimContext,
  boat: BoatState,
  spec: BoatSpec,
  heading: Degrees,
  speed: Knots,
  others: readonly BoatState[],
  astern: ReadonlySet<string>,
  room: Meters,
): { readonly other: BoatState; readonly share: number } | undefined {
  const mine = scale(bearingToVector(heading), knotsToMps(speed))
  let found: { other: BoatState; share: number } | undefined
  for (const other of others) {
    const share = astern.has(other.id)
      ? hullGap(boat, spec, heading, mine, other, specFor(ctx, other.id)) /
        (ASTERN_ROOM * spec.length)
      : middlesApart(boat, mine, other) / room
    if (!found || share < found.share) found = { other, share }
  }
  return found
}

/** The nearest the boats' middles come, on straight courses. Infinite if they are not closing. */
function middlesApart(boat: BoatState, mine: Vec2, other: BoatState): Meters {
  const apart = sub(other.position, boat.position)
  const closing = sub(scale(bearingToVector(other.heading), knotsToMps(other.speed)), mine)
  const speed = dot(closing, closing)
  const when = speed > 0 ? clamp(-dot(apart, closing) / speed, 0, LOOKAHEAD) : 0
  return when === 0 ? Number.POSITIVE_INFINITY : length(add(apart, scale(closing, when)))
}

/**
 * The nearest the two hulls come, edge to edge, with her on `heading` and the other boat
 * holding her course. Infinite if they are never closer than they are now.
 */
function hullGap(
  boat: BoatState,
  spec: BoatSpec,
  heading: Degrees,
  mine: Vec2,
  other: BoatState,
  otherSpec: BoatSpec,
): Meters {
  const theirs = scale(bearingToVector(other.heading), knotsToMps(other.speed))
  const radii = hullRadius(spec) + hullRadius(otherSpec)
  const gapAt = (t: Seconds) =>
    closestBetweenSegments(
      hullCentreline({ ...boat, heading, position: add(boat.position, scale(mine, t)) }, spec),
      hullCentreline({ ...other, position: add(other.position, scale(theirs, t)) }, otherSpec),
    ).distance - radii
  const now = gapAt(0)
  let nearest = Number.POSITIVE_INFINITY
  for (let t = STEP; t <= LOOKAHEAD; t += STEP) nearest = Math.min(nearest, gapAt(t))
  return nearest < now ? Math.max(0, nearest) : Number.POSITIVE_INFINITY
}
