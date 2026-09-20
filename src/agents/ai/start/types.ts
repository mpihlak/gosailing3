import type { Degrees, Seconds } from '@/foundation/units'
import type { BoatSpec, BoatState } from '@/domain/boat'
import type { RaceLine } from '@/domain/course'
import type { WindSample } from '@/domain/wind'

/** Everything a start strategy is allowed to look at. */
export interface StartContext {
  readonly boat: BoatState
  readonly spec: BoatSpec
  /** The wind where the boat is, now. */
  readonly wind: WindSample
  readonly line: RaceLine
  /** Seconds until the gun. Negative once it has fired. */
  readonly timeToStart: Seconds
  /** Whether the gun has gone. She may still be behind the line when it does. */
  readonly gunFired: boolean
}

/**
 * What the boat is doing about her start. The phase is for the lab and the tests to read;
 * the bearing is the whole of the instruction.
 */
export interface StartPlan {
  readonly bearing: Degrees
  readonly phase: StartPhase
}

export type StartPhase =
  /** Sailing away from the line, with time in hand. */
  | 'reaching'
  /** Coming back at the line, timed to arrive with the gun. */
  | 'approaching'
  /** On the approach but early, sailing lower to lose the time. */
  | 'burning'
  /** The gun has gone and she is on her way. */
  | 'onTheWind'

/**
 * How a boat goes about starting. There will be more of these — a committee boat end
 * start, a timed run from the middle, a conservative start behind the fleet — and they
 * differ only in the bearing they ask for, so they share this shape and nothing else.
 */
export interface StartStrategy {
  readonly name: string
  plan(context: StartContext): StartPlan
}
