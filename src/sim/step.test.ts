import { describe, it, expect } from 'vitest'
import { distance, vec } from '@/foundation/geom'
import { createSimulation } from './scenario'
import { step } from './step'
import { fixedSource, runHeadless, SimulationRunner, type InputSource } from './runner'
import { DEFAULT_CONFIG } from './world'
import { interpolateWorld } from './interpolate'
import type { WorldState } from './world'

function twoBoats(overrides = {}) {
  return createSimulation({
    name: 'test',
    seed: 'step-test',
    boats: [
      { id: 'a', name: 'Alpha', position: vec(-20, -100), heading: 0 },
      { id: 'b', name: 'Bravo', position: vec(20, -100), heading: 0 },
    ],
    ...overrides,
  })
}

describe('step', () => {
  it('advances the clock by exactly one fixed tick', () => {
    const { ctx, world } = twoBoats()
    const next = step(ctx, world, {}).world
    expect(next.tick).toBe(1)
    expect(next.time).toBeCloseTo(ctx.config.dt)
  })

  it('moves the boats', () => {
    const { ctx, world } = twoBoats()
    const next = step(ctx, world, {}).world
    expect(next.boats[0]!.position).not.toEqual(world.boats[0]!.position)
  })

  it('gives identical results for identical inputs', () => {
    const first = runHeadless(twoBoats().ctx, twoBoats().world, { a: fixedSource({ rudder: 0.4 }) }, { maxTicks: 600 })
    const second = runHeadless(twoBoats().ctx, twoBoats().world, { a: fixedSource({ rudder: 0.4 }) }, { maxTicks: 600 })
    expect(first.world).toEqual(second.world)
    expect(first.events).toEqual(second.events)
  })

  it('diverges for a different seed, because the wind is different', () => {
    const a = twoBoats({ seed: 'one' })
    const b = twoBoats({ seed: 'two' })
    const first = runHeadless(a.ctx, a.world, {}, { maxTicks: 1200 })
    const second = runHeadless(b.ctx, b.world, {}, { maxTicks: 1200 })
    expect(first.world.boats[0]!.position).not.toEqual(second.world.boats[0]!.position)
  })

  it('leaves a snapshot that survives a round trip through JSON', () => {
    const { ctx, world } = twoBoats()
    const next = runHeadless(ctx, world, {}, { maxTicks: 120 }).world
    expect(JSON.parse(JSON.stringify(next))).toEqual(next)
  })
})

describe('contacts', () => {
  const collidingFleet = () =>
    createSimulation({
      name: 'collision',
      seed: 'contact',
      boats: [
        { id: 'a', name: 'Alpha', position: vec(-1.5, -100), heading: 0 },
        { id: 'b', name: 'Bravo', position: vec(1.5, -100), heading: 0 },
      ],
    })

  it('pushes overlapping boats apart', () => {
    const { ctx, world } = collidingFleet()
    const before = distance(world.boats[0]!.position, world.boats[1]!.position)
    const after = step(ctx, world, {}).world
    expect(distance(after.boats[0]!.position, after.boats[1]!.position)).toBeGreaterThan(before)
  })

  it('takes the way off both boats', () => {
    const { ctx, world } = collidingFleet()
    const after = step(ctx, world, {}).world
    expect(after.boats[0]!.speed).toBeLessThan(world.boats[0]!.speed * 0.7)
    expect(after.boats[1]!.speed).toBeLessThan(world.boats[1]!.speed * 0.7)
  })

  it('reports one contact for one collision, not one per tick', () => {
    const { ctx, world } = collidingFleet()
    const { events } = runHeadless(ctx, world, {}, { maxTicks: 30 })
    expect(events.filter((event) => event.kind === 'contact')).toHaveLength(1)
  })

  it('counts a penalty against each boat involved', () => {
    const { ctx, world } = collidingFleet()
    const after = runHeadless(ctx, world, {}, { maxTicks: 5 }).world
    expect(after.race.progress.a?.penalties).toBe(1)
    expect(after.race.progress.b?.penalties).toBe(1)
  })

  it('lets a boat pass close by a mark without calling it a touch', () => {
    // Five meters abeam is clear water: the old circular hull called this a collision.
    const sim = createSimulation({
      name: 'near miss',
      seed: 'near',
      boats: [{ id: 'a', name: 'Alpha', position: vec(5, 880), heading: 0 }],
      course: { legLength: 900, lineLength: 400, startCenter: vec(0, 0) },
    })
    const { events } = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 120 })
    expect(events.filter((event) => event.kind === 'contact')).toHaveLength(0)
  })

  it('pushes the mark aside rather than bouncing the boat off it', () => {
    // Running down onto the mark from upwind, which is an angle she can actually sail.
    const sim = createSimulation({
      name: 'mark brush',
      seed: 'brush',
      boats: [{ id: 'a', name: 'Alpha', position: vec(0, 940), heading: 180 }],
      course: { legLength: 900, lineLength: 400, startCenter: vec(0, 0) },
    })
    // Dead downwind is slow going: forty seconds to run the length of the approach.
    const { world, events } = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 60 * 40 })

    expect(events.filter((event) => event.kind === 'contact')).toHaveLength(1)
    expect(world.race.progress.a?.penalties).toBe(1)
    // She carries on through and out the far side, rather than being held off it.
    expect(world.boats[0]!.position.y).toBeLessThan(890)
    expect(Math.abs(world.boats[0]!.position.x)).toBeLessThan(6)
  })

  it('reports a boat hitting the committee boat, and stops her', () => {
    const sim = createSimulation({
      name: 'committee',
      seed: 'rc',
      // Reaching along the line straight at the committee boat on the starboard end.
      boats: [{ id: 'a', name: 'Alpha', position: vec(160, 0), heading: 90 }],
      course: { legLength: 900, lineLength: 400, startCenter: vec(0, 0) },
    })
    const { world, events } = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 60 * 30 })

    const contact = events.find((event) => event.kind === 'contact')
    expect(contact).toMatchObject({ otherId: 'committee', with: 'mark' })
    // Solid: she is held off it rather than sailing through.
    expect(world.boats[0]!.position.x).toBeLessThan(200)
  })

  it('reports a boat hitting the pin, and lets her push it aside', () => {
    const sim = createSimulation({
      name: 'pin',
      seed: 'pin',
      boats: [{ id: 'a', name: 'Alpha', position: vec(-160, 0), heading: 270 }],
      course: { legLength: 900, lineLength: 400, startCenter: vec(0, 0) },
    })
    const { events } = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 60 * 30 })
    expect(events.find((event) => event.kind === 'contact')).toMatchObject({ otherId: 'pin' })
  })

  it('lets a boat start between the ends without touching either', () => {
    const sim = createSimulation({
      name: 'clean start',
      seed: 'clean',
      // Close-hauled, which she can hold, rather than pinched into the no-go zone.
      boats: [{ id: 'a', name: 'Alpha', position: vec(0, -50), heading: 45 }],
      course: { legLength: 900, lineLength: 400, startCenter: vec(0, 0) },
      config: { startSequence: 0 },
    })
    const { events } = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 60 * 40 })
    expect(events.filter((event) => event.kind === 'contact')).toHaveLength(0)
    expect(events.some((event) => event.kind === 'boatStarted')).toBe(true)
  })

  it('costs less speed to brush a mark than to hit another boat', () => {
    expect(DEFAULT_CONFIG.markContactSpeedLoss).toBeLessThan(DEFAULT_CONFIG.contactSpeedLoss)
  })

  it('names the mark it touched, and leaves the mark where it was', () => {
    const sim = createSimulation({
      name: 'mark hit',
      seed: 'mark',
      boats: [{ id: 'a', name: 'Alpha', position: vec(0, 899), heading: 180 }],
      course: { legLength: 900, lineLength: 400, startCenter: vec(0, 0) },
    })
    const { events, world } = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 5 })

    expect(events.find((event) => event.kind === 'contact')).toMatchObject({
      with: 'mark',
      otherId: 'windward',
    })
    expect(sim.ctx.course.marks[0]!.position).toEqual(vec(0, 900))
    // Soft: she is not shoved clear of it the moment they touch.
    expect(distance(world.boats[0]!.position, vec(0, 900))).toBeLessThan(3)
  })
})

describe('SimulationRunner', () => {
  const sources: Record<string, InputSource> = { a: fixedSource({ rudder: 0 }) }

  it('runs one tick per fixed step of real time', () => {
    const { ctx, world } = twoBoats()
    const runner = new SimulationRunner(ctx, world)
    for (let frame = 0; frame < 60; frame++) runner.advance(1 / 60, sources)
    expect(runner.world.tick).toBe(60)
  })

  it('carries the remainder of a frame over to the next one', () => {
    const { ctx, world } = twoBoats()
    const runner = new SimulationRunner(ctx, world)
    runner.advance(0.01, sources) // less than one tick
    expect(runner.world.tick).toBe(0)
    runner.advance(0.01, sources)
    expect(runner.world.tick).toBe(1)
  })

  it('caps a long stall instead of simulating it all at once', () => {
    const { ctx, world } = twoBoats()
    const runner = new SimulationRunner(ctx, world)
    runner.advance(30, sources) // a backgrounded tab
    expect(runner.world.tick).toBeLessThanOrEqual(15) // a quarter second of catch-up
  })

  it('absorbs an ordinary frame hitch without losing time', () => {
    const { ctx, world } = twoBoats()
    const runner = new SimulationRunner(ctx, world)
    runner.advance(0.1, sources) // a 100ms hitch is caught up in full
    expect(runner.world.tick).toBe(6)
  })

  it('keeps the previous tick so rendering has something to interpolate from', () => {
    const { ctx, world } = twoBoats()
    const runner = new SimulationRunner(ctx, world)
    runner.advance(1, sources)
    expect(runner.previous.tick).toBe(runner.world.tick - 1)
    expect(runner.alpha).toBeGreaterThanOrEqual(0)
    expect(runner.alpha).toBeLessThan(1)
  })
})

describe('interpolateWorld', () => {
  it('places a boat between two ticks', () => {
    const { ctx, world } = twoBoats()
    const next = step(ctx, world, {}).world
    const halfway = interpolateWorld(world, next, 0.5)
    const from = world.boats[0]!.position
    const to = next.boats[0]!.position
    expect(halfway.boats[0]!.position.x).toBeCloseTo((from.x + to.x) / 2)
    expect(halfway.boats[0]!.position.y).toBeCloseTo((from.y + to.y) / 2)
  })

  it('returns the newer tick unchanged at the end of the interval', () => {
    const { ctx, world } = twoBoats()
    const next = step(ctx, world, {}).world
    expect(interpolateWorld(world, next, 1)).toBe(next)
  })
})

describe('runHeadless', () => {
  it('stops when told to', () => {
    const { ctx, world } = twoBoats()
    const result = runHeadless(ctx, world, {}, { until: (state: WorldState) => state.time >= 10 })
    expect(result.world.time).toBeCloseTo(10, 1)
  })

  it('records samples along the way', () => {
    const { ctx, world } = twoBoats()
    const result = runHeadless(ctx, world, {}, { maxTicks: 600, sampleEvery: 60 })
    expect(result.samples).toHaveLength(10)
  })
})
