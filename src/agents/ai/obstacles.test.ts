import { describe, it, expect } from 'vitest'
import { vec } from '@/foundation/geom'
import { createSimulation, type WorldState } from '@/sim'
import { giveWay } from './avoidance'
import { clearOfObstacles, obstacleShare } from './obstacles'

const STEADY = {
  direction: 0,
  speed: 12,
  shiftAmplitude: 0,
  startBias: 0,
  gustiness: 0,
  gradientStrength: 0,
}

/** Boats where they are put before the gun, the committee boat at (130, 0). */
function prestart(boats: { id: string; position: { x: number; y: number }; heading: number }[]) {
  const sim = createSimulation({
    name: 'committee',
    seed: 'committee',
    boats: boats.map((boat) => ({ ...boat, name: boat.id, controller: 'ai' as const })),
    course: { legLength: 450, lineLength: 260, startCenter: vec(0, 0) },
    wind: STEADY,
    config: { startSequence: 120 },
    duration: 2400,
  })
  const world: WorldState = {
    ...sim.world,
    time: 100,
    boats: sim.world.boats.map((boat) => ({ ...boat, speed: 5 })),
  }
  return { ...sim, world }
}

describe('keeping clear of the committee boat', () => {
  it('turns her off a course into it, away from it', () => {
    // Below the committee boat and to the left of it, close-hauled on starboard at it.
    const sim = prestart([{ id: 'robot', position: vec(140, -18), heading: 330 }])
    const boat = sim.world.boats[0]!
    const spec = sim.ctx.specs.robot!
    expect(obstacleShare(sim.ctx, boat, spec, STEADY, 330)).toBeLessThan(1)
    const steered = clearOfObstacles(sim.ctx, boat, spec, STEADY, 330)
    expect(obstacleShare(sim.ctx, boat, spec, STEADY, steered)).toBeGreaterThanOrEqual(1)
  })

  it('does not luff into it to keep clear of a boat to leeward', () => {
    // On starboard just below the committee boat, a boat to leeward converging on her.
    // A luff is the way clear of that boat, and straight into the committee boat. With
    // no way clear of both, she takes the course that leaves the most room from either.
    const sim = prestart([
      { id: 'leeward', position: vec(125, -22), heading: 345 },
      { id: 'robot', position: vec(131, -18), heading: 330 },
    ])
    const boat = sim.world.boats.find((one) => one.id === 'robot')!
    const spec = sim.ctx.specs.robot!
    const away = giveWay(sim.ctx, sim.world, boat, spec, STEADY, 330)
    expect(away?.rule).toBe(11)
    // The luff she took without thinking of the committee boat left her no room at all.
    expect(obstacleShare(sim.ctx, boat, spec, STEADY, away!.bearing)).toBeGreaterThan(0)
  })
})
