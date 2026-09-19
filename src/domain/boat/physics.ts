import {
  add,
  bearingToVector,
  normalizeBearing,
  normalizeSigned,
  scale,
  toRadians,
  type Vec2,
} from '@/foundation/geom'
import { clamp, knotsToMps, type Degrees, type Knots, type Seconds } from '@/foundation/units'
import type { WindSample } from '@/domain/wind'
import type { BoatSpec } from './spec'
import type { BoatInput, BoatState, Tack } from './types'

/**
 * True wind angle, signed. Positive means the wind crosses the boat from the port side,
 * which is what puts her on port tack.
 */
export function trueWindAngle(heading: Degrees, windDirection: Degrees): Degrees {
  return normalizeSigned(heading - windDirection)
}

export function tackOf(twa: Degrees): Tack {
  return twa >= 0 ? 'port' : 'starboard'
}

export function bowPosition(state: BoatState, spec: BoatSpec): Vec2 {
  return add(state.position, scale(bearingToVector(state.heading), spec.length / 2))
}

export function velocityOf(state: BoatState): Vec2 {
  return scale(bearingToVector(state.course), knotsToMps(state.speed))
}

/**
 * How far the boat slips sideways. Side force peaks upwind and all but disappears once
 * she bears away, and a boat moving faster needs less of an angle to resist it — so
 * leeway is largest when close-hauled and slow, which is exactly when it hurts.
 */
export function leewayAngle(twa: Degrees, speed: Knots, wind: WindSample, spec: BoatSpec): Degrees {
  const absTwa = Math.abs(twa)
  const rad = toRadians(absTwa)
  const sideForce = Math.sin(rad) * Math.cos(rad / 2) ** 2
  const pressure = wind.speed / Math.max(speed, 1)
  return spec.leewayFactor * sideForce * pressure * Math.sign(twa || 1)
}

/** Exponential approach, so the result does not depend on the size of the time step. */
function approach(current: number, target: number, timeConstant: Seconds, dt: Seconds): number {
  if (timeConstant <= 0) return target
  return current + (target - current) * (1 - Math.exp(-dt / timeConstant))
}

export interface BoatEnvironment {
  readonly wind: WindSample
}

/**
 * Advance one boat by one tick. Pure: the same state, input, wind and step always give
 * the same result, with no clock and no shared state anywhere in sight.
 */
export function stepBoat(
  state: BoatState,
  input: BoatInput,
  spec: BoatSpec,
  env: BoatEnvironment,
  dt: Seconds,
): BoatState {
  const { wind } = env

  // A boat with no way on answers the helm poorly, which is what strands you in irons.
  const steerage = clamp(state.speed / spec.steerageSpeed, 0.12, 1)
  const demandedTurn = clamp(input.rudder, -1, 1) * spec.maxTurnRate * steerage
  const turnRate = approach(state.turnRate, demandedTurn, spec.turnResponse, dt)
  const heading = normalizeBearing(state.heading + turnRate * dt)

  const twa = trueWindAngle(heading, wind.direction)
  const targetSpeed = spec.polar.boatSpeed(twa, wind.speed)

  const timeConstant = targetSpeed > state.speed ? spec.accelerationTime : spec.decelerationTime
  let speed = approach(state.speed, targetSpeed, timeConstant, dt)

  // Rudder drag. Throwing the helm over scrubs speed, so a hurried tack costs more
  // than a patient one.
  speed = Math.max(0, speed * (1 - spec.rudderDrag * Math.abs(turnRate) * dt))

  const leeway = leewayAngle(twa, speed, wind, spec)
  const course = normalizeBearing(heading + leeway)
  const position = add(state.position, scale(bearingToVector(course), knotsToMps(speed) * dt))

  return { id: state.id, position, heading, speed, turnRate, twa, course, leeway }
}

export interface SpawnOptions {
  readonly id: string
  readonly position: Vec2
  readonly heading: Degrees
  /** Omit to start at the polar speed for the heading, which is the usual case. */
  readonly speed?: Knots
}

/** A boat placed on the water, already sailing at her natural speed for the conditions. */
export function spawnBoat(options: SpawnOptions, spec: BoatSpec, wind: WindSample): BoatState {
  const heading = normalizeBearing(options.heading)
  const twa = trueWindAngle(heading, wind.direction)
  const speed = options.speed ?? spec.polar.boatSpeed(twa, wind.speed)
  const leeway = leewayAngle(twa, speed, wind, spec)
  return {
    id: options.id,
    position: options.position,
    heading,
    speed,
    turnRate: 0,
    twa,
    course: normalizeBearing(heading + leeway),
    leeway,
  }
}
