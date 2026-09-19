import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  angleBetween,
  angleDelta,
  bearingToVector,
  lerpBearing,
  mirrorBearing,
  normalizeBearing,
  normalizeSigned,
  vectorToBearing,
} from './angles'

describe('bearing conventions', () => {
  it('maps the cardinal points onto a y-north world', () => {
    expect(bearingToVector(0)).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(1) })
    expect(bearingToVector(90)).toMatchObject({ x: expect.closeTo(1), y: expect.closeTo(0) })
    expect(bearingToVector(180)).toMatchObject({ x: expect.closeTo(0), y: expect.closeTo(-1) })
    expect(bearingToVector(270)).toMatchObject({ x: expect.closeTo(-1), y: expect.closeTo(0) })
  })

  it('round-trips a bearing through a vector', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 359.999, noNaN: true }), (bearing) => {
        expect(vectorToBearing(bearingToVector(bearing))).toBeCloseTo(bearing, 6)
      }),
    )
  })
})

describe('normalization', () => {
  it('wraps any input into range', () => {
    fc.assert(
      fc.property(fc.double({ min: -10_000, max: 10_000, noNaN: true }), (angle) => {
        const bearing = normalizeBearing(angle)
        expect(bearing).toBeGreaterThanOrEqual(0)
        expect(bearing).toBeLessThan(360)

        const signed = normalizeSigned(angle)
        expect(signed).toBeGreaterThan(-180.000001)
        expect(signed).toBeLessThanOrEqual(180)
      }),
    )
  })

  it('treats 180 as the positive limit so a delta never flips sign arbitrarily', () => {
    expect(normalizeSigned(180)).toBe(180)
    expect(normalizeSigned(-180)).toBe(180)
  })
})

describe('angleDelta', () => {
  it('takes the short way around the compass', () => {
    expect(angleDelta(350, 10)).toBeCloseTo(20)
    expect(angleDelta(10, 350)).toBeCloseTo(-20)
    expect(angleDelta(0, 90)).toBeCloseTo(90)
    expect(angleDelta(90, 0)).toBeCloseTo(-90)
  })

  it('is antisymmetric except at the 180 boundary', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        (a, b) => {
          const forward = angleDelta(a, b)
          if (Math.abs(forward) === 180) return
          expect(angleDelta(b, a)).toBeCloseTo(-forward, 9)
        },
      ),
    )
  })

  it('never exceeds a half turn', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -720, max: 720, noNaN: true }),
        fc.double({ min: -720, max: 720, noNaN: true }),
        (a, b) => {
          expect(angleBetween(a, b)).toBeLessThanOrEqual(180.000001)
        },
      ),
    )
  })
})

describe('lerpBearing', () => {
  it('crosses north rather than going the long way', () => {
    expect(lerpBearing(350, 10, 0.5)).toBeCloseTo(0)
  })

  it('returns the endpoints exactly', () => {
    expect(lerpBearing(42, 137, 0)).toBeCloseTo(42)
    expect(lerpBearing(42, 137, 1)).toBeCloseTo(137)
  })
})

describe('mirrorBearing', () => {
  it('reflects a tack across the wind axis', () => {
    // Port and starboard close-hauled headings in a northerly, 40 degrees off the wind.
    expect(mirrorBearing(40, 0)).toBeCloseTo(320)
    expect(mirrorBearing(320, 0)).toBeCloseTo(40)
  })
})
