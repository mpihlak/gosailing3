import { describe, it, expect } from 'vitest'
import { createRng } from '@/foundation/rng'
import { personalityFor } from './personality'
import { GybePlan } from './gybing'

const RUN = 400

/** Every distance to go, a meter at a time, at which the plan says to gybe. */
function gybesOn(plan: GybePlan): number[] {
  const at: number[] = []
  for (let toGo = RUN; toGo >= 0; toGo--) {
    if (plan.due(toGo)) {
      at.push(toGo)
      plan.made()
    }
  }
  return at
}

describe('planning gybes on a run', () => {
  it('never gybes a skipper with no restlessness', () => {
    for (let race = 0; race < 20; race++) {
      expect(gybesOn(new GybePlan(createRng(`calm-${race}`), 0, RUN))).toEqual([])
    }
  })

  it('gybes a restless one up to three times, never straight after the mark nor at the line', () => {
    const counts = new Set<number>()
    for (let race = 0; race < 40; race++) {
      const at = gybesOn(new GybePlan(createRng(`restless-${race}`), 1, RUN))
      counts.add(at.length)
      for (const toGo of at) {
        expect(toGo).toBeLessThanOrEqual(0.9 * RUN)
        expect(toGo).toBeGreaterThanOrEqual(0.2 * RUN - 1)
      }
    }
    expect(Math.max(...counts)).toBeLessThanOrEqual(3)
    expect(counts.size).toBeGreaterThan(1)
  })

  it('chooses afresh each race', () => {
    const plans = new Set<string>()
    for (let race = 0; race < 10; race++) {
      plans.add(JSON.stringify(gybesOn(new GybePlan(createRng(`Alice:race-${race}`), 1, RUN))))
    }
    expect(plans.size).toBeGreaterThan(1)
  })

  it('gives up a gybe held up too long, rather than making it late', () => {
    // A race in which she plans exactly one.
    const seed = Array.from({ length: 50 }, (_, race) => `held-${race}`).find(
      (one) => gybesOn(new GybePlan(createRng(one), 1, RUN)).length === 1,
    )!
    const [at] = gybesOn(new GybePlan(createRng(seed), 1, RUN))
    const plan = new GybePlan(createRng(seed), 1, RUN)
    expect(plan.due(at!)).toBe(true)
    // Never made, and by now a tenth of the run late.
    expect(plan.due(at! - 0.1 * RUN - 1)).toBe(false)
  })

  it('makes some robots more restless than others', () => {
    const restless = ['Alice', 'Bob', 'Carol', 'Dan', 'Eve'].map(
      (name) => personalityFor(name).gybing,
    )
    expect(Math.max(...restless) - Math.min(...restless)).toBeGreaterThan(0.3)
  })
})
