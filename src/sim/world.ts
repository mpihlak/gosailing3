import type { BoatId, BoatInput, BoatSpec, BoatState } from '@/domain/boat'
import type { Course } from '@/domain/course'
import type { WindField } from '@/domain/wind'
import type { Seconds } from '@/foundation/units'
import type { RaceState } from './race'

export interface SimConfig {
  /** Length of one simulation step. Fixed, so results never depend on frame rate. */
  readonly dt: Seconds
  /** How long the countdown runs before the starting gun. */
  readonly startSequence: Seconds
  /** Speed a boat loses when hulls meet, as a fraction. */
  readonly contactSpeedLoss: number
  /**
   * Speed lost brushing a mark. A mark is an inflatable buoy on a rope: a boat pushes it
   * aside rather than bouncing off it, so touching one costs a nudge and a penalty under
   * the rules, not a collision.
   */
  readonly markContactSpeedLoss: number
}

export const DEFAULT_CONFIG: SimConfig = {
  dt: 1 / 60,
  startSequence: 60,
  contactSpeedLoss: 0.35,
  markContactSpeedLoss: 0.08,
}

/**
 * The fixed part of a race: the things that do not change from tick to tick. Held apart
 * from the state so the state stays serializable, and so a client and a server can each
 * rebuild the context from the same scenario rather than sending functions over a wire.
 */
export interface SimContext {
  readonly course: Course
  readonly wind: WindField
  readonly specs: Readonly<Record<BoatId, BoatSpec>>
  readonly config: SimConfig
}

/** Everything that changes. Plain data, structured-clone friendly, safe to snapshot. */
export interface WorldState {
  readonly tick: number
  readonly time: Seconds
  readonly boats: readonly BoatState[]
  readonly race: RaceState
  /** Overlaps still in progress, so one long scrape reports as one contact. */
  readonly contacts: readonly string[]
  /** When each pair of boats was last judged, so one incident costs one turn. */
  readonly incidents: Readonly<Record<string, Seconds>>
}

export type InputFrame = Readonly<Record<BoatId, BoatInput>>

export function boatById(world: WorldState, id: BoatId): BoatState | undefined {
  return world.boats.find((boat) => boat.id === id)
}

export function specFor(ctx: SimContext, id: BoatId): BoatSpec {
  const spec = ctx.specs[id]
  if (!spec) throw new Error(`no boat spec registered for "${id}"`)
  return spec
}

/** Seconds until the gun. Negative once the race has started. */
export function timeToStart(ctx: SimContext, world: WorldState): Seconds {
  return ctx.config.startSequence - world.time
}

/** Elapsed race time. Negative during the countdown. */
export function raceTime(ctx: SimContext, world: WorldState): Seconds {
  return world.time - ctx.config.startSequence
}
