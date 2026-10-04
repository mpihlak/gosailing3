import { createRng } from '@/foundation/rng'
import type { Degrees } from '@/foundation/units'

/**
 * How one skipper sails, where the course leaves room for taste. Every value stays in a
 * range a good sailor would choose from, so two boats differ in where they go rather than
 * in how well they go.
 */
export interface Personality {
  /** How far off the direct line she goes before tacking back, as a share of the distance to go. */
  readonly corridor: number
  /**
   * Which side of the direct line she prefers, from -1 to 1. Positive widens the corridor
   * east of the line and narrows it west by the same share, so she sails longer on port.
   */
  readonly eastward: number
  /** How far past the layline she stands on before turning for the mark. */
  readonly overstand: Degrees
  /** How far along the line from her end she aims to start, in boat lengths. */
  readonly startClearance: number
  /**
   * How restless she is on the run to the finish, from 0 to 1. At 0 she holds the gybe
   * she rounded on; at 1 she may gybe up to three times, at points chosen afresh each race.
   */
  readonly gybing: number
}

/** The skipper every boat had before they had their own: down the middle, no taste. */
export const PLAIN: Personality = {
  corridor: 0.42,
  eastward: 0,
  overstand: 0,
  startClearance: 1.6,
  gybing: 0,
}

/** A personality of her own, the same every time for the same name. */
export function personalityFor(name: string): Personality {
  const rng = createRng(`personality:${name}`)
  return {
    corridor: rng.split('corridor').range(0.3, 0.55),
    eastward: rng.split('eastward').range(-0.4, 0.4),
    overstand: rng.split('overstand').range(0, 4),
    startClearance: rng.split('start').range(1.6, 10),
    gybing: rng.split('gybing').range(0, 1),
  }
}

/** One line for a log, so whoever is watching knows what to expect of her. */
export function describePersonality(personality: Personality): string {
  const { corridor, eastward, overstand, startClearance, gybing } = personality
  const side = Math.abs(eastward) < 0.1 ? 'middle' : eastward > 0 ? 'east' : 'west'
  return (
    `corridor ${Math.round(corridor * 100)}% favors ${side} (${eastward.toFixed(2)})` +
    ` overstand ${overstand.toFixed(1)}° start ${startClearance.toFixed(1)} lengths in` +
    ` gybing ${gybing.toFixed(2)}`
  )
}
