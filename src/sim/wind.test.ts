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

/**
 * The same thing on the other leg, where it is the boat ahead who suffers. Running, the
 * wind comes from astern, so a boat sails in the dirty air of whoever is behind her.
 */
const onARun: BoatSetup = { id: 'a', name: 'Alpha', position: vec(0, -300), heading: 180 }
/** Twenty meters straight upwind of her, which on a run is twenty meters behind. */
const blanketingHer: BoatSetup = {
  id: 'b',
  name: 'Bravo',
  position: vec(0, -280),
  heading: 180,
}

describe('running in another boat\'s shadow', () => {
  const clear = sailedIn([onARun], 60)

  it('takes ground off the boat ahead', () => {
    expect(sailedIn([onARun, blanketingHer], 60)).toBeLessThan(clear)
  })

  it('costs her enough to be worth avoiding', () => {
    // A tenth of a minute's running, which is several lengths by the leeward mark.
    expect(sailedIn([onARun, blanketingHer], 60) / clear).toBeLessThan(0.95)
  })

  it('reaches about thirty meters and no further', () => {
    const at30 = { ...blanketingHer, position: vec(0, -270) }
    const at40 = { ...blanketingHer, position: vec(0, -260) }
    expect(sailedIn([onARun, at30], 60) / clear).toBeLessThan(0.99)
    expect(sailedIn([onARun, at40], 60) / clear).toBeGreaterThan(0.99)
  })

  /*
   * This is why it can be sailed through without noticing. The cone is about as wide as
   * the boat casting it, so a length of separation across the course puts her in clear
   * air while she still looks stacked up on the screen.
   */
  it('is narrow enough that a few meters across the course escapes it', () => {
    const offset = (across: number) =>
      sailedIn([onARun, { ...blanketingHer, position: vec(across, -280) }], 60) / clear
    expect(offset(0)).toBeLessThan(0.95)
    expect(offset(5)).toBeGreaterThan(offset(0))
    expect(offset(10)).toBeGreaterThan(0.99)
  })

  it('costs the boat behind something too, once she runs up on the one she is blanketing', () => {
    // Her own shadow reaches a little upwind of her, and the gap closes as the boat
    // ahead slows, so the pair end up in each other's dirt.
    const together = sailedIn([onARun, blanketingHer], 60, 'b')
    expect(together).toBeLessThan(sailedIn([blanketingHer], 60, 'b'))
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
