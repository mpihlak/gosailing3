import { WebSocketServer, type WebSocket } from 'ws'
import { Regatta } from '@/net'
import { FLEET_COLORS, GAME_PACE, randomSeed, regattaRace } from '@/apps/game/scenario'
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
})

const sockets = new Map<string, WebSocket>()
const sessions = new Sessions(regatta, (id, text) => {
  const socket = sockets.get(id)
  if (socket?.readyState === socket?.OPEN) socket?.send(text)
})

let connections = 0
const server = new WebSocketServer({ port: PORT })

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

console.log(`regatta on ws://localhost:${PORT}`)
