/**
 * Units are meters, seconds and degrees throughout the simulation. Boat and wind
 * speeds are the exception: the sailing domain speaks knots, so knots is what the
 * polar tables, the instruments and the wind model carry. Convert at the point of
 * integration, never in between.
 */

export type Meters = number
export type Seconds = number
export type Knots = number
export type MetersPerSecond = number

/** Compass bearing: 0 is north, 90 is east, increasing clockwise. */
export type Degrees = number
export type DegreesPerSecond = number

export const KNOTS_TO_MPS = 0.514444

export function knotsToMps(knots: Knots): MetersPerSecond {
  return knots * KNOTS_TO_MPS
}

export function mpsToKnots(mps: MetersPerSecond): Knots {
  return mps / KNOTS_TO_MPS
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Fraction of the way from `a` to `b`, clamped, and 0 when the span is empty. */
export function inverseLerp(a: number, b: number, value: number): number {
  if (a === b) return 0
  return clamp((value - a) / (b - a), 0, 1)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Hermite ease used wherever a value must arrive and leave without a corner. */
export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1)
  return c * c * (3 - 2 * c)
}
