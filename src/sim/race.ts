import { distance, type Segment, type Vec2 } from '@/foundation/geom'
import type { Meters, Seconds } from '@/foundation/units'
import {
  bowPosition,
  hullCentreline,
  tackOf,
  type BoatId,
  type BoatSpec,
  type BoatState,
} from '@/domain/boat'
import {
  crossedLine,
  pastMark,
  sideOfLine,
  sideOfMark,
  type Course,
  type CourseStage,
  type RaceLine,
} from '@/domain/course'
import type { SimEvent } from './events'

export type RacePhase = 'prestart' | 'racing' | 'complete'
export type BoatStatus = 'prestart' | 'overEarly' | 'racing' | 'finished'

export interface BoatProgress {
  readonly boatId: BoatId
  readonly status: BoatStatus
  /** Which stage of the course the boat is working on. */
  readonly stageIndex: number
  readonly startTime?: Seconds
  readonly finishTime?: Seconds
  readonly place?: number
  /** Whether the boat has passed the mark on the required side, and so is half round it. */
  readonly passedMark: boolean
  /**
   * Whether her hull has been entirely on the pre-start side at or after the gun. Until
   * it has, she cannot start, however many times she crosses the line.
   */
  readonly clearedPreStart: boolean
  readonly penalties: number
  readonly distanceSailed: Meters
}

export interface RaceState {
  readonly phase: RacePhase
  readonly progress: Readonly<Record<BoatId, BoatProgress>>
  readonly finishOrder: readonly BoatId[]
}

/**
 * How close to the mark a crossing has to happen to count as rounding it rather than
 * merely sailing past on that side of the course.
 */
const ROUNDING_RANGE: Meters = 120

export function createRaceState(boatIds: readonly BoatId[]): RaceState {
  const progress: Record<BoatId, BoatProgress> = {}
  for (const boatId of boatIds) {
    progress[boatId] = {
      boatId,
      status: 'prestart',
      stageIndex: 0,
      passedMark: false,
      clearedPreStart: false,
      penalties: 0,
      distanceSailed: 0,
    }
  }
  return { phase: 'prestart', progress, finishOrder: [] }
}

export interface RaceStepInput {
  readonly course: Course
  readonly specs: Readonly<Record<BoatId, BoatSpec>>
  readonly previous: readonly BoatState[]
  readonly current: readonly BoatState[]
  /** Elapsed race time. Negative before the gun. */
  readonly raceTime: Seconds
}

export interface RaceStepResult {
  readonly race: RaceState
  readonly events: SimEvent[]
}

export function stepRace(race: RaceState, input: RaceStepInput): RaceStepResult {
  const { course, specs, previous, current, raceTime } = input
  const events: SimEvent[] = []
  const started = raceTime >= 0

  if (race.phase === 'prestart' && started) events.push({ kind: 'raceStarted' })

  const progress: Record<BoatId, BoatProgress> = {}
  const finishOrder = [...race.finishOrder]

  for (const boat of current) {
    const before = race.progress[boat.id]
    const spec = specs[boat.id]
    const previousState = previous.find((candidate) => candidate.id === boat.id)
    if (!before || !spec || !previousState) {
      if (before) progress[boat.id] = before
      continue
    }

    let next: BoatProgress = {
      ...before,
      distanceSailed: before.distanceSailed + distance(previousState.position, boat.position),
    }

    if (tackOf(previousState.twa) !== tackOf(boat.twa) && Math.abs(boat.twa) > 5) {
      events.push({
        kind: 'tacked',
        boatId: boat.id,
        from: tackOf(previousState.twa),
        to: tackOf(boat.twa),
      })
    }

    const stage = course.stages[next.stageIndex]
    if (stage) {
      next = advanceStage({
        progress: next,
        stage,
        from: bowPosition(previousState, spec),
        to: bowPosition(boat, spec),
        previousHull: hullCentreline(previousState, spec),
        currentHull: hullCentreline(boat, spec),
        halfBeam: spec.beam / 2,
        started,
        raceTime,
        events,
        finishOrder,
      })
    }

    progress[boat.id] = next
  }

  const everyoneHome = Object.values(progress).every((boat) => boat.status === 'finished')
  const phase: RacePhase = everyoneHome ? 'complete' : started ? 'racing' : 'prestart'
  if (phase === 'complete' && race.phase !== 'complete') events.push({ kind: 'raceFinished' })

  return { race: { phase, progress, finishOrder }, events }
}

interface StageInput {
  readonly progress: BoatProgress
  readonly stage: CourseStage
  readonly from: Vec2
  readonly to: Vec2
  readonly previousHull: Segment
  readonly currentHull: Segment
  readonly halfBeam: Meters
  readonly started: boolean
  readonly raceTime: Seconds
  readonly events: SimEvent[]
  readonly finishOrder: BoatId[]
}

function advanceStage(input: StageInput): BoatProgress {
  const { progress, stage, from, to, started, raceTime, events, finishOrder } = input
  const boatId = progress.boatId

  switch (stage.kind) {
    case 'start': {
      const { line } = stage
      const clearBefore = hullClearOfLine(input.previousHull, line, input.halfBeam)
      const clearNow = hullClearOfLine(input.currentHull, line, input.halfBeam)

      /*
       * A boat starts when, her hull having been entirely on the pre-start side of the
       * line at or after her starting signal, she crosses the line from the pre-start
       * side to the course side.
       *
       * Which side she is on is the whole of it, and how she came to be there does not
       * matter: sailing round the end of the line puts her on the course side exactly as
       * crossing it does. Judging this by crossings alone let a boat reach the course
       * side around the end and then be started by a crossing she was not entitled to
       * make, and the string of her track would not have passed the starting marks.
       */
      const clearedPreStart = progress.clearedPreStart || (started && clearBefore)

      if (started && clearedPreStart && crossedLine(line, from, to) === 'forward') {
        events.push({ kind: 'boatStarted', boatId, late: raceTime })
        return {
          ...progress,
          status: 'racing',
          startTime: raceTime,
          clearedPreStart: true,
          stageIndex: progress.stageIndex + 1,
        }
      }

      // Being on the course side is only an offence while she is not entitled to be
      // there. Once she has been wholly behind the line at or after the gun she is
      // crossing it, and a boat in the act of starting is not over early.
      if (!clearNow && !clearedPreStart && progress.status !== 'overEarly') {
        events.push({ kind: 'overEarly', boatId })
        return { ...progress, status: 'overEarly', clearedPreStart }
      }
      if (clearNow && progress.status === 'overEarly') {
        events.push({ kind: 'cleared', boatId })
        return { ...progress, status: 'prestart', clearedPreStart }
      }
      return { ...progress, clearedPreStart }
    }

    case 'mark': {
      if (progress.status !== 'racing') return progress

      const { mark, approach } = stage
      if (distance(to, mark.position) > ROUNDING_RANGE) return progress

      // A rounding is two crossings of the line through the mark square to the leg: out
      // past the mark on the side that leaves it where the rules require, then back the
      // other way on the opposite side. Judging it this way does not care whether the
      // boat turned tightly or sailed a wide arc, only that she went round.
      const wasPast = pastMark(mark.position, approach, from) > 0
      const isPast = pastMark(mark.position, approach, to) > 0
      if (wasPast === isPast) return progress

      const side = sideOfMark(mark.position, approach, to)
      const required = mark.rounding === 'port' ? -1 : 1

      if (!progress.passedMark) {
        // Going past the mark, on the side that leaves it where it must be left.
        return isPast && Math.sign(side) === required ? { ...progress, passedMark: true } : progress
      }

      if (isPast) return progress

      if (Math.sign(side) === required) {
        // Back to leeward the same side she went up: she thought better of it, and has
        // not rounded anything. Start the rounding over.
        return { ...progress, passedMark: false }
      }

      events.push({ kind: 'markRounded', boatId, markId: mark.id })
      return { ...progress, stageIndex: progress.stageIndex + 1, passedMark: false }
    }

    case 'finish': {
      if (progress.status !== 'racing') return progress
      if (crossedLine(stage.line, from, to) !== 'forward') return progress

      finishOrder.push(boatId)
      const place = finishOrder.length
      events.push({ kind: 'boatFinished', boatId, place })
      return {
        ...progress,
        status: 'finished',
        finishTime: raceTime,
        place,
        stageIndex: progress.stageIndex + 1,
      }
    }
  }
}

/**
 * Whether the whole hull is on the pre-start side. The hull is a capsule, so its nearest
 * point to the line is half a beam ahead of whichever end is closer.
 */
function hullClearOfLine(hull: Segment, line: RaceLine, halfBeam: Meters): boolean {
  return sideOfLine(line, hull.from) < -halfBeam && sideOfLine(line, hull.to) < -halfBeam
}

export function addPenalty(progress: BoatProgress): BoatProgress {
  return { ...progress, penalties: progress.penalties + 1 }
}
