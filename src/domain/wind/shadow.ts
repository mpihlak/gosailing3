import { bearingToVector, cross, dot, normalizeBearing, sub, type Vec2 } from '@/foundation/geom'
import { smoothstep, type Degrees, type Meters } from '@/foundation/units'
import type { WindSample } from './types'

/**
 * A boat casts a shadow on the water to leeward of her.
 *
 * Her rig blocks the flow, so boats behind her sail in less wind — reaching some four to
 * seven mast heights downwind, and widening as it goes. Her sails also bend the air, the
 * way any wing does, so what reaches them is not merely weaker but turned. A wing works
 * on the flow ahead of it as well, which is why the shadow reaches a little way upwind of
 * her too, and why a boat sitting just ahead and to leeward of another is in a good place.
 *
 * Which way the air is turned is hers, decided by the tack she is on: the air does not
 * know who sails into it. A boat on the same tack as her finds it a header. A boat on the
 * other tack finds the same turn a lift. Both find less wind.
 */
export interface Shadower {
  readonly id: string
  readonly position: Vec2
  /** Her true wind angle, which says which way her sails bend the air. */
  readonly twa: Degrees
  readonly length: Meters
}

export interface ShadowOptions {
  /** How far downwind it reaches, in boat lengths. */
  readonly aftLengths?: number
  /** And how far upwind, which is much less. */
  readonly forwardLengths?: number
  readonly widthLengths?: number
  /** Wind lost right behind her, as a fraction. */
  readonly maxLoss?: number
  /** How far the air is turned right behind her. */
  readonly maxBend?: Degrees
}

const DEFAULTS = {
  aftLengths: 7,
  forwardLengths: 1.5,
  widthLengths: 2.5,
  maxLoss: 0.4,
  maxBend: 12,
} as const

export interface ShadowReach {
  readonly aft: Meters
  readonly forward: Meters
  readonly halfWidth: Meters
}

/** How far a boat's shadow reaches, for judging it and for drawing it. */
export function shadowReach(shadower: Shadower, options: ShadowOptions = {}): ShadowReach {
  const { aftLengths, forwardLengths, widthLengths } = { ...DEFAULTS, ...options }
  return {
    aft: shadower.length * aftLengths,
    forward: shadower.length * forwardLengths,
    halfWidth: shadower.length * widthLengths,
  }
}

/**
 * How heavily one boat's shadow lies on a point: nothing outside it, hardest at the boat.
 *
 * Two half ellipses sharing a waist at her rather than one ellipse behind her, so that
 * the worst of it is where she is and it thins out downwind, which is the way round it
 * happens.
 */
export function shadowStrength(
  shadower: Shadower,
  at: Vec2,
  windDirection: Degrees,
  options: ShadowOptions = {},
): number {
  const reach = shadowReach(shadower, options)
  const downwind = bearingToVector(normalizeBearing(windDirection + 180))
  const offset = sub(at, shadower.position)

  const along = dot(offset, downwind)
  const across = cross(downwind, offset)
  const span = along >= 0 ? reach.aft : reach.forward
  if (span <= 0 || reach.halfWidth <= 0) return 0

  const within = Math.hypot(along / span, across / reach.halfWidth)
  return within >= 1 ? 0 : smoothstep(1 - within)
}

/**
 * The wind at a point once the fleet's shadows are laid over it.
 *
 * Kept apart from the wind field itself, which is a pure function of where and when and
 * knows nothing of boats. Shadows are the fleet's doing, so they are applied where the
 * fleet is known, and the field stays something a replay can sample at any moment.
 */
export function shade(
  natural: WindSample,
  at: Vec2,
  shadowers: readonly Shadower[],
  options: ShadowOptions = {},
): WindSample {
  const { maxLoss, maxBend } = { ...DEFAULTS, ...options }

  let speedFactor = 1
  let bend = 0

  for (const shadower of shadowers) {
    const strength = shadowStrength(shadower, at, natural.direction, options)
    if (strength <= 0) continue

    speedFactor *= 1 - maxLoss * strength
    // Her sails turn the air one way on port tack and the other on starboard. A boat on
    // her tack is headed by it; one on the other tack is lifted by the same turn.
    bend += (shadower.twa >= 0 ? 1 : -1) * maxBend * strength
  }

  if (speedFactor === 1 && bend === 0) return natural
  return {
    direction: normalizeBearing(natural.direction + bend),
    speed: natural.speed * speedFactor,
  }
}
