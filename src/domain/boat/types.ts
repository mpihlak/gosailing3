import type { Vec2 } from '@/foundation/geom'
import type { Degrees, DegreesPerSecond, Knots } from '@/foundation/units'

export type BoatId = string

export type Tack = 'port' | 'starboard'

export interface BoatState {
  readonly id: BoatId
  readonly position: Vec2
  /** Where the bow points. */
  readonly heading: Degrees
  /** Speed through the water, in knots. */
  readonly speed: Knots
  readonly turnRate: DegreesPerSecond
  /** True wind angle: 0 is head to wind, positive means the wind is on the port side. */
  readonly twa: Degrees
  /** The direction the boat actually travels, which is its heading plus leeway. */
  readonly course: Degrees
  /** How far the boat is slipping sideways, in degrees. */
  readonly leeway: Degrees
}

/**
 * Everything that steers a boat produces one of these, whether it is a player holding
 * an arrow key, an AI tactician, or a packet from another machine. Sails trim
 * themselves, so the helm is the whole of the control problem.
 */
export interface BoatInput {
  /** -1 is hard over to port, +1 is hard over to starboard, 0 is centered. */
  readonly rudder: number
}

export const NEUTRAL_INPUT: BoatInput = { rudder: 0 }
