import { bearingToVector, dot, sub, type Vec2 } from '@/foundation/geom'
import { inverseLerp, lerp, type Degrees, type Knots, type Meters } from '@/foundation/units'
import type { WindModifier } from './types'

export interface GradientOptions {
  /** Median wind direction, used to work out which side of the course is which. */
  readonly axis: Degrees
  /** Wind speed on the left-hand side of the course, looking upwind. */
  readonly leftSpeed: Knots
  readonly rightSpeed: Knots
  /** Point the two sides are measured either side of, usually the middle of the course. */
  readonly center: Vec2
  /** Distance from the center at which the full left or right speed applies. */
  readonly halfWidth: Meters
}

/**
 * More breeze on one side of the course than the other. This is the decision that makes
 * the first beat worth thinking about: pick a side, and live with it.
 */
export function sideGradient(options: GradientOptions): WindModifier {
  const { axis, leftSpeed, rightSpeed, center, halfWidth } = options
  // Looking upwind, the cross-course axis points to the right-hand side.
  const crossAxis = bearingToVector(axis + 90)

  return (sample, position) => {
    const across = dot(sub(position, center), crossAxis)
    const t = inverseLerp(-halfWidth, halfWidth, across)
    // The gradient scales whatever speed reached this layer, so it composes with gusts.
    const base = (leftSpeed + rightSpeed) / 2
    const factor = base === 0 ? 1 : lerp(leftSpeed, rightSpeed, t) / base
    return { ...sample, speed: sample.speed * factor }
  }
}
