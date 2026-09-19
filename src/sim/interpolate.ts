import { lerpBearing, lerpVec } from '@/foundation/geom'
import { lerp } from '@/foundation/units'
import type { BoatState } from '@/domain/boat'
import type { WorldState } from './world'

/**
 * Blend two consecutive ticks for drawing. The simulation runs at a fixed rate and the
 * screen refreshes at whatever rate it likes, so the renderer shows a point in between
 * rather than the last tick twice.
 */
export function interpolateBoat(from: BoatState, to: BoatState, t: number): BoatState {
  return {
    ...to,
    position: lerpVec(from.position, to.position, t),
    heading: lerpBearing(from.heading, to.heading, t),
    course: lerpBearing(from.course, to.course, t),
    speed: lerp(from.speed, to.speed, t),
  }
}

export function interpolateWorld(from: WorldState, to: WorldState, t: number): WorldState {
  if (from === to || t >= 1) return to
  const previous = new Map(from.boats.map((boat) => [boat.id, boat]))
  return {
    ...to,
    boats: to.boats.map((boat) => {
      const before = previous.get(boat.id)
      return before ? interpolateBoat(before, boat, t) : boat
    }),
  }
}
