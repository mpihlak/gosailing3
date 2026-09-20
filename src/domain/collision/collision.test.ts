import { describe, it, expect } from 'vitest'
import { vec } from '@/foundation/geom'
import { CRUISER_35_SPEC, hullCentreline, hullRadius, spawnBoat } from '@/domain/boat'
import { detectContacts, isTouching, separationFor, type Disc, type Hull } from './index'

const SPEC = CRUISER_35_SPEC
const WIND = { direction: 0, speed: 12 }
const HALF_BEAM = SPEC.beam / 2 // 1.7 m
const MARK: Disc = { id: 'windward', position: vec(0, 0), radius: 1.5 }
/** Centre to centre at which the hull and the mark just touch, abeam. */
const TOUCHING_ABEAM = HALF_BEAM + MARK.radius // 3.2 m

/** A boat at a position and heading, as the simulation would hand it to the detector. */
function hull(id: string, x: number, y: number, heading = 0): Hull {
  const boat = spawnBoat({ id, position: vec(x, y), heading }, SPEC, WIND)
  return { id, centreline: hullCentreline(boat, SPEC), radius: hullRadius(SPEC) }
}

function touches(x: number, y: number, heading = 0): boolean {
  return detectContacts({ boats: [hull('a', x, y, heading)], marks: [MARK] }).length > 0
}

describe('the shape of a hull', () => {
  it('is half a beam wide, not half a length', () => {
    expect(hullRadius(SPEC)).toBeCloseTo(1.7)
  })

  it('covers the whole length of the boat once the radius is added', () => {
    const line = hullCentreline(spawnBoat({ id: 'a', position: vec(0, 0), heading: 0 }, SPEC, WIND), SPEC)
    const spine = Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y)
    expect(spine + SPEC.beam).toBeCloseTo(SPEC.length)
  })

  it('lies along the heading', () => {
    const north = hullCentreline(spawnBoat({ id: 'a', position: vec(0, 0), heading: 0 }, SPEC, WIND), SPEC)
    expect(north.to.y).toBeGreaterThan(north.from.y)
    expect(north.to.x).toBeCloseTo(0)

    const east = hullCentreline(spawnBoat({ id: 'a', position: vec(0, 0), heading: 90 }, SPEC, WIND), SPEC)
    expect(east.to.x).toBeGreaterThan(east.from.x)
    expect(east.to.y).toBeCloseTo(0)
  })
})

describe('passing a mark abeam', () => {
  it('does not touch it with a couple of meters to spare', () => {
    expect(touches(TOUCHING_ABEAM + 2, 0)).toBe(false)
  })

  it('does not touch it at five meters, which the old circle called a collision', () => {
    expect(touches(5, 0)).toBe(false)
  })

  it('touches it when the hull reaches the buoy', () => {
    expect(touches(TOUCHING_ABEAM - 0.2, 0)).toBe(true)
  })

  it('finds the boundary where the hull meets the buoy, and not elsewhere', () => {
    expect(touches(TOUCHING_ABEAM + 0.05, 0)).toBe(false)
    expect(touches(TOUCHING_ABEAM - 0.05, 0)).toBe(true)
  })

  it('touches on either side alike', () => {
    expect(touches(-(TOUCHING_ABEAM - 0.2), 0)).toBe(true)
    expect(touches(-(TOUCHING_ABEAM + 2), 0)).toBe(false)
  })
})

describe('passing a mark ahead and astern', () => {
  it('reaches further along the hull than across it', () => {
    // Straight ahead, the bow gets there from much further off than the topsides do.
    expect(touches(0, SPEC.length / 2 - 0.2)).toBe(true)
    expect(touches(0, SPEC.length / 2 + 2)).toBe(false)
  })

  it('touches with the stern as well as the bow', () => {
    expect(touches(0, -(SPEC.length / 2 - 0.2))).toBe(true)
  })

  it('turns with the boat, so the same water touches or does not by heading alone', () => {
    // Four meters abeam is clear; four meters off the bow of a boat pointing at it is not.
    expect(touches(4, 0, 0)).toBe(false)
    expect(touches(4, 0, 270)).toBe(true)
  })
})

describe('boats touching each other', () => {
  it('leaves them clear when they are a length apart abreast', () => {
    expect(detectContacts({ boats: [hull('a', 0, 0), hull('b', 11, 0)] })).toEqual([])
  })

  it('reports an overlap when they are alongside and touching', () => {
    const [contact] = detectContacts({ boats: [hull('a', 0, 0), hull('b', 3, 0)] })
    expect(contact?.boatId).toBe('a')
    expect(contact?.otherId).toBe('b')
    expect(contact?.overlap).toBeCloseTo(SPEC.beam - 3)
    expect(contact?.normal).toMatchObject({ x: -1, y: 0 })
  })

  it('reports a boat running into the back of another', () => {
    expect(detectContacts({ boats: [hull('a', 0, 0), hull('b', 0, 10)] })).toHaveLength(1)
    expect(detectContacts({ boats: [hull('a', 0, 0), hull('b', 0, 12)] })).toEqual([])
  })

  it('sees a crossing where the hulls meet at an angle', () => {
    // One heading north, one heading east, crossing close enough to touch.
    expect(detectContacts({ boats: [hull('a', 0, 0, 0), hull('b', 3, 3, 90)] })).toHaveLength(1)
  })

  it('reports each touching pair once, and only the pairs that touch', () => {
    // Three abreast within a beam of each other: every pair overlaps.
    expect(
      detectContacts({ boats: [hull('a', 0, 0), hull('b', 1.5, 0), hull('c', 3, 0)] }),
    ).toHaveLength(3)

    // Spread them out and only the neighbours touch, not the outside pair.
    expect(
      detectContacts({ boats: [hull('a', 0, 0), hull('b', 3, 0), hull('c', 6, 0)] }),
    ).toHaveLength(2)
  })

  it('survives two boats on exactly the same spot', () => {
    const [contact] = detectContacts({ boats: [hull('a', 0, 0), hull('b', 0, 0)] })
    expect(contact?.overlap).toBeCloseTo(SPEC.beam)
    expect(Number.isFinite(contact!.normal.x)).toBe(true)
  })
})

describe('marks and obstacles', () => {
  it('tells them apart', () => {
    const contacts = detectContacts({
      boats: [hull('a', 0, 0)],
      marks: [{ id: 'windward', position: vec(2, 0), radius: 1.5 }],
      obstacles: [{ id: 'rock', position: vec(-3, 0), radius: 3 }],
    })
    expect(contacts.map((contact) => contact.kind)).toEqual(['mark', 'obstacle'])
  })

  it('points the normal from the mark back toward the boat', () => {
    const [contact] = detectContacts({ boats: [hull('a', 2, 0)], marks: [MARK] })
    expect(contact?.normal).toMatchObject({ x: 1, y: 0 })
  })
})

describe('separationFor', () => {
  it('splits the correction between two boats', () => {
    const [contact] = detectContacts({ boats: [hull('a', 0, 0), hull('b', 3, 0)] })
    expect(separationFor(contact!, true).x).toBeCloseTo(-(SPEC.beam - 3) / 2)
  })

  it('makes the boat give way entirely to something fixed', () => {
    const [contact] = detectContacts({ boats: [hull('a', 2, 0)], marks: [MARK] })
    expect(separationFor(contact!, false).x).toBeCloseTo(TOUCHING_ABEAM - 2)
  })
})

describe('near misses', () => {
  it('reports nothing near without a margin', () => {
    expect(detectContacts({ boats: [hull('a', 0, 0), hull('b', 8, 0)] })).toEqual([])
  })

  it('reports a pair within the margin, and says they are not touching', () => {
    const [close] = detectContacts({ boats: [hull('a', 0, 0), hull('b', 8, 0)], margin: 12 })
    expect(close).toBeDefined()
    expect(close!.separation).toBeCloseTo(8 - SPEC.beam)
    expect(isTouching(close!)).toBe(false)
  })

  it('still says a pair into each other is touching', () => {
    const [overlapping] = detectContacts({ boats: [hull('a', 0, 0), hull('b', 2, 0)], margin: 12 })
    expect(overlapping!.separation).toBeLessThan(0)
    expect(isTouching(overlapping!)).toBe(true)
  })

  it('leaves a pair beyond the margin out altogether', () => {
    expect(detectContacts({ boats: [hull('a', 0, 0), hull('b', 40, 0)], margin: 12 })).toEqual([])
  })
})
