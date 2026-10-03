/**
 * The value a fraction of the way up a sorted list, by nearest rank: it needs no
 * interpolation and cannot invent a number nobody saw.
 */
export function nearestRank(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!
}
