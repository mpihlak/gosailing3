import { add, bearingToVector, scale, sub, type Vec2 } from '@/foundation/geom'
import type { Degrees, Meters } from '@/foundation/units'
import { createLine } from './line'
import { pointAt } from './queries'
import type { Bounds, Course, CourseStage, Mark, Obstacle } from './types'

export interface WindwardLeewardOptions {
  readonly windDirection: Degrees
  /** Distance from the leeward end of the course to the windward mark. */
  readonly legLength: Meters
  readonly lineLength: Meters
  /** Middle of the start line. */
  readonly startCenter: Vec2
  /** Times round. One lap is start, windward mark, finish. */
  readonly laps?: number
  /** Rotation of the line away from square to the wind. Positive favors the pin. */
  readonly lineBias?: Degrees
  readonly rounding?: 'port' | 'starboard'
  readonly obstacles?: readonly Obstacle[]
  readonly margin?: Meters
}

/**
 * The standard windward-leeward course: beat to the windward mark, run back, finish at
 * the line you started from.
 */
export function windwardLeeward(options: WindwardLeewardOptions): Course {
  const {
    windDirection,
    legLength,
    lineLength,
    startCenter,
    laps = 1,
    lineBias = 0,
    rounding = 'port',
    obstacles = [],
    margin = 150,
  } = options

  // Square to the wind, then rotated by the bias so one end sits closer to the breeze.
  const lineAxis = windDirection + 90 + lineBias
  const halfLine = scale(bearingToVector(lineAxis), lineLength / 2)
  const pin = sub(startCenter, halfLine)
  const committee = add(startCenter, halfLine)

  const windwardMark: Mark = {
    id: 'windward',
    name: 'Windward',
    position: pointAt(startCenter, windDirection, legLength),
    rounding,
    radius: 1.5,
  }
  const leewardMark: Mark = {
    id: 'leeward',
    name: 'Leeward',
    position: pointAt(startCenter, windDirection + 180, 80),
    rounding,
    radius: 1.5,
  }

  const startLine = createLine('start', 'Start', pin, committee, windwardMark.position)
  const finishLine = createLine('finish', 'Finish', pin, committee, leewardMark.position)

  const marks: Mark[] = [windwardMark]
  const stages: CourseStage[] = [{ kind: 'start', line: startLine }]
  for (let lap = 0; lap < laps; lap++) {
    stages.push({ kind: 'mark', mark: windwardMark, approach: windDirection })
    if (lap < laps - 1) {
      stages.push({ kind: 'mark', mark: leewardMark, approach: windDirection + 180 })
    }
  }
  stages.push({ kind: 'finish', line: finishLine })
  if (laps > 1) marks.push(leewardMark)

  return {
    name: `Windward-leeward, ${laps} lap${laps === 1 ? '' : 's'}`,
    stages,
    marks,
    obstacles,
    bounds: boundsAround([pin, committee, windwardMark.position, leewardMark.position], margin),
  }
}

export function boundsAround(points: readonly Vec2[], margin: Meters): Bounds {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    min: { x: Math.min(...xs) - margin, y: Math.min(...ys) - margin },
    max: { x: Math.max(...xs) + margin, y: Math.max(...ys) + margin },
  }
}
