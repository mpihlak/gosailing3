import { type Vec2 } from '@/foundation/geom'
import type { Meters, Seconds } from '@/foundation/units'
import { pastMark, sideOfLine, type CourseStage } from '@/domain/course'
import type { BoatId } from '@/domain/boat'
import type { SimContext, WorldState } from './world'

export interface Standing {
  readonly boatId: BoatId
  /** Where she lies now, finished or not. */
  readonly place: number
  readonly finished: boolean
  /** Out of the race after fouling a boat still racing once she had finished. */
  readonly dnf: boolean
  readonly finishTime?: Seconds
  readonly penalties: number
}

/**
 * How far a boat still has to go to get this stage done, along the course's own axis:
 * up or down the leg to the mark, or square to the line. Distance to a point would count
 * a boat out to one side as further behind than she is, and one making for an end of the
 * finish line as further than one making for its middle. The axis is the course's and not
 * the wind's, so a shift does not reshuffle the fleet.
 */
function toGoOn(stage: CourseStage | undefined, position: Vec2): Meters {
  if (!stage) return 0
  if (stage.kind === 'mark') return -pastMark(stage.mark.position, stage.approach, position)
  return -sideOfLine(stage.line, position)
}

/**
 * The order the fleet is in, at any moment and not only at the end. Boats already home
 * keep the places they finished in; the rest are ranked by how much of the course they
 * have put behind them, and then by how close they are to the next thing they have to
 * get to. A boat scored DNF is out of it, and goes to the bottom.
 */
export function standings(ctx: SimContext, world: WorldState): Standing[] {
  const ranked = world.boats
    .map((boat) => {
      const progress = world.race.progress[boat.id]
      // Past the mark she is on her way to the next one, though the rounding is not done
      // until she has crossed back.
      const leg = (progress?.stageIndex ?? 0) + (progress?.passedMark ? 1 : 0)
      const toGo = toGoOn(ctx.course.stages[leg], boat.position)
      return { boat, progress, leg, toGo }
    })
    .sort((one, two) => {
      const first = one.progress
      const second = two.progress
      if (!first || !second) return 0

      // Home already, and in the order they crossed.
      if (first.place !== undefined && second.place !== undefined) return first.place - second.place
      if (first.place !== undefined) return -1
      if (second.place !== undefined) return 1
      if ((first.status === 'dnf') !== (second.status === 'dnf'))
        return first.status === 'dnf' ? 1 : -1

      // Further round the course leads.
      if (one.leg !== two.leg) return two.leg - one.leg
      return one.toGo - two.toGo
    })

  return ranked.map((entry, index) => ({
    boatId: entry.boat.id,
    place: index + 1,
    finished: entry.progress?.status === 'finished',
    dnf: entry.progress?.status === 'dnf',
    ...(entry.progress?.finishTime === undefined ? {} : { finishTime: entry.progress.finishTime }),
    penalties: entry.progress?.penalties ?? 0,
  }))
}
