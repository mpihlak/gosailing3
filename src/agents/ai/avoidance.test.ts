import { describe, it, expect } from 'vitest'
import { angleDelta, vec, type Vec2 } from '@/foundation/geom'
import { createSimulation, SimulationRunner } from '@/sim'
import { giveWay } from './avoidance'
import { Skipper } from './skipper'

const STEADY = {
  direction: 0,
  speed: 12,
  shiftAmplitude: 0,
  startBias: 0,
  gustiness: 0,
  gradientStrength: 0,
}

/** Boats where they are put, racing up the first beat in a steady northerly. */
function racing(boats: { id: string; position: Vec2; heading: number }[]) {
  const sim = createSimulation({
    name: 'meeting',
    seed: 'meeting',
    boats: boats.map((boat) => ({ ...boat, name: boat.id, controller: 'ai' as const })),
    course: { legLength: 450, lineLength: 260, startCenter: vec(0, 0) },
    wind: STEADY,
    config: { startSequence: 0 },
    duration: 2400,
  })
  const progress = Object.fromEntries(
    Object.entries(sim.world.race.progress).map(([id, entry]) => [
      id,
      { ...entry, status: 'racing' as const, stageIndex: 1, clearedPreStart: true },
    ]),
  )
  return {
    ...sim,
    world: { ...sim.world, race: { ...sim.world.race, phase: 'racing' as const, progress } },
  }
}

function decide(sim: ReturnType<typeof racing>, id: string) {
  const boat = sim.world.boats.find((one) => one.id === id)!
  return giveWay(sim.ctx, sim.world, boat, sim.ctx.specs[id]!, STEADY.direction, boat.heading)
}

describe('keeping clear', () => {
  // Port heads north-east and starboard north-west, and they meet halfway between.
  const crossing = () =>
    racing([
      { id: 'port', position: vec(-18, 200), heading: 45 },
      { id: 'starboard', position: vec(18, 200), heading: 315 },
    ])

  it('has the port tack boat bear away to pass astern', () => {
    const away = decide(crossing(), 'port')
    expect(away?.rule).toBe(10)
    // Further off the wind than the close-hauled course she was on.
    expect(Math.abs(angleDelta(STEADY.direction, away!.bearing))).toBeGreaterThan(45)
  })

  it('leaves the starboard tack boat to hold her course', () => {
    expect(decide(crossing(), 'starboard')).toBeUndefined()
  })

  it('has the windward boat luff away from the leeward one', () => {
    // Both on port, the windward one bearing down on the other.
    const sim = racing([
      { id: 'leeward', position: vec(0, 200), heading: 45 },
      { id: 'windward', position: vec(-14, 206), heading: 75 },
    ])
    const away = decide(sim, 'windward')
    expect(away?.rule).toBe(11)
    expect(away!.bearing).toBeLessThan(75)
  })

  it('does nothing about a boat that is not coming near', () => {
    const sim = racing([
      { id: 'one', position: vec(-200, 200), heading: 45 },
      { id: 'two', position: vec(200, 200), heading: 45 },
    ])
    expect(decide(sim, 'one')).toBeUndefined()
  })

  it('sails two AI boats through a port and starboard crossing without touching', () => {
    const sim = crossing()
    const runner = new SimulationRunner(sim.ctx, sim.world)
    const helms = { port: new Skipper(), starboard: new Skipper() }
    let contacts = 0
    for (let tick = 0; tick < 60 * 30; tick++) {
      contacts += runner
        .advance(1 / 60, helms, 10)
        .filter((event) => event.kind === 'contact').length
    }
    expect(contacts).toBe(0)
  })
})
