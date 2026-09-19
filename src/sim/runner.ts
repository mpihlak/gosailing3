import type { Seconds } from '@/foundation/units'
import { NEUTRAL_INPUT, type BoatId, type BoatInput } from '@/domain/boat'
import type { TimedEvent } from './events'
import { step } from './step'
import type { InputFrame, SimContext, WorldState } from './world'

/**
 * Where a boat's helm comes from. A keyboard, an AI, a replay and a packet from another
 * machine all look the same from here, which is what keeps networking a later problem
 * rather than a pervasive one.
 */
export interface InputSource {
  inputFor(boatId: BoatId, world: WorldState, ctx: SimContext): BoatInput
}

export const IDLE_SOURCE: InputSource = { inputFor: () => NEUTRAL_INPUT }

export function collectInputs(
  sources: Readonly<Record<BoatId, InputSource>>,
  world: WorldState,
  ctx: SimContext,
): InputFrame {
  const frame: Record<BoatId, BoatInput> = {}
  for (const boat of world.boats) {
    frame[boat.id] = (sources[boat.id] ?? IDLE_SOURCE).inputFor(boat.id, world, ctx)
  }
  return frame
}

/**
 * Drives the simulation at a fixed rate. Real time arrives from outside as a delta, so
 * the runner has no clock of its own: the game loop feeds it frame times, a test feeds
 * it whatever it likes, and both get identical physics.
 */
export class SimulationRunner {
  private accumulator: Seconds = 0
  private previousWorld: WorldState

  constructor(
    readonly ctx: SimContext,
    private currentWorld: WorldState,
  ) {
    this.previousWorld = currentWorld
  }

  get world(): WorldState {
    return this.currentWorld
  }

  /** The state one tick back, which rendering interpolates from. */
  get previous(): WorldState {
    return this.previousWorld
  }

  /** How far the clock has run past the last completed tick, as a fraction of one tick. */
  get alpha(): number {
    return this.accumulator / this.ctx.config.dt
  }

  tick(inputs: InputFrame): readonly TimedEvent[] {
    const result = step(this.ctx, this.currentWorld, inputs)
    this.previousWorld = this.currentWorld
    this.currentWorld = result.world
    return result.events
  }

  /**
   * Advance by a stretch of real time. Long stalls are capped rather than simulated in
   * one burst, so a backgrounded tab does not come back to a boat half a mile away.
   */
  advance(
    elapsed: Seconds,
    sources: Readonly<Record<BoatId, InputSource>>,
    maxCatchUp: Seconds = 0.25,
  ): readonly TimedEvent[] {
    const { dt } = this.ctx.config
    this.accumulator = Math.min(this.accumulator + elapsed, maxCatchUp)

    const events: TimedEvent[] = []
    while (this.accumulator >= dt) {
      this.accumulator -= dt
      events.push(...this.tick(collectInputs(sources, this.currentWorld, this.ctx)))
    }
    return events
  }
}

export interface HeadlessOptions {
  readonly maxTicks?: number
  /** Stop early once this returns true, for instance when every boat has finished. */
  readonly until?: (world: WorldState) => boolean
  /** Record the world every N ticks, for replay comparison or plotting. */
  readonly sampleEvery?: number
}

export interface HeadlessResult {
  readonly world: WorldState
  readonly events: readonly TimedEvent[]
  readonly samples: readonly WorldState[]
}

/**
 * Run a race with no renderer and no clock, as fast as the machine allows. This is what
 * tests assert on, what the lab batches over many seeds, and what a server would run.
 */
export function runHeadless(
  ctx: SimContext,
  initial: WorldState,
  sources: Readonly<Record<BoatId, InputSource>>,
  options: HeadlessOptions = {},
): HeadlessResult {
  const { maxTicks = 60 * 60 * 20, until, sampleEvery } = options
  const events: TimedEvent[] = []
  const samples: WorldState[] = []

  let world = initial
  for (let i = 0; i < maxTicks; i++) {
    if (until?.(world)) break
    const result = step(ctx, world, collectInputs(sources, world, ctx))
    world = result.world
    events.push(...result.events)
    if (sampleEvery && world.tick % sampleEvery === 0) samples.push(world)
  }
  return { world, events, samples }
}

/** An input source that replays a recorded trace, tick by tick. */
export function replaySource(trace: ReadonlyMap<number, BoatInput>): InputSource {
  return { inputFor: (_boatId, world) => trace.get(world.tick) ?? NEUTRAL_INPUT }
}

/** An input source that holds one setting, useful for tests and for tuning in the lab. */
export function fixedSource(input: BoatInput): InputSource {
  return { inputFor: () => input }
}
