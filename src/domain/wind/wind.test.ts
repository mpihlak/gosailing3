import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { createRng } from '@/foundation/rng'
import { angleDelta, bearingToVector, scale, add, vec } from '@/foundation/geom'
import { constantWind, createWindField } from './field'
import { generateShiftSchedule, oscillation, shiftAt } from './shifts'
import { sideGradient } from './gradient'
import { generateGusts, gustInfluence, gusts } from './gusts'
import { createRaceWind } from './presets'

const COURSE_CENTER = vec(0, 500)
const COURSE_WIDTH = 800

function raceWind(seed: string, overrides = {}) {
  return createRaceWind({
    seed,
    direction: 0,
    speed: 12,
    courseCenter: COURSE_CENTER,
    courseWidth: COURSE_WIDTH,
    duration: 900,
    ...overrides,
  })
}

describe('constantWind', () => {
  it('reports the same wind everywhere and always', () => {
    const wind = constantWind(225, 14)
    expect(wind.sample(vec(0, 0), 0)).toEqual({ direction: 225, speed: 14 })
    expect(wind.sample(vec(5000, -2000), 3600)).toEqual({ direction: 225, speed: 14 })
  })

  it('never reports a negative speed, however a modifier misbehaves', () => {
    const field = createWindField({ direction: 0, speed: 5 }, [(s) => ({ ...s, speed: -100 })])
    expect(field.sample(vec(0, 0), 0).speed).toBe(0)
  })
})

describe('shift schedules', () => {
  const options = { duration: 600, amplitude: 10, minPeriod: 40, maxPeriod: 90 }

  it('stays inside the amplitude at every moment, not just at keyframes', () => {
    const schedule = generateShiftSchedule(createRng('shifts'), options)
    for (let t = 0; t <= 600; t += 0.5) {
      expect(Math.abs(shiftAt(schedule, t))).toBeLessThanOrEqual(10.000001)
    }
  })

  it('holds the last angle when sampled past the end of the schedule', () => {
    const schedule = generateShiftSchedule(createRng('shifts'), options)
    const last = schedule[schedule.length - 1]!
    expect(shiftAt(schedule, 100_000)).toBe(last.angle)
  })

  it('keeps the breeze moving rather than settling on one angle', () => {
    const schedule = generateShiftSchedule(createRng('shifts'), options)
    for (let i = 1; i < schedule.length; i++) {
      expect(Math.abs(schedule[i]!.angle - schedule[i - 1]!.angle)).toBeGreaterThanOrEqual(4)
    }
  })

  it('holds the start bias over the start, then lets go of it', () => {
    const schedule = generateShiftSchedule(createRng('bias'), {
      ...options,
      initialBias: 12,
      biasUntil: 90,
    })
    expect(shiftAt(schedule, 0)).toBe(12)
    expect(shiftAt(schedule, 60)).toBe(12)
    expect(shiftAt(schedule, 90)).toBe(12)
    expect(shiftAt(schedule, 400)).not.toBe(12)
  })

  it('eases between keyframes instead of stepping', () => {
    const schedule = [
      { time: 0, angle: -10 },
      { time: 60, angle: 10 },
    ]
    expect(shiftAt(schedule, 30)).toBeCloseTo(0)
    let previous = shiftAt(schedule, 0)
    for (let t = 0; t <= 60; t += 1) {
      const angle = shiftAt(schedule, t)
      expect(angle - previous).toBeLessThan(1) // no jumps
      previous = angle
    }
  })

  it('applies the shift as an offset to the median direction', () => {
    const schedule = [{ time: 0, angle: 15 }]
    const field = createWindField({ direction: 350, speed: 10 }, [oscillation(schedule)])
    expect(field.sample(vec(0, 0), 0).direction).toBeCloseTo(5) // wraps past north
  })
})

describe('sideGradient', () => {
  const gradient = sideGradient({
    axis: 0,
    leftSpeed: 8,
    rightSpeed: 16,
    center: vec(0, 0),
    halfWidth: 400,
  })
  const field = createWindField({ direction: 0, speed: 12 }, [gradient])

  it('puts the stronger breeze on the side it was told to', () => {
    // Looking upwind in a northerly, left is west.
    expect(field.sample(vec(-400, 0), 0).speed).toBeCloseTo(8)
    expect(field.sample(vec(400, 0), 0).speed).toBeCloseTo(16)
  })

  it('leaves the median speed in the middle of the course', () => {
    expect(field.sample(vec(0, 0), 0).speed).toBeCloseTo(12)
  })

  it('clamps outside the course rather than running away', () => {
    expect(field.sample(vec(-10_000, 0), 0).speed).toBeCloseTo(8)
    expect(field.sample(vec(10_000, 0), 0).speed).toBeCloseTo(16)
  })

  it('follows the wind axis when the breeze is not northerly', () => {
    const rotated = createWindField({ direction: 90, speed: 12 }, [
      sideGradient({ axis: 90, leftSpeed: 8, rightSpeed: 16, center: vec(0, 0), halfWidth: 400 }),
    ])
    // In an easterly, looking upwind is looking east, so the right-hand side is south.
    expect(rotated.sample(vec(0, -400), 0).speed).toBeCloseTo(16)
    expect(rotated.sample(vec(0, 400), 0).speed).toBeCloseTo(8)
  })
})

describe('gusts', () => {
  const cell = {
    origin: vec(0, 0),
    spawnTime: 10,
    lifetime: 60,
    radius: 100,
    strength: 4,
    bend: 0,
    driftDirection: 180,
    driftSpeed: 5,
  }

  it('does nothing before it arrives or after it dies', () => {
    expect(gustInfluence(cell, vec(0, 0), 5)).toBe(0)
    expect(gustInfluence(cell, vec(0, 0), 200)).toBe(0)
  })

  it('is strongest at the center and fades to nothing at the edge', () => {
    const atCenter = gustInfluence(cell, vec(0, -100), 30) // cell has drifted 100m south
    const atEdge = gustInfluence(cell, vec(0, -199), 30)
    expect(atCenter).toBeGreaterThan(atEdge)
    expect(gustInfluence(cell, vec(0, -100 - cell.radius), 30)).toBe(0)
  })

  it('travels downwind over time', () => {
    const early = gustInfluence(cell, vec(0, -50), 20)
    const late = gustInfluence(cell, vec(0, -50), 50)
    expect(early).toBeGreaterThan(late) // the cell has moved past by then
  })

  it('adds its strength to the underlying wind', () => {
    const field = createWindField({ direction: 0, speed: 10 }, [gusts([cell])])
    expect(field.sample(vec(0, -100), 30).speed).toBeGreaterThan(10)
    expect(field.sample(vec(0, 900), 30).speed).toBeCloseTo(10)
  })

  it('generates cells upwind of the course so they blow through it', () => {
    const cells = generateGusts(createRng('g'), {
      axis: 0,
      center: COURSE_CENTER,
      spread: COURSE_WIDTH,
      duration: 600,
      count: 10,
      radius: { min: 100, max: 300 },
      strength: { min: -2, max: 4 },
      driftSpeed: 4,
    })
    for (const generated of cells) {
      expect(generated.origin.y).toBeGreaterThan(COURSE_CENTER.y)
      expect(generated.driftDirection).toBe(180)
    }
  })
})

describe('createRaceWind', () => {
  it('gives identical wind for identical seeds', () => {
    const a = raceWind('regatta-1')
    const b = raceWind('regatta-1')
    for (let t = 0; t < 600; t += 37) {
      const position = vec(t - 300, t)
      expect(a.sample(position, t)).toEqual(b.sample(position, t))
    }
  })

  it('gives different wind for different seeds', () => {
    const a = raceWind('regatta-1')
    const b = raceWind('regatta-2')
    const samples = Array.from({ length: 20 }, (_, i) => [
      a.sample(vec(0, 500), i * 30).direction,
      b.sample(vec(0, 500), i * 30).direction,
    ])
    expect(samples.some(([x, y]) => x !== y)).toBe(true)
  })

  it('can be sampled in any order, because it holds no state', () => {
    const wind = raceWind('seek')
    const position = vec(120, 400)
    const forwards = Array.from({ length: 50 }, (_, i) => wind.sample(position, i * 12))
    const backwards = Array.from({ length: 50 }, (_, i) => wind.sample(position, (49 - i) * 12))
    expect(forwards).toEqual([...backwards].reverse())
  })

  it('favors one end of the line at the start', () => {
    const wind = raceWind('bias', { startBias: 12 })
    expect(angleDelta(0, wind.sample(COURSE_CENTER, 0).direction)).toBeCloseTo(12, 1)
  })

  it('puts more breeze on the side it says is favored', () => {
    const wind = raceWind('sides', { gustiness: 0 })
    const across = bearingToVector(wind.median.direction + 90)
    const left = wind.sample(add(COURSE_CENTER, scale(across, -400)), 0).speed
    const right = wind.sample(add(COURSE_CENTER, scale(across, 400)), 0).speed
    if (wind.favoredSide === 'left') expect(left).toBeGreaterThan(right)
    else expect(right).toBeGreaterThan(left)
  })

  it('stays within believable limits anywhere on the course at any time', () => {
    const wind = raceWind('limits')
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -500, max: 1500, noNaN: true }),
        fc.double({ min: 0, max: 900, noNaN: true }),
        (x, y, t) => {
          const sample = wind.sample(vec(x, y), t)
          expect(Number.isFinite(sample.speed)).toBe(true)
          expect(sample.speed).toBeGreaterThanOrEqual(0)
          expect(sample.speed).toBeLessThan(30)
          expect(sample.direction).toBeGreaterThanOrEqual(0)
          expect(sample.direction).toBeLessThan(360)
        },
      ),
    )
  })
})
