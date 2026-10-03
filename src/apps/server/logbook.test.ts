import { describe, it, expect, beforeEach } from 'vitest'
import { vec } from '@/foundation/geom'
import type { ScenarioSpec, ServerMessage } from '@/net'
import { Logbook, type Journal } from './logbook'

const race = (seed: string): ScenarioSpec => ({
  name: 'test',
  seed,
  boats: [
    { id: 'c1', name: 'Blue (Ann)', controller: 'human' },
    { id: 'c2', name: 'Red (Bob)', controller: 'human' },
  ],
  course: { legLength: 200, lineLength: 120, startCenter: vec(0, 0) },
  wind: { direction: 0, speed: 12 },
  config: { startSequence: 60 },
  duration: 2400,
})

const racing = (seed: string): ServerMessage => ({ kind: 'racing', scenario: race(seed) })
const results = (): ServerMessage => ({
  kind: 'results',
  places: [{ boatId: 'c1', name: 'Blue (Ann)', outcome: 'finished', place: 1 }],
  nextRaceIn: 5,
})

/** A journal that keeps what it was told, so a recording can be read back in a test. */
class Paper implements Journal {
  files: { name: string; lines: unknown[] }[] = []
  indexed: unknown[] = []
  private open: { name: string; lines: unknown[] } | undefined
  begin(name: string) {
    this.finish()
    this.open = { name, lines: [] }
    this.files.push(this.open)
  }
  write(line: string) {
    this.open?.lines.push(JSON.parse(line))
  }
  finish() {
    this.open = undefined
  }
  index(line: string) {
    this.indexed.push(JSON.parse(line))
  }
}

let paper: Paper
let clock: number
let ids: number
let logbook: Logbook

beforeEach(() => {
  paper = new Paper()
  clock = Date.parse('2026-10-03T08:00:00.000Z')
  ids = 0
  logbook = new Logbook({ journal: paper, now: () => clock, id: () => `id${++ids}` })
})

const only = () => paper.files[0]!
const kinds = (lines: readonly unknown[]) => lines.map((one) => (one as { t: string }).t)

describe('writing a race down', () => {
  it('writes nothing at all until a race starts', () => {
    logbook.heard('c1', { kind: 'helm', rudder: 0.5 })
    expect(paper.files).toEqual([])
    expect(logbook.racing).toBeUndefined()
  })

  it('opens a file named for when it began and what it is called', () => {
    logbook.sent(['c1', 'c2'], racing('seed-a'))
    expect(only().name).toBe('20261003T080000Z-id1.jsonl')
    expect(logbook.racing).toBe('id1')
  })

  it('heads it with the scenario, so a replayer needs nothing else to build the race', () => {
    logbook.sent(['c1', 'c2'], racing('seed-a'))
    const header = only().lines[0] as {
      t: string
      id: string
      seed: string
      scenario: ScenarioSpec
    }
    expect(header.t).toBe('race')
    expect(header.id).toBe('id1')
    expect(header.seed).toBe('seed-a')
    expect(header.scenario.boats).toHaveLength(2)
  })

  it('keeps what went out and what came back, stamped from the start of the race', () => {
    logbook.sent(['c1', 'c2'], racing('seed-a'))
    clock += 250
    logbook.heard('c1', { kind: 'helm', rudder: 0.5 })
    clock += 50
    logbook.sent(['c1', 'c2'], { kind: 'snapshot', time: 1, boats: [], events: [] })

    // The `racing` message is in the stream too: a replayer plays the file at the game
    // and the game builds the race from it, exactly as it did the first time.
    expect(kinds(only().lines)).toEqual(['race', 'out', 'in', 'out'])
    expect(only().lines[1]).toMatchObject({ ms: 0, m: { kind: 'racing' } })
    expect(only().lines[2]).toMatchObject({ ms: 250, from: 'c1', m: { rudder: 0.5 } })
    expect(only().lines[3]).toMatchObject({ ms: 300, to: ['c1', 'c2'] })
  })

  it('closes on the result and says how it ended', () => {
    logbook.sent(['c1', 'c2'], racing('seed-a'))
    clock += 90_000
    logbook.sent(['c1', 'c2'], results())

    const footer = only().lines.at(-1) as { t: string; ending: string; ms: number }
    expect(footer).toMatchObject({ t: 'over', ending: 'scored', ms: 90_000 })
    expect(logbook.racing).toBeUndefined()
  })
})

describe('telling one race from another', () => {
  /*
   * A sailor who arrives mid-race is sent the race she is watching, with the seed it has
   * been running under. That is not a new race, and recording it as one would cut the
   * file in half every time somebody looked in.
   */
  it('does not start a new file for a latecomer sent the race in progress', () => {
    logbook.sent(['c1', 'c2'], racing('seed-a'))
    logbook.sent(['c3'], racing('seed-a'))
    expect(paper.files).toHaveLength(1)
    expect(logbook.racing).toBe('id1')
  })

  it('starts a new file when the start is made again under a new seed', () => {
    logbook.sent(['c1', 'c2'], racing('seed-a'))
    clock += 4000
    logbook.sent(['c1', 'c2', 'c3'], racing('seed-b'))

    expect(paper.files.map((file) => file.name)).toHaveLength(2)
    expect(logbook.racing).toBe('id2')
    // The one it replaced is closed off rather than left dangling.
    expect(paper.files[0]!.lines.at(-1)).toMatchObject({ t: 'over', ending: 'abandoned' })
  })

  it('closes an unfinished race when the server is going away', () => {
    logbook.sent(['c1', 'c2'], racing('seed-a'))
    logbook.close()
    expect(only().lines.at(-1)).toMatchObject({ t: 'over', ending: 'abandoned' })
    expect(logbook.racing).toBeUndefined()
  })
})

describe('the index of races', () => {
  it('gets a line a race, with the id and when it ran', () => {
    logbook.sent(['c1', 'c2'], racing('seed-a'))
    clock += 90_000
    logbook.sent(['c1', 'c2'], results())

    expect(paper.indexed).toEqual([
      {
        id: 'id1',
        file: '20261003T080000Z-id1.jsonl',
        from: '2026-10-03T08:00:00.000Z',
        to: '2026-10-03T08:01:30.000Z',
        ms: 90_000,
        ending: 'scored',
        sailors: ['Blue (Ann)', 'Red (Bob)'],
      },
    ])
  })

  it('lists an abandoned race too, so nothing on disk is a surprise', () => {
    logbook.sent(['c1', 'c2'], racing('seed-a'))
    logbook.close()
    expect(paper.indexed).toMatchObject([{ ending: 'abandoned' }])
  })
})
