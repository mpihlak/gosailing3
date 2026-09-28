import type { Seconds } from '@/foundation/units'
import type { BoatId, BoatState } from '@/domain/boat'
import type { BoatStatus, ScenarioSpec, TimedEvent } from '@/sim'

/**
 * What the two ends of a regatta say to each other.
 *
 * The server owns the world and the clock. A client sends one number and is told where
 * every boat is; it never runs the race itself. Lockstep would be tempting — the
 * simulation is pure, fixed-step and seeded — but `Math.sin` and its neighbours are not
 * required to be correctly rounded, and two browsers would drift apart within a leg with
 * nothing to show for it.
 */

/** How often the server sends the fleet, in messages per second of the player's time. */
export const SNAPSHOT_HZ = 20
/** And how often a client says where her helm is, whether or not it has moved. */
export const HELM_HZ = 20

export type Role = 'racer' | 'observer'
export type Phase = 'lobby' | 'racing' | 'results'

/** Why a boat is no longer sailing. */
export type Outcome = 'finished' | 'timedOut' | 'retired'

export interface Sailor {
  readonly id: BoatId
  readonly name: string
  readonly role: Role
  readonly color: string
  /** True while her race is the next one rather than the one being sailed. */
  readonly waiting: boolean
}

export interface Placing {
  readonly boatId: BoatId
  readonly name: string
  readonly outcome: Outcome
  readonly place?: number
  /** Her elapsed time in the player's seconds, when she finished. */
  readonly elapsed?: Seconds
}

/**
 * How a boat stands in the race, as much of it as anyone watching needs.
 *
 * Not the whole of what the simulation keeps. The rest — how far she has sailed, how far
 * round a penalty turn she is — changes every tick, so sending it would put the race on
 * every snapshot and there would be no point having asked whether it changed.
 */
export interface BoatReport {
  readonly status: BoatStatus
  readonly stageIndex: number
  readonly penalties: number
  readonly place?: number
  /** Her elapsed time, in simulated seconds, once she is home. */
  readonly finishTime?: Seconds
}

export type RaceReport = Readonly<Record<BoatId, BoatReport>>

export type ClientMessage =
  | { readonly kind: 'join'; readonly name: string; readonly role?: Role }
  | { readonly kind: 'helm'; readonly rudder: number }

export type ServerMessage =
  /** First thing a client hears: who she is and what is going on. */
  | {
      readonly kind: 'welcome'
      readonly you: BoatId
      readonly role: Role
      readonly phase: Phase
      readonly fleet: readonly Sailor[]
    }
  | { readonly kind: 'fleet'; readonly phase: Phase; readonly fleet: readonly Sailor[] }
  /**
   * A race is on. The scenario is the whole of it: the client builds the same course, the
   * same boats and the same wind from the seed, so none of that is ever sent again.
   */
  | { readonly kind: 'racing'; readonly scenario: ScenarioSpec }
  | {
      readonly kind: 'snapshot'
      readonly time: Seconds
      readonly boats: readonly BoatState[]
      /** Sent only when it has changed, which is when a boat starts, rounds or finishes. */
      readonly race?: RaceReport
      readonly events: readonly TimedEvent[]
    }
  | { readonly kind: 'results'; readonly places: readonly Placing[] }

/** A message and the connections it goes to. */
export interface Addressed {
  readonly to: readonly BoatId[]
  readonly message: ServerMessage
}
