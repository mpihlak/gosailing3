import { describe, it, expect } from 'vitest'
import { telltalesApply, telltalesFor } from './telltales'

const BEAT = 38

describe('telltalesFor', () => {
  it('streams both of them when the boat is on the target angle', () => {
    const state = telltalesFor(BEAT, BEAT)
    expect(state.windwardLift).toBe(0)
    expect(state.leewardLift).toBe(0)
  })

  it('forgives a couple of degrees either side, as a helm wanders', () => {
    expect(telltalesFor(BEAT + 2, BEAT).leewardLift).toBe(0)
    expect(telltalesFor(BEAT - 2, BEAT).windwardLift).toBe(0)
  })

  it('lifts the windward one when she is pinched too high', () => {
    const state = telltalesFor(BEAT - 8, BEAT)
    expect(state.windwardLift).toBeGreaterThan(0)
    expect(state.leewardLift).toBe(0)
  })

  it('lifts the leeward one when she is sailing too low', () => {
    const state = telltalesFor(BEAT + 8, BEAT)
    expect(state.leewardLift).toBeGreaterThan(0)
    expect(state.windwardLift).toBe(0)
  })

  it('never lifts both at once, since she cannot be high and low together', () => {
    for (let twa = 10; twa <= 89; twa += 1) {
      const state = telltalesFor(twa, BEAT)
      expect(Math.min(state.windwardLift, state.leewardLift)).toBe(0)
    }
  })

  it('lifts further the further off the angle she is, up to fully lifted', () => {
    expect(telltalesFor(BEAT - 12, BEAT).windwardLift).toBeGreaterThan(
      telltalesFor(BEAT - 6, BEAT).windwardLift,
    )
    expect(telltalesFor(BEAT - 40, BEAT).windwardLift).toBe(1)
    expect(telltalesFor(BEAT + 40, BEAT).leewardLift).toBe(1)
  })

  it('puts the windward telltale on the side the wind is coming from', () => {
    // Positive true wind angle means the wind crosses from port, which is port tack.
    expect(telltalesFor(40, BEAT).windwardSide).toBe('port')
    expect(telltalesFor(-40, BEAT).windwardSide).toBe('starboard')
  })

  it('reads the same on either tack', () => {
    for (const twa of [20, 33, 38, 45, 70]) {
      expect(telltalesFor(-twa, BEAT).windwardLift).toBeCloseTo(telltalesFor(twa, BEAT).windwardLift)
      expect(telltalesFor(-twa, BEAT).leewardLift).toBeCloseTo(telltalesFor(twa, BEAT).leewardLift)
    }
  })

  it('follows the target angle when the breeze changes it', () => {
    // Thirty-eight degrees is on the money in one breeze and pinching in another.
    expect(telltalesFor(38, 38).windwardLift).toBe(0)
    expect(telltalesFor(38, 44).windwardLift).toBeGreaterThan(0)
  })
})

describe('telltalesApply', () => {
  it('reads them upwind and across the wind', () => {
    expect(telltalesApply(40)).toBe(true)
    expect(telltalesApply(-75)).toBe(true)
  })

  it('does not once she is off the wind, where they say nothing', () => {
    expect(telltalesApply(120)).toBe(false)
    expect(telltalesApply(-175)).toBe(false)
  })
})
