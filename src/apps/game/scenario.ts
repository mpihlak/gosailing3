import type { ScenarioSpec } from '@/sim'

export const PLAYER_ID = 'player'

/**
 * Sailing at true scale is too slow to be much fun: a boat doing six knots up a nine
 * hundred meter beat takes the better part of ten minutes. The game runs its simulation
 * this many simulated seconds per second of the player's time, which is the pace it is
 * tuned at.
 *
 * Every clock the player sees is divided back down by it, so the timer counts real
 * seconds however fast the boats are moving.
 */
export const GAME_PACE = 4

/** Countdown before the gun, in the player's seconds. */
export const COUNTDOWN: number = 60

/** The race the game opens with: one boat, one lap. */
export function soloRace(seed: number | string): ScenarioSpec {
  return {
    name: 'Solo windward-leeward',
    seed,
    boats: [{ id: PLAYER_ID, name: 'You', controller: 'human' }],
    course: { legLength: 900, lineLength: 260 },
    wind: { direction: 0, speed: 12 },
    config: { startSequence: COUNTDOWN * GAME_PACE },
    duration: 1200 * GAME_PACE,
  }
}

export function randomSeed(): string {
  return Math.floor(Math.random() * 1e9).toString(36)
}
