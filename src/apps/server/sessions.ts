import type { Seconds } from '@/foundation/units'
import {
  cleanName,
  type Addressed,
  type ClientMessage,
  type Regatta,
  type ServerMessage,
} from '@/net'

/**
 * Told what crosses a session, after it has been read and before it goes out.
 *
 * One place rather than a callback for each thing somebody wants to watch: the latency
 * log and the race recording both want the same traffic, for different reasons.
 */
export interface SessionWatcher {
  readonly heard?: (id: string, message: ClientMessage) => void
  readonly sent?: (to: readonly string[], message: ServerMessage) => void
}

/**
 * Everything between a socket and the regatta: reading what arrives, deciding what it
 * meant, and handing back the lines to write.
 *
 * Kept apart from the socket itself so it can be exercised without one. What arrives over
 * a socket is whatever anyone cared to send, so nothing here trusts its shape.
 */
export class Sessions {
  constructor(
    private readonly regatta: Regatta,
    private readonly send: (id: string, text: string) => void,
    /** Shown everything that crosses the session, for whatever wants to write it down. */
    private readonly watch: SessionWatcher = {},
  ) {}

  received(id: string, text: string): void {
    const message = read(text)
    if (!message) return
    this.watch.heard?.(id, message)
    this.deliver(this.regatta.say(id, message))
  }

  closed(id: string): void {
    this.deliver(this.regatta.leave(id))
  }

  tick(dt: Seconds): void {
    this.deliver(this.regatta.tick(dt))
  }

  private deliver(sent: readonly Addressed[]): void {
    for (const { to, message } of sent) {
      this.watch.sent?.(to, message)
      if (to.length === 0) continue
      // Written once however many it goes to: the fleet gets the same line.
      const text = JSON.stringify(message)
      for (const id of to) this.send(id, text)
    }
  }
}

/** What arrived, if it was anything we know. */
export function read(text: string): ClientMessage | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const message = parsed as Record<string, unknown>

  if (message.kind === 'join') {
    const name = typeof message.name === 'string' ? cleanName(message.name) : ''
    const role = message.role === 'observer' ? 'observer' : 'racer'
    return { kind: 'join', name, role, robot: message.robot === true }
  }
  if (message.kind === 'helm' && typeof message.rudder === 'number') {
    if (!Number.isFinite(message.rudder)) return undefined
    return { kind: 'helm', rudder: message.rudder }
  }
  if (message.kind === 'command') {
    if (message.command !== 'endRace' && message.command !== 'restart') return undefined
    return { kind: 'command', command: message.command }
  }
  return undefined
}
