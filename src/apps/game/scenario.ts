import { vec } from '@/foundation/geom'
import type { Meters, Seconds } from '@/foundation/units'
import type { BoatId } from '@/domain/boat'
import type { ScenarioSpec } from '@/sim'
import type { FleetColor } from '@/net'
import { PALETTE } from '@/presentation/render'

export const PLAYER_ID = 'player'

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
const RACE_DURATION: Seconds = 1200
/**
 * The wind of a standalone game: the race's bias to one end of the line, then shifts from
 * the start. The game holds the shifts frozen until the player sets them going.
 */
const SHIFTING_WIND = { direction: WIND_DIRECTION, speed: WIND_SPEED, biasUntil: 0 }

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

/** How many robots race the player in a standalone game. */
export const ROBOTS = 9

/**
 * The race the game opens with: the player and `ROBOTS` robots, one lap. The course
 * spreads the fleet along the line, moved round from race to race, so the player starts
 * from a different berth and tack each time. Each robot is named for the color she is
 * drawn in.
 */
export function standaloneRace(seed: number | string): ScenarioSpec {
  const robots = FLEET_COLORS.slice(1, 1 + ROBOTS).map((color, index) => ({
    id: `robot-${index + 1}`,
    name: color.name,
    controller: 'ai' as const,
  }))
  return {
    name: 'Windward-leeward',
    seed,
    boats: [{ id: PLAYER_ID, name: FLEET_COLORS[0]!.name, controller: 'human' }, ...robots],
    course: { legLength: LEG_LENGTH, lineLength: LINE_LENGTH, startCenter: START_CENTER },
    wind: SHIFTING_WIND,
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

/** Nobody racing is painted this, so an onlooker is never taken for a boat. */
export const WATCHER_COLOR: FleetColor = { name: 'Watcher', hex: '#9aa7b1' }

/**
 * The regatta the game joins when it is asked for a networked race and told no more.
 *
 * It must be `wss:`, because the page is served over https and a browser will not open a
 * plain socket from one.
 *
 * Behind this name is a Cloudflare tunnel. Measured against the same server reached over
 * the house network, steering answers three milliseconds slower; the tailscale funnel it
 * replaces was a hundred slower at the median and three hundred at the ninetieth.
 */
export const DEFAULT_SERVER = 'wss://ws.gosailing.online'

export function randomSeed(): string {
  return Math.floor(Math.random() * 1e9).toString(36)
}
