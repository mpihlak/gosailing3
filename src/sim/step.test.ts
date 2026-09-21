import { describe, it, expect } from 'vitest'
import { add, bearingToVector, distance, scale, vec } from '@/foundation/geom'
import { createSimulation } from './scenario'
import { step } from './step'
import { fixedSource, runHeadless, SimulationRunner, type InputSource } from './runner'

/** Helm that heads her up until she is this far off the wind, then holds what she has. */
function luffingTo(twa: number): InputSource {
  return {
    inputFor: (boatId, world) => {
      const boat = world.boats.find((other) => other.id === boatId)
      return { rudder: boat && Math.abs(boat.twa) > twa ? -0.45 : 0 }
    },
  }
}
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

  it('puts the turn on the boat that had to keep clear, and not on the other', () => {
    // A steady northerly, so which tack they are on is the rule's answer and not the
    // seed's: the shifting wind a race normally gets would decide it for us.
    const sim = createSimulation({
      name: 'right of way',
      seed: 'row',
      boats: [
        { id: 'a', name: 'Alpha', position: vec(-1.5, -100), heading: 10 },
        { id: 'b', name: 'Bravo', position: vec(1.5, -100), heading: 10 },
      ],
      wind: { direction: 0, speed: 12, shiftAmplitude: 0, startBias: 0, gustiness: 0, gradientStrength: 0 },
    })
    const { world: after, events } = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 5 })

    // Overlapped on port tack, so leeward is the starboard side. Bravo lies there, which
    // makes Alpha the windward boat and the one in the wrong.
    expect(events.find((event) => event.kind === 'penalised')).toMatchObject({
      boatId: 'a',
      otherId: 'b',
      rule: 11,
    })
    expect(after.race.progress.a?.penalties).toBe(1)
    expect(after.race.progress.b?.penalties).toBe(0)
  })

  it('puts the turn on the windward boat when the leeward boat luffs into her', () => {
    /*
     * Rule 11 asks who was to leeward, not who turned. The leeward boat closes the gap
     * herself and still has right of way; the windward boat owes the turn for not having
     * kept clear. Rule 16, which limits how a right-of-way boat may change course, is
     * not modelled, so nothing here comes back on the boat that luffed.
     */
    const heading = 70
    const windward = vec(0, -300)
    // Square out to her starboard side, which is the leeward side on port tack, far
    // enough that they start with clear water between them and end up overlapped.
    const leeward = add(windward, scale(bearingToVector(heading + 90), 8))
    const sim = createSimulation({
      name: 'luff',
      seed: 'luff',
      boats: [
        { id: 'windward', name: 'Windward', position: windward, heading },
        { id: 'leeward', name: 'Leeward', position: leeward, heading },
      ],
      wind: { direction: 0, speed: 12, shiftAmplitude: 0, startBias: 0, gustiness: 0, gradientStrength: 0 },
      config: { startSequence: 0 },
    })

    // Nothing to see if they begin on top of each other.
    expect(step(sim.ctx, sim.world, {}).world.contacts).toHaveLength(0)

    const luffing = { leeward: fixedSource({ rudder: -0.35 }) }
    const { world: after, events } = runHeadless(sim.ctx, sim.world, luffing, { maxTicks: 300 })

    expect(events.filter((event) => event.kind === 'contact')).toMatchObject([
      { boatId: 'windward', otherId: 'leeward', with: 'boat' },
    ])
    expect(events.filter((event) => event.kind === 'penalised')).toMatchObject([
      { boatId: 'windward', otherId: 'leeward', rule: 11 },
    ])
    expect(after.race.progress.windward?.penalties).toBe(1)
    expect(after.race.progress.leeward?.penalties).toBe(0)
    // She luffed rather than tacked, so rule 11 held all the way through: both are still
    // on port tack, which is what a positive true wind angle means.
    for (const boat of after.boats) expect(boat.twa).toBeGreaterThan(0)
  })

  describe('on a run', () => {
    const RUNNING = 175
    /** Wind steady out of the north, so port tack puts the windward boat to the east. */
    const running = (leewardHelm?: Record<string, InputSource>) => {
      const sim = createSimulation({
        name: 'run', seed: 'run',
        boats: [
          { id: 'windward', name: 'Windward', position: vec(8, 0), heading: RUNNING, speed: 4.4 },
          { id: 'leeward', name: 'Leeward', position: vec(0, 0), heading: RUNNING, speed: 4.4 },
        ],
        wind: { direction: 0, speed: 12, shiftAmplitude: 0, startBias: 0, gustiness: 0, gradientStrength: 0 },
        course: { legLength: 2000, lineLength: 400, startCenter: vec(0, 1200) },
        config: { startSequence: 0 },
      })
      return runHeadless(sim.ctx, sim.world, leewardHelm ?? {}, { maxTicks: 60 * 12 })
    }

    it('leaves two boats sailing parallel alone', () => {
      expect(running().events.filter((event) => event.kind === 'contact')).toHaveLength(0)
    })

    /*
     * Running, a boat is drawn with her boom squared right out, so a pair overlap on the
     * screen long before their hulls meet — the reach of the rig against the reach of the
     * hull is measured in the sail tests. What the hulls do when they finally do meet is
     * this: judged exactly as on a beat, with the turn on the windward boat.
     */
    it('judges a leeward boat who luffs into her the same as on a beat', () => {
      const { events } = running({ leeward: luffingTo(90) })
      expect(events.filter((event) => event.kind === 'contact')).toMatchObject([
        { boatId: 'windward', otherId: 'leeward', with: 'boat' },
      ])
      expect(events.filter((event) => event.kind === 'penalised')).toMatchObject([
        { boatId: 'windward', otherId: 'leeward' },
      ])
    })
  })

  it('charges one turn for one coming together, however long they stay locked', () => {
    // Two hulls that stay into each other touch and part many times a second. Two full
    // minutes of it is still one incident and one turn.
    const locked = () =>
      createSimulation({
        name: 'locked',
        seed: 'lock',
        boats: [
          { id: 'a', name: 'Alpha', position: vec(-1, -200), heading: 20 },
          { id: 'b', name: 'Bravo', position: vec(1, -200), heading: 20 },
        ],
        wind: { direction: 0, speed: 12, shiftAmplitude: 0, startBias: 0, gustiness: 0, gradientStrength: 0 },
        config: { startSequence: 0 },
      })

    for (const minutes of [0.25, 1, 2]) {
      const sim = locked()
      const { world: after, events } = runHeadless(sim.ctx, sim.world, {}, {
        maxTicks: Math.round(60 * 60 * minutes),
      })
      const turns = Object.values(after.race.progress).reduce((sum, boat) => sum + boat.penalties, 0)
      expect(turns).toBe(1)
      expect(events.filter((event) => event.kind === 'penalised')).toHaveLength(1)
      expect(events.filter((event) => event.kind === 'contact')).toHaveLength(1)
    }
  })

  it('does not weld two boats together when they meet', () => {
    // Bow to bow, wedged. Charging them speed every tick they stayed in contact once
    // held a pair at a standstill for the rest of the race.
    const sim = createSimulation({
      name: 'wedged',
      seed: 'wedge',
      boats: [
        { id: 'a', name: 'Alpha', position: vec(-1, -200), heading: 45 },
        { id: 'b', name: 'Bravo', position: vec(1, -200), heading: 315 },
      ],
      wind: { direction: 0, speed: 12, shiftAmplitude: 0, startBias: 0, gustiness: 0, gradientStrength: 0 },
      config: { startSequence: 0 },
    })
    const after = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 60 * 30 }).world
    for (const boat of after.boats) expect(boat.speed).toBeGreaterThan(3)
  })

  it('keeps the incident open while they are still in each other\'s company', () => {
    const { ctx, world } = collidingFleet()
    const after = runHeadless(ctx, world, {}, { maxTicks: 60 * 10 }).world
    expect(after.incidents).toHaveLength(1)
  })

  it('closes the incident once they have come properly apart', () => {
    // Touching to begin with, then sailing away from one another.
    const sim = createSimulation({
      name: 'parting',
      seed: 'part',
      boats: [
        { id: 'a', name: 'Alpha', position: vec(-1, -200), heading: 270 },
        { id: 'b', name: 'Bravo', position: vec(1, -200), heading: 90 },
      ],
      wind: { direction: 0, speed: 12, shiftAmplitude: 0, startBias: 0, gustiness: 0, gradientStrength: 0 },
      config: { startSequence: 0 },
    })
    const touched = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 5 }).world
    expect(touched.incidents).toHaveLength(1)

    const parted = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 60 * 20 }).world
    expect(parted.incidents).toHaveLength(0)
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

  it('lets a boat lie alongside the committee boat without calling it a touch', () => {
    /*
     * Six meters off her centreline leaves two meters of clear water down her side. She
     * was a circle five meters in every direction, more than twice her half beam, and
     * this was reported as contact with nothing touching on the screen.
     */
    const sim = createSimulation({
      name: 'alongside',
      seed: 'alongside',
      boats: [{ id: 'a', name: 'Alpha', position: vec(194, 0), heading: 0, speed: 0 }],
      course: { legLength: 900, lineLength: 400, startCenter: vec(0, 0) },
    })
    const { events } = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 60 })
    expect(events.filter((event) => event.kind === 'contact')).toHaveLength(0)
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
