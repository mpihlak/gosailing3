import { vec } from '@/foundation/geom'
import type { Meters, Seconds } from '@/foundation/units'
import { CRUISER_35_SPEC, type BoatId } from '@/domain/boat'
import { pointAt } from '@/domain/course'
import type { ScenarioSpec } from '@/sim'
import type { FleetColor } from '@/net'
import { PALETTE } from '@/presentation/render'

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

/**
 * Simulation seconds as the player lives them. Every duration she is shown goes through
 * here: the boats move GAME_PACE times faster than her clock, so a number taken straight
 * from the simulation reads four times too large. A start half a second late was reported
 * as two seconds late that way.
 */
export function playerSeconds(simulated: Seconds): Seconds {
  return simulated / GAME_PACE
}

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
        name: 'Blue',
        controller: 'human',
        position: playerBerth,
        heading: alongLine,
      },
      {
        id: OPPONENT_ID,
        name: 'Red',
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

/**
 * The same course, sailed by however many turn up. Boats are given no berth, so the
 * course spreads them along the line itself and a fleet of two or eight needs no other
 * arrangement.
 */
export function regattaRace(
  seed: string,
  sailors: readonly { readonly id: BoatId; readonly name: string }[],
): ScenarioSpec {
  return {
    name: 'Regatta',
    seed,
    boats: sailors.map(({ id, name }) => ({ id, name, controller: 'human' as const })),
    course: { legLength: LEG_LENGTH, lineLength: LINE_LENGTH, startCenter: START_CENTER },
    wind: { direction: WIND_DIRECTION, speed: WIND_SPEED },
    config: { startSequence: COUNTDOWN * GAME_PACE },
    duration: RACE_DURATION * GAME_PACE,
  }
}

/** One for each of the ten boats a race will hold, so no two of them look alike. */
export const FLEET_COLORS: readonly FleetColor[] = [
  { name: 'Blue', hex: PALETTE.hullBlue },
  { name: 'Red', hex: PALETTE.hullRed },
  { name: 'Silver', hex: PALETTE.hullRival },
  { name: 'Amber', hex: '#e0a458' },
  { name: 'Violet', hex: '#9d7fd8' },
  { name: 'Teal', hex: '#5fc9b5' },
  { name: 'Rose', hex: '#d67fb0' },
  { name: 'Olive', hex: '#b8c45c' },
  { name: 'Azure', hex: '#6f9bd1' },
  { name: 'Copper', hex: '#cf8b6a' },
]

/** Nobody racing is painted this, so an onlooker is never taken for a boat. */
export const WATCHER_COLOR: FleetColor = { name: 'Watcher', hex: '#9aa7b1' }

/**
 * The regatta the game joins when it is asked for a networked race and told no more.
 *
 * It must be `wss:`, because the page is served over https and a browser will not open a
 * plain socket from one.
 */
export const DEFAULT_SERVER = 'wss://voyager.tail64dd71.ts.net'

export function randomSeed(): string {
  return Math.floor(Math.random() * 1e9).toString(36)
}
