import { describe, it, expect } from 'vitest'
import { fasterThan, formatRate, NORMAL_RATE, RATE_LADDER, slowerThan } from './timescale'

describe('the rate ladder', () => {
  it('steps up and down through the rungs', () => {
    expect(fasterThan(1)).toBe(2)
    expect(fasterThan(2)).toBe(4)
    expect(slowerThan(1)).toBe(0.5)
    expect(slowerThan(0.5)).toBe(0.25)
  })

  it('stops at the ends rather than running away', () => {
    expect(fasterThan(16)).toBe(16)
    expect(fasterThan(1000)).toBe(16)
    expect(slowerThan(0.25)).toBe(0.25)
    expect(slowerThan(0)).toBe(0.25)
  })

  it('comes back to normal speed from either direction', () => {
    expect(RATE_LADDER).toContain(NORMAL_RATE)
    let rate = 16
    while (rate > NORMAL_RATE) rate = slowerThan(rate)
    expect(rate).toBe(NORMAL_RATE)
  })

  it('reads as a plain multiplier', () => {
    expect(formatRate(1)).toBe('1×')
    expect(formatRate(0.25)).toBe('0.25×')
    expect(formatRate(16)).toBe('16×')
  })
})
