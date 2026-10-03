import { describe, it, expect } from 'vitest'
import { vec, type Vec2 } from '@/foundation/geom'
import { CRUISER_35_SPEC, spawnBoat, type BoatState } from '@/domain/boat'
import type { WorldState } from '@/sim'
import { clearToTack, wouldTack } from './tacking'

const WIND = { direction: 0, speed: 12 }
const boat = (id: string, position: Vec2, heading: number) =>
  spawnBoat({ id, position, heading }, CRUISER_35_SPEC, WIND)
const world = (boats: BoatState[]) => ({ boats }) as unknown as WorldState

describe('deciding whether to tack', () => {
  it('knows a tack from a bear away', () => {
    const port = boat('a', vec(0, 0), 45)
    expect(wouldTack(port, 315, WIND.direction)).toBe(true)
    expect(wouldTack(port, 90, WIND.direction)).toBe(false)
    // The other way round, through dead downwind, is a gybe.
    expect(wouldTack(port, 225, WIND.direction)).toBe(false)
  })

  it('tacks with nobody about', () => {
    const me = boat('me', vec(0, 0), 45)
    expect(clearToTack(world([me]), me, CRUISER_35_SPEC, 315)).toBe(true)
  })

  it('will not tack across the bow of a boat close to windward', () => {
    const me = boat('me', vec(0, 0), 45)
    const windward = boat('them', vec(-6, 6), 45)
    expect(clearToTack(world([me, windward]), me, CRUISER_35_SPEC, 315)).toBe(false)
  })

  it('tacks when the boat about is well clear', () => {
    const me = boat('me', vec(0, 0), 45)
    const far = boat('them', vec(-200, 200), 45)
    expect(clearToTack(world([me, far]), me, CRUISER_35_SPEC, 315)).toBe(true)
  })
})

describe('two boats side by side', () => {
  it('lets the windward one tack away, and not the leeward one tack into her', () => {
    const leeward = boat('leeward', vec(0, 0), 45)
    const windward = boat('windward', vec(-6, 6), 45)
    const both = world([leeward, windward])
    expect(clearToTack(both, windward, CRUISER_35_SPEC, 315)).toBe(true)
    expect(clearToTack(both, leeward, CRUISER_35_SPEC, 315)).toBe(false)
  })
})
