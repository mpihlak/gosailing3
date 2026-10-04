import { describe, it, expect, beforeEach } from 'vitest'
import { vec } from '@/foundation/geom'
import type { ScenarioSpec } from '@/sim'
import { HELM_HZ, SNAPSHOT_HZ, type ServerMessage } from './protocol'
import { OnlineRace, type Socket } from './online'

const SCENARIO: ScenarioSpec = {
  name: 'test',
  seed: 'seed',
  boats: [
    { id: 'c1', name: 'Ann', controller: 'human' },
    { id: 'c2', name: 'Bob', controller: 'human' },
  ],
  course: { legLength: 200, lineLength: 120, startCenter: vec(0, 0) },
  wind: { direction: 0, speed: 12 },
  config: { startSequence: 60 },
  duration: 2400,
}

/** A socket that goes nowhere, so the transport can be talked to directly. */
class FakeSocket implements Socket {
  sent: string[] = []
  closed = false
  private listeners = new Map<string, (event: never) => void>()
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.closed = true
  }
  addEventListener(type: 'open' | 'message' | 'close', listen: (event: never) => void) {
    this.listeners.set(type, listen)
  }
  open() {
    this.listeners.get('open')?.(undefined as never)
  }
  say(message: ServerMessage) {
    this.listeners.get('message')?.({ data: JSON.stringify(message) } as never)
  }
  hangUp() {
    this.listeners.get('close')?.(undefined as never)
  }
}

let socket: FakeSocket
let race: OnlineRace
let rudder = 0
let clock = 0

beforeEach(() => {
  socket = new FakeSocket()
  rudder = 0
  clock = 0
  race = new OnlineRace({
    url: 'ws://test',
    name: 'Ann',
    helm: () => rudder,
    open: () => socket,
    now: () => clock,
  })
  race.join()
})

const boatsAt = (x: number) => [
  { id: 'c1', position: vec(x, 0), heading: 40, speed: 6, turnRate: 0, twa: 40, course: 40, leeway: 0 },
]

describe('joining', () => {
  it('says who she is as soon as the socket opens', () => {
    socket.open()
    expect(JSON.parse(socket.sent[0]!)).toEqual({ kind: 'join', name: 'Ann', role: 'racer' })
  })

  it('learns her own boat from the welcome, and watches it', () => {
    socket.say({ kind: 'welcome', you: 'c1', role: 'racer', phase: 'lobby', fleet: [] })
    expect(race.you).toBe('c1')
    expect(race.watching).toBe('c1')
  })

  it('leaves an observer watching nobody in particular', () => {
    socket.say({ kind: 'welcome', you: 'c9', role: 'observer', phase: 'racing', fleet: [] })
    expect(race.role).toBe('observer')
    expect(race.watching).toBeUndefined()
  })

  it('builds the same race the server is sailing, from the seed alone', () => {
    socket.say({ kind: 'racing', scenario: SCENARIO })
    expect(race.simulation?.ctx.course.marks).toHaveLength(1)
    expect(race.simulation?.names).toMatchObject({ c1: 'Ann', c2: 'Bob' })
    // The wind is a function of where and when, so it never comes over the wire.
    expect(race.simulation?.wind.median.speed).toBeGreaterThan(0)
  })

  it('says why when her place goes to a person, and keeps saying it once the line closes', () => {
    socket.say({ kind: 'removed' })
    socket.hangUp()
    expect(race.trouble).toBe('Gave up her place to a person.')
  })

  it('keeps talking while it waits, or it would be taken for gone', () => {
    socket.open()
    socket.sent = []
    race.sendHelm()
    expect(JSON.parse(socket.sent[0]!)).toEqual({ kind: 'helm', rudder: 0 })
  })

  /*
   * The helm is asked for every frame and sent the moment it moves. Waiting for a fixed
   * cadence cost twenty-five milliseconds on average, on a message of thirty bytes.
   */
  describe('saying where the helm is', () => {
    const helms = () => socket.sent.map((text) => JSON.parse(text)).filter((m) => m.kind === 'helm')

    beforeEach(() => {
      socket.open()
      socket.say({ kind: 'racing', scenario: SCENARIO })
      socket.say({ kind: 'welcome', you: 'c1', role: 'racer', phase: 'racing', fleet: [] })
      socket.sent = []
    })

    it('goes the moment the tiller moves, without waiting for the beat', () => {
      race.sendHelm()
      socket.sent = []
      clock += 1
      rudder = 0.4
      race.sendHelm()
      expect(helms()).toEqual([{ kind: 'helm', rudder: 0.4 }])
    })

    it('falls back to the slow beat for a tiller held still', () => {
      race.sendHelm()
      socket.sent = []
      // A second of frames with nobody touching the helm.
      const frames = 60
      for (let frame = 0; frame < frames; frame++) {
        clock += 1000 / 60
        race.sendHelm()
      }
      /*
       * The beat, not one message a frame. It is not exactly HELM_HZ: three frames of
       * 16.667ms fall a hair short of the 50ms it waits for, so it slips to four. That
       * is well inside the ten seconds of silence the server allows.
       */
      expect(helms().length).toBeGreaterThanOrEqual(HELM_HZ / 2)
      expect(helms().length).toBeLessThanOrEqual(HELM_HZ)
      expect(helms().length).toBeLessThan(frames / 2)
    })

    it('still speaks up on the beat when nothing has moved', () => {
      race.sendHelm()
      socket.sent = []
      clock += 1000 / HELM_HZ + 1
      race.sendHelm()
      expect(helms()).toHaveLength(1)
    })

    it('ignores a hair of movement, which is a thumb and not a course change', () => {
      rudder = 0.4
      race.sendHelm()
      socket.sent = []
      clock += 1
      rudder = 0.4005
      race.sendHelm()
      expect(helms()).toEqual([])
    })
  })

  it('sends the helm once the race is on', () => {
    socket.open()
    socket.say({ kind: 'racing', scenario: SCENARIO })
    rudder = -0.4
    socket.sent = []
    race.sendHelm()
    expect(JSON.parse(socket.sent[0]!)).toEqual({ kind: 'helm', rudder: -0.4 })
  })
})

describe('drawing what the server says', () => {
  beforeEach(() => {
    socket.say({ kind: 'welcome', you: 'c1', role: 'racer', phase: 'lobby', fleet: [] })
    socket.say({ kind: 'racing', scenario: SCENARIO })
  })

  it('has nothing to draw before anything arrives', () => {
    expect(race.frameAt(0)).toBeUndefined()
  })

  /** One snapshot interval apart, arriving when they say they do. */
  const GAP = 1000 / SNAPSHOT_HZ
  const twoSnapshots = () => {
    clock = 0
    socket.say({ kind: 'snapshot', time: 1, boats: boatsAt(0), events: [] })
    clock = GAP
    socket.say({ kind: 'snapshot', time: 1.05, boats: boatsAt(10), events: [] })
  }

  it('slides the fleet between the last two, rather than jumping', () => {
    twoSnapshots()
    // Drawn one message behind, so two intervals on the clock is the newer of the two.
    expect(race.frameAt(GAP)?.boats[0]?.position.x).toBeCloseTo(0)
    expect(race.frameAt(GAP * 1.5)?.boats[0]?.position.x).toBeCloseTo(5)
    expect(race.frameAt(GAP * 2)?.boats[0]?.position.x).toBeCloseTo(10)
  })

  it('holds on the last one rather than running ahead of it', () => {
    twoSnapshots()
    expect(race.frameAt(5000)?.boats[0]?.position.x).toBeCloseTo(10)
  })

  it('keeps the standing of each boat from the last time it was sent', () => {
    socket.say({
      kind: 'snapshot',
      time: 1,
      boats: boatsAt(0),
      events: [],
      race: { c1: { status: 'racing', stageIndex: 1, penalties: 2, passedMark: true } },
    })
    clock = 50
    socket.say({ kind: 'snapshot', time: 1.05, boats: boatsAt(1), events: [] })
    const drawn = race.frameAt(100)
    expect(drawn?.race.progress.c1).toMatchObject({
      status: 'racing',
      stageIndex: 1,
      penalties: 2,
      // Without this a boat steering by the wire would never finish rounding a mark.
      passedMark: true,
    })
  })

  it('puts the finishers in order', () => {
    socket.say({
      kind: 'snapshot',
      time: 9,
      boats: boatsAt(0),
      events: [],
      race: {
        c1: { status: 'finished', stageIndex: 3, penalties: 0, passedMark: false, place: 2 },
        c2: { status: 'finished', stageIndex: 3, penalties: 0, passedMark: false, place: 1 },
      },
    })
    clock = 50
    socket.say({ kind: 'snapshot', time: 9.05, boats: boatsAt(1), events: [] })
    expect(race.frameAt(100)?.race.finishOrder).toEqual(['c2', 'c1'])
  })
})

describe('what the race has done', () => {
  beforeEach(() => {
    socket.say({ kind: 'welcome', you: 'c1', role: 'racer', phase: 'lobby', fleet: [] })
    socket.say({ kind: 'racing', scenario: SCENARIO })
  })

  it('keeps what came with the boats, so a banner can be made of it', () => {
    socket.say({
      kind: 'snapshot',
      time: 1,
      boats: boatsAt(0),
      events: [{ kind: 'penalised', boatId: 'c1', otherId: 'c2', rule: 11, tick: 1, time: 1 }],
    })
    expect(race.takeEvents()).toEqual([
      { kind: 'penalised', boatId: 'c1', otherId: 'c2', rule: 11, tick: 1, time: 1 },
    ])
  })

  it('hands each one over once', () => {
    socket.say({
      kind: 'snapshot',
      time: 1,
      boats: boatsAt(0),
      events: [{ kind: 'raceStarted', tick: 1, time: 1 }],
    })
    expect(race.takeEvents()).toHaveLength(1)
    expect(race.takeEvents()).toHaveLength(0)
  })

  it('gathers up everything between one ask and the next', () => {
    for (const time of [1, 2, 3]) {
      socket.say({
        kind: 'snapshot',
        time,
        boats: boatsAt(time),
        events: [{ kind: 'markRounded', boatId: 'c1', markId: 'windward', tick: time, time }],
      })
    }
    expect(race.takeEvents()).toHaveLength(3)
  })

  it('drops what belonged to the race before', () => {
    socket.say({
      kind: 'snapshot',
      time: 1,
      boats: boatsAt(0),
      events: [{ kind: 'raceStarted', tick: 1, time: 1 }],
    })
    socket.say({ kind: 'racing', scenario: SCENARIO })
    expect(race.takeEvents()).toEqual([])
  })
})

describe('when it ends', () => {
  it('keeps the result and says so', () => {
    socket.say({
      kind: 'results',
      places: [{ boatId: 'c1', name: 'Ann', outcome: 'finished', place: 1, points: 2, total: 2 }],
      nextRaceIn: 5,
    })
    expect(race.phase).toBe('results')
    expect(race.results).toHaveLength(1)
  })

  /** The card counts the wait down, so the fleet is never left wondering. */
  it('counts down to the next race', () => {
    clock = 10_000
    socket.say({
      kind: 'results',
      places: [{ boatId: 'c1', name: 'Ann', outcome: 'finished', place: 1, points: 2, total: 2 }],
      nextRaceIn: 5,
    })
    expect(race.secondsToNextRace(10_000)).toBe(5)
    expect(race.secondsToNextRace(11_200)).toBe(4)
    expect(race.secondsToNextRace(14_100)).toBe(1)
    expect(race.secondsToNextRace(15_000)).toBe(0)
    // It stops at nothing rather than running away into negatives.
    expect(race.secondsToNextRace(30_000)).toBe(0)
  })

  it('loses only the countdown when a server does not say', () => {
    socket.say({
      kind: 'results',
      places: [],
      nextRaceIn: 'soon',
    } as unknown as Parameters<typeof socket.say>[0])
    expect(race.phase).toBe('results')
    expect(race.secondsToNextRace(0)).toBeUndefined()
  })

  /** Her own round trip, which only the server can measure, and only for her. */
  it('takes the round trip the server reports', () => {
    expect(race.rtt).toBeUndefined()
    socket.say({ kind: 'timing', rtt: 26 })
    expect(race.rtt).toBe(26)
  })

  it('refuses a round trip that is not a number', () => {
    socket.say({ kind: 'timing', rtt: 26 })
    socket.say({ kind: 'timing', rtt: 'quick' } as unknown as ServerMessage)
    expect(race.rtt).toBeUndefined()
  })

  it('carries on when the server says something it has never heard of', () => {
    socket.say({ kind: 'weather', outlook: 'brisk' } as unknown as ServerMessage)
    expect(race.trouble).toBeUndefined()
    expect(race.phase).toBe('lobby')
  })

  it('notices the connection going away', () => {
    expect(race.trouble).toBeUndefined()
    socket.hangUp()
    expect(race.trouble).toContain('closed')
  })
})

/*
 * A boat whose sailor has gone keeps sailing: the server hands her a helm amidships and
 * she holds her last heading. Two robots did exactly that for forty seconds, dead
 * straight to the horizon, while the one human left wondered what they were doing.
 */
describe('noticing that somebody has gone', () => {
  const crew = (...names: string[]) =>
    names.map((name) => ({
      id: name,
      name,
      colorName: name,
      role: 'racer' as const,
      color: '#4fa3dd',
      waiting: false,
      host: false,
    }))

  const fleet = (...names: string[]) =>
    socket.say({ kind: 'fleet', phase: 'racing', fleet: crew(...names) })

  it('says nothing about a fleet that has only grown', () => {
    fleet('Ann')
    fleet('Ann', 'Bob')
    expect(race.takeDepartures()).toEqual([])
  })

  it('names whoever is no longer in it', () => {
    fleet('Ann', 'Bob', 'Cat')
    fleet('Ann')
    expect(race.takeDepartures().map((one) => one.name)).toEqual(['Bob', 'Cat'])
  })

  it('says it once', () => {
    fleet('Ann', 'Bob')
    fleet('Ann')
    expect(race.takeDepartures()).toHaveLength(1)
    expect(race.takeDepartures()).toEqual([])
  })

  it('keeps the fleet it was given', () => {
    fleet('Ann', 'Bob')
    fleet('Ann')
    expect(race.fleet.map((one) => one.name)).toEqual(['Ann'])
  })
})
