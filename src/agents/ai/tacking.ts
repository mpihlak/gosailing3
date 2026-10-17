import { add, angleDelta, bearingToVector, distance, dot, scale, sub } from '@/foundation/geom'
import { knotsToMps, type Degrees, type Seconds } from '@/foundation/units'
import type { BoatSpec, BoatState } from '@/domain/boat'
import type { WindSample } from '@/domain/wind'
import type { SimContext, WorldState } from '@/sim'
import { obstacleShare } from './obstacles'

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
 * How close, in her own lengths between the middles, a boat that will be clear astern of
 * her on the new tack may come. Rule 12 has that boat keep clear once she is round, so
 * less room will do than from a boat she would tack in front of or beside.
 */
const ASTERN_SEPARATION = 1.5

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
  const ahead = bearingToVector(heading)
  const mine = scale(ahead, knotsToMps(boat.speed) * SPEED_WHILE_TACKING)
  // The tack she will be on: the wind on the other side of her.
  const newTack = -Math.sign(boat.twa || 1)
  for (const other of world.boats) {
    if (other.id === boat.id) continue
    const theirs = scale(bearingToVector(other.heading), knotsToMps(other.speed))
    const now = distance(boat.position, other.position)
    // A length or more behind her on the tack she is going onto, the other boat will be
    // clear astern once she is round. Kept from tacking on top of her, she turned back
    // from a tack thirty metres ahead of a boat and lost the layline. Still the whole
    // look-ahead: checked only for the tack itself, she tacked in front of boats that
    // rolled her to leeward while she was slow, and fouls after the gun rose a sixth.
    const astern =
      Math.sign(other.twa || 1) === newTack &&
      dot(sub(other.position, boat.position), ahead) < -spec.length
    const limit = (astern ? ASTERN_SEPARATION : SEPARATION) * spec.length
    for (let t = STEP; t <= LOOKAHEAD; t += STEP) {
      const here = add(boat.position, scale(mine, t))
      const there = add(other.position, scale(theirs, t))
      const apart = distance(here, there)
      if (apart < limit && apart < now) return false
    }
  }
  return true
}

/** Whether a tack onto `heading` is clear of the other boats, the committee boat and obstacles. */
export function tackIsClear(
  ctx: SimContext,
  world: WorldState,
  boat: BoatState,
  spec: BoatSpec,
  wind: WindSample,
  heading: Degrees,
): boolean {
  return (
    clearToTack(world, boat, spec, heading) && obstacleShare(ctx, boat, spec, wind, heading) >= 1
  )
}
