import { angleDelta } from '@/foundation/geom'
import { clamp, type Degrees } from '@/foundation/units'

/**
 * The lowest tier of steering: hold a bearing. Proportional on the heading error, so the
 * helm eases off as the boat comes onto the new course instead of sawing across it.
 */
export function rudderToHold(heading: Degrees, target: Degrees, degreesForFullRudder = 12): number {
  return clamp(angleDelta(heading, target) / degreesForFullRudder, -1, 1)
}
