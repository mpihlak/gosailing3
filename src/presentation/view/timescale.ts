/**
 * How fast the race runs against the clock. The simulation still steps at its fixed rate;
 * this only decides how much time is handed to it each frame, so the physics is identical
 * however fast you watch it.
 */

/** "1×", "0.5×", "16×" — never "1.0×". */
export function formatRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`
}
