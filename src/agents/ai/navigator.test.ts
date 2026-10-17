import { describe, it, expect } from 'vitest'
import { angleDelta, vec } from '@/foundation/geom'
import { createSimulation, type WorldState } from '@/sim'
import { pinEndPortStart } from './start'
import { planCourse } from './navigator'

/** One boat, nobody near her, so there is always water to turn in. */
const alone = createSimulation({
  name: 'turning',
  seed: 'turn',
  boats: [{ id: 'ai', name: 'Ann', controller: 'ai', position: vec(0, 200), heading: 180 }],
  course: { legLength: 450, lineLength: 260, startCenter: vec(0, 0) },
  wind: { direction: 0, speed: 12 },
  config: { startSequence: 120 },
  duration: 2400,
})

/** Her, racing, owing a turn, and pointed the way the trouble happens. */
function owing(twa: number): WorldState {
  const world = alone.world
  const boat = world.boats[0]!
  const progress = world.race.progress.ai!
  return {
    ...world,
    boats: [{ ...boat, heading: 180, twa, speed: 5 }],
    race: {
      ...world.race,
      progress: { ai: { ...progress, status: 'racing', penalties: 1, stageIndex: 2 } },
    },
  }
}

const plan = (twa: number, spinning: 1 | -1 | undefined) => {
  const world = owing(twa)
  const boat = world.boats[0]!
  const wind = alone.ctx.wind.sample(boat.position, world.time)
  return planCourse(alone.ctx, world, boat, alone.ctx.specs.ai!, wind, pinEndPortStart(), spinning)
}

/*
 * Her tack is which side the wind is on, so it flips the instant she crosses dead
 * downwind — several times a second when she is running square. Taking the way round a
 * penalty turn from her tack therefore reversed the order every tick: she was told to
 * turn both ways at once, went straight on instead, and sailed off the course at four
 * knots until the race timed out. One boat tacked a hundred and twenty-seven times.
 */
describe('paying off a turn while running square', () => {
  it('decides to turn at all', () => {
    expect(plan(179, undefined).reason).toBe('penalty')
    expect(plan(179, undefined).spin).toBeDefined()
  })

  it('keeps going the way she started when her tack flips underneath her', () => {
    const began = plan(179, undefined).spin!
    // The same boat a tick later, a hair the other side of dead downwind.
    const next = plan(-179, began)
    expect(next.spin).toBe(began)
    expect(next.bearing).toBeCloseTo(plan(179, began).bearing)
  })

  it('would reverse without being told what she was doing, which is the bug', () => {
    expect(plan(179, undefined).spin).not.toBe(plan(-179, undefined).spin)
  })
})

describe('when a turn is paid off', () => {
  it('waits for water rather than turning into another boat', () => {
    const world = owing(179)
    const boat = world.boats[0]!
    const crowded: WorldState = {
      ...world,
      boats: [boat, { ...boat, id: 'other', position: vec(4, 200) }],
    }
    const wind = alone.ctx.wind.sample(boat.position, world.time)
    const made = planCourse(
      alone.ctx,
      crowded,
      boat,
      alone.ctx.specs.ai!,
      wind,
      pinEndPortStart(),
      undefined,
    )
    expect(made.reason).not.toBe('penalty')
  })

  /** Turns are no longer saved for the last leg: she pays as soon as there is room. */
  it('pays on an earlier leg as readily as on the last', () => {
    const world = owing(179)
    const early: WorldState = {
      ...world,
      race: {
        ...world.race,
        progress: { ai: { ...world.race.progress.ai!, stageIndex: 1 } },
      },
    }
    const boat = early.boats[0]!
    const wind = alone.ctx.wind.sample(boat.position, early.time)
    const made = planCourse(
      alone.ctx,
      early,
      boat,
      alone.ctx.specs.ai!,
      wind,
      pinEndPortStart(),
      undefined,
    )
    expect(made.reason).toBe('penalty')
  })
})

describe('laying the windward mark', () => {
  // A steady breeze, so the beat angle and the mark's line do not move under her.
  const course = createSimulation({
    name: 'laying',
    seed: 'lay',
    boats: [{ id: 'ai', name: 'Ann', controller: 'ai', position: vec(0, 0), heading: 0 }],
    course: { legLength: 450, lineLength: 260, startCenter: vec(0, 0) },
    wind: {
      direction: 0,
      speed: 12,
      shiftAmplitude: 0,
      startBias: 0,
      gustiness: 0,
      gradientStrength: 0,
    },
    config: { startSequence: 0 },
    duration: 2400,
  })
  const mark = course.ctx.course.marks[0]!.position

  /** Her plan close-hauled on starboard, beating up to the mark, from `x` and `y` off it. */
  const beatingFrom = (x: number, y: number) => {
    const world = course.world
    const progress = world.race.progress.ai!
    const boat = {
      ...world.boats[0]!,
      position: vec(mark.x + x, mark.y + y),
      heading: 323,
      twa: -37,
      speed: 6,
    }
    const racing: WorldState = {
      ...world,
      boats: [boat],
      race: {
        ...world.race,
        phase: 'racing',
        progress: { ai: { ...progress, status: 'racing', stageIndex: 1, clearedPreStart: true } },
      },
    }
    const wind = course.ctx.wind.sample(boat.position, racing.time)
    return planCourse(
      course.ctx,
      racing,
      boat,
      course.ctx.specs.ai!,
      wind,
      pinEndPortStart(),
      undefined,
    )
  }

  it('tacks away from a starboard course that sails at the mark', () => {
    // Below and to the right of it, close-hauled straight at it: no room to pass.
    expect(Math.abs(angleDelta(37, beatingFrom(30, -40).bearing))).toBeLessThan(5)
  })

  it('holds a starboard course that passes the mark with room', () => {
    expect(Math.abs(angleDelta(323, beatingFrom(60, -40).bearing))).toBeLessThan(5)
  })
})
