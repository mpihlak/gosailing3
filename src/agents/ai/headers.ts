import { angleDelta, normalizeBearing } from '@/foundation/geom'
import type { Degrees, Seconds } from '@/foundation/units'
import type { BoatSpec, BoatState } from '@/domain/boat'
import type { WindSample } from '@/domain/wind'
import type { NavigationPlan } from './navigator'
import { wouldTack } from './tacking'

/** How far the wind has to head her from the best she has had on this tack. */
const HEADER: Degrees = 10
/**
 * How long she stays on a tack before a header may tack her again, in simulated
 * seconds. A tack costs her way, and tacking straight back on the next shift would
 * spend it twice for nothing.
 */
const HOLD: Seconds = 40

/**
 * Tacking on headers, upwind. On port a header is the wind veering and on starboard it
 * backing, either way forcing her to bear away from the mark. She keeps the most lifted
 * wind she has had on her tack, and once the wind is more than `HEADER` worse than that,
 * the other tack is the lifted one.
 */
export class HeaderWatch {
  private tack:
    | { readonly side: number; readonly since: Seconds; readonly byHeader: boolean; best: Degrees }
    | undefined
  /** Whether the tack she is making was a header's, until she is round. */
  private tacking = false

  /**
   * The course to steer instead of the plan's, if any: close-hauled on the other tack
   * when she is beating and headed enough to want it, or on the tack a header put her on
   * while she holds it. Asked every tick, so it keeps track of her tack and her best
   * wind even when the answer is nothing.
   */
  tackFor(
    time: Seconds,
    boat: BoatState,
    spec: BoatSpec,
    wind: WindSample,
    plan: NavigationPlan,
  ): Degrees | undefined {
    const side = Math.sign(boat.twa || 1)
    const tack = this.tack
    // A new tack, or a clock that went backwards: a race begun again.
    if (!tack || tack.side !== side || time < tack.since) {
      this.tack = { side, since: time, byHeader: this.tacking, best: wind.direction }
      this.tacking = false
      return undefined
    }
    // Only a tack asked for on the tick she went round counts as the header's.
    this.tacking = false
    // Positive is a header: the wind moved round towards where she is heading.
    const headed = side * angleDelta(tack.best, wind.direction)
    if (headed < 0) tack.best = wind.direction
    if (plan.reason !== 'beating') return undefined
    const closeHauled = (on: number) =>
      normalizeBearing(wind.direction + on * spec.polar.beatAngle(wind.speed))
    const held = time - tack.since < HOLD
    // On a tack a header gave her, she holds it rather than let the corridor turn her
    // straight back. The layline and the mark are not beating, and still have their way.
    if (held) {
      return tack.byHeader && wouldTack(boat, plan.bearing, wind.direction)
        ? closeHauled(side)
        : undefined
    }
    if (headed <= HEADER) return undefined
    this.tacking = true
    return closeHauled(-side)
  }
}
