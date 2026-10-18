import { describe, it, expect } from 'vitest'
import { angleDelta, vec } from '@/foundation/geom'
import { FreezableWind } from './freeze'
import { createRaceWind } from './presets'

/** A wind that shifts and nothing else, so its direction is the shift alone. */
const shifting = () =>
  createRaceWind({
    seed: 'freeze',
    direction: 0,
    speed: 12,
    courseCenter: vec(0, 0),
    courseWidth: 600,
    duration: 3000,
    gradientStrength: 0,
    gustiness: 0,
    biasUntil: 0,
  })
const here = vec(0, 0)

describe('a wind whose shifts can be frozen', () => {
  it('follows the shifts while they are not frozen', () => {
    const wind = shifting()
    const freezable = new FreezableWind(wind)
    for (const time of [0, 200, 900]) {
      expect(freezable.sample(here, time).direction).toBeCloseTo(wind.sample(here, time).direction)
    }
  })

  it('holds the shift it had while frozen', () => {
    const freezable = new FreezableWind(shifting())
    freezable.freeze(300)
    const held = freezable.sample(here, 300).direction
    for (const time of [400, 900, 2000]) {
      expect(freezable.sample(here, time).direction).toBeCloseTo(held)
    }
  })

  it('carries on from where it stopped when started again', () => {
    const wind = shifting()
    const freezable = new FreezableWind(wind)
    freezable.freeze(300)
    const held = freezable.sample(here, 300).direction
    freezable.unfreeze(1000)
    // No jump to where the schedule had got to, and the shifts move on from there.
    expect(freezable.sample(here, 1000).direction).toBeCloseTo(held)
    expect(freezable.sample(here, 1200).direction).toBeCloseTo(wind.sample(here, 500).direction)
  })

  it('starts with the bias it was drawn when frozen from the start', () => {
    const wind = shifting()
    const freezable = new FreezableWind(wind, 0)
    expect(angleDelta(0, freezable.sample(here, 1500).direction)).toBeCloseTo(wind.startBias)
  })
})
