import type { BoatId, Tack } from '@/domain/boat'
import type { ContactKind } from '@/domain/collision'
import type { Seconds } from '@/foundation/units'

/**
 * Everything the simulation has to say about a tick. The UI, the scoreboard, the AI and
 * the rules engine all read these rather than inspecting state, so a new consumer never
 * means a change to the simulation.
 *
 * Events are plain data: they serialize, so they also travel over a network and into a
 * replay without translation.
 */
export type SimEvent =
  | { readonly kind: 'raceStarted' }
  | { readonly kind: 'boatStarted'; readonly boatId: BoatId; readonly late: Seconds }
  | { readonly kind: 'overEarly'; readonly boatId: BoatId }
  | { readonly kind: 'cleared'; readonly boatId: BoatId }
  | { readonly kind: 'markRounded'; readonly boatId: BoatId; readonly markId: string }
  | { readonly kind: 'boatFinished'; readonly boatId: BoatId; readonly place: number }
  | { readonly kind: 'raceFinished' }
  | { readonly kind: 'tacked'; readonly boatId: BoatId; readonly from: Tack; readonly to: Tack }
  | {
      readonly kind: 'contact'
      readonly boatId: BoatId
      readonly otherId: string
      readonly with: ContactKind
    }

export type SimEventKind = SimEvent['kind']

/** An event with the moment it happened attached. */
export type TimedEvent = SimEvent & {
  readonly tick: number
  readonly time: Seconds
}

export function eventsOfKind<K extends SimEventKind>(
  events: readonly TimedEvent[],
  kind: K,
): Extract<TimedEvent, { kind: K }>[] {
  return events.filter((event): event is Extract<TimedEvent, { kind: K }> => event.kind === kind)
}
