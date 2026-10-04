import { angleDelta } from '@/foundation/geom'
import { clamp, type Degrees, type DegreesPerSecond, type Seconds } from '@/foundation/units'

/**
 * The lowest tier of steering: hold a bearing. Proportional on the heading error, so the
 * helm eases off as the boat comes onto the new course instead of sawing across it.
 *
 * The boat answers the helm late: her rate of turn takes `lead` seconds to follow the
 * rudder. So the helm steers against the turn she already has, aiming short by the
 * degrees it will still carry her. Without that she swings past a new course and settles
 * back over several seconds. A lead equal to the boat's own response time stops her
 * swinging past at all.
 */
export function rudderToHold(
  heading: Degrees,
  target: Degrees,
  degreesForFullRudder = 12,
  turnRate: DegreesPerSecond = 0,
  lead: Seconds = 0,
): number {
  const error = angleDelta(heading, target) - turnRate * lead
  return clamp(error / degreesForFullRudder, -1, 1)
}
