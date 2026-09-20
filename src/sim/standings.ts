import { distance, type Vec2 } from '@/foundation/geom'
import type { Meters, Seconds } from '@/foundation/units'
import { lineMidpoint, type CourseStage } from '@/domain/course'
import type { BoatId } from '@/domain/boat'
import type { SimContext, WorldState } from './world'

export interface Standing {
  readonly boatId: BoatId
  /** Where she lies now, finished or not. */
  readonly place: number
  readonly finished: boolean
  readonly finishTime?: Seconds
  readonly penalties: number
}

/** What a boat on this stage is sailing at. */
function targetOf(stage: CourseStage | undefined): Vec2 | undefined {
  if (!stage) return undefined
  return stage.kind === 'mark' ? stage.mark.position : lineMidpoint(stage.line)
}

/**
 * The order the fleet is in, at any moment and not only at the end. Boats already home
 * keep the places they finished in; the rest are ranked by how much of the course they
 * have put behind them, and then by how close they are to the next thing they have to
 * get to.
 */
export function standings(ctx: SimContext, world: WorldState): Standing[] {
  const ranked = world.boats
    .map((boat) => {
      const progress = world.race.progress[boat.id]
      const target = targetOf(ctx.course.stages[progress?.stageIndex ?? 0])
      const toGo: Meters = target ? distance(boat.position, target) : 0
      return { boat, progress, toGo }
    })
    .sort((one, two) => {
      const first = one.progress
      const second = two.progress
      if (!first || !second) return 0

      // Home already, and in the order they crossed.
      if (first.place !== undefined && second.place !== undefined) return first.place - second.place
      if (first.place !== undefined) return -1
      if (second.place !== undefined) return 1

      // Further round the course leads.
      if (first.stageIndex !== second.stageIndex) return second.stageIndex - first.stageIndex
      return one.toGo - two.toGo
    })

  return ranked.map((entry, index) => ({
    boatId: entry.boat.id,
    place: index + 1,
    finished: entry.progress?.status === 'finished',
    ...(entry.progress?.finishTime === undefined ? {} : { finishTime: entry.progress.finishTime }),
    penalties: entry.progress?.penalties ?? 0,
  }))
}
