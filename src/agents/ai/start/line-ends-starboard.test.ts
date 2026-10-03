import { describe, it, expect } from 'vitest'
import { vec } from '@/foundation/geom'
import { CRUISER_35_SPEC, spawnBoat, tackOf } from '@/domain/boat'
import { createLine } from '@/domain/course'
import { boatEndStarboardStart, pinEndPortStart } from './line-ends'
import type { StartContext } from './types'

const SPEC = CRUISER_35_SPEC
const WIND = { direction: 0, speed: 12 }
/** Symmetric about the wind: the pin to the west, the committee boat to the east. */
const LINE = createLine('start', 'Start', vec(-130, 0), vec(130, 0), vec(0, 450))

function at(x: number, y: number, heading: number, timeToStart: number): StartContext {
  return {
    boat: spawnBoat({ id: 'a', position: vec(x, y), heading }, SPEC, WIND),
    spec: SPEC,
    wind: WIND,
    line: LINE,
    timeToStart,
    gunFired: timeToStart <= 0,
  }
}

/** The same angle, however it is written down. */
const sameBearing = (one: number, two: number) => Math.abs(((one - two + 540) % 360) - 180) < 1e-6

describe('starting at the committee boat on starboard', () => {
  const starboard = boatEndStarboardStart()
  const port = pinEndPortStart()

  /*
   * The two ends of a line are mirror images about the wind, so the same boat reflected
   * east for west should be given the reflected course. This is the whole claim of the
   * strategy in one assertion, and it covers the geometry far better than picking
   * bearings by hand would.
   */
  it('is the pin end start reflected, to the metre and the degree', () => {
    for (const x of [-200, -120, -40, 0, 40, 120, 200]) {
      for (const y of [-40, -120, -260]) {
        for (const t of [120, 60, 30, 12, 4, 0, -5]) {
          const them = port.plan(at(x, y, 40, t))
          const her = starboard.plan(at(-x, y, -40, t))
          expect(her.phase).toBe(them.phase)
          expect(sameBearing(her.bearing, -them.bearing)).toBe(true)
        }
      }
    }
  })

  it('says which start it is', () => {
    expect(starboard.name).toContain('starboard')
    expect(port.name).toContain('port')
  })

  /** The point of her: she arrives with right of way over the boats coming the other way. */
  it('crosses the line on starboard', () => {
    const onTheWind = starboard.plan(at(60, -60, -40, 0))
    const boat = spawnBoat(
      { id: 'a', position: vec(60, -60), heading: onTheWind.bearing },
      SPEC,
      WIND,
    )
    expect(tackOf(boat.twa)).toBe('starboard')
  })

  it('aims at the committee boat end, not the pin', () => {
    // Well before the gun she reaches away; the course she picks is to the east side.
    const away = starboard.plan(at(0, -120, -40, 110))
    expect(away.phase).toBe('reaching')
    expect(Math.sin((away.bearing * Math.PI) / 180)).toBeGreaterThan(0)
  })
})
