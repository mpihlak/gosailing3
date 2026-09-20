import { bearingToVector, cross, dot, sub, type Vec2 } from '@/foundation/geom'
import type { Meters } from '@/foundation/units'
import { hullCentreline, tackOf, type BoatId, type BoatSpec, type BoatState } from '@/domain/boat'

/**
 * The right-of-way rules of Part 2, Section A. Only the three that decide most of what
 * happens on a race course:
 *
 *   10  on opposite tacks, port keeps clear of starboard
 *   11  on the same tack and overlapped, windward keeps clear of leeward
 *   12  on the same tack and not overlapped, clear astern keeps clear of clear ahead
 *
 * Rule 13, while tacking, is not here: a boat is judged on the tack she is on.
 */
export type RightOfWayRule = 10 | 11 | 12

export interface Encounter {
  readonly rule: RightOfWayRule
  readonly rightOfWay: BoatId
  readonly keepClear: BoatId
}

export interface Contender {
  readonly boat: BoatState
  readonly spec: BoatSpec
}

/** How far along an axis the furthest-forward part of a hull reaches. */
function foremost(of: Contender, origin: Vec2, axis: Vec2): Meters {
  const hull = hullCentreline(of.boat, of.spec)
  const ends = [dot(sub(hull.from, origin), axis), dot(sub(hull.to, origin), axis)]
  return Math.max(...ends) + of.spec.beam / 2
}

function aftermost(of: Contender, origin: Vec2, axis: Vec2): Meters {
  const hull = hullCentreline(of.boat, of.spec)
  const ends = [dot(sub(hull.from, origin), axis), dot(sub(hull.to, origin), axis)]
  return Math.min(...ends) - of.spec.beam / 2
}

/**
 * A boat is clear astern of another when her hull is behind a line abeam from the
 * aftermost point of the other's hull. Measured along the other boat's centreline,
 * which is the line that "abeam" is square to.
 */
export function isClearAstern(astern: Contender, ahead: Contender): boolean {
  const axis = bearingToVector(ahead.boat.heading)
  return foremost(astern, ahead.boat.position, axis) < aftermost(ahead, ahead.boat.position, axis)
}

/** Neither clear astern of the other. */
export function areOverlapped(a: Contender, b: Contender): boolean {
  return !isClearAstern(a, b) && !isClearAstern(b, a)
}

/**
 * Whether one boat lies on the other's leeward side — the side away from the wind, which
 * is her starboard side on port tack and her port side on starboard tack.
 */
export function isToLeewardOf(other: Contender, of: Contender): boolean {
  const toOther = sub(other.boat.position, of.boat.position)
  // Positive is to port of her, negative to starboard.
  const side = cross(bearingToVector(of.boat.heading), toOther)
  return tackOf(of.boat.twa) === 'port' ? side < 0 : side > 0
}

/** Which of two boats has right of way, and under which rule. */
export function encounter(a: Contender, b: Contender): Encounter {
  if (tackOf(a.boat.twa) !== tackOf(b.boat.twa)) {
    const port = tackOf(a.boat.twa) === 'port' ? a : b
    const starboard = port === a ? b : a
    return { rule: 10, rightOfWay: starboard.boat.id, keepClear: port.boat.id }
  }

  if (!areOverlapped(a, b)) {
    const astern = isClearAstern(a, b) ? a : b
    const ahead = astern === a ? b : a
    return { rule: 12, rightOfWay: ahead.boat.id, keepClear: astern.boat.id }
  }

  const leeward = isToLeewardOf(b, a) ? b : a
  const windward = leeward === a ? b : a
  return { rule: 11, rightOfWay: leeward.boat.id, keepClear: windward.boat.id }
}
