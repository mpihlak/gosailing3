import { distance, type Vec2 } from '@/foundation/geom'
import type { Knots, Meters, Seconds } from '@/foundation/units'
import { tackOf, type BoatId, type Tack } from '@/domain/boat'
import { lineMidpoint } from '@/domain/course'
import {
  createSimulation,
  raceTime,
  step,
  collectInputs,
  type ScenarioSpec,
  type WorldState,
} from '@/sim'
import { Skipper } from '../skipper'
import type { StartPhase, StartStrategy } from './types'

/** What a start looked like, judged from outside. */
export interface StartReport {
  /** Race time she crossed at. Zero is the gun; positive is late. Undefined if she never did. */
  readonly startedAt?: Seconds
  readonly started: boolean
  /** How far up the line from the pin she crossed. */
  readonly fromPin?: Meters
  readonly speedAtStart?: Knots
  readonly tackAtStart?: Tack
  /** Her speed as a fraction of what she could be doing close-hauled. */
  readonly speedRatio?: number
  readonly calledOverEarly: boolean
  readonly touchedAMark: boolean
  /** Closest she came to the pin, which is the mark she is trying not to hit. */
  readonly closestToPin: Meters
  readonly phases: readonly StartPhase[]
  /** How far she strayed from the line while waiting, for judging the reach out. */
  readonly furthestFromLine: Meters
}

export interface StartTrialOptions {
  readonly strategy: StartStrategy
  readonly scenario: ScenarioSpec
  readonly boatId?: BoatId
  /** How long to keep sailing after the gun before giving up on her. */
  readonly patience?: Seconds
}

/**
 * Sail one start and report on it. Headless and deterministic, so a scenario either
 * starts well or it does not, every time.
 */
export function trialStart(options: StartTrialOptions): StartReport {
  const { strategy, scenario, patience = 120 } = options
  const simulation = createSimulation(scenario)
  const boatId = options.boatId ?? (simulation.world.boats[0]?.id as BoatId)
  const skipper = new Skipper({ start: strategy })
  const sources = { [boatId]: skipper }

  const startStage = simulation.ctx.course.stages[0]
  if (startStage?.kind !== 'start') throw new Error('a start trial needs a course with a start')
  const { line } = startStage
  const pin: Vec2 = line.from
  const middle = lineMidpoint(line)
  const phases: StartPhase[] = []

  let world: WorldState = simulation.world
  let closestToPin = Infinity
  let furthestFromLine = 0
  let touchedAMark = false
  let calledOverEarly = false
  let report: Partial<StartReport> = {}

  const limit = scenario.config?.startSequence ?? 60
  const maxTicks = Math.ceil((limit + patience) / simulation.ctx.config.dt)

  for (let tick = 0; tick < maxTicks; tick++) {
    const result = step(simulation.ctx, world, collectInputs(sources, world, simulation.ctx))
    world = result.world

    const boat = world.boats.find((candidate) => candidate.id === boatId)
    if (!boat) break

    const phase = skipper.lastStartPhase
    if (phase && phases[phases.length - 1] !== phase) phases.push(phase)

    closestToPin = Math.min(closestToPin, distance(boat.position, pin))
    furthestFromLine = Math.max(furthestFromLine, distance(boat.position, middle))

    for (const event of result.events) {
      if (event.kind === 'contact') touchedAMark = true
      if (event.kind === 'overEarly' && event.boatId === boatId) calledOverEarly = true
      if (event.kind === 'boatStarted' && event.boatId === boatId) {
        const wind = simulation.ctx.wind.sample(boat.position, world.time)
        const target = simulation.ctx.specs[boatId]?.polar.beatTarget(wind.speed).speed ?? 0
        report = {
          startedAt: event.late,
          fromPin: distance(boat.position, pin),
          speedAtStart: boat.speed,
          tackAtStart: tackOf(boat.twa),
          speedRatio: target > 0 ? boat.speed / target : 0,
        }
      }
    }

    if (report.startedAt !== undefined) break
    if (raceTime(simulation.ctx, world) > patience) break
  }

  return {
    ...report,
    started: report.startedAt !== undefined,
    calledOverEarly,
    touchedAMark,
    closestToPin,
    phases,
    furthestFromLine,
  }
}
