import type { Vec2 } from '@/foundation/geom'
import type { Degrees, Meters } from '@/foundation/units'

/** The side a boat must leave the mark on as it rounds. */
export type RoundingSide = 'port' | 'starboard'

export interface Mark {
  readonly id: string
  readonly name: string
  readonly position: Vec2
  readonly rounding: RoundingSide
  /** Physical size, used for contact. The rules zone is a separate, larger circle. */
  readonly radius: Meters
}

export interface RaceLine {
  readonly id: string
  readonly name: string
  /** The pin end, which is the left-hand end seen from the course. */
  readonly from: Vec2
  /** The committee boat end. */
  readonly to: Vec2
  /** Unit vector along which a legal crossing travels. */
  readonly normal: Vec2
}

/**
 * A course is an ordered list of things to do. Adding a leeward gate or a reaching mark
 * means adding a stage, not teaching the race logic about a new course shape.
 */
export type CourseStage =
  | { readonly kind: 'start'; readonly line: RaceLine }
  | {
      readonly kind: 'mark'
      readonly mark: Mark
      /** Direction of travel along the leg that leads to this mark. */
      readonly approach: Degrees
    }
  | { readonly kind: 'finish'; readonly line: RaceLine }

export interface Obstacle {
  readonly id: string
  readonly position: Vec2
  readonly radius: Meters
}

export interface Bounds {
  readonly min: Vec2
  readonly max: Vec2
}

export interface Course {
  readonly name: string
  readonly stages: readonly CourseStage[]
  readonly marks: readonly Mark[]
  readonly obstacles: readonly Obstacle[]
  /** The extent of the racing area, used to frame the view and to keep boats honest. */
  readonly bounds: Bounds
}

export function stageAt(course: Course, index: number): CourseStage | undefined {
  return course.stages[index]
}

export function isFinished(course: Course, stageIndex: number): boolean {
  return stageIndex >= course.stages.length
}
