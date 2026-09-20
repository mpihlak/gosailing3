import { describe, it, expect } from 'vitest'
import { bestAngle, telltalesApply, telltalesFor } from './telltales'

const BEAT = 38
const RUN = 150

/** Read against whichever angle applies at that point of sail. */
const at = (twa: number) => telltalesFor(twa, BEAT, RUN)

describe('going up', () => {
  it('streams both of them on the beat angle', () => {
    expect(at(BEAT).windwardLift).toBe(0)
    expect(at(BEAT).leewardLift).toBe(0)
  })

  it('lifts the windward one when she is pinched too high', () => {
    const state = at(BEAT - 6)
    expect(state.windwardLift).toBeGreaterThan(0)
    expect(state.leewardLift).toBe(0)
  })

  it('lifts the leeward one when she is sailing too low', () => {
    const state = at(BEAT + 6)
    expect(state.leewardLift).toBeGreaterThan(0)
    expect(state.windwardLift).toBe(0)
  })
})

describe('coming down', () => {
  it('streams both of them on the running angle', () => {
    expect(at(RUN).windwardLift).toBe(0)
    expect(at(RUN).leewardLift).toBe(0)
  })

  it('lifts the windward one when she is not deep enough', () => {
    // Sailing higher than her best running angle is too high, just as on a beat.
    const state = at(RUN - 8)
    expect(state.windwardLift).toBeGreaterThan(0)
    expect(state.leewardLift).toBe(0)
  })

  it('lifts the leeward one when she is too deep', () => {
    const state = at(RUN + 8)
    expect(state.leewardLift).toBeGreaterThan(0)
    expect(state.windwardLift).toBe(0)
  })

  it('reads the same on both gybes', () => {
    for (const twa of [120, 140, 150, 165, 178]) {
      expect(at(-twa).windwardLift).toBeCloseTo(at(twa).windwardLift)
      expect(at(-twa).leewardLift).toBeCloseTo(at(twa).leewardLift)
    }
  })
})

describe('the angle they are read against', () => {
  it('is the beat angle going up and the running angle coming down', () => {
    expect(bestAngle(40, BEAT, RUN)).toBe(BEAT)
    expect(bestAngle(150, BEAT, RUN)).toBe(RUN)
    expect(bestAngle(-40, BEAT, RUN)).toBe(BEAT)
    expect(bestAngle(-150, BEAT, RUN)).toBe(RUN)
  })

  it('follows the wind, so the same angle can be right in one breeze and wrong in another', () => {
    expect(telltalesFor(38, 38, RUN).windwardLift).toBe(0)
    expect(telltalesFor(38, 44, RUN).windwardLift).toBeGreaterThan(0)
    expect(telltalesFor(150, BEAT, 150).leewardLift).toBe(0)
    expect(telltalesFor(150, BEAT, 140).leewardLift).toBeGreaterThan(0)
  })
})

describe('how readily they lift', () => {
  it('forgives a degree or so of wandering', () => {
    expect(at(BEAT + 1).leewardLift).toBe(0)
    expect(at(RUN - 1).windwardLift).toBe(0)
  })

  it('shows a few degrees off, which is the point of steering by them', () => {
    expect(at(BEAT - 4).windwardLift).toBeGreaterThan(0.2)
    expect(at(RUN + 4).leewardLift).toBeGreaterThan(0.2)
  })

  it('lifts further the further off she is, up to fully lifted', () => {
    expect(at(BEAT - 8).windwardLift).toBeGreaterThan(at(BEAT - 4).windwardLift)
    expect(at(BEAT - 30).windwardLift).toBe(1)
    expect(at(RUN + 30).leewardLift).toBe(1)
  })

  it('never lifts both at once, since she cannot be high and low together', () => {
    for (let twa = 5; twa <= 180; twa += 1) {
      const state = at(twa)
      expect(Math.min(state.windwardLift, state.leewardLift)).toBe(0)
    }
  })

  it('puts the windward telltale on the side the wind comes from, on either leg', () => {
    expect(at(40).windwardSide).toBe('port')
    expect(at(-40).windwardSide).toBe('starboard')
    expect(at(150).windwardSide).toBe('port')
    expect(at(-150).windwardSide).toBe('starboard')
  })
})

describe('when they are shown', () => {
  it('reads them all the way round once she is racing', () => {
    expect(telltalesApply(40, true)).toBe(true)
    expect(telltalesApply(150, true)).toBe(true)
    expect(telltalesApply(-175, true)).toBe(true)
  })

  it('reads them going up before the gun, where a beat is still a beat', () => {
    expect(telltalesApply(40, false)).toBe(true)
    expect(telltalesApply(-75, false)).toBe(true)
  })

  it('says nothing coming down before the gun, where there is no angle worth holding', () => {
    expect(telltalesApply(120, false)).toBe(false)
    expect(telltalesApply(-175, false)).toBe(false)
  })
})
