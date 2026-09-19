import { distance, type Vec2 } from '@/foundation/geom'
import type { Meters, Seconds } from '@/foundation/units'
import { bowPosition, tackOf, type BoatId, type BoatSpec, type BoatState } from '@/domain/boat'
import { crossedLine, pastMark, sideOfMark, type Course, type CourseStage } from '@/domain/course'
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
      const crossing = crossedLine(stage.line, from, to)

      if (!started) {
        // Over the line early. She stays over until she comes back and clears it.
        if (crossing === 'forward' && progress.status !== 'overEarly') {
          events.push({ kind: 'overEarly', boatId })
          return { ...progress, status: 'overEarly' }
        }
        if (crossing === 'backward' && progress.status === 'overEarly') {
          events.push({ kind: 'cleared', boatId })
          return { ...progress, status: 'prestart' }
        }
        return progress
      }

      if (crossing === 'backward' && progress.status === 'overEarly') {
        events.push({ kind: 'cleared', boatId })
        return { ...progress, status: 'prestart' }
      }
      if (crossing === 'forward' && progress.status !== 'overEarly') {
        events.push({ kind: 'boatStarted', boatId, late: raceTime })
        return { ...progress, status: 'racing', startTime: raceTime, stageIndex: progress.stageIndex + 1 }
      }
      return progress
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

export function addPenalty(progress: BoatProgress): BoatProgress {
  return { ...progress, penalties: progress.penalties + 1 }
}
