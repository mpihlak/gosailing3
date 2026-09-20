import { angleDelta, distance, type Segment, type Vec2 } from '@/foundation/geom'
import type { Degrees, Meters, Seconds } from '@/foundation/units'
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
import type { RightOfWayRule } from '@/domain/rules'
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
  /** Turns still owed. She may carry them, but she may not finish owing any. */
  readonly penalties: number
  /**
   * Whether her hull has been wholly on the course side of the finishing line since she
   * last went over it. Only matters to a boat who takes a turn below the line: coming
   * back with her bow alone is not coming back.
   */
  readonly clearedToFinish: boolean
  /** A penalty turn under way: which way round she is going and how far she has got. */
  readonly penaltyTurn?: PenaltyTurn
  readonly distanceSailed: Meters
}

export interface PenaltyTurn {
  readonly direction: 1 | -1
  /** Signed rotation since the turn began. */
  readonly swept: Degrees
  /** The furthest she has got round, so turning back can be seen. */
  readonly peak: Degrees
  /** She has passed head to wind: the tack the rule asks for. */
  readonly tacked: boolean
  /** She has passed dead downwind: the gybe. */
  readonly gybed: boolean
  /** How long she has gone without getting any further round. */
  readonly stalled: Seconds
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

/** A penalty turn is a full circle, and must take in a tack and a gybe besides. */
const FULL_TURN: Degrees = 360
/** Heading changes smaller than this are steering, not turning. */
const TURN_NOISE: Degrees = 0.02
/** Turning back this far unwinds the turn: the rule asks for one direction. */
const TURN_REVERSAL: Degrees = 10
/**
 * How long she may go without getting further round before the turn is abandoned.
 *
 * This is what makes it a turn rather than a tally. Counting every heading change while
 * a turn was owed let a boat pay it off with a mark rounding and a couple of gybes over
 * seven minutes of ordinary sailing, having never gone round at all: rule 44.2 asks her
 * to make the turns promptly, and promptly means without stopping to race in between.
 */
const TURN_PATIENCE: Seconds = 4

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
      clearedToFinish: false,
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
  readonly dt: Seconds
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

    next = trackPenaltyTurn(next, previousState, boat, input.dt, events)

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
      // None of this counts before the gun. A boat may sail where she likes while she
      // waits, and going above the line and round an end is ordinary pre-start
      // manoeuvring, not an offence.
      if (!started) return progress

      const clearBefore = hullClearOfLine(input.previousHull, line, input.halfBeam)
      const clearNow = hullClearOfLine(input.currentHull, line, input.halfBeam)

      /*
       * A boat starts when, her hull having been entirely on the pre-start side of the
       * line at or after her starting signal, she crosses the line from the pre-start
       * side to the course side.
       *
       * Which side she is on at the gun is the whole of it, and how she came to be there
       * does not matter: sailing round the end of the line puts her on the course side
       * exactly as crossing it does, and the line extends past its marks for deciding
       * that. Judging it by crossings alone let a boat reach the course side around the
       * end and then be started by a crossing she was not entitled to make, and the
       * string of her track would not have passed the starting marks.
       */
      const clearedPreStart = progress.clearedPreStart || clearBefore

      if (clearedPreStart && crossedLine(line, from, to) === 'forward') {
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

      // Rule 44.2: her hull shall be completely on the course side of the line before
      // she finishes. Sailing the last leg she is wholly on it for minutes at a time;
      // it only bites on a boat who has been over the line and taken a turn below it.
      const clearedToFinish =
        progress.clearedToFinish || hullClearOfLine(input.currentHull, stage.line, input.halfBeam)

      if (crossedLine(stage.line, from, to) !== 'forward') return { ...progress, clearedToFinish }

      if (progress.penalties > 0) {
        // She may not finish owing turns. She takes them where she likes, but she has to
        // come wholly back to the course side before crossing again.
        events.push({ kind: 'finishRefused', boatId, penalties: progress.penalties })
        return { ...progress, clearedToFinish: false }
      }

      if (!clearedToFinish) return progress

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

function withoutTurn(progress: BoatProgress): BoatProgress {
  if (!progress.penaltyTurn) return progress
  const cleared = { ...progress }
  delete (cleared as { penaltyTurn?: PenaltyTurn }).penaltyTurn
  return cleared
}

/**
 * Watch a boat go round. A penalty turn is a full circle in one direction, and since a
 * full circle passes head to wind and dead downwind it takes in the tack and the gybe
 * the rule asks for without either having to be looked for.
 *
 * Turns carry over: a boat owing two who keeps going round to seven hundred and twenty
 * degrees pays both without straightening up in between.
 */
function trackPenaltyTurn(
  progress: BoatProgress,
  previous: BoatState,
  boat: BoatState,
  dt: Seconds,
  events: SimEvent[],
): BoatProgress {
  if (progress.penalties <= 0) return withoutTurn(progress)

  const turned = angleDelta(previous.heading, boat.heading)
  const turn = progress.penaltyTurn

  if (!turn) {
    if (Math.abs(turned) < TURN_NOISE) return progress
    const direction: 1 | -1 = turned > 0 ? 1 : -1
    return {
      ...progress,
      penaltyTurn: {
        direction,
        swept: turned,
        peak: direction * turned,
        // The tick the turn begins on can be the tack itself.
        tacked: crossed(previous.twa, boat.twa, 0),
        gybed: crossed(previous.twa, boat.twa, 180),
        stalled: 0,
      },
    }
  }

  const swept = turn.swept + turned
  const round = turn.direction * swept
  const peak = Math.max(turn.peak, round)

  // Turning back out of it, or stopping to sail on, abandons the turn.
  if (round < peak - TURN_REVERSAL) return withoutTurn(progress)
  const stalled = round > turn.peak ? 0 : turn.stalled + dt
  if (stalled > TURN_PATIENCE) return withoutTurn(progress)

  const tacked = turn.tacked || crossed(previous.twa, boat.twa, 0)
  const gybed = turn.gybed || crossed(previous.twa, boat.twa, 180)

  if (round >= FULL_TURN && tacked && gybed) {
    const penalties = progress.penalties - 1
    events.push({ kind: 'penaltyCleared', boatId: progress.boatId, remaining: penalties })
    const carried = round - FULL_TURN
    return penalties > 0
      ? {
          ...progress,
          penalties,
          penaltyTurn: {
            direction: turn.direction,
            swept: turn.direction * carried,
            peak: carried,
            tacked: false,
            gybed: false,
            stalled: 0,
          },
        }
      : withoutTurn({ ...progress, penalties })
  }

  return { ...progress, penaltyTurn: { direction: turn.direction, swept, peak, tacked, gybed, stalled } }
}

/**
 * Whether the boat went through an angle to the wind between one tick and the next:
 * zero for head to wind, a hundred and eighty for dead downwind.
 */
function crossed(before: Degrees, after: Degrees, angle: Degrees): boolean {
  const from = angleDelta(angle, before)
  const to = angleDelta(angle, after)
  return Math.sign(from) !== Math.sign(to) && Math.abs(from) < 90 && Math.abs(to) < 90
}

/** A turn owed. In match racing an opponent's outstanding turn cancels it instead. */
export function penalise(
  progress: Record<BoatId, BoatProgress>,
  offender: BoatId,
  other: string,
  events: SimEvent[],
  rule?: RightOfWayRule,
): void {
  const theirs = progress[other]
  if (theirs && theirs.penalties > 0) {
    progress[other] = { ...theirs, penalties: theirs.penalties - 1 }
    events.push({ kind: 'penaltiesCancelled', boatId: offender, otherId: other })
    return
  }

  const mine = progress[offender]
  if (mine) progress[offender] = { ...mine, penalties: mine.penalties + 1 }
  events.push(rule === undefined
    ? { kind: 'penalised', boatId: offender, otherId: other }
    : { kind: 'penalised', boatId: offender, otherId: other, rule })
}
