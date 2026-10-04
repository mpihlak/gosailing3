import type { Rng } from '@/foundation/rng'
import type { Meters } from '@/foundation/units'

/** The most gybes she plans on one run, for the most restless skipper. */
const MOST_GYBES = 3
/**
 * Where on the run a gybe may fall, as shares of the distance still to go when she
 * starts it. Not straight after the mark, where the fleet is bunched, and not so late
 * that she cannot get back to the line on the other gybe.
 */
const EARLIEST = 0.9
const LATEST = 0.2
/** How far past its point, as a share of the run, a gybe the traffic held up is given up. */
const PATIENCE = 0.1

/**
 * The gybes she means to make on a run, drawn at random when the run begins: how many from
 * how restless she is, and where. Nothing about the wind goes into it. The point is that
 * boats rounding together do not all sail the same line to the finish.
 */
export class GybePlan {
  /** The distances to go at which she gybes, the next one first. */
  private readonly points: Meters[]
  private readonly run: Meters

  constructor(rng: Rng, restlessness: number, run: Meters) {
    const count = Math.floor(rng.range(0, 1 + MOST_GYBES * restlessness))
    this.points = Array.from({ length: count }, () => rng.range(LATEST, EARLIEST) * run).sort(
      (a, b) => b - a,
    )
    this.run = run
  }

  /** Whether she is due to gybe with this far still to go. */
  due(toGo: Meters): boolean {
    // A gybe the traffic held up for too long is not worth making late.
    while (this.points.length > 0 && toGo < this.points[0]! - PATIENCE * this.run)
      this.points.shift()
    const next = this.points[0]
    return next !== undefined && toGo <= next
  }

  /** The gybe that was due has been made. */
  made(): void {
    this.points.shift()
  }
}
