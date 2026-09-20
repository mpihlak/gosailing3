import { describe, it, expect } from 'vitest'
import { add, bearingToVector, scale, vec, type Vec2 } from '@/foundation/geom'
import { shade, shadowReach, shadowStrength, type Shadower } from './shadow'

const NORTHERLY = { direction: 0, speed: 12 }
const LENGTH = 10.7

/** A boat at the origin. Positive true wind angle puts her on port tack. */
function shadower(twa: number, position: Vec2 = vec(0, 0)): Shadower {
  return { id: 's', position, twa, length: LENGTH }
}

/** A point a given distance downwind of the origin, in a northerly. */
const downwind = (metres: number): Vec2 => vec(0, -metres)
const upwind = (metres: number): Vec2 => vec(0, metres)
const abeam = (metres: number): Vec2 => vec(metres, 0)

describe('the shape of a shadow', () => {
  const her = shadower(45)
  const reach = shadowReach(her)

  it('reaches much further downwind than up', () => {
    expect(reach.aft).toBeGreaterThan(reach.forward * 3)
    expect(reach.aft).toBeCloseTo(LENGTH * 7)
    expect(reach.forward).toBeCloseTo(LENGTH * 1.5)
  })

  it('lies hardest on the boat herself', () => {
    expect(shadowStrength(her, vec(0, 0), 0)).toBeCloseTo(1)
  })

  it('thins out downwind and stops at the end of it', () => {
    const near = shadowStrength(her, downwind(20), 0)
    const far = shadowStrength(her, downwind(60), 0)
    expect(near).toBeGreaterThan(far)
    expect(far).toBeGreaterThan(0)
    expect(shadowStrength(her, downwind(reach.aft + 1), 0)).toBe(0)
  })

  it('reaches a little way upwind, and not far', () => {
    expect(shadowStrength(her, upwind(10), 0)).toBeGreaterThan(0)
    expect(shadowStrength(her, upwind(reach.forward + 1), 0)).toBe(0)
    expect(shadowStrength(her, upwind(20), 0)).toBeLessThan(shadowStrength(her, downwind(20), 0))
  })

  it('stops at the sides', () => {
    expect(shadowStrength(her, abeam(reach.nearWidth + 1), 0)).toBe(0)
    expect(shadowStrength(her, abeam(4), 0)).toBeGreaterThan(0)
  })

  it('is narrow where it leaves her and spreads downwind', () => {
    expect(reach.farWidth).toBeGreaterThan(reach.nearWidth * 2)

    // The widest water it covers is well behind her, not alongside.
    const widthAt = (downwindMetres: number): number => {
      let widest = 0
      for (let across = 0; across < reach.farWidth + 5; across += 0.5) {
        if (shadowStrength(her, vec(across, -downwindMetres), 0) > 0) widest = across
      }
      return widest
    }
    expect(widthAt(45)).toBeGreaterThan(widthAt(0))
    expect(widthAt(45)).toBeGreaterThan(widthAt(reach.aft - 5))
  })

  it('is an egg and not an hourglass', () => {
    // No pinch at the boat: walking from the nose to the tail it swells once and closes.
    const widthAt = (downwindMetres: number): number => {
      let widest = 0
      for (let across = 0; across < reach.farWidth + 5; across += 0.5) {
        if (shadowStrength(her, vec(across, -downwindMetres), 0) > 0) widest = across
      }
      return widest
    }

    const walk = []
    for (let along = -reach.forward + 1; along < reach.aft - 1; along += 2) {
      walk.push(widthAt(along))
    }

    // Once it starts closing it never swells again, which is what a waist would be.
    let closing = false
    for (let i = 1; i < walk.length; i++) {
      if ((walk[i] as number) < (walk[i - 1] as number)) closing = true
      else if (closing) expect.fail(`widened again at ${i} after it had begun to close`)
    }

    // And nothing ahead of her is wider than she is.
    expect(widthAt(-8)).toBeLessThanOrEqual(widthAt(0))
  })

  it('follows the wind round', () => {
    // In an easterly the shadow lies to the west of her, not to the south.
    const west = vec(-40, 0)
    expect(shadowStrength(her, west, 90)).toBeGreaterThan(0)
    expect(shadowStrength(her, downwind(40), 90)).toBe(0)
  })

  it('moves with the boat', () => {
    const moved = shadower(45, vec(200, 200))
    expect(shadowStrength(moved, add(vec(200, 200), downwind(30)), 0)).toBeGreaterThan(0)
    expect(shadowStrength(moved, downwind(30), 0)).toBe(0)
  })
})

describe('what a shadow does to the wind', () => {
  const onPort = shadower(45)
  const onStarboard = shadower(-45)
  const behind = downwind(30)

  it('takes wind out of it', () => {
    expect(shade(NORTHERLY, behind, [onPort]).speed).toBeLessThan(NORTHERLY.speed)
  })

  it('leaves clear water alone', () => {
    expect(shade(NORTHERLY, downwind(500), [onPort])).toEqual(NORTHERLY)
  })

  it('heads a boat on her tack and lifts one on the other, by the same turn', () => {
    // The air is turned one way, and which way it reads depends on who is in it. On port
    // a header is the wind veering; on starboard a header is the wind backing.
    const fromPort = shade(NORTHERLY, behind, [onPort])
    const fromStarboard = shade(NORTHERLY, behind, [onStarboard])

    expect(fromPort.direction).toBeGreaterThan(0)
    expect(fromPort.direction).toBeLessThan(180)
    expect(fromStarboard.direction).toBeGreaterThan(180)

    // Mirrored: the same size of turn, the other way.
    expect(fromPort.direction).toBeCloseTo(360 - fromStarboard.direction)
  })

  it('takes the same wind out of a boat whichever tack she is on', () => {
    expect(shade(NORTHERLY, behind, [onPort]).speed).toBeCloseTo(
      shade(NORTHERLY, behind, [onStarboard]).speed,
    )
  })

  it('bends and slows it more the closer in she is', () => {
    const close = shade(NORTHERLY, downwind(10), [onPort])
    const far = shade(NORTHERLY, downwind(60), [onPort])
    expect(close.speed).toBeLessThan(far.speed)
    expect(close.direction).toBeGreaterThan(far.direction)
  })

  it('compounds two boats shading the same water', () => {
    const second: Shadower = { ...onPort, id: 'two', position: abeam(8) }
    const one = shade(NORTHERLY, behind, [onPort])
    const both = shade(NORTHERLY, behind, [onPort, second])
    expect(both.speed).toBeLessThan(one.speed)
  })

  it('never blows harder, and never backwards', () => {
    for (let along = -40; along <= 120; along += 5) {
      for (let across = -40; across <= 40; across += 5) {
        const at = add(scale(bearingToVector(180), along), abeam(across))
        const shaded = shade(NORTHERLY, at, [onPort, onStarboard])
        expect(shaded.speed).toBeLessThanOrEqual(NORTHERLY.speed + 1e-9)
        expect(shaded.speed).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(shaded.direction)).toBe(true)
      }
    }
  })
})
