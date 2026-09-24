import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { createPolar } from './polar'
import { CRUISER_35 } from './tables/cruiser'
import { validateTable } from './table'

const polar = createPolar(CRUISER_35)

describe('boatSpeed against the measured table', () => {
  it('returns table values exactly at measured points', () => {
    expect(polar.boatSpeed(90, 10)).toBeCloseTo(7.13)
    expect(polar.boatSpeed(120, 16)).toBeCloseTo(8.41)
    expect(polar.boatSpeed(180, 4)).toBeCloseTo(1.8)
  })

  it('interpolates between two wind speeds', () => {
    const mid = polar.boatSpeed(90, 11) // between the 10 and 12 knot rows
    expect(mid).toBeGreaterThan(polar.boatSpeed(90, 10))
    expect(mid).toBeLessThan(polar.boatSpeed(90, 12))
    expect(mid).toBeCloseTo((7.13 + 7.47) / 2, 2)
  })

  it('interpolates between two angles', () => {
    const mid = polar.boatSpeed(67.5, 8) // between the 60 and 75 degree columns
    expect(mid).toBeCloseTo((6.25 + 6.41) / 2, 2)
  })

  it('clamps rather than extrapolating outside the measured range', () => {
    expect(polar.boatSpeed(90, 0)).toBeCloseTo(polar.boatSpeed(90, 4))
    expect(polar.boatSpeed(90, 60)).toBeCloseTo(polar.boatSpeed(90, 24))
  })

  it('ignores the sign of the wind angle, so both tacks sail alike', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        (twa, tws) => {
          expect(polar.boatSpeed(twa, tws)).toBeCloseTo(polar.boatSpeed(-twa, tws), 9)
        },
      ),
    )
  })
})

describe('the no-go zone', () => {
  it('stops the boat head to wind', () => {
    expect(polar.boatSpeed(0, 12)).toBe(0)
  })

  it('leaves her stopped until her sails fill, and rises without a step after that', () => {
    // Head to wind is not the only angle she makes no way at: a boat pointed well inside
    // her beat angle is stalled, and waiting does not help her.
    const beat = polar.beatAngle(12)
    expect(polar.boatSpeed(beat * 0.5, 12)).toBe(0)

    // Walked finely, because the interesting place is the edge of the stall, where the
    // curve leaves zero steeply. Steep is wanted; a step in the value is not.
    let previous = 0
    for (let twa = 0; twa <= beat; twa += 0.1) {
      const speed = polar.boatSpeed(twa, 12)
      expect(speed).toBeGreaterThanOrEqual(previous - 1e-9)
      expect(speed - previous).toBeLessThan(0.1)
      previous = speed
    }
  })

  /*
   * How fast the curve may fall away at the beat angle is not a free choice. The table's
   * beat angle is the angle of best VMG, and VMG is speed times the cosine of the angle,
   * so the speed curve has to fall at exactly the tangent of that angle for the peak to
   * land where the table puts it. A steeper taper — five per cent of her speed for the
   * first degree of pinch — made a touch on the tiller cost far more than it should.
   */
  it('gives up only a degree of speed for a degree of pinch', () => {
    for (const wind of [8, 12, 16]) {
      const beat = polar.beatAngle(wind)
      const best = polar.boatSpeed(beat, wind)
      expect(polar.boatSpeed(beat - 1, wind) / best).toBeGreaterThan(0.97)
      expect(polar.boatSpeed(beat - 3, wind) / best).toBeGreaterThan(0.9)
    }
  })

  it('joins the table smoothly where the measured data begins', () => {
    const below = polar.boatSpeed(51.9, 12)
    const at = polar.boatSpeed(52, 12)
    expect(Math.abs(at - below)).toBeLessThan(0.05)
  })

  it('costs most of the speed in the last few degrees of pinching', () => {
    const target = polar.beatTarget(12)
    const halfway = polar.boatSpeed(target.angle / 2, 12)
    expect(halfway / target.speed).toBeLessThan(0.3)
  })
})

describe('targets', () => {
  it('beats at a tighter angle as the breeze builds', () => {
    expect(polar.beatAngle(6)).toBeGreaterThan(polar.beatAngle(16))
  })

  it('finds the beat angle to be the true upwind VMG peak', () => {
    const tws = 12
    const best = polar.beatTarget(tws)
    for (let twa = 20; twa < 90; twa += 0.5) {
      expect(polar.vmg(twa, tws)).toBeLessThanOrEqual(best.vmg + 0.02)
    }
  })

  it('finds the run angle to be the true downwind VMG peak', () => {
    const tws = 12
    const best = polar.runTarget(tws)
    for (let twa = 90; twa <= 180; twa += 0.5) {
      expect(-polar.vmg(twa, tws)).toBeLessThanOrEqual(best.vmg + 0.02)
    }
  })

  it('runs deeper as the breeze builds', () => {
    expect(polar.runAngle(20)).toBeGreaterThan(polar.runAngle(6))
  })

  it('never sails dead downwind at its best VMG', () => {
    for (const tws of [4, 8, 12, 16, 20, 24]) {
      expect(polar.runAngle(tws)).toBeLessThan(180)
      expect(polar.runAngle(tws)).toBeGreaterThan(120)
    }
  })
})

describe('invariants', () => {
  it('never returns a negative or non-finite speed', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -720, max: 720, noNaN: true }),
        fc.double({ min: 0, max: 80, noNaN: true }),
        (twa, tws) => {
          const speed = polar.boatSpeed(twa, tws)
          expect(Number.isFinite(speed)).toBe(true)
          expect(speed).toBeGreaterThanOrEqual(0)
        },
      ),
    )
  })

  it('never exceeds the fastest measured speed for the wind', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: 4, max: 24, noNaN: true }),
        (twa, tws) => {
          expect(polar.boatSpeed(twa, tws)).toBeLessThanOrEqual(polar.maxSpeed(tws) + 1e-9)
        },
      ),
    )
  })

  it('goes faster in more wind at any angle the table measures', () => {
    for (let twa = 52; twa <= 180; twa += 4) {
      for (let tws = 4; tws < 24; tws += 2) {
        expect(polar.boatSpeed(twa, tws + 2)).toBeGreaterThan(polar.boatSpeed(twa, tws))
      }
    }
  })

  it('goes faster in more wind close-hauled too, up to where the boat depowers', () => {
    for (let twa = 0; twa < 52; twa += 1) {
      for (let tws = 4; tws < 18; tws += 0.5) {
        expect(polar.boatSpeed(twa, tws + 0.5)).toBeGreaterThanOrEqual(polar.boatSpeed(twa, tws))
      }
    }
  })

  it('loses upwind VMG above 20 knots, because the source table depowers there', () => {
    // Not an interpolation artifact: the measured beat VMG peaks at 5.24 knots in 20
    // knots of breeze and drops to 5.20 by 24. Keep the model faithful to that.
    expect(polar.beatTarget(20).vmg).toBeGreaterThan(polar.beatTarget(16).vmg)
    expect(polar.beatTarget(24).vmg).toBeLessThan(polar.beatTarget(20).vmg)
    expect(polar.beatAngle(24)).toBeGreaterThan(polar.beatAngle(20))
  })
})

describe('validateTable', () => {
  it('rejects a table whose rows do not line up with its angles', () => {
    expect(() =>
      validateTable({ ...CRUISER_35, angles: [...CRUISER_35.angles, 190] }),
    ).toThrow(/speeds for/)
  })

  it('rejects unsorted wind speeds', () => {
    expect(() => validateTable({ ...CRUISER_35, windSpeeds: [8, 4, 6, 10, 12, 14, 16, 20, 24] })).toThrow(
      /ascend/,
    )
  })
})
