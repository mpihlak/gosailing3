import type { Degrees, DegreesPerSecond, Knots, Meters, Seconds } from '@/foundation/units'
import { createPolar, CRUISER_35, type Polar } from '@/domain/polars'

/**
 * The handling of a class of boat. Everything here is tunable in the lab: these are the
 * numbers that decide whether the game feels like a keelboat or a dinghy.
 */
export interface BoatSpec {
  readonly name: string
  readonly polar: Polar
  readonly length: Meters
  readonly beam: Meters
  /** Radius used for contact, a little wider than the hull to stand in for crew nerves. */
  readonly contactRadius: Meters
  /** Turn rate at full rudder once the boat has steerage way. */
  readonly maxTurnRate: DegreesPerSecond
  /** How quickly the turn rate answers the helm. */
  readonly turnResponse: Seconds
  /** Speed at which the rudder bites fully. Below it, steering gets vague. */
  readonly steerageSpeed: Knots
  /** How quickly the boat builds speed toward its polar target. */
  readonly accelerationTime: Seconds
  /** How quickly it loses speed. Boats stop more readily than they go. */
  readonly decelerationTime: Seconds
  /** Fraction of speed lost per degree per second of turning. This is what makes a
   * carelessly thrown tack expensive, and rewards a smooth one. */
  readonly rudderDrag: number
  /** Scales how far the boat slips to leeward. */
  readonly leewayFactor: Degrees
}

export const CRUISER_35_SPEC: BoatSpec = {
  name: 'Cruiser 35',
  polar: createPolar(CRUISER_35),
  length: 10.7,
  beam: 3.4,
  contactRadius: 6,
  maxTurnRate: 22,
  turnResponse: 0.7,
  steerageSpeed: 2.5,
  accelerationTime: 7,
  decelerationTime: 4.5,
  rudderDrag: 0.004,
  leewayFactor: 4,
}
