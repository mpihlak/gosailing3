import { describe, it, expect } from 'vitest'
import { vec } from '@/foundation/geom'
import type { Meters, Seconds } from '@/foundation/units'
import type { ScenarioSpec } from '@/sim'
import { pinEndPortStart } from './pin-end-port'
import { trialStart, type StartReport } from './evaluate'

/** The countdown the game itself uses, in simulation seconds. */
const COUNTDOWN: Seconds = 120
/** The line is 260m long, so a start inside this is recognisably at the pin end. */
const PIN_END: Meters = 65

interface Conditions {
  readonly seed: string
  readonly countdown?: Seconds
  readonly windSpeed?: number
  readonly from?: { x: Meters; y: Meters }
}

function scenario(conditions: Conditions): ScenarioSpec {
  return {
    name: 'start trial',
    seed: conditions.seed,
    boats: [
      {
        id: 'ai',
        name: 'Robot',
        controller: 'ai',
        position: vec(conditions.from?.x ?? 0, conditions.from?.y ?? -70),
        heading: 90,
      },
    ],
    course: { legLength: 450, lineLength: 260, startCenter: vec(0, 0) },
    wind: { direction: 0, speed: conditions.windSpeed ?? 12 },
    config: { startSequence: conditions.countdown ?? COUNTDOWN },
    duration: 900,
  }
}

function start(conditions: Conditions): StartReport {
  return trialStart({ strategy: pinEndPortStart(), scenario: scenario(conditions) })
}

describe('a pin end port start, in the conditions it is built for', () => {
  const seeds = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']

  it.each(seeds)('gets off the line and is not over early in seed %s', (seed) => {
    const report = start({ seed })
    expect(report.started).toBe(true)
    expect(report.calledOverEarly).toBe(false)
  })

  it.each(seeds)('crosses within a few seconds of the gun in seed %s', (seed) => {
    const report = start({ seed })
    expect(report.startedAt).toBeGreaterThanOrEqual(0) // never before it
    expect(report.startedAt).toBeLessThan(10)
  })

  it.each(seeds)('crosses at the pin end, on port, at speed in seed %s', (seed) => {
    const report = start({ seed })
    expect(report.fromPin).toBeLessThan(PIN_END)
    expect(report.tackAtStart).toBe('port')
    expect(report.speedRatio).toBeGreaterThan(0.9)
  })

  it.each(seeds)('hits nothing, and leaves the pin room in seed %s', (seed) => {
    const report = start({ seed })
    expect(report.touchedAMark).toBe(false)
    expect(report.closestToPin).toBeGreaterThan(5)
  })
})

describe('across the wind range', () => {
  it.each([6, 9, 12, 16, 20])('starts cleanly in %i knots', (windSpeed) => {
    const report = start({ seed: 'breeze', windSpeed })
    expect(report.started).toBe(true)
    expect(report.calledOverEarly).toBe(false)
    expect(report.startedAt).toBeLessThan(10)
    expect(report.fromPin).toBeLessThan(PIN_END)
  })

  it('reaches further out in a breeze than in light air', () => {
    // A check that the timing is doing something rather than sailing a fixed pattern:
    // more speed buys more distance in the same countdown.
    expect(start({ seed: 'breeze', windSpeed: 6 }).furthestFromLine).toBeLessThan(
      start({ seed: 'breeze', windSpeed: 20 }).furthestFromLine,
    )
  })
})

describe('from where she happens to be', () => {
  it('starts cleanly from down by the pin', () => {
    const report = start({ seed: 'place', from: { x: -200, y: -60 } })
    expect(report.started).toBe(true)
    expect(report.calledOverEarly).toBe(false)
  })

  it('starts cleanly from close under the line', () => {
    const report = start({ seed: 'place', from: { x: 0, y: -15 } })
    expect(report.started).toBe(true)
    expect(report.calledOverEarly).toBe(false)
  })

  it('gets back and starts cleanly from above the line', () => {
    const report = start({ seed: 'place', from: { x: 0, y: 40 } })
    expect(report.started).toBe(true)
    expect(report.calledOverEarly).toBe(false)
    expect(report.fromPin).toBeLessThan(PIN_END)
  })

  it('goes away from the line before coming back at it', () => {
    const report = start({ seed: 'place' })
    expect(report.phases[0]).toBe('reaching')
    expect(report.phases).toContain('approaching')
    expect(report.furthestFromLine).toBeGreaterThan(150)
  })
})

describe('losing time she does not need', () => {
  it('bears away to lose it, and still starts cleanly', () => {
    const report = start({ seed: 'burn', countdown: 200 })
    expect(report.phases).toContain('burning')
    expect(report.started).toBe(true)
    expect(report.calledOverEarly).toBe(false)
  })
})

/**
 * Starts she makes badly but does not throw away. In each of these she crosses before the
 * gun, is called over early, and goes back for a late start rather than sailing on and
 * never starting at all. Recovering is not the same as starting well, so each still has
 * the fix it is waiting for.
 */
describe('when the start goes wrong', () => {
  it('recovers from a countdown too short to reach out in', () => {
    // With a minute there is no room for the reach out, so the whole of the spare time
    // goes into bearing away — and bearing away runs her up the line rather than away
    // from it. She meets the line before she meets the gun.
    // TODO: a timed run instead, out on a reciprocal for half the spare and back, so she
    // starts on the gun rather than recovering from being over it.
    const report = start({ seed: 'short', countdown: 60 })
    expect(report.calledOverEarly).toBe(true)
    expect(report.started).toBe(true)
  })

  it('recovers when the pin is not layable', () => {
    // From well up the line, close-hauled on port crosses the extension beyond the
    // committee boat rather than passing between the marks, which is no start at all.
    // TODO: fall back to the best part of the line she can actually fetch.
    const report = start({ seed: 'unlayable', from: { x: 200, y: -60 } })
    expect(report.calledOverEarly).toBe(true)
    expect(report.started).toBe(true)
  })
})

/**
 * What she cannot do yet. Written down rather than left to be rediscovered, and each one
 * a scenario she should eventually handle. When one of these starts passing, the fix
 * worked and the test should become a requirement.
 */
describe('known limits', () => {
  it('drifts away from the pin over a very long countdown', () => {
    // The wind shifts while she is reaching out, so the layline she comes back on is not
    // the one she left.
    // TODO: re-solve the approach against the wind she has now, not the wind she had.
    const report = start({ seed: 'longwait', countdown: 240 })
    expect(report.started).toBe(true)
    expect(report.fromPin).toBeGreaterThan(PIN_END)
  })
})
