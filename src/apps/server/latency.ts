import { nearestRank } from '@/foundation/rank'

/** How a connection's round trips have been running. Milliseconds. */
export interface LatencySummary {
  readonly samples: number
  readonly p50: number
  readonly p90: number
  readonly max: number
}

/**
 * Round trips, kept per connection.
 *
 * Measured with websocket ping and pong, which the far end answers in its network layer
 * rather than in its page. So this is the state of the line, not of whoever is on it: a
 * browser stuck in a long frame still answers a ping at once.
 *
 * The middle of the spread is the least interesting part of it. A line that answers in
 * seventy milliseconds every time feels steered; one that answers anywhere between a
 * hundred and seven hundred feels like it is arguing, and both can share a median.
 */
export class Latency {
  private readonly trips = new Map<string, number[]>()

  /** How many of the most recent round trips are kept for each connection. */
  constructor(private readonly keep = 600) {}

  record(id: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return
    const kept = this.trips.get(id) ?? []
    kept.push(ms)
    if (kept.length > this.keep) kept.splice(0, kept.length - this.keep)
    this.trips.set(id, kept)
  }

  forget(id: string): void {
    this.trips.delete(id)
  }

  /** Over the whole window, or over the last `overLast` of it. */
  summary(id: string, overLast = Number.POSITIVE_INFINITY): LatencySummary | undefined {
    const kept = this.trips.get(id)
    if (!kept?.length) return undefined
    const recent = kept.slice(Math.max(0, kept.length - overLast))
    const sorted = [...recent].sort((a, b) => a - b)
    return {
      samples: sorted.length,
      p50: nearestRank(sorted, 0.5),
      p90: nearestRank(sorted, 0.9),
      max: sorted[sorted.length - 1]!,
    }
  }
}
