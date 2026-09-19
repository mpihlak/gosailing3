import { describe, it, expect } from 'vitest'
import { Skipper } from '@/agents/ai'
import { createSimulation, runHeadless, timeToStart } from '@/sim'
import { COUNTDOWN, GAME_PACE, soloRace } from './scenario'

/**
 * The game runs its simulation faster than real time and divides every clock back down,
 * so what the player reads is seconds of their own. These check the two ends of that:
 * the countdown they wait through, and the race they sail.
 */
describe('the clocks the player reads', () => {
  const sim = createSimulation(soloRace('clock-check'))

  it('counts the countdown down in the player\'s seconds', () => {
    // The relationship, not the number: the countdown is tuning, and moves.
    expect(timeToStart(sim.ctx, sim.world) / GAME_PACE).toBeCloseTo(COUNTDOWN)
  })

  it('runs a race in a couple of minutes rather than ten', () => {
    const { world } = runHeadless(
      sim.ctx,
      sim.world,
      { [sim.world.boats[0]!.id]: new Skipper() },
      { maxTicks: 60 * 60 * 60, until: (state) => state.race.phase === 'complete' },
    )
    const progress = world.race.progress[sim.world.boats[0]!.id]
    expect(progress?.status).toBe('finished')

    const elapsed = (progress?.finishTime ?? 0) / GAME_PACE
    expect(elapsed).toBeGreaterThan(60)
    expect(elapsed).toBeLessThan(300)
  })
})
