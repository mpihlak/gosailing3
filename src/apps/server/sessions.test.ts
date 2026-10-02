import { describe, it, expect, beforeEach } from 'vitest'
import { vec } from '@/foundation/geom'
import { Regatta } from '@/net'
import type { ServerMessage } from '@/net'
import { Sessions, read } from './sessions'

const PACE = 4

function regatta() {
  let races = 0
  return new Regatta({
    race: (seed, sailors) => ({
      name: 'test',
      seed,
      boats: sailors.map((sailor) => ({ id: sailor.id, name: sailor.name, controller: 'ai' })),
      course: { legLength: 200, lineLength: 120, startCenter: vec(0, 0) },
      wind: { direction: 0, speed: 12 },
      config: { startSequence: 15 * PACE },
      duration: 2400,
    }),
    seed: () => `race-${++races}`,
    pace: PACE,
    colors: ['#111111', '#222222'],
  })
}

let written: { to: string; message: ServerMessage }[]
let sessions: Sessions

beforeEach(() => {
  written = []
  sessions = new Sessions(regatta(), (to, text) => written.push({ to, message: JSON.parse(text) }))
})

const kindsFor = (id: string) =>
  written.filter((one) => one.to === id).map((one) => one.message.kind)

describe('reading what arrives', () => {
  it('takes a join and a helm', () => {
    expect(read('{"kind":"join","name":"Ann"}')).toEqual({
      kind: 'join',
      name: 'Ann',
      role: 'racer',
    })
    expect(read('{"kind":"helm","rudder":0.5}')).toEqual({ kind: 'helm', rudder: 0.5 })
  })

  /*
   * Whatever arrives over a socket is whatever somebody chose to send, so none of it is
   * taken on trust: not the shape, not the types, not the length of a name.
   */
  it('refuses anything it does not recognise', () => {
    for (const text of ['', 'null', '[]', '"hello"', '{}', '{"kind":"quit"}', 'not json']) {
      expect(read(text)).toBeUndefined()
    }
  })

  it('refuses a helm that is not a number, and one that is not finite', () => {
    expect(read('{"kind":"helm","rudder":"hard over"}')).toBeUndefined()
    expect(read('{"kind":"helm","rudder":null}')).toBeUndefined()
    expect(read('{"kind":"helm"}')).toBeUndefined()
  })

  it('cuts a long name short and gives a nameless sailor one', () => {
    const long = read(`{"kind":"join","name":"${'x'.repeat(200)}"}`)
    expect(long?.kind === 'join' && long.name.length).toBe(20)
    expect(read('{"kind":"join","name":"   "}')).toMatchObject({ name: 'Sailor' })
    expect(read('{"kind":"join"}')).toMatchObject({ name: 'Sailor' })
  })

  /*
   * A name goes out to the whole fleet and onto boards built by interpolating into
   * `innerHTML`. Letters and digits cannot close a tag or open an attribute, and the
   * twenty character limit is no defence on its own: `<svg onload=alert()>` is twenty.
   */
  it('keeps only letters and digits in a name', () => {
    const cases: [string, string][] = [
      ['<svg onload=alert()>', 'svgonloadalert'],
      ['Ann', 'Ann'],
      ["Ann O'Brien", 'AnnOBrien'],
      ['<script>x</script>', 'scriptxscript'],
      ['\u0000\u0007bad', 'bad'],
      ['drop\ttabs and\nnewlines', 'droptabsandnewlines'],
    ]
    for (const [sent, kept] of cases) {
      expect(read(JSON.stringify({ kind: 'join', name: sent }))).toMatchObject({ name: kept })
    }
  })

  it('falls back to a name when nothing of one survives', () => {
    expect(read('{"kind":"join","name":"<>!@#"}')).toMatchObject({ name: 'Sailor' })
  })
})

describe('a socket talking to the regatta', () => {
  it('welcomes a sailor and tells the fleet', () => {
    sessions.received('c1', '{"kind":"join","name":"Ann"}')
    expect(kindsFor('c1')).toEqual(['welcome', 'fleet'])
  })

  it('writes the same line once for each of them', () => {
    sessions.received('c1', '{"kind":"join","name":"Ann"}')
    written = []
    sessions.received('c2', '{"kind":"join","name":"Bob"}')
    expect(kindsFor('c1')).toEqual(['fleet'])
    expect(kindsFor('c2')).toEqual(['welcome', 'fleet'])
  })

  it('starts the race for both of them, and then sends them boats', () => {
    sessions.received('c1', '{"kind":"join","name":"Ann"}')
    sessions.received('c2', '{"kind":"join","name":"Bob"}')
    written = []
    sessions.tick(1)
    expect(kindsFor('c1')).toContain('racing')
    expect(kindsFor('c2')).toContain('racing')

    written = []
    for (let n = 0; n < 20; n++) sessions.tick(1 / 20)
    expect(kindsFor('c1').filter((kind) => kind === 'snapshot')).toHaveLength(20)
  })

  it('says nothing to a socket that has closed', () => {
    sessions.received('c1', '{"kind":"join","name":"Ann"}')
    sessions.received('c2', '{"kind":"join","name":"Bob"}')
    sessions.closed('c2')
    written = []
    sessions.tick(1)
    expect(written.every((one) => one.to === 'c1')).toBe(true)
  })

  it('ignores a helm from a socket that never joined', () => {
    expect(() => sessions.received('nobody', '{"kind":"helm","rudder":1}')).not.toThrow()
    expect(written).toEqual([])
  })
})
