import { describe, it, expect } from 'vitest'
import { vec } from '@/foundation/geom'
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
