import { describe, it, expect } from 'vitest'
import { boomAngle } from './boats'

describe('boomAngle', () => {
  it('shows a readable angle close-hauled, where a real main would be near flat', () => {
    // The whole point: at the size a boat is drawn, a correctly trimmed main tells the
    // player nothing about which tack she is on.
    expect(boomAngle(40)).toBeGreaterThan(15)
  })

  it('eases the boom out as she bears away', () => {
    expect(boomAngle(90)).toBeGreaterThan(boomAngle(45))
    expect(boomAngle(150)).toBeGreaterThan(boomAngle(90))
  })

  it('comes back amidships head to wind, where there is no tack to show', () => {
    expect(boomAngle(0)).toBeCloseTo(0)
    expect(boomAngle(2)).toBeLessThan(2)
  })

  it('takes up the tack quickly once she bears away from head to wind', () => {
    expect(boomAngle(12)).toBeGreaterThan(15)
  })

  it('never goes further out than square to the boat', () => {
    for (let twa = 0; twa <= 180; twa += 1) {
      expect(boomAngle(twa)).toBeLessThanOrEqual(90)
    }
  })

  it('never comes back in as she bears away', () => {
    for (let twa = 0; twa < 180; twa += 1) {
      expect(boomAngle(twa + 1)).toBeGreaterThanOrEqual(boomAngle(twa) - 1e-9)
    }
  })

  it('reads the same on both tacks, since the side is drawn separately', () => {
    for (const twa of [15, 40, 90, 135, 170]) {
      expect(boomAngle(-twa)).toBeCloseTo(boomAngle(twa))
    }
  })
})
