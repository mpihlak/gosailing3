import { describe, it, expect } from 'vitest'
import { vec, type Vec2 } from '@/foundation/geom'
import { CRUISER_35_SPEC, spawnBoat } from '@/domain/boat'
import { areOverlapped, encounter, isClearAstern, isToLeewardOf, type Contender } from './right-of-way'

const SPEC = CRUISER_35_SPEC
const WIND = { direction: 0, speed: 12 } // out of the north

/** A boat on port tack heads north-east in a northerly; one on starboard, north-west. */
const PORT = 45
const STARBOARD = 315

function boat(id: string, position: Vec2, heading: number): Contender {
  return { boat: spawnBoat({ id, position, heading }, SPEC, WIND), spec: SPEC }
}

describe('rule 10, on opposite tacks', () => {
  it('makes the port tack boat keep clear', () => {
    const verdict = encounter(boat('p', vec(0, 0), PORT), boat('s', vec(30, 0), STARBOARD))
    expect(verdict).toEqual({ rule: 10, rightOfWay: 's', keepClear: 'p' })
  })

  it('does not care which way round they are given', () => {
    const verdict = encounter(boat('s', vec(30, 0), STARBOARD), boat('p', vec(0, 0), PORT))
    expect(verdict).toEqual({ rule: 10, rightOfWay: 's', keepClear: 'p' })
  })

  it('applies however far apart or overlapped they are', () => {
    const far = encounter(boat('p', vec(0, 0), PORT), boat('s', vec(0, 400), STARBOARD))
    expect(far.rule).toBe(10)
    expect(far.keepClear).toBe('p')
  })

  it('reads the tack from the wind, not from the compass', () => {
    // The same two headings in a southerly put them on the other tacks.
    const southerly = { direction: 180, speed: 12 }
    const a = { boat: spawnBoat({ id: 'a', position: vec(0, 0), heading: PORT }, SPEC, southerly), spec: SPEC }
    const b = { boat: spawnBoat({ id: 'b', position: vec(30, 0), heading: STARBOARD }, SPEC, southerly), spec: SPEC }
    expect(encounter(a, b)).toEqual({ rule: 10, rightOfWay: 'a', keepClear: 'b' })
  })
})

describe('clear astern and overlapped', () => {
  // Both on starboard, sailing north-west, one following the other down the same line.
  const track = (along: number): Vec2 => vec(-along * 0.707, along * 0.707)

  it('sees a boat a long way back as clear astern', () => {
    expect(isClearAstern(boat('back', track(0), STARBOARD), boat('front', track(40), STARBOARD))).toBe(true)
  })

  it('sees a boat alongside as overlapped', () => {
    expect(areOverlapped(boat('a', vec(0, 0), STARBOARD), boat('b', vec(8, 0), STARBOARD))).toBe(true)
  })

  it('has them overlap the moment the sterns come abeam', () => {
    // Hull to hull along the track: clear astern until her bow reaches the other's stern.
    const justClear = isClearAstern(boat('back', track(0), STARBOARD), boat('front', track(11), STARBOARD))
    const justOverlapped = areOverlapped(boat('back', track(0), STARBOARD), boat('front', track(10), STARBOARD))
    expect(justClear).toBe(true)
    expect(justOverlapped).toBe(true)
  })

  it('will not have both of them clear astern of each other', () => {
    const a = boat('a', vec(0, 0), STARBOARD)
    const b = boat('b', vec(4, 4), STARBOARD)
    expect(isClearAstern(a, b) && isClearAstern(b, a)).toBe(false)
  })
})

describe('rule 12, same tack and not overlapped', () => {
  const track = (along: number): Vec2 => vec(-along * 0.707, along * 0.707)

  it('makes the boat clear astern keep clear', () => {
    const verdict = encounter(boat('back', track(0), STARBOARD), boat('front', track(40), STARBOARD))
    expect(verdict).toEqual({ rule: 12, rightOfWay: 'front', keepClear: 'back' })
  })

  it('works on port tack the same way', () => {
    const up = (along: number): Vec2 => vec(along * 0.707, along * 0.707)
    const verdict = encounter(boat('back', up(0), PORT), boat('front', up(40), PORT))
    expect(verdict.keepClear).toBe('back')
  })
})

describe('rule 11, same tack and overlapped', () => {
  it('makes the windward boat keep clear on port tack', () => {
    // Heading north-east on port, the wind is on the port side, so leeward is to
    // starboard: the boat to the south-east is the leeward one.
    const verdict = encounter(boat('a', vec(0, 0), PORT), boat('b', vec(14, -14), PORT))
    expect(verdict).toEqual({ rule: 11, rightOfWay: 'b', keepClear: 'a' })
  })

  it('makes the windward boat keep clear on starboard tack', () => {
    // Heading north-west on starboard, leeward is to port: the boat to the south-west.
    const verdict = encounter(boat('a', vec(0, 0), STARBOARD), boat('b', vec(-14, -14), STARBOARD))
    expect(verdict).toEqual({ rule: 11, rightOfWay: 'b', keepClear: 'a' })
  })

  it('puts the same boat to leeward whichever way the pair is given', () => {
    const a = boat('a', vec(0, 0), PORT)
    const b = boat('b', vec(14, -14), PORT)
    expect(isToLeewardOf(b, a)).toBe(true)
    expect(isToLeewardOf(a, b)).toBe(false)
  })
})

describe('the three rules together', () => {
  it('asks the questions in the order the rulebook does', () => {
    // Opposite tacks settles it, overlapped or not, windward or not.
    const opposite = encounter(boat('p', vec(0, 0), PORT), boat('s', vec(6, 0), STARBOARD))
    expect(opposite.rule).toBe(10)

    // Same tack, so overlap decides which of 11 and 12 applies.
    const apart = encounter(boat('a', vec(0, 0), PORT), boat('b', vec(40, 40), PORT))
    expect(apart.rule).toBe(12)
    const together = encounter(boat('a', vec(0, 0), PORT), boat('b', vec(12, -12), PORT))
    expect(together.rule).toBe(11)
  })

  it('always names one of each, and never the same boat twice', () => {
    for (const headingA of [0, 45, 90, 135, 180, 225, 270, 315]) {
      for (const headingB of [30, 120, 210, 300]) {
        const verdict = encounter(boat('a', vec(0, 0), headingA), boat('b', vec(9, 5), headingB))
        expect(verdict.rightOfWay).not.toBe(verdict.keepClear)
        expect([verdict.rightOfWay, verdict.keepClear].sort()).toEqual(['a', 'b'])
      }
    }
  })
})
