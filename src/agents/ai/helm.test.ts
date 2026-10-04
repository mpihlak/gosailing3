import { describe, it, expect } from 'vitest'
import { angleDelta, vec } from '@/foundation/geom'
import { CRUISER_35_SPEC } from '@/domain/boat'
import { createSimulation, runHeadless, type InputSource } from '@/sim'
import { rudderToHold } from './helm'

/** Hold a bearing the way the skipper does, with or without allowing for her turn. */
const holding = (bearing: number, lead: number): InputSource => ({
  inputFor: (id, world) => {
    const boat = world.boats.find((one) => one.id === id)!
    return { rudder: rudderToHold(boat.heading, bearing, 12, boat.turnRate, lead) }
  },
})

/** How far past the bearing she swings when sent from a reach onto a run. */
function overshoot(lead: number): number {
  const sim = createSimulation({
    name: 'helm',
    seed: 'helm',
    boats: [{ id: 'a', name: 'A', position: vec(0, 300), heading: 100 }],
    wind: {
      direction: 0,
      speed: 12,
      shiftAmplitude: 0,
      startBias: 0,
      gustiness: 0,
      gradientStrength: 0,
    },
    config: { startSequence: 0 },
  })
  const bearing = 150
  let furthest = 0
  runHeadless(
    sim.ctx,
    sim.world,
    { a: holding(bearing, lead) },
    {
      maxTicks: 60 * 15,
      until: (world) => {
        furthest = Math.max(furthest, angleDelta(bearing, world.boats[0]!.heading))
        return false
      },
    },
  )
  return furthest
}

describe('holding a bearing', () => {
  it('turns hard while there is a long way to go', () => {
    expect(rudderToHold(0, 90)).toBe(1)
    expect(rudderToHold(0, -90)).toBe(-1)
  })

  it('eases the helm for a turn she is already making', () => {
    expect(rudderToHold(0, 10, 12, 20, 0.7)).toBeLessThan(rudderToHold(0, 10, 12))
  })

  it('swings past a new course when it does not allow for her turn', () => {
    expect(overshoot(0)).toBeGreaterThan(3)
  })

  it('comes onto a new course without swinging past it when it does', () => {
    expect(overshoot(CRUISER_35_SPEC.turnResponse)).toBeLessThan(1)
  })
})
