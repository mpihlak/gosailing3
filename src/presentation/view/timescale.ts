/**
 * How fast the race runs against the clock. The simulation still steps at its fixed rate;
 * this only decides how much time is handed to it each frame, so the physics is identical
 * however fast you watch it.
 */
export const RATE_LADDER = [0.25, 0.5, 1, 2, 4, 8, 16] as const

export const NORMAL_RATE = 1

export function fasterThan(rate: number): number {
  return RATE_LADDER.find((step) => step > rate) ?? (RATE_LADDER[RATE_LADDER.length - 1] as number)
}

export function slowerThan(rate: number): number {
  return [...RATE_LADDER].reverse().find((step) => step < rate) ?? (RATE_LADDER[0] as number)
}

/** "1×", "0.5×", "16×" — never "1.0×". */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`
}
