import { describe, it, expect } from 'vitest'
import { Latency } from './latency'

describe('keeping round trips', () => {
  const of = (ms: readonly number[]) => {
    const latency = new Latency()
    for (const one of ms) latency.record('c1', one)
    return latency
  }

  it('knows nothing about a connection it has not heard from', () => {
    expect(new Latency().summary('c1')).toBeUndefined()
  })

  it('reads the spread, not just the middle', () => {
    // Nine quick and one slow: the median says fine, the tail says otherwise.
    const latency = of([20, 21, 22, 23, 24, 25, 26, 27, 28, 700])
    expect(latency.summary('c1')).toMatchObject({ samples: 10, p50: 25, max: 700 })
    expect(latency.summary('c1')?.p90).toBe(700)
  })

  it('takes the single trip it has as every number', () => {
    expect(of([42])).toBeDefined()
    expect(of([42]).summary('c1')).toMatchObject({ samples: 1, p50: 42, p90: 42, max: 42 })
  })

  it('reports over the last few when asked, for a number to show a sailor', () => {
    const latency = of([500, 500, 500, 10, 12, 14])
    expect(latency.summary('c1')?.p50).toBe(500)
    expect(latency.summary('c1', 3)?.p50).toBe(12)
  })

  it('keeps only the most recent, so a long race cannot grow without end', () => {
    const latency = new Latency(5)
    for (let n = 0; n < 100; n++) latency.record('c1', n)
    expect(latency.summary('c1')).toMatchObject({ samples: 5, max: 99 })
  })

  it('refuses a measurement that is not one', () => {
    const latency = new Latency()
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) latency.record('c1', bad)
    expect(latency.summary('c1')).toBeUndefined()
  })

  it('keeps connections apart, and forgets one that has gone', () => {
    const latency = new Latency()
    latency.record('c1', 10)
    latency.record('c2', 90)
    expect(latency.summary('c2')?.p50).toBe(90)
    latency.forget('c1')
    expect(latency.summary('c1')).toBeUndefined()
    expect(latency.summary('c2')?.p50).toBe(90)
  })
})
