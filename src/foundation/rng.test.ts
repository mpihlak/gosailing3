import { describe, it, expect } from 'vitest'
import { createRng } from './rng'

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = Array.from({ length: 20 }, () => createRng(1234).next())
    const b = Array.from({ length: 20 }, () => createRng(1234).next())
    expect(a).toEqual(b)
  })

  it('produces different sequences for different seeds', () => {
    const a = createRng('race-a')
    const b = createRng('race-b')
    expect(a.next()).not.toBe(b.next())
  })

  it('stays inside the unit interval', () => {
    const rng = createRng(7)
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('keeps split streams independent, so one consumer cannot disturb another', () => {
    const windOnly = createRng(99).split('wind')
    const shared = createRng(99)
    shared.split('ai').next()
    shared.split('ai').next()
    const windAfterAi = shared.split('wind')

    expect(windAfterAi.next()).toBe(windOnly.next())
  })

  it('spreads roughly evenly across the range', () => {
    const rng = createRng('distribution')
    const buckets = new Array(10).fill(0)
    for (let i = 0; i < 100_000; i++) buckets[rng.int(10)]++
    for (const count of buckets) {
      expect(count).toBeGreaterThan(9000)
      expect(count).toBeLessThan(11000)
    }
  })
})
