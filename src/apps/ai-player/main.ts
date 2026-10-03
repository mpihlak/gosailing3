import { crewName, Robot } from './crew'

/**
 * Sailors who are not people, for trying the online game without finding opponents.
 *
 *   npm run ai-player                           one robot against a server at home
 *   npm run ai-player -- wss://host --count 3   three of them, somewhere else
 *
 * They join over a socket like anybody else and sail by what the server tells them,
 * which is the point: nothing here looks at the world the server is keeping, only at
 * the messages a player's page would have received.
 */
const STEP_HZ = 60
/** Long enough apart that a pair do not all arrive on the same tick of the lobby. */
const APART = 400

const args = process.argv.slice(2)
const url = args.find((arg) => !arg.startsWith('--')) ?? 'ws://localhost:8080'
const count = Math.max(1, Number(valueOf('--count') ?? 1))
const named = valueOf('--name')

function valueOf(flag: string): string | undefined {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}

const crew = Array.from({ length: count }, (_, index) => {
  const name = count === 1 && named ? named : (named ?? '') + crewName(index)
  return new Robot({ url, name })
})

console.log(`${count} sailing at ${url}: ${crew.map((robot) => robot.name).join(', ')}`)

for (const [index, robot] of crew.entries()) {
  setTimeout(() => {
    robot.join()
    say(robot.name, 'joined')
  }, index * APART)
}

const step = setInterval(() => {
  for (const robot of crew) robot.step()
}, 1000 / STEP_HZ)

// How the fleet is getting on, often enough to watch and seldom enough to read.
setInterval(() => {
  for (const robot of crew) {
    const standing = robot.standing()
    if (standing) say(robot.name, standing)
  }
}, 10_000)

/** What each of them is doing, said once each time it changes. */
const was = new Map<string, string>()
setInterval(() => {
  for (const robot of crew) {
    const { phase, you, rtt } = robot.race
    const now = `${phase}${you ? ` as ${you}` : ''}`
    if (was.get(robot.name) === now) continue
    was.set(robot.name, now)
    say(robot.name, `${now}${rtt === undefined ? '' : ` (${rtt}ms)`}`)
  }
  const done = crew[0]?.race.results
  if (done && was.get('results') !== JSON.stringify(done)) {
    was.set('results', JSON.stringify(done))
    for (const place of done) {
      say('race', `${place.place ?? '-'} ${place.name} ${place.outcome}`)
    }
  }
}, 250)

function say(who: string, what: string): void {
  console.log(`${new Date().toISOString().slice(11, 19)} ${who.padEnd(8)} ${what}`)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(step)
    for (const robot of crew) robot.leave()
    console.log('\nashore')
    process.exit(0)
  })
}
