import type { BoatId, BoatInput } from '@/domain/boat'
import { specFor, type InputSource, type SimContext, type WorldState } from '@/sim'
import { rudderToHold } from './helm'
import { planCourse, type NavigationPlan } from './navigator'

/**
 * An AI boat. It produces the same input a player does, so from the simulation's point
 * of view there is no difference between the two, and nothing in the physics or the race
 * rules needs to know which is which.
 */
export class Skipper implements InputSource {
  /** The most recent decision, for the lab and the debug overlay to show. */
  lastPlan?: NavigationPlan

  constructor(private readonly degreesForFullRudder = 12) {}

  inputFor(boatId: BoatId, world: WorldState, ctx: SimContext): BoatInput {
    const boat = world.boats.find((candidate) => candidate.id === boatId)
    if (!boat) return { rudder: 0 }

    const spec = specFor(ctx, boatId)
    const wind = ctx.wind.sample(boat.position, world.time)
    const plan = planCourse(ctx, world, boat, spec, wind)
    this.lastPlan = plan

    return { rudder: rudderToHold(boat.heading, plan.bearing, this.degreesForFullRudder) }
  }
}
