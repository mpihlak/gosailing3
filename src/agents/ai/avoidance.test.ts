import { describe, it, expect } from 'vitest'
import { add, angleDelta, bearingToVector, scale, vec, type Vec2 } from '@/foundation/geom'
import { clamp } from '@/foundation/units'
import {
  createSimulation,
  fixedSource,
  runHeadless,
  SimulationRunner,
  type InputSource,
} from '@/sim'
import { giveWay } from './avoidance'
import { personalityFor } from './personality'
import { boatEndStarboardStart, pinEndPortStart } from './start'
import { Skipper } from './skipper'

const STEADY = {
  direction: 0,
  speed: 12,
  shiftAmplitude: 0,
  startBias: 0,
  gustiness: 0,
  gradientStrength: 0,
}

/** Boats where they are put, racing up the first beat in a steady northerly. */
function racing(boats: { id: string; position: Vec2; heading: number }[]) {
  const sim = createSimulation({
    name: 'meeting',
    seed: 'meeting',
    boats: boats.map((boat) => ({ ...boat, name: boat.id, controller: 'ai' as const })),
    course: { legLength: 450, lineLength: 260, startCenter: vec(0, 0) },
    wind: STEADY,
    config: { startSequence: 0 },
    duration: 2400,
  })
  const progress = Object.fromEntries(
    Object.entries(sim.world.race.progress).map(([id, entry]) => [
      id,
      { ...entry, status: 'racing' as const, stageIndex: 1, clearedPreStart: true },
    ]),
  )
  return {
    ...sim,
    world: { ...sim.world, race: { ...sim.world.race, phase: 'racing' as const, progress } },
  }
}

function decide(sim: ReturnType<typeof racing>, id: string) {
  const boat = sim.world.boats.find((one) => one.id === id)!
  return giveWay(sim.ctx, sim.world, boat, sim.ctx.specs[id]!, STEADY, boat.heading)
}

describe('keeping clear', () => {
  // Port heads north-east and starboard north-west, and they meet halfway between.
  const crossing = () =>
    racing([
      { id: 'port', position: vec(-18, 200), heading: 45 },
      { id: 'starboard', position: vec(18, 200), heading: 315 },
    ])

  it('has the port tack boat bear away to pass astern', () => {
    const away = decide(crossing(), 'port')
    expect(away?.rule).toBe(10)
    // Further off the wind than the close-hauled course she was on.
    expect(Math.abs(angleDelta(STEADY.direction, away!.bearing))).toBeGreaterThan(45)
  })

  it('leaves the starboard tack boat to hold her course', () => {
    expect(decide(crossing(), 'starboard')).toBeUndefined()
  })

  it('has the windward boat luff away from the leeward one', () => {
    // Both on port, the windward one bearing down on the other.
    const sim = racing([
      { id: 'leeward', position: vec(0, 200), heading: 45 },
      { id: 'windward', position: vec(-14, 206), heading: 75 },
    ])
    const away = decide(sim, 'windward')
    expect(away?.rule).toBe(11)
    expect(away!.bearing).toBeLessThan(75)
  })

  it('passes close by a boat she is clear astern of', () => {
    // Both on port, a slow boat ahead and a little to leeward. Holding her course she
    // passes ten metres beside her, more than half a length hull to hull.
    const sim = racing([
      { id: 'ahead', position: vec(20, 206), heading: 45 },
      { id: 'astern', position: vec(0, 200), heading: 45 },
    ])
    const world = {
      ...sim.world,
      boats: sim.world.boats.map((boat) => ({ ...boat, speed: boat.id === 'ahead' ? 2 : 6 })),
    }
    const boat = world.boats.find((one) => one.id === 'astern')!
    expect(giveWay(sim.ctx, world, boat, sim.ctx.specs.astern!, STEADY, 45)).toBeUndefined()
  })

  it('does nothing about a boat that is not coming near', () => {
    const sim = racing([
      { id: 'one', position: vec(-200, 200), heading: 45 },
      { id: 'two', position: vec(200, 200), heading: 45 },
    ])
    expect(decide(sim, 'one')).toBeUndefined()
  })

  it('sails two AI boats through a port and starboard crossing without touching', () => {
    const sim = crossing()
    const runner = new SimulationRunner(sim.ctx, sim.world)
    const helms = { port: new Skipper(), starboard: new Skipper() }
    let contacts = 0
    for (let tick = 0; tick < 60 * 30; tick++) {
      contacts += runner
        .advance(1 / 60, helms, 10)
        .filter((event) => event.kind === 'contact').length
    }
    expect(contacts).toBe(0)
  })
})

describe('keeping clear before the gun', () => {
  /*
   * From a race on the server: a robot coming back to the pin close-hauled on port, and
   * a person reaching down the line on starboard, steady on a course that meets hers.
   * She held her course into the other boat and took the penalty.
   */
  it('has a port tack boat on her way to the line keep clear of a starboard one', () => {
    const sim = createSimulation({
      name: 'pre-start crossing',
      seed: 'crossing',
      boats: [
        {
          id: 'robot',
          name: 'Alice',
          controller: 'ai',
          position: vec(-198.9, -125.6),
          heading: 53.4,
        },
        {
          id: 'person',
          name: 'Martin',
          controller: 'human',
          position: vec(-119.4, -81.6),
          heading: 244.1,
        },
      ],
      course: { legLength: 450, lineLength: 260, startCenter: vec(0, 0) },
      wind: STEADY,
      config: { startSequence: 120 },
      duration: 4800,
    })
    const speeds: Record<string, number> = { robot: 5.2, person: 7.2 }
    const world = {
      ...sim.world,
      time: 64,
      boats: sim.world.boats.map((boat) => ({ ...boat, speed: speeds[boat.id]! })),
    }
    // Her own way of starting, which is what put her on this line to the pin.
    const personality = personalityFor('Alice')
    const start = pinEndPortStart({ clearance: personality.startClearance })
    const helms = {
      robot: new Skipper({ start, personality, seed: 'Alice:944zw5' }),
      person: fixedSource({ rudder: 0 }),
    }
    const { events } = runHeadless(sim.ctx, world, helms, {
      until: (now) => now.time >= 120,
    })
    expect(events.filter((event) => event.kind === 'contact')).toEqual([])
  })
})

describe('being luffed before the gun', () => {
  /** Luffs steadily from close-hauled on starboard to just short of head to wind. */
  const luffing: InputSource = {
    inputFor: (id, world) => {
      const boat = world.boats.find((one) => one.id === id)!
      const wanted = 315 + clamp((world.time - 101) * 5, 0, 37)
      return { rudder: clamp(angleDelta(boat.heading, wanted) / 10 - boat.turnRate / 30, -1, 1) }
    },
  }

  it('tacks away when the world comes from the server', () => {
    // A robot online is told each boat's status and never the race's phase, which reads
    // as racing from the first snapshot. Luffed to twenty degrees off the wind, overlapped
    // to windward of a boat sitting head to wind a little ahead of her.
    const sim = racing([
      { id: 'leeward', position: vec(-6, -97), heading: 352 },
      { id: 'windward', position: vec(0, -100), heading: 340 },
    ])
    const progress = Object.fromEntries(
      Object.entries(sim.world.race.progress).map(([id, entry]) => [
        id,
        { ...entry, status: 'prestart' as const },
      ]),
    )
    const world = {
      ...sim.world,
      boats: sim.world.boats.map((boat) => ({
        ...boat,
        speed: boat.id === 'windward' ? 3 : 1,
        twa: angleDelta(STEADY.direction, boat.heading),
      })),
      race: { ...sim.world.race, progress },
    }
    const boat = world.boats.find((one) => one.id === 'windward')!
    const away = giveWay(sim.ctx, world, boat, sim.ctx.specs.windward!, STEADY, 320)
    expect(angleDelta(STEADY.direction, away!.bearing)).toBeGreaterThan(0)
  })

  it('does not tack away from a boat that is not luffing her', () => {
    // From a race on the server: a boat stopped head to wind some way ahead, which she
    // was keeping clear of from astern. She tacked away from it and started a minute late.
    const sim = racing([
      { id: 'stopped', position: vec(-14, -78), heading: 352 },
      { id: 'robot', position: vec(0, -100), heading: 340 },
    ])
    const progress = Object.fromEntries(
      Object.entries(sim.world.race.progress).map(([id, entry]) => [
        id,
        { ...entry, status: 'prestart' as const },
      ]),
    )
    const world = {
      ...sim.world,
      boats: sim.world.boats.map((boat) => ({
        ...boat,
        speed: boat.id === 'robot' ? 4 : 0,
        twa: angleDelta(STEADY.direction, boat.heading),
      })),
      race: { ...sim.world.race, progress },
    }
    const boat = world.boats.find((one) => one.id === 'robot')!
    const away = giveWay(sim.ctx, world, boat, sim.ctx.specs.robot!, STEADY, 330)
    expect(away?.rule).toBe(12)
    expect(angleDelta(STEADY.direction, away!.bearing)).toBeLessThan(0)
  })

  it('has the windward boat tack away rather than stop head to wind beside her', () => {
    // Both close-hauled on starboard below the line, the robot to windward and a little
    // behind, so she cannot sail out ahead as the other boat slows.
    const leeward = vec(80, -120)
    const robot = add(add(leeward, scale(bearingToVector(45), 9)), scale(bearingToVector(315), -8))
    const sim = createSimulation({
      name: 'luffed',
      seed: 'luffed',
      boats: [
        { id: 'person', name: 'Martin', controller: 'human', position: leeward, heading: 315 },
        { id: 'robot', name: 'Bob', controller: 'ai', position: robot, heading: 315 },
      ],
      course: { legLength: 450, lineLength: 260, startCenter: vec(0, 0) },
      wind: STEADY,
      config: { startSequence: 120 },
      duration: 4800,
    })
    const world = {
      ...sim.world,
      time: 100,
      boats: sim.world.boats.map((b) => ({ ...b, speed: 6 })),
    }
    const runner = new SimulationRunner(sim.ctx, world)
    const helms = { person: luffing, robot: new Skipper({ start: boatEndStarboardStart() }) }
    let slowest = Infinity
    let tacked = false
    const penalties = []
    for (let tick = 0; tick < 60 * 25; tick++) {
      const events = runner.advance(1 / 60, helms, 10)
      penalties.push(...events.filter((event) => event.kind === 'penalised'))
      const boat = runner.world.boats.find((one) => one.id === 'robot')!
      if (tick > 60 * 2) slowest = Math.min(slowest, boat.speed)
      tacked ||= boat.twa > 0
    }
    expect(penalties).toEqual([])
    expect(tacked).toBe(true)
    // Followed up to head to wind she was down to a fifth of a knot.
    expect(slowest).toBeGreaterThan(1.5)
  })
})
