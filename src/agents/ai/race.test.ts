import { describe, it, expect } from 'vitest'
import { createSimulation, runHeadless, type WorldState } from '@/sim'
import { Skipper } from './skipper'

/** A full race, sailed by the AI with no renderer and no clock. */
function sailRace(seed: string, options: { laps?: number; windSpeed?: number } = {}) {
  const simulation = createSimulation({
    name: 'AI race',
    seed,
    boats: [{ id: 'ai', name: 'Robot', controller: 'ai' }],
    course: { legLength: 700, lineLength: 260, ...(options.laps ? { laps: options.laps } : {}) },
    wind: { direction: 0, speed: options.windSpeed ?? 12 },
    // The countdown the game itself runs. The start strategy needs room to reach out and
    // come back; a short sequence is its own problem, recorded in the strategy's tests.
    config: { startSequence: 120 },
    duration: 2400,
  })

  const result = runHeadless(
    simulation.ctx,
    simulation.world,
    { ai: new Skipper() },
    {
      maxTicks: 60 * 60 * 25, // give her twenty-five minutes of race time
      until: (world: WorldState) => world.race.phase === 'complete',
    },
  )
  return { simulation, ...result }
}

describe('a boat sailed by the AI', () => {
  const { world, events } = sailRace('race-1')
  const progress = world.race.progress.ai

  it('gets round the course and finishes', () => {
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['raceStarted', 'boatStarted', 'markRounded', 'boatFinished']),
    )
    expect(progress?.status).toBe('finished')
  })

  it('starts after the gun rather than before it', () => {
    expect(progress?.startTime).toBeGreaterThanOrEqual(0)
    expect(events.filter((event) => event.kind === 'overEarly')).toHaveLength(0)
  })

  it('is not still hanging about a minute after the gun', () => {
    expect(progress?.startTime).toBeLessThan(45)
  })

  it('sails the course without hitting anything', () => {
    expect(events.filter((event) => event.kind === 'contact')).toHaveLength(0)
    expect(progress?.penalties).toBe(0)
  })

  it('tacks up the beat instead of trying to sail straight at the mark', () => {
    expect(events.filter((event) => event.kind === 'tacked').length).toBeGreaterThanOrEqual(2)
  })

  it('takes a plausible amount of time for the distance', () => {
    // 700m up and 700m back at roughly 5 knots made good is somewhere near six minutes.
    expect(progress?.finishTime).toBeGreaterThan(200)
    expect(progress?.finishTime).toBeLessThan(900)
  })

  it('does not sail absurdly further than the course is long', () => {
    expect(progress?.distanceSailed).toBeGreaterThan(1400)
    expect(progress?.distanceSailed).toBeLessThan(3500)
  })
})

describe('across conditions', () => {
  it.each(['alpha', 'bravo', 'charlie', 'delta', 'echo'])('finishes in seed %s', (seed) => {
    const { world } = sailRace(seed)
    expect(world.race.progress.ai?.status).toBe('finished')
  })

  it.each([6, 9, 16, 20])('finishes in %i knots of breeze', (windSpeed) => {
    const { world } = sailRace('breeze', { windSpeed })
    expect(world.race.progress.ai?.status).toBe('finished')
  })

  it('sails a two-lap course', () => {
    const { world, events } = sailRace('two-laps', { laps: 2 })
    expect(events.filter((event) => event.kind === 'markRounded')).toHaveLength(3)
    expect(world.race.progress.ai?.status).toBe('finished')
  })
})

describe('determinism', () => {
  it('sails exactly the same race twice', () => {
    const first = sailRace('repeatable')
    const second = sailRace('repeatable')
    expect(first.world.race.progress.ai?.finishTime).toBe(
      second.world.race.progress.ai?.finishTime,
    )
    expect(first.world.boats).toEqual(second.world.boats)
  })

  it('sails a different race in a different wind', () => {
    const first = sailRace('wind-a')
    const second = sailRace('wind-b')
    expect(first.world.race.progress.ai?.finishTime).not.toBe(
      second.world.race.progress.ai?.finishTime,
    )
  })
})
