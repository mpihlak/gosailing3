/**
 * Seeded randomness. Every random choice in the game traces back to one scenario seed,
 * so a race can be replayed, shared, or re-run in a test and behave identically.
 *
 * Streams are split by label rather than drawn from one sequence. Adding an AI boat
 * therefore cannot shift the wind, and a stored replay keeps working when unrelated
 * parts of the game start drawing random numbers.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform in [min, max). */
  range(min: number, max: number): number
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number
  bool(probability?: number): boolean
  pick<T>(items: readonly T[]): T
  /** An independent stream derived from this one and the label. */
  split(label: string): Rng
}

/** FNV-1a, used to turn a seed string or stream label into a 32-bit state. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function toSeed(seed: number | string): number {
  return typeof seed === 'number' ? seed >>> 0 : hashString(seed)
}

export function createRng(seed: number | string): Rng {
  let state = toSeed(seed) || 0x9e3779b9

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    bool: (probability = 0.5) => next() < probability,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick() needs a non-empty list')
      return items[Math.floor(next() * items.length)] as T
    },
    split: (label) => createRng((toSeed(seed) ^ hashString(label)) >>> 0),
  }
}
