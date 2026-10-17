import { describe, it, expect } from 'vitest'
import { angleDelta, vec } from '@/foundation/geom'
import { createSimulation } from './scenario'

/** Three sailors in the order they joined, the way the regatta asks for a race. */
function race(seed: string) {
  return createSimulation({
    name: 'berths',
    seed,
    boats: ['a', 'b', 'c'].map((id) => ({ id, name: id })),
    course: { legLength: 450, lineLength: 260, startCenter: vec(0, 0) },
    wind: { direction: 0, speed: 12 },
  })
}

describe('where the fleet waits for the gun', () => {
  const firstBoat = (seed: string) => race(seed).world.boats.find((boat) => boat.id === 'a')!

  it('puts the same sailor in different berths from race to race', () => {
    const berths = new Set(
      ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((seed) => Math.round(firstBoat(seed).position.x)),
    )
    expect(berths.size).toBeGreaterThan(1)
  })

  it('starts her on either tack', () => {
    // Heading east along the line is port tack in a northerly, west is starboard.
    const tacks = new Set(
      ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((seed) =>
        Math.sign(angleDelta(0, firstBoat(seed).heading)),
      ),
    )
    expect(tacks).toEqual(new Set([1, -1]))
  })

  it('puts her in the same berth for the same race', () => {
    expect(firstBoat('r1').position).toEqual(firstBoat('r1').position)
  })
})
