import type { Vec2 } from '@/foundation/geom'
import type { BoatId } from '@/domain/boat'
import { shade, type Shadower, type WindSample } from '@/domain/wind'
import { specFor, type SimContext, type WorldState } from './world'

/**
 * The fleet, as things that cast shadows. One boat does not shade herself, so whoever is
 * asking is left out.
 */
export function shadowersIn(
  ctx: SimContext,
  world: WorldState,
  except?: BoatId,
): Shadower[] {
  return world.boats
    .filter((boat) => boat.id !== except)
    .map((boat) => ({
      id: boat.id,
      position: boat.position,
      twa: boat.twa,
      length: specFor(ctx, boat.id).length,
    }))
}

/**
 * The wind somewhere on the course: what the water is doing, with the fleet's shadows
 * laid over it. Everything that asks what the wind is — the physics, the instruments,
 * the arrows on the water — asks here, so they all see the same wind.
 */
export function windAt(
  ctx: SimContext,
  world: WorldState,
  at: Vec2,
  except?: BoatId,
): WindSample {
  return shade(ctx.wind.sample(at, world.time), at, shadowersIn(ctx, world, except))
}
