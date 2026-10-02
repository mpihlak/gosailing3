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

const regatta = new Regatta({
  race: regattaRace,
  seed: randomSeed,
  pace: GAME_PACE,
  colors: FLEET_COLORS,
  watcherColor: WATCHER_COLOR,
})

const sockets = new Map<string, WebSocket>()
const sessions = new Sessions(regatta, (id, text) => {
  const socket = sockets.get(id)
  if (socket?.readyState === socket?.OPEN) socket?.send(text)
})

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
  socket.on('close', () => {
    sockets.delete(id)
    sessions.closed(id)
  })
  socket.on('error', () => socket.close())
})

let last = Date.now()
setInterval(() => {
  const now = Date.now()
  const elapsed = (now - last) / 1000
  last = now
  sessions.tick(elapsed)
}, 1000 / TICK_HZ)

web.listen(PORT, () => console.log(`regatta on ws://localhost:${PORT}`))
