import type { Degrees } from '@/foundation/units'
import type { Vec2 } from './vec'

/**
 * One angle convention for the whole game: compass bearings, 0 = north, clockwise.
 * World space has y pointing north, so a bearing maps to (sin, cos) rather than the
 * (cos, sin) you would write for a mathematical angle. The renderer is the only place
 * that flips y for the screen.
 */

export const DEG_TO_RAD = Math.PI / 180
export const RAD_TO_DEG = 180 / Math.PI

export function toRadians(degrees: Degrees): number {
  return degrees * DEG_TO_RAD
}

export function toDegrees(radians: number): Degrees {
  return radians * RAD_TO_DEG
}

/** Wrap to [0, 360). */
export function normalizeBearing(bearing: Degrees): Degrees {
  const wrapped = bearing % 360
  if (wrapped >= 0) return wrapped
  // A tiny negative angle rounds to exactly 360 when shifted, which is out of range.
  const shifted = wrapped + 360
  return shifted >= 360 ? 0 : shifted
}

/** Wrap to (-180, 180]. */
export function normalizeSigned(angle: Degrees): Degrees {
  const wrapped = normalizeBearing(angle)
  return wrapped > 180 ? wrapped - 360 : wrapped
}

/** Shortest signed rotation from one bearing to another, positive clockwise. */
export function angleDelta(from: Degrees, to: Degrees): Degrees {
  return normalizeSigned(to - from)
}

/** Unsigned separation between two bearings, 0 to 180. */
export function angleBetween(a: Degrees, b: Degrees): Degrees {
  return Math.abs(angleDelta(a, b))
}

export function bearingToVector(bearing: Degrees): Vec2 {
  const rad = toRadians(bearing)
  return { x: Math.sin(rad), y: Math.cos(rad) }
}

export function vectorToBearing(v: Vec2): Degrees {
  return normalizeBearing(toDegrees(Math.atan2(v.x, v.y)))
}

/** Interpolate between bearings the short way around the compass. */
export function lerpBearing(from: Degrees, to: Degrees, t: number): Degrees {
  return normalizeBearing(from + angleDelta(from, to) * t)
}

export function mirrorBearing(bearing: Degrees, axis: Degrees): Degrees {
  return normalizeBearing(2 * axis - bearing)
}
