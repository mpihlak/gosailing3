import { describe, it, expect, beforeEach } from 'vitest'
import { vec } from '@/foundation/geom'
import type { ScenarioSpec } from '@/sim'
import type { ServerMessage, Socket } from '@/net'
import { crewName, Robot } from './crew'

const SCENARIO: ScenarioSpec = {
  name: 'test',
  seed: 'seed',
  boats: [
    { id: 'c1', name: 'Ann', controller: 'human' },
    { id: 'c2', name: 'Bob', controller: 'human' },
  ],
  course: { legLength: 400, lineLength: 200, startCenter: vec(0, 0) },
  wind: { direction: 0, speed: 12 },
  config: { startSequence: 60 },
  duration: 2400,
}

/** Pointing away from the course, so anybody steering has something to do about it. */
const boats = (y: number) => [
  { id: 'c1', position: vec(0, y), heading: 180, speed: 5, turnRate: 0, twa: 180, course: 180, leeway: 0 },
]

class FakeSocket implements Socket {
  sent: string[] = []
  private listeners = new Map<string, (event: never) => void>()
  send(text: string) {
    this.sent.push(text)
  }
  close() {}
  addEventListener(type: 'open' | 'message' | 'close', listen: (event: never) => void) {
    this.listeners.set(type, listen)
    if (type === 'open') listen(undefined as never)
  }
  say(message: ServerMessage) {
    this.listeners.get('message')?.({ data: JSON.stringify(message) } as never)
  }
}

let socket: FakeSocket
let clock: number
let robot: Robot

beforeEach(() => {
  socket = new FakeSocket()
  clock = 0
  robot = new Robot({ url: 'ws://test', name: 'Ann', open: () => socket, now: () => clock })
  robot.join()
})

/** Every helm she has put on the wire. */
const helms = () =>
  socket.sent.map((text) => JSON.parse(text)).filter((one) => one.kind === 'helm')

function underway() {
  socket.say({ kind: 'welcome', you: 'c1', role: 'racer', phase: 'racing', fleet: [] })
  socket.say({ kind: 'racing', scenario: SCENARIO })
  // The first snapshot of a race always carries the report, and without it she has no
  // stage to sail to and rightly holds whatever heading she is on.
  socket.say({
    kind: 'snapshot',
    time: 1,
    boats: boats(-80),
    events: [],
    race: { c1: { status: 'racing', stageIndex: 0, penalties: 0, passedMark: false } },
  })
  clock += 1000 / 30
  socket.say({ kind: 'snapshot', time: 1.05, boats: boats(-79), events: [] })
  clock += 1000 / 30
}

describe('naming a crew', () => {
  it('hands them out in order', () => {
    expect([0, 1, 2].map(crewName)).toEqual(['Ann', 'Bob', 'Alice'])
  })

  it('numbers them once the list runs out, so no two share a name', () => {
    expect(crewName(10)).toBe('Ann2')
    expect(crewName(22)).toBe('Alice3')
  })
})

describe('a robot sailing by what she is told', () => {
  it('says who she is and asks to race', () => {
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ kind: 'join', name: 'Ann' })
  })

  it('holds the helm amidships before there is a race to sail', () => {
    robot.step()
    expect(helms().every((one) => one.rudder === 0)).toBe(true)
  })

  /*
   * The point of the whole thing: she is given no more than a player's page is given,
   * and steers from it. A boat pointed away from the course has something to correct.
   */
  it('puts the helm over once the server has told her where everyone is', () => {
    underway()
    for (let frame = 0; frame < 5; frame++) {
      robot.step()
      clock += 1000 / 60
    }
    const put = helms().map((one) => one.rudder)
    expect(put.some((rudder) => rudder !== 0)).toBe(true)
    expect(put.every((rudder) => Number.isFinite(rudder) && Math.abs(rudder) <= 1)).toBe(true)
  })

  it('says how she is getting on', () => {
    underway()
    expect(robot.standing()).toMatch(/kn/)
  })

  it('has nothing to report before the first race', () => {
    expect(robot.standing()).toBeUndefined()
  })
})
