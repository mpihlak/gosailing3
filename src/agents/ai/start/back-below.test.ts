import { describe, it, expect } from 'vitest'
import { vec, type Vec2 } from '@/foundation/geom'
import { createSimulation, SimulationRunner, type SimEvent } from '@/sim'
import { Skipper } from '../skipper'
import { boatEndStarboardStart } from './line-ends'

const STEADY = {
  direction: 0,
  speed: 12,
  shiftAmplitude: 0,
  startBias: 0,
  gustiness: 0,
  gradientStrength: 0,
}

/** A robot put above the line `before` seconds before the gun, and what happens to her. */
function pushedOver(position: Vec2, before: number): SimEvent[] {
  const sim = createSimulation({
    name: 'pushed over',
    seed: 'over',
    boats: [{ id: 'robot', name: 'Bob', controller: 'ai', position, heading: 330 }],
    course: { legLength: 450, lineLength: 260, startCenter: vec(0, 0) },
    wind: STEADY,
    config: { startSequence: 120 },
    duration: 4800,
  })
  const world = {
    ...sim.world,
    time: 120 - before,
    boats: sim.world.boats.map((boat) => ({ ...boat, speed: 4 })),
  }
  const runner = new SimulationRunner(sim.ctx, world)
  const helms = { robot: new Skipper({ start: boatEndStarboardStart() }) }
  const events: SimEvent[] = []
  while (runner.world.time < 150) events.push(...runner.advance(1 / 60, helms, 10))
  return events
}

describe('pushed over the line before the gun', () => {
  // Left to the start strategy she sailed along the course side until the gun, then
  // went back as over early and started a quarter of a minute late.
  it('goes back below the line and starts without being over early', () => {
    const events = pushedOver(vec(100, 15), 20)
    expect(events.filter((event) => event.kind === 'overEarly')).toEqual([])
    const started = events.find((event) => event.kind === 'boatStarted')
    expect(started?.kind === 'boatStarted' && started.late).toBeLessThan(10)
  })

  it('comes back round the outside of the committee boat from past the end', () => {
    const events = pushedOver(vec(140, 15), 20)
    expect(events.filter((event) => event.kind === 'penalised')).toEqual([])
    expect(events.some((event) => event.kind === 'boatStarted')).toBe(true)
  })
})
