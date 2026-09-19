import type { Degrees, Knots } from '@/foundation/units'

/**
 * A boat's measured performance: how fast it sails at a given true wind angle and
 * true wind speed. Tables come from real polar data, so they stop at the angles a
 * boat can actually hold. Everything closer to the wind than `beat` is derived.
 */
export interface PolarTable {
  readonly name: string
  /** True wind speeds the table is measured at, ascending. */
  readonly windSpeeds: readonly Knots[]
  /** True wind angles the table is measured at, ascending, 0 to 180. */
  readonly angles: readonly Degrees[]
  /** speeds[windIndex][angleIndex], in knots. */
  readonly speeds: readonly (readonly Knots[])[]
  /** Best upwind performance per wind speed: the angle to sail and the VMG it yields. */
  readonly beat: readonly BeatPoint[]
}

export interface BeatPoint {
  readonly angle: Degrees
  readonly vmg: Knots
}

export function validateTable(table: PolarTable): void {
  const { name, windSpeeds, angles, speeds, beat } = table
  if (windSpeeds.length === 0 || angles.length === 0) {
    throw new Error(`polar table "${name}" has no data`)
  }
  if (speeds.length !== windSpeeds.length) {
    throw new Error(
      `polar table "${name}" has ${speeds.length} speed rows for ${windSpeeds.length} wind speeds`,
    )
  }
  for (const [index, row] of speeds.entries()) {
    if (row.length !== angles.length) {
      throw new Error(
        `polar table "${name}" row ${index} has ${row.length} speeds for ${angles.length} angles`,
      )
    }
  }
  if (beat.length !== windSpeeds.length) {
    throw new Error(`polar table "${name}" needs one beat point per wind speed`)
  }
  if (!isAscending(windSpeeds)) throw new Error(`polar table "${name}" wind speeds must ascend`)
  if (!isAscending(angles)) throw new Error(`polar table "${name}" angles must ascend`)
}

function isAscending(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value > (values[index - 1] as number))
}
