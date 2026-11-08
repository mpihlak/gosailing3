import { crewName, Robot } from './crew'
import { describePersonality } from '@/agents/ai'

/**
 * Sailors who are not people, for trying the online game without finding opponents.
 *
 *   npm run ai-player                           one robot against a server at home
 *   npm run ai-player -- wss://host --count 3   three of them, somewhere else
 *
 * They join over a socket like anybody else and sail by what the server tells them,
 * which is the point: nothing here looks at the world the server is keeping, only at
 * the messages a player's page would have received.
 *
 * They only race people. The server's health check says whether a person has opened the
 * regatta, and they go and join it when one has; the server sends them off again when
 * the last person has gone.
 */
const STEP_HZ = 60
/** Long enough apart that a pair do not all arrive on the same tick of the lobby. */
const APART = 400
/** How often she looks to see whether a person has opened the regatta. */
const LOOK_EVERY = 3000

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
  // Every other one goes to the other end, so a fleet of them starts on both tacks.
  const end = index % 2 === 0 ? 'pin' : 'committee'
  return new Robot({ url, name, end })
})

console.log(
  `${count} sailing at ${url}: ${crew.map((robot) => `${robot.name} (${robot.end})`).join(', ')}`,
)
for (const robot of crew) say(robot.name, describePersonality(robot.personality))

/** The server's health check, on the same host and port as the regatta. */
function healthOf(regatta: string): string {
  const at = new URL(regatta)
  at.protocol = at.protocol === 'wss:' ? 'https:' : 'http:'
  at.pathname = '/health'
  return at.toString()
}
const health = healthOf(url)

/** Join whoever is ashore if the regatta is open. A server that does not answer is left alone. */
async function lookIn(): Promise<void> {
  let open: boolean
  try {
    const answer = await fetch(health)
    open = ((await answer.json()) as { open?: unknown }).open === true
  } catch {
    return
  }
  if (!open) {
    for (const robot of crew) robot.regattaClosed()
    return
  }
  crew
    .filter((robot) => robot.ashore)
    .forEach((robot, index) => {
      setTimeout(() => {
        // Looked at again, because the last look may have sent her already.
        if (!robot.ashore) return
        robot.board()
        say(robot.name, 'joined')
      }, index * APART)
    })
}
void lookIn()
setInterval(() => void lookIn(), LOOK_EVERY)

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
    const race = robot.race
    if (!race) continue
    const { phase, you, rtt, trouble } = race
    const now = trouble ?? `${phase}${you ? ` as ${you}` : ''}`
    if (was.get(robot.name) === now) continue
    was.set(robot.name, now)
    say(robot.name, `${now}${rtt === undefined || trouble ? '' : ` (${rtt}ms)`}`)
  }
  const done = crew[0]?.race?.results
  if (done && was.get('results') !== JSON.stringify(done)) {
    was.set('results', JSON.stringify(done))
    for (const place of done) {
      say(
        'race',
        `${place.place ?? '-'} ${place.name} ${place.outcome} +${place.points} (${place.total})`,
      )
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
