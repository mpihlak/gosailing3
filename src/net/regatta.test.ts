import { describe, it, expect } from 'vitest'
import { vec } from '@/foundation/geom'
import type { ScenarioSpec } from '@/sim'
import { Regatta, type RegattaLimits } from './regatta'
import type { Addressed, ServerMessage } from './protocol'

/** The pace the game is played at, so the limits below read in the player's seconds. */
const PACE = 4

/** A short course, so a race in a test is over in a few seconds of wall time. */
function shortRace(seed: string, sailors: readonly { id: string; name: string }[]): ScenarioSpec {
  return {
    name: 'test regatta',
    seed,
    boats: sailors.map((sailor) => ({ id: sailor.id, name: sailor.name, controller: 'ai' })),
    course: { legLength: 200, lineLength: 120, startCenter: vec(0, 0) },
    wind: { direction: 0, speed: 12 },
    config: { startSequence: 15 * PACE },
    duration: 2400,
  }
}

function regatta(limits: Partial<RegattaLimits> = {}) {
  let races = 0
  return new Regatta({
    race: shortRace,
    seed: () => `race-${++races}`,
    pace: PACE,
    colors: [
      { name: 'Blue', hex: '#4fa3dd' },
      { name: 'Red', hex: '#c4655c' },
      { name: 'Green', hex: '#7ee08a' },
    ],
    watcherColor: { name: 'Watcher', hex: '#9aa7b1' },
    limits,
  })
}

/** Everything the server said, in order, with who it was said to. */
function transcript(sent: Addressed[]): ServerMessage['kind'][] {
  return sent.map((one) => one.message.kind)
}

const joins = (name: string) => ({ kind: 'join', name }) as const
/** A sailor is shown as her color with the name she gave after it, so match on that. */
const isCalled = (given: string) => (one: { readonly name: string }) =>
  one.name.endsWith(`(${given})`)
const watches = (name: string) => ({ kind: 'join', name, role: 'observer' }) as const

describe('the lobby', () => {
  it('tells a sailor who she is and what is going on', () => {
    const sent = regatta().say('a', joins('Ann'))
    expect(transcript(sent)).toEqual(['welcome', 'fleet'])
    const welcome = sent[0]!.message
    expect(welcome).toMatchObject({ kind: 'welcome', you: 'a', role: 'racer', phase: 'lobby' })
  })

  it('waits for a fleet before it starts anything', () => {
    const race = regatta()
    race.say('a', joins('Ann'))
    expect(transcript(race.tick(1))).toEqual([])
    expect(race.state).toBe('lobby')
  })

  it('starts once there are enough of them', () => {
    const race = regatta()
    race.say('a', joins('Ann'))
    race.say('b', joins('Bob'))
    expect(transcript(race.tick(1))).toContain('racing')
    expect(race.state).toBe('racing')
  })

  it('hands out a different colour to each', () => {
    const race = regatta()
    race.say('a', joins('Ann'))
    race.say('b', joins('Bob'))
    const colors = race.fleet.map((sailor) => sailor.color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('does not count someone who only came to watch', () => {
    const race = regatta()
    race.say('a', joins('Ann'))
    race.say('b', watches('Bea'))
    race.tick(1)
    expect(race.state).toBe('lobby')
  })
})

describe('a race in progress', () => {
  function started(limits: Partial<RegattaLimits> = {}) {
    const race = regatta(limits)
    race.say('a', joins('Ann'))
    race.say('b', joins('Bob'))
    race.tick(1)
    return race
  }

  it('sends the fleet at the rate it says it will', () => {
    const race = started()
    const sent = [...Array(20)].flatMap(() => race.tick(1 / 20))
    expect(sent.filter((one) => one.message.kind === 'snapshot')).toHaveLength(20)
  })

  it('sends the scenario once and the boats thereafter', () => {
    const race = started()
    const sent = [...Array(40)].flatMap(() => race.tick(1 / 20))
    expect(sent.filter((one) => one.message.kind === 'racing')).toHaveLength(0)
    const snapshot = sent.find((one) => one.message.kind === 'snapshot')!.message
    expect(snapshot).toMatchObject({ kind: 'snapshot' })
    if (snapshot.kind === 'snapshot') expect(snapshot.boats).toHaveLength(2)
  })

  it('puts a latecomer in the lobby, and shows her the race', () => {
    const race = started()
    const sent = race.say('c', joins('Cat'))
    expect(transcript(sent)).toEqual(['welcome', 'racing', 'fleet'])
    expect(race.fleet.find((sailor) => sailor.id === 'c')?.waiting).toBe(true)
  })

  it('takes the helm from whoever is sailing the boat', () => {
    const race = started()
    expect(race.say('a', { kind: 'helm', rudder: 0.5 })).toEqual([])
    // Out of range is clamped rather than refused.
    race.say('a', { kind: 'helm', rudder: 4 })
    expect(() => race.tick(1)).not.toThrow()
  })
})

/**
 * Sail the regatta forward, keeping the named sailors talking so they are not taken for
 * gone. Robots need no helm and are never silent.
 */
function sail(
  race: Regatta,
  seconds: number,
  options: { alive?: readonly string[]; until?: () => boolean } = {},
): Addressed[] {
  const sent: Addressed[] = []
  const step = 1 / 20
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    for (const id of options.alive ?? []) race.say(id, { kind: 'helm', rudder: 0 })
    sent.push(...race.tick(step))
    if (options.until?.()) break
  }
  return sent
}

function resultsIn(sent: Addressed[]) {
  const found = sent.find((one) => one.message.kind === 'results')?.message
  return found?.kind === 'results' ? found.places : undefined
}

describe('how a race ends', () => {
  it('is over when every boat is home', () => {
    const race = regatta()
    race.addRobot('Rob')
    race.addRobot('Bot')
    race.tick(1)

    const places = resultsIn(sail(race, 400, { until: () => race.state === 'results' }))
    expect(places).toHaveLength(2)
    expect(places?.every((one) => one.outcome === 'finished')).toBe(true)
    expect(places?.map((one) => one.place).sort()).toEqual([1, 2])
  })

  /*
   * A boat can fail to finish without ever retiring: sail past the end of the line and
   * she is neither started nor over early nor coming back. Waiting for every boat would
   * wait for ever, so the rest of the fleet gets the winner's time and a bit.
   */
  it('gives the rest of the fleet thirty per cent on top of the winning time', () => {
    const race = regatta()
    race.addRobot('Rob')
    race.say('idle', joins('Drifter'))
    race.tick(1)

    const places = resultsIn(
      sail(race, 600, { alive: ['idle'], until: () => race.state === 'results' }),
    )
    expect(places?.find(isCalled('Rob'))?.outcome).toBe('finished')
    expect(places?.find(isCalled('Drifter'))?.outcome).toBe('timedOut')
  })

  it('abandons a race nobody finishes at all', () => {
    const race = regatta({ abandonAfter: 30 })
    race.say('a', joins('Ann'))
    race.say('b', joins('Bob'))
    race.tick(1)

    const places = resultsIn(
      sail(race, 60, { alive: ['a', 'b'], until: () => race.state === 'results' }),
    )
    expect(places?.every((one) => one.outcome === 'timedOut')).toBe(true)
  })

  it('retires a sailor who goes quiet, and does not wait for her', () => {
    const race = regatta({ idleAfter: 3, abandonAfter: 20 })
    race.say('a', joins('Ann'))
    race.say('b', joins('Bob'))
    race.tick(1)

    // Ann keeps talking; nothing is heard from Bob again.
    const places = resultsIn(
      sail(race, 60, { alive: ['a'], until: () => race.state === 'results' }),
    )
    expect(places?.find(isCalled('Bob'))?.outcome).toBe('retired')
    expect(race.fleet.some(isCalled('Bob'))).toBe(false)
  })

  it('goes back to the lobby and takes the next race', () => {
    const race = regatta({ resultsFor: 2 })
    race.addRobot('Rob')
    race.addRobot('Bot')
    race.tick(1)
    sail(race, 400, { until: () => race.state === 'results' })

    const after = sail(race, 5, { until: () => race.state !== 'results' })
    expect(race.state).toBe('racing')
    expect(after.filter((one) => one.message.kind === 'racing')).toHaveLength(1)
  })

  it('brings a sailor who was waiting into the next one', () => {
    const race = regatta({ resultsFor: 1 })
    race.addRobot('Rob')
    race.addRobot('Bot')
    race.tick(1)
    race.say('c', joins('Cat'))
    expect(race.fleet.find(isCalled('Cat'))?.waiting).toBe(true)

    sail(race, 400, { alive: ['c'], until: () => race.state === 'results' })
    sail(race, 5, { alive: ['c'], until: () => race.state === 'racing' })
    expect(race.fleet.find(isCalled('Cat'))?.waiting).toBe(false)
  })
})

describe('holding the gate', () => {
  /*
   * Every join tells the whole fleet, so a client repeating it turns one frame into as
   * many as there are sailors. Measured before this was closed: two thousand joins from
   * one connection produced twelve thousand messages to six onlookers.
   */
  it('answers a connection that joins twice with nothing', () => {
    const race = regatta()
    race.say('a', joins('Ann'))
    expect(transcript(race.say('a', joins('Ann')))).toEqual([])
    expect(transcript(race.say('a', joins('Someone')))).toEqual([])
    expect(race.fleet).toHaveLength(1)
  })

  it('keeps the name she joined under when she tries for another', () => {
    const race = regatta()
    race.say('a', joins('Ann'))
    race.say('a', joins('Bob'))
    expect(race.fleet[0]?.name).toBe('Blue (Ann)')
  })

  it('seats the racers it will sail and watches the rest', () => {
    const race = regatta({ maxRacers: 3, fleetSize: 10 })
    for (const id of ['a', 'b', 'c', 'd', 'e']) race.say(id, joins(id))

    const roles = race.fleet.map((sailor) => sailor.role)
    expect(roles).toEqual(['racer', 'racer', 'racer', 'observer', 'observer'])
  })

  it('tells the one it turned back that she is watching', () => {
    const race = regatta({ maxRacers: 1, fleetSize: 10 })
    race.say('a', joins('Ann'))
    const welcome = race.say('b', joins('Bob'))[0]!.message
    expect(welcome).toMatchObject({ kind: 'welcome', role: 'observer' })
  })

  it('never sails more boats than it seats', () => {
    const race = regatta({ maxRacers: 2 })
    for (const id of ['a', 'b', 'c', 'd']) race.say(id, joins(id))
    const racing = race.tick(1).find((one) => one.message.kind === 'racing')!.message
    expect(racing.kind === 'racing' && racing.scenario.boats).toHaveLength(2)
  })

  it('lets a seat go to the next arrival once it is given up', () => {
    const race = regatta({ maxRacers: 1, fleetSize: 10 })
    race.say('a', joins('Ann'))
    race.say('b', joins('Bob'))
    expect(race.fleet[1]?.role).toBe('observer')

    race.leave('a')
    race.say('c', joins('Cat'))
    expect(race.fleet.find((sailor) => sailor.id === 'c')?.role).toBe('racer')
  })
})

describe('telling a sailor which boat is hers', () => {
  it('calls her by her color when she gave no name', () => {
    const race = regatta()
    race.say('a', { kind: 'join', name: '' })
    expect(race.fleet[0]?.name).toBe('Blue')
  })

  it('hands every boat a color of its own', () => {
    const race = regatta({ fleetSize: 10 })
    for (const id of ['a', 'b', 'c']) race.say(id, joins(id))
    expect(race.fleet.map((one) => one.name)).toEqual(['Blue (a)', 'Red (b)', 'Green (c)'])
  })

  it('gives a color back when the boat wearing it goes', () => {
    const race = regatta({ fleetSize: 10 })
    race.say('a', joins('Ann'))
    race.say('b', joins('Bob'))
    race.leave('a')
    race.say('c', joins('Cat'))
    expect(race.fleet.find(isCalled('Cat'))?.name).toBe('Blue (Cat)')
  })

  /** An onlooker is not a boat, so she takes none of the colors the boats need. */
  it('marks an onlooker apart and leaves the palette alone', () => {
    const race = regatta({ fleetSize: 10 })
    race.say('w', watches('Wendy'))
    race.say('a', joins('Ann'))
    expect(race.fleet.find((one) => one.id === 'w')?.name).toBe('Watcher (Wendy)')
    expect(race.fleet.find(isCalled('Ann'))?.name).toBe('Blue (Ann)')
  })

  it('paints the boat the color it named', () => {
    const race = regatta()
    race.say('a', joins('Ann'))
    expect(race.fleet[0]?.color).toBe('#4fa3dd')
  })
})
