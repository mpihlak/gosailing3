import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { Regatta } from '@/net'
import {
  FLEET_COLORS,
  GAME_PACE,
  randomSeed,
  regattaRace,
  WATCHER_COLOR,
} from '@/apps/game/scenario'
import { randomUUID } from 'node:crypto'
import { Files } from './journal'
import { Latency, type LatencySummary } from './latency'
import { Logbook } from './logbook'
import { Sessions } from './sessions'

/**
 * The regatta server: one race, run here, pushed to whoever is connected.
 *
 * It holds the world and the clock. A client sends the position of her helm and is told
 * where every boat is; nobody sails the race but this. Running it on each machine instead
 * would be cheaper on the wire and is what the simulation's purity invites, but the
 * trigonometry underneath is not required to be correctly rounded and two browsers would
 * come apart within a leg.
 */
const PORT = Number(process.env.PORT ?? 8080)
/** How often the race is stepped. The snapshots the fleet sees go out more slowly. */
const TICK_HZ = 60
/** How often each connection is pinged. Ten bytes, and it keeps the tunnel open too. */
const PING_HZ = 2
/** How often a sailor is told her own round trip. */
const TIMING_HZ = 1
/** How many of the most recent trips the number she is shown is taken from. */
const RECENT_TRIPS = 10
/** How often the journal gets a line for each sailor, in seconds. */
const LOG_EVERY = 10
/** Where every race is written down. Relative to where the server was started. */
const LOGS = process.env.GOSAILING_LOGS ?? 'logs'

const regatta = new Regatta({
  race: regattaRace,
  seed: randomSeed,
  pace: GAME_PACE,
  colors: FLEET_COLORS,
  watcherColor: WATCHER_COLOR,
})

const sockets = new Map<string, WebSocket>()
const latency = new Latency()
const round = (ms: number) => Math.round(ms)

const logbook = new Logbook({
  journal: new Files(LOGS),
  now: () => Date.now(),
  id: () => randomUUID().slice(0, 8),
})

const sessions = new Sessions(
  regatta,
  (id, text) => {
    const socket = sockets.get(id)
    if (socket?.readyState === socket?.OPEN) socket?.send(text)
  },
  {
    heard: (id, message) => logbook.heard(id, message),
    sent: (to, message) => {
      logbook.sent(to, message)
      if (message.kind !== 'results') return
      // The race as a whole, one line a sailor, written as the result goes out.
      for (const place of message.places) {
        const trips = latency.summary(place.boatId)
        console.log(`latency race ${place.name} ${place.outcome} ${spread(trips)}`)
      }
    },
  },
)

/** The shape of a set of round trips, or why there is none. */
function spread(trips: LatencySummary | undefined): string {
  if (!trips) return 'no round trips measured'
  const { samples, p50, p90, max } = trips
  return `n=${samples} p50 ${round(p50)}ms p90 ${round(p90)}ms max ${round(max)}ms`
}

/*
 * How the fleet is doing right now, rather than how the race went. Taken over the last
 * stretch alone, so a line that goes bad in the middle of a race shows as it happens
 * instead of being averaged away by the good minutes either side of it.
 */
setInterval(() => {
  for (const sailor of regatta.fleet) {
    const trips = latency.summary(sailor.id, PING_HZ * LOG_EVERY)
    if (trips) console.log(`latency now ${sailor.name} ${spread(trips)}`)
  }
}, LOG_EVERY * 1000)

/**
 * Sailors arrive over a websocket, but the port answers plain HTTP as well, so a deploy
 * can ask whether the thing came up and the tunnel in front of it has something to talk
 * to besides an upgrade.
 */
const web = createServer((request, response) => {
  if (request.url !== '/health') {
    response.writeHead(404)
    return response.end()
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ ok: true, phase: regatta.state, sailors: regatta.fleet.length }))
})

/**
 * A sailor sends two kinds of message and the larger is a join carrying a twenty
 * character name, so nothing legitimate comes near this. Left at the library's default a
 * single connection could hand us hundred megabyte frames to hold and parse.
 */
const MAX_FRAME = 1024

let connections = 0
const server = new WebSocketServer({ server: web, maxPayload: MAX_FRAME })

server.on('connection', (socket) => {
  const id = `c${++connections}`
  sockets.set(id, socket)
  socket.on('message', (data) => sessions.received(id, String(data)))
  // The ping carries the time it left, so the pong brings it back and nothing is held.
  socket.on('pong', (stamp) => latency.record(id, performance.now() - Number(stamp)))
  socket.on('close', () => {
    sockets.delete(id)
    latency.forget(id)
    sessions.closed(id)
  })
  socket.on('error', () => socket.close())
})

setInterval(() => {
  for (const socket of sockets.values()) {
    if (socket.readyState === socket.OPEN) socket.ping(String(performance.now()))
  }
}, 1000 / PING_HZ)

setInterval(() => {
  for (const [id, socket] of sockets) {
    const trips = latency.summary(id, RECENT_TRIPS)
    if (!trips || socket.readyState !== socket.OPEN) continue
    socket.send(JSON.stringify({ kind: 'timing', rtt: round(trips.p50) }))
  }
}, 1000 / TIMING_HZ)

let last = Date.now()
setInterval(() => {
  const now = Date.now()
  const elapsed = (now - last) / 1000
  last = now
  sessions.tick(elapsed)
}, 1000 / TICK_HZ)

// A race cut off by a restart is still worth what was written of it, so it is closed
// rather than left without an ending.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logbook.close()
    process.exit(0)
  })
}

web.listen(PORT, () => {
  console.log(`regatta on ws://localhost:${PORT}`)
  console.log(`races written to ${LOGS}`)
})
