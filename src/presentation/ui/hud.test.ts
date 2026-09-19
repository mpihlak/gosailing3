import { describe, it, expect } from 'vitest'
import { createPolar, CRUISER_35 } from '@/domain/polars'
import { clock, targetVmgRatio, velocityMadeGood } from './hud'

const polar = createPolar(CRUISER_35)
const TWS = 12

/** The boat sailing exactly to her polar at a given angle. */
function onThePolar(twa: number, tws = TWS): number {
  return targetVmgRatio(polar, polar.boatSpeed(twa, tws), twa, tws)
}

describe('targetVmgRatio', () => {
  it('reads full marks at the beat angle, sailing to the polar', () => {
    expect(onThePolar(polar.beatAngle(TWS))).toBeCloseTo(1, 2)
  })

  it('reads full marks at the running angle too', () => {
    expect(onThePolar(polar.runAngle(TWS))).toBeCloseTo(1, 2)
  })

  it('marks down a boat that is pinching, even at full speed for that angle', () => {
    // This is the whole point: she can be on her polar and still sailing badly.
    const pinched = onThePolar(polar.beatAngle(TWS) - 10)
    expect(pinched).toBeLessThan(0.98)
    expect(pinched).toBeGreaterThan(0)
  })

  it('marks down a boat sailing too low', () => {
    expect(onThePolar(polar.beatAngle(TWS) + 15)).toBeLessThan(0.98)
  })

  it('marks down a boat at the right angle but short of her speed', () => {
    const angle = polar.beatAngle(TWS)
    const slow = targetVmgRatio(polar, polar.boatSpeed(angle, TWS) * 0.5, angle, TWS)
    expect(slow).toBeCloseTo(0.5, 1)
  })

  it('reads nothing when she is stopped', () => {
    expect(targetVmgRatio(polar, 0, 40, TWS)).toBe(0)
  })

  it('reads near nothing across the wind, where there is no VMG to make', () => {
    expect(onThePolar(90)).toBeLessThan(0.1)
  })

  it('never exceeds the best on offer by much, however she is sailed', () => {
    for (let twa = 0; twa <= 180; twa += 1) {
      expect(onThePolar(twa)).toBeLessThanOrEqual(1.001)
    }
  })

  it('reads the same on both tacks', () => {
    for (const twa of [35, 45, 90, 140, 170]) {
      expect(onThePolar(-twa)).toBeCloseTo(onThePolar(twa))
    }
  })

  it('moves its target with the wind speed', () => {
    // An angle worth sailing in a breeze is not the one to sail in light air.
    const angle = polar.beatAngle(20)
    expect(onThePolar(angle, 20)).toBeGreaterThan(onThePolar(angle, 5))
  })
})

describe('velocityMadeGood', () => {
  it('is the whole of the boat speed straight upwind, and none of it across', () => {
    expect(velocityMadeGood(6, 0)).toBeCloseTo(6)
    expect(velocityMadeGood(6, 90)).toBeCloseTo(0)
  })

  it('goes negative downwind, since that is made good the other way', () => {
    expect(velocityMadeGood(6, 180)).toBeCloseTo(-6)
  })
})

describe('clock', () => {
  it('reads as minutes and seconds', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(9)).toBe('0:09')
    expect(clock(75)).toBe('1:15')
    expect(clock(600)).toBe('10:00')
  })

  it('does not go negative', () => {
    expect(clock(-5)).toBe('0:00')
  })
})
