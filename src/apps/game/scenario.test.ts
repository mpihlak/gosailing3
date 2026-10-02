import { describe, it, expect } from 'vitest'
import { angleDelta, distance } from '@/foundation/geom'
import { CRUISER_35_SPEC, hullCentreline, hullRadius, tackOf, type BoatState } from '@/domain/boat'
import { detectContacts } from '@/domain/collision'
import { pointAt } from '@/domain/course'
import { Skipper } from '@/agents/ai'
import { createSimulation, runHeadless, timeToStart } from '@/sim'
import { COUNTDOWN, duel, GAME_PACE, OPPONENT_ID, PLAYER_ID, regattaRace } from './scenario'

/**
 * The game runs its simulation faster than real time and divides every clock back down,
 * so what the player reads is seconds of their own. These check the two ends of that:
 * the countdown they wait through, and the race they sail.
 */
describe('the clocks the player reads', () => {
  const sim = createSimulation(duel('clock-check'))

  it('counts the countdown down in the player\'s seconds', () => {
    // The relationship, not the number: the countdown is tuning, and moves.
    expect(timeToStart(sim.ctx, sim.world) / GAME_PACE).toBeCloseTo(COUNTDOWN)
  })

  it('runs a race in a couple of minutes rather than ten', () => {
    const { world } = runHeadless(sim.ctx, sim.world, { [PLAYER_ID]: new Skipper() }, {
      maxTicks: 60 * 60 * 60,
      // The opponent has no hand on her helm and never finishes, so waiting on the whole
      // fleet would wait for ever.
      until: (state) => state.race.progress[PLAYER_ID]?.status === 'finished',
    })
    const progress = world.race.progress[PLAYER_ID]
    expect(progress?.status).toBe('finished')

    const elapsed = (progress?.finishTime ?? 0) / GAME_PACE
    expect(elapsed).toBeGreaterThan(60)
    expect(elapsed).toBeLessThan(300)
  })
})

describe('the starting arrangement', () => {
  const sim = createSimulation(duel('berths'))
  const spec = CRUISER_35_SPEC
  const player = sim.world.boats.find((boat) => boat.id === PLAYER_ID)!
  const opponent = sim.world.boats.find((boat) => boat.id === OPPONENT_ID)!

  /** The very back of the boat, which is what the two have between them. */
  const sternOf = (boat: typeof player) =>
    pointAt(boat.position, boat.heading + 180, spec.length / 2)

  it('puts the two of them on the same latitude', () => {
    expect(opponent.position.y).toBeCloseTo(player.position.y)
  })

  it('lays them stern to stern with a boat length of water between', () => {
    expect(distance(sternOf(player), sternOf(opponent))).toBeCloseTo(spec.length)
  })

  it('points them opposite ways along the line', () => {
    expect(Math.abs(angleDelta(player.heading, opponent.heading))).toBeCloseTo(180)
    expect(player.heading).toBeCloseTo(90) // east, toward the committee boat
    expect(opponent.heading).toBeCloseTo(270) // west, toward the pin
  })

  it('has the player on port tack and the opponent on starboard', () => {
    expect(tackOf(player.twa)).toBe('port')
    expect(tackOf(opponent.twa)).toBe('starboard')
  })

  it('leaves the pair a little west of the middle of the line', () => {
    const between = (player.position.x + opponent.position.x) / 2
    expect(between).toBeLessThan(0)
    expect(Math.abs(between)).toBeLessThan(spec.length * 2)
  })

  it('starts them clear of each other', () => {
    const { events } = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 60 })
    expect(events.filter((event) => event.kind === 'contact')).toHaveLength(0)
  })

  it('sails the opponent away to the west, given no helm', () => {
    const { world } = runHeadless(sim.ctx, sim.world, {}, { maxTicks: 60 * 60 })
    const sailed = world.boats.find((boat) => boat.id === OPPONENT_ID)!
    expect(sailed.position.x).toBeLessThan(opponent.position.x - 50)
    expect(tackOf(sailed.twa)).toBe('starboard')
  })

  it('counts her as a competitor', () => {
    expect(sim.world.race.progress[OPPONENT_ID]).toBeDefined()
    expect(sim.world.race.progress[OPPONENT_ID]?.status).toBe('prestart')
  })
})

describe('the race finishing', () => {
  function sailItOut(seed: string) {
    const sim = createSimulation(duel(seed))
    const helms = Object.fromEntries(sim.world.boats.map((boat) => [boat.id, new Skipper()]))
    const { world } = runHeadless(sim.ctx, sim.world, helms, {
      maxTicks: 60 * 60 * 60,
      until: (state) => state.race.phase === 'complete',
    })
    return { sim, world }
  }

  it.each(['alpha', 'bravo', 'charlie'])('gets both boats home in seed %s', (seed) => {
    const { world } = sailItOut(seed)
    expect(world.race.phase).toBe('complete')
    expect(world.race.finishOrder).toHaveLength(2)
  })

  it('places them in the order they crossed, with a time each', () => {
    const { world } = sailItOut('alpha')
    const places = world.race.finishOrder.map((id) => world.race.progress[id]?.place)
    expect(places).toEqual([1, 2])

    for (const boatId of world.race.finishOrder) {
      const progress = world.race.progress[boatId]
      expect(progress?.status).toBe('finished')
      expect(progress?.finishTime).toBeGreaterThan(0)
    }
  })

  it('names them for the colors they are drawn in', () => {
    const { sim, world } = sailItOut('alpha')
    const names = world.race.finishOrder.map((id) => sim.names[id])
    expect(names).toEqual(expect.arrayContaining(['Blue', 'Red']))
  })

  it('takes a few minutes of the player\'s time, both boats', () => {
    // A penalty turn costs a boat the better part of a minute, so the slower of the two
    // is allowed rather more room than the winner.
    const { world } = sailItOut('alpha')
    for (const boatId of world.race.finishOrder) {
      const elapsed = (world.race.progress[boatId]?.finishTime ?? 0) / GAME_PACE
      expect(elapsed).toBeGreaterThan(60)
      expect(elapsed).toBeLessThan(420)
    }
  })

  it('does not call the race complete while one of them is still out there', () => {
    // The player alone finishing is not the end of it: the results wait for the fleet.
    const sim = createSimulation(duel('alpha'))
    const { world } = runHeadless(sim.ctx, sim.world, { [PLAYER_ID]: new Skipper() }, {
      maxTicks: 60 * 60 * 30,
      until: (state) => state.race.progress[PLAYER_ID]?.status === 'finished',
    })
    expect(world.race.progress[PLAYER_ID]?.status).toBe('finished')
    expect(world.race.phase).not.toBe('complete')
  })
})

describe('where a regatta fleet waits for the gun', () => {
  const sailors = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `c${index}`, name: `S${index}` }))

  const fleet = (count: number) =>
    createSimulation(regattaRace('berths', sailors(count))).world.boats

  const hulls = (boats: readonly BoatState[]) =>
    boats.map((boat) => ({
      id: boat.id,
      centreline: hullCentreline(boat, CRUISER_35_SPEC),
      radius: hullRadius(CRUISER_35_SPEC),
    }))

  const closestPair = (boats: readonly BoatState[]) => {
    const gaps = boats.flatMap((boat, index) =>
      boats.slice(index + 1).map((other) => distance(boat.position, other.position)),
    )
    return Math.min(...gaps)
  }

  /*
   * Pointing a whole fleet the same way lined it up like a rank of soldiers. They now
   * lie in three ranks and face both ways along the line: those nearer the pin reach
   * down towards it and those nearer the committee boat up towards that.
   */
  it('faces them both ways along the line, never all one way', () => {
    for (const count of [2, 3, 5, 10]) {
      const headings = new Set(fleet(count).map((boat) => Math.round(boat.heading)))
      expect(headings.size).toBe(2)
    }
  })

  it('lies them in more than one rank', () => {
    const behind = new Set(fleet(6).map((boat) => Math.round(boat.position.y)))
    expect(behind.size).toBeGreaterThan(1)
  })

  it('starts nobody touching anybody, however many turn up', () => {
    for (const count of [2, 3, 5, 8, 10]) {
      expect(detectContacts({ boats: hulls(fleet(count)) })).toEqual([])
    }
  })

  /** A pair put out at the two ends would barely meet before the gun. */
  it('keeps a small fleet close enough to mix', () => {
    expect(closestPair(fleet(2))).toBeLessThan(60)
  })

  it('still fits a full fleet in with room between the boats', () => {
    expect(closestPair(fleet(10))).toBeGreaterThan(CRUISER_35_SPEC.length * 2)
  })
})
