import { describe, it, expect } from 'vitest'
import { vec } from '@/foundation/geom'
import type { WindSample } from '@/domain/wind'
import { createSimulation, fixedSource, SimulationRunner, type InputSource } from '@/sim'
import { Skipper } from './skipper'

/**
 * A robot racing up a long beat on port, in a wind that does what the test says. A long
 * leg, so her corridor is wide and only a header would tack her.
 */
function beating(
  direction: (time: number) => number,
  others: { id: string; position: { x: number; y: number }; heading: number }[] = [],
) {
  const sim = createSimulation({
    name: 'headers',
    seed: 'headers',
    boats: [
      { id: 'robot', name: 'Bob', controller: 'ai', position: vec(0, 100), heading: 40 },
      ...others.map((other) => ({ ...other, name: other.id, controller: 'human' as const })),
    ],
    course: { legLength: 2000, lineLength: 260, startCenter: vec(0, 0) },
    wind: { direction: 0, speed: 12 },
    config: { startSequence: 0 },
    duration: 4800,
  })
  const wind = { sample: (): WindSample => ({ direction: 0, speed: 12 }) }
  const progress = Object.fromEntries(
    Object.entries(sim.world.race.progress).map(([id, entry]) => [
      id,
      { ...entry, status: 'racing' as const, stageIndex: 1, clearedPreStart: true },
    ]),
  )
  const ctx = {
    ...sim.ctx,
    wind: {
      sample: (_position: { x: number; y: number }, time: number) => ({
        ...wind.sample(),
        direction: direction(time),
      }),
    },
  }
  const world = {
    ...sim.world,
    boats: sim.world.boats.map((boat) => ({ ...boat, speed: 6 })),
    race: { ...sim.world.race, phase: 'racing' as const, progress },
  }
  return new SimulationRunner(ctx, world)
}

/** The times, in simulated seconds, at which she went from one tack to the other. */
function tacksOver(
  runner: SimulationRunner,
  seconds: number,
  others: Record<string, InputSource> = {},
): number[] {
  const helms = { robot: new Skipper(), ...others }
  const tacks: number[] = []
  let side = Math.sign(runner.world.boats[0]!.twa)
  while (runner.world.time < seconds) {
    runner.advance(1 / 60, helms, 10)
    const now = Math.sign(runner.world.boats.find((boat) => boat.id === 'robot')!.twa)
    if (now !== side) tacks.push(runner.world.time)
    side = now
  }
  return tacks
}

describe('tacking on a header', () => {
  it('tacks when the wind heads her by more than ten degrees', () => {
    // Veering on port is a header: she has to bear away from the mark.
    const tacks = tacksOver(
      beating((time) => (time < 60 ? 0 : 15)),
      80,
    )
    expect(tacks).toHaveLength(1)
    expect(tacks[0]).toBeGreaterThan(60)
  })

  it('holds her tack through a small header', () => {
    expect(
      tacksOver(
        beating((time) => (time < 60 ? 0 : 5)),
        120,
      ),
    ).toEqual([])
  })

  it('stays on the new tack a while before a header tacks her back', () => {
    // Headed on port, she tacks; the wind backing straight after heads her on starboard,
    // and she holds on for a while before tacking back.
    const tacks = tacksOver(
      beating((time) => (time < 60 ? 0 : time < 70 ? 15 : -5)),
      150,
    )
    expect(tacks.length).toBeGreaterThanOrEqual(2)
    expect(tacks[1]! - tacks[0]!).toBeGreaterThanOrEqual(40)
  })

  it('does not tack on a header across the bow of a boat close to windward', () => {
    // On port a little behind her and to windward, sailing the same course: a tack onto
    // starboard would cross her bow.
    const tacks = tacksOver(
      beating(
        (time) => (time < 60 ? 0 : 15),
        [{ id: 'other', position: vec(-12, 96), heading: 40 }],
      ),
      64,
      { other: fixedSource({ rudder: 0 }) },
    )
    expect(tacks).toEqual([])
  })
})
