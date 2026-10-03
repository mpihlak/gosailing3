import { add, angleDelta, bearingToVector, distance, scale } from '@/foundation/geom'
import { knotsToMps, type Degrees, type Seconds } from '@/foundation/units'
import type { BoatSpec, BoatState } from '@/domain/boat'
import type { WorldState } from '@/sim'

/**
 * How far ahead a tack is looked at: round, and back up to speed on the new course. Rule
 * 13 has her keep clear for all of the first part, and a boat she has just tacked under
 * has no time to avoid her in the second.
 */
const LOOKAHEAD: Seconds = 8
const STEP: Seconds = 0.25
/** How close, in her own lengths, another boat may come before the tack is not clear. */
const SEPARATION = 2
/** She loses way going through the wind, and covers this share of her speed meanwhile. */
const SPEED_WHILE_TACKING = 0.6

/**
 * Whether the bearing she wants takes her through head to wind. Both sides of the wind
 * forward of the beam, so the short way round is the tack and not a gybe.
 */
export function wouldTack(boat: BoatState, bearing: Degrees, windDirection: Degrees): boolean {
  const wanted = angleDelta(windDirection, bearing)
  return (
    Math.sign(wanted) !== Math.sign(boat.twa) && Math.abs(wanted) < 90 && Math.abs(boat.twa) < 90
  )
}

/**
 * Whether she can tack onto `heading` without coming near anybody. Each boat is taken to
 * hold her present course and speed, which is what rule 13 entitles them to.
 *
 * A boat already close only stops the tack if it takes her closer still. Two boats
 * sailing side by side are both inside the limit, and if that alone forbade a tack
 * neither would ever tack: the windward one tacks away from the other and is clear.
 */
export function clearToTack(
  world: WorldState,
  boat: BoatState,
  spec: BoatSpec,
  heading: Degrees,
): boolean {
  const mine = scale(bearingToVector(heading), knotsToMps(boat.speed) * SPEED_WHILE_TACKING)
  const limit = SEPARATION * spec.length
  for (const other of world.boats) {
    if (other.id === boat.id) continue
    const theirs = scale(bearingToVector(other.heading), knotsToMps(other.speed))
    const now = distance(boat.position, other.position)
    for (let t = STEP; t <= LOOKAHEAD; t += STEP) {
      const here = add(boat.position, scale(mine, t))
      const there = add(other.position, scale(theirs, t))
      const apart = distance(here, there)
      if (apart < limit && apart < now) return false
    }
  }
  return true
}
