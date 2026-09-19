import type { Vec2 } from '@/foundation/geom'
import type { Degrees, Knots, Seconds } from '@/foundation/units'

export interface WindSample {
  /** The direction the wind blows FROM, as a compass bearing. */
  readonly direction: Degrees
  readonly speed: Knots
}

/**
 * Wind is a pure function of where you are and what time it is. It holds no state
 * and never advances itself, so a replay can be scrubbed backwards, two clients can
 * agree without exchanging anything, and a test can jump straight to minute nine.
 */
export interface WindField {
  sample(position: Vec2, time: Seconds): WindSample
}

/** A layer that adjusts the wind: an oscillation, a gradient across the course, a gust. */
export type WindModifier = (sample: WindSample, position: Vec2, time: Seconds) => WindSample
