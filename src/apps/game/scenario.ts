import { vec } from '@/foundation/geom'
import type { Meters, Seconds } from '@/foundation/units'
import { CRUISER_35_SPEC } from '@/domain/boat'
import { pointAt } from '@/domain/course'
import type { ScenarioSpec } from '@/sim'

export const PLAYER_ID = 'player'
export const OPPONENT_ID = 'opponent'

/**
 * Sailing at true scale is too slow to be much fun: the course below takes a boat about
 * six and a half minutes on the water. The game runs its simulation this many simulated
 * seconds per second of the player's time, which is the pace it is tuned at, and brings
 * that down to a minute and a half.
 *
 * Every clock the player sees is divided back down by it, so the timer counts real
 * seconds however fast the boats are moving.
 */
export const GAME_PACE = 4

/** Countdown before the gun, in the player's seconds. */
export const COUNTDOWN: number = 30

const WIND_DIRECTION = 0
const WIND_SPEED = 12
const START_CENTER = vec(0, 0)
const LEG_LENGTH: Meters = 450
const LINE_LENGTH: Meters = 260
/** How far to leeward of the line the fleet waits. */
const BERTH_TO_LEEWARD: Meters = 70
const RACE_DURATION: Seconds = 1200

/**
 * The race the game opens with: the player and one opponent, one lap.
 *
 * The two lie stern to stern with a boat length of water between them, on the same
 * latitude and pointing opposite ways along the line. The player is on port tack heading
 * for the committee boat and the opponent on starboard heading for the pin, which puts
 * the pair a little west of the middle of the line.
 */
export function duel(seed: number | string): ScenarioSpec {
  const alongLine = WIND_DIRECTION + 90
  const playerBerth = pointAt(START_CENTER, WIND_DIRECTION + 180, BERTH_TO_LEEWARD)
  // Centres two lengths apart leaves one length between the sterns.
  const opponentBerth = pointAt(playerBerth, alongLine + 180, CRUISER_35_SPEC.length * 2)

  return {
    name: 'Windward-leeward duel',
    seed,
    boats: [
      {
        id: PLAYER_ID,
        name: 'Player',
        controller: 'human',
        position: playerBerth,
        heading: alongLine,
      },
      {
        id: OPPONENT_ID,
        name: 'Computer',
        controller: 'ai',
        position: opponentBerth,
        heading: alongLine + 180,
      },
    ],
    course: { legLength: LEG_LENGTH, lineLength: LINE_LENGTH, startCenter: START_CENTER },
    wind: { direction: WIND_DIRECTION, speed: WIND_SPEED },
    config: { startSequence: COUNTDOWN * GAME_PACE },
    duration: RACE_DURATION * GAME_PACE,
  }
}

export function randomSeed(): string {
  return Math.floor(Math.random() * 1e9).toString(36)
}
