import { add, bearingToVector, cross, dot, normalizeBearing, scale, sub, type Vec2 } from '@/foundation/geom'
import type { Degrees, Meters } from '@/foundation/units'
import type { Mark, RoundingSide } from './types'

export interface Layline {
  readonly tack: 'port' | 'starboard'
  /** The heading a boat sails on this tack to reach the mark. */
  readonly bearing: Degrees
  /** Where the layline starts, for drawing: the mark itself. */
  readonly origin: Vec2
  /** Direction the layline extends away from the mark, the reciprocal of `bearing`. */
  readonly extends: Vec2
}

/**
 * The two courses that fetch a windward mark without another tack. Crossing one is the
 * moment a beat stops being a choice, so the instruments draw them and the AI aims at them.
 */
export function laylines(mark: Vec2, windDirection: Degrees, beatAngle: Degrees): [Layline, Layline] {
  const build = (tack: 'port' | 'starboard'): Layline => {
    const bearing = normalizeBearing(windDirection + (tack === 'port' ? beatAngle : -beatAngle))
    return {
      tack,
      bearing,
      origin: mark,
      extends: bearingToVector(bearing + 180),
    }
  }
  return [build('port'), build('starboard')]
}

/** How far past the layline a boat is: positive once it can lay the mark. */
export function laylineMargin(
  position: Vec2,
  layline: Layline,
  rounding: RoundingSide = 'port',
): Meters {
  const toMark = sub(layline.origin, position)
  const along = bearingToVector(layline.bearing)
  const side = cross(along, toMark)
  // Approaching a port-rounding mark on starboard, overstanding puts the mark to port.
  const sign = rounding === 'port' ? 1 : -1
  return sign * (layline.tack === 'starboard' ? side : -side)
}

/**
 * The angular position of a boat around a mark, measured from the direction it is being
 * approached from. Accumulating this is how a rounding is judged: a boat that has swept
 * half a turn around the mark the right way has rounded it.
 */
export function bearingAroundMark(mark: Vec2, position: Vec2): Degrees {
  const offset = sub(position, mark)
  return normalizeBearing((Math.atan2(offset.x, offset.y) * 180) / Math.PI)
}

/** The zone, in boat lengths, that rule 18 turns on. Drawn now, enforced later. */
export function markZone(mark: Mark, boatLength: Meters, lengths = 3): number {
  return mark.radius + boatLength * lengths
}

export function isInZone(mark: Mark, position: Vec2, boatLength: Meters, lengths = 3): boolean {
  const reach = markZone(mark, boatLength, lengths)
  const offset = sub(position, mark.position)
  return dot(offset, offset) <= reach * reach
}

export function pointAt(origin: Vec2, bearing: Degrees, distance: Meters): Vec2 {
  return add(origin, scale(bearingToVector(bearing), distance))
}

/**
 * Which side of a mark a boat is on, measured across the leg that leads to it.
 * Negative is the side that leaves the mark to port as the boat goes by.
 */
export function sideOfMark(mark: Vec2, approach: Degrees, position: Vec2): number {
  const along = bearingToVector(approach)
  const offset = sub(position, mark)
  return cross(along, offset)
}

/** How far along the leg the boat is relative to the mark. Positive means past it. */
export function pastMark(mark: Vec2, approach: Degrees, position: Vec2): Meters {
  return dot(sub(position, mark), bearingToVector(approach))
}
