import { describe, it, expect } from 'vitest'
import { distance, vec, type Vec2 } from '@/foundation/geom'
import { createSimulation } from './scenario'
import { runHeadless } from './runner'
import { shadowersIn, windAt } from './wind'
import type { BoatSetup } from './scenario'

const STEADY = {
  direction: 0,
  speed: 12,
  shiftAmplitude: 0,
  startBias: 0,
  gustiness: 0,
  gradientStrength: 0,
} as const

function race(boats: BoatSetup[]) {
  return createSimulation({
    name: 'shadow',
    seed: 'shade',
    boats,
    course: { legLength: 900, lineLength: 400, startCenter: vec(0, 0) },
    wind: { ...STEADY },
    config: { startSequence: 0 },
  })
}

/** Close-hauled on port in a northerly, sailing away from the start. */
const CLOSE_HAULED = 40

function sailedIn(boats: BoatSetup[], seconds: number, watching = 'a'): number {
  const sim = race(boats)
  const start = sim.world.boats.find((boat) => boat.id === watching)!.position
  const { world } = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 60 * seconds })
  const end = world.boats.find((boat) => boat.id === watching)!.position
  return distance(start, end)
}

const alone: BoatSetup = { id: 'a', name: 'Alpha', position: vec(0, -300), heading: CLOSE_HAULED }
/** Thirty meters straight upwind of her, on the same tack. */
const upwindOfHer: BoatSetup = {
  id: 'b',
  name: 'Bravo',
  position: vec(0, -270),
  heading: CLOSE_HAULED,
}

describe('sailing in another boat\'s shadow', () => {
  it('makes less ground than sailing in clear air', () => {
    const clear = sailedIn([alone], 60)
    const shaded = sailedIn([alone, upwindOfHer], 60)
    expect(shaded).toBeLessThan(clear)
  })

  it('costs her enough to be worth avoiding', () => {
    const clear = sailedIn([alone], 60)
    const shaded = sailedIn([alone, upwindOfHer], 60)
    expect(shaded / clear).toBeLessThan(0.95)
  })

  it('leaves the boat doing the shading alone', () => {
    const shadedRace = sailedIn([alone, upwindOfHer], 60, 'b')
    const onHerOwn = sailedIn([{ ...upwindOfHer, id: 'b' }], 60, 'b')
    expect(shadedRace).toBeCloseTo(onHerOwn, 0)
  })
})

describe('windAt', () => {
  const sim = race([alone, upwindOfHer])
  const behind = (at: Vec2) => windAt(sim.ctx, sim.world, at)

  it('takes the wind out of the water behind a boat', () => {
    const inTheLee = behind(vec(0, -300))
    const clear = behind(vec(400, -300))
    expect(inTheLee.speed).toBeLessThan(clear.speed)
  })

  it('leaves a boat out of her own shadow when she asks', () => {
    const asHerself = windAt(sim.ctx, sim.world, vec(0, -270), 'b')
    const asAnyone = windAt(sim.ctx, sim.world, vec(0, -270))
    expect(asHerself.speed).toBeGreaterThan(asAnyone.speed)
  })

  it('counts every boat but the one asking', () => {
    expect(shadowersIn(sim.ctx, sim.world)).toHaveLength(2)
    expect(shadowersIn(sim.ctx, sim.world, 'a')).toHaveLength(1)
  })
})
