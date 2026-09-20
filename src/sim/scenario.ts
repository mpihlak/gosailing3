import { lerpVec, scale, sub, add, vectorToBearing, type Vec2 } from '@/foundation/geom'
import type { Degrees, Knots, Seconds } from '@/foundation/units'
import { CRUISER_35_SPEC, spawnBoat, type BoatId, type BoatSpec, type BoatState } from '@/domain/boat'
import { windwardLeeward, lineMidpoint, type Course, type WindwardLeewardOptions } from '@/domain/course'
import { createRaceWind, type RaceWind, type RaceWindOptions } from '@/domain/wind'
import { createRaceState } from './race'
import { DEFAULT_CONFIG, type SimConfig, type SimContext, type WorldState } from './world'

export type ControllerKind = 'human' | 'ai' | 'idle'

export interface BoatSetup {
  readonly id: BoatId
  readonly name: string
  readonly controller?: ControllerKind
  readonly spec?: BoatSpec
  /** Where she starts. Defaults to a berth on the line, spread across the fleet. */
  readonly position?: Vec2
  readonly heading?: Degrees
  readonly speed?: Knots
}

export interface ScenarioSpec {
  readonly name: string
  readonly seed: number | string
  readonly boats: readonly BoatSetup[]
  readonly course?: Partial<WindwardLeewardOptions>
  readonly wind?: Partial<Omit<RaceWindOptions, 'seed'>>
  readonly config?: Partial<SimConfig>
  /** How long the race is expected to run, which is how much wind to generate. */
  readonly duration?: Seconds
}

export interface Simulation {
  readonly spec: ScenarioSpec
  readonly ctx: SimContext
  readonly world: WorldState
  readonly wind: RaceWind
  readonly names: Readonly<Record<BoatId, string>>
  readonly controllers: Readonly<Record<BoatId, ControllerKind>>
}

/**
 * Turn a scenario into a course, a wind and a fleet on the water. This is the one way a
 * race comes into being, so a test, a lab experiment, a replay and the game itself all
 * start from the same description.
 */
export function createSimulation(spec: ScenarioSpec): Simulation {
  const duration = spec.duration ?? 1800
  const courseOptions: WindwardLeewardOptions = {
    windDirection: spec.wind?.direction ?? 0,
    legLength: 900,
    lineLength: 300,
    startCenter: { x: 0, y: 0 },
    ...spec.course,
  }
  const course = windwardLeeward(courseOptions)

  const wind = createRaceWind({
    direction: courseOptions.windDirection,
    speed: 12,
    courseCenter: courseCenterOf(course, courseOptions),
    courseWidth: courseOptions.lineLength * 2.5,
    duration,
    ...spec.wind,
    seed: spec.seed,
  })

  const config: SimConfig = { ...DEFAULT_CONFIG, ...spec.config }
  const specs: Record<BoatId, BoatSpec> = {}
  const names: Record<BoatId, string> = {}
  const controllers: Record<BoatId, ControllerKind> = {}
  const boats: BoatState[] = []

  const berths = startingBerths(course, spec.boats.length)

  spec.boats.forEach((setup, index) => {
    const boatSpec = setup.spec ?? CRUISER_35_SPEC
    const berth = berths[index] ?? { position: { x: 0, y: -60 }, heading: 90 }
    const position = setup.position ?? berth.position
    const heading = setup.heading ?? berth.heading
    const sample = wind.sample(position, 0)

    specs[setup.id] = boatSpec
    names[setup.id] = setup.name
    controllers[setup.id] = setup.controller ?? 'idle'
    boats.push(
      spawnBoat(
        setup.speed === undefined
          ? { id: setup.id, position, heading }
          : { id: setup.id, position, heading, speed: setup.speed },
        boatSpec,
        sample,
      ),
    )
  })

  const world: WorldState = {
    tick: 0,
    time: 0,
    boats,
    race: createRaceState(boats.map((boat) => boat.id)),
    contacts: [],
    incidents: [],
  }

  return { spec, ctx: { course, wind, specs, config }, world, wind, names, controllers }
}

function courseCenterOf(course: Course, options: WindwardLeewardOptions): Vec2 {
  const windward = course.marks[0]?.position ?? options.startCenter
  return lerpVec(options.startCenter, windward, 0.5)
}

interface Berth {
  readonly position: Vec2
  readonly heading: Degrees
}

/**
 * Where the fleet waits for the gun: spread along the line and a little to leeward of
 * it, reaching along it the way a fleet mills about before a start.
 */
function startingBerths(course: Course, count: number): Berth[] {
  const startStage = course.stages.find((stage) => stage.kind === 'start')
  if (startStage?.kind !== 'start') return []
  const { line } = startStage

  const alongLine = vectorToBearing(sub(line.to, line.from))
  const behindLine = scale(line.normal, -70)
  const midpoint = lineMidpoint(line)

  return Array.from({ length: count }, (_, index) => {
    // Spread across the middle of the line, leaving the ends free.
    const spread = count === 1 ? 0.5 : 0.25 + (index / Math.max(1, count - 1)) * 0.5
    const onLine = lerpVec(line.from, line.to, spread)
    return {
      position: add(count === 1 ? midpoint : onLine, behindLine),
      heading: alongLine,
    }
  })
}
