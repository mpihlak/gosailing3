import { normalizeBearing } from '@/foundation/geom'
import type { Degrees, Knots } from '@/foundation/units'
import type { WindField, WindModifier, WindSample } from './types'

/**
 * Compose a base wind with any number of modifiers. Each modifier sees the result of
 * the ones before it, so ordering is meaningful: a gust that adds five knots on top of
 * a gradient behaves differently from one applied underneath it.
 */
export function createWindField(base: WindSample, modifiers: readonly WindModifier[]): WindField {
  return {
    sample(position, time) {
      let sample = base
      for (const modify of modifiers) {
        sample = modify(sample, position, time)
      }
      return {
        direction: normalizeBearing(sample.direction),
        speed: Math.max(0, sample.speed),
      }
    },
  }
}

export function constantWind(direction: Degrees, speed: Knots): WindField {
  return createWindField({ direction, speed }, [])
}
