import { add, distance, bearingToVector, scale, type Vec2 } from '@/foundation/geom'
import { clamp, smoothstep, type Degrees, type Knots, type Meters, type Seconds } from '@/foundation/units'
import type { Rng } from '@/foundation/rng'
import type { WindModifier } from './types'

/**
 * A patch of stronger or lighter air drifting down the course. Each cell is described
 * entirely by its start conditions, so where it sits at a given time is arithmetic
 * rather than an accumulated simulation.
 */
export interface GustCell {
  readonly origin: Vec2
  readonly spawnTime: Seconds
  readonly lifetime: Seconds
  readonly radius: Meters
  /** Change in wind speed at the center of the cell. Negative makes a hole. */
  readonly strength: Knots
  /** Change in wind direction at the center, positive clockwise. */
  readonly bend: Degrees
  /** Direction the cell travels toward, and how fast, in meters per second. */
  readonly driftDirection: Degrees
  readonly driftSpeed: number
}

export interface GustOptions {
  readonly axis: Degrees
  readonly center: Vec2
  readonly spread: Meters
  readonly duration: Seconds
  readonly count: number
  readonly radius: { min: Meters; max: Meters }
  readonly strength: { min: Knots; max: Knots }
  readonly bend?: { min: Degrees; max: Degrees }
  readonly driftSpeed: number
}

export function generateGusts(rng: Rng, options: GustOptions): GustCell[] {
  const { axis, center, spread, duration, count, radius, strength, bend, driftSpeed } = options
  // Gusts arrive from upwind, so they start beyond the top of the course and drift down.
  const upwind = bearingToVector(axis)

  return Array.from({ length: count }, () => {
    const lifetime = rng.range(duration / 8, duration / 3)
    const across = rng.range(-spread, spread)
    const crossAxis = bearingToVector(axis + 90)
    const origin = add(
      add(center, scale(upwind, rng.range(spread * 0.5, spread * 1.5))),
      scale(crossAxis, across),
    )
    return {
      origin,
      spawnTime: rng.range(-lifetime / 2, duration),
      lifetime,
      radius: rng.range(radius.min, radius.max),
      strength: rng.range(strength.min, strength.max),
      bend: bend ? rng.range(bend.min, bend.max) : 0,
      // Travelling downwind is the reverse of the direction the wind comes from.
      driftDirection: axis + 180,
      driftSpeed,
    }
  })
}

export function gustCenterAt(cell: GustCell, time: Seconds): Vec2 {
  const travelled = (time - cell.spawnTime) * cell.driftSpeed
  return add(cell.origin, scale(bearingToVector(cell.driftDirection), travelled))
}

/** How strongly a cell applies at a point: 0 outside it, 1 at its center, faded at its edges. */
export function gustInfluence(cell: GustCell, position: Vec2, time: Seconds): number {
  const age = time - cell.spawnTime
  if (age < 0 || age > cell.lifetime) return 0

  const reach = distance(position, gustCenterAt(cell, time))
  if (reach >= cell.radius) return 0

  // Fade in and out over the first and last fifth of the cell's life.
  const ramp = cell.lifetime / 5
  const alive = Math.min(smoothstep(age / ramp), smoothstep((cell.lifetime - age) / ramp))
  const falloff = smoothstep(1 - reach / cell.radius)
  return clamp(alive * falloff, 0, 1)
}

export function gusts(cells: readonly GustCell[]): WindModifier {
  return (sample, position, time) => {
    let speed = sample.speed
    let direction = sample.direction
    for (const cell of cells) {
      const influence = gustInfluence(cell, position, time)
      if (influence === 0) continue
      speed += cell.strength * influence
      direction += cell.bend * influence
    }
    return { direction, speed }
  }
}
