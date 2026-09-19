import type { ScenarioSpec } from '@/sim'

export const PLAYER_ID = 'player'

/** The race the game opens with: one boat, one lap, a minute to the gun. */
export function soloRace(seed: number | string): ScenarioSpec {
  return {
    name: 'Solo windward-leeward',
    seed,
    boats: [{ id: PLAYER_ID, name: 'You', controller: 'human' }],
    course: { legLength: 900, lineLength: 260 },
    wind: { direction: 0, speed: 12 },
    config: { startSequence: 60 },
    duration: 1200,
  }
}

export function randomSeed(): string {
  return Math.floor(Math.random() * 1e9).toString(36)
}
