import type { Seconds } from '@/foundation/units'
import type { Addressed, ClientMessage, Regatta } from '@/net'

/** How long a name may be before it is cut short. */
const NAME_LIMIT = 20

/**
 * Letters and digits, and nothing else.
 *
 * A name is the one string a sailor chooses, and it goes out to the whole fleet to be put
 * on their boards. Those are built by interpolating into `innerHTML`, where `<svg
 * onload=alert()>` is twenty characters and runs. Taking the markup out of the name here
 * leaves nothing to interpolate; the boards escape it as well, because a page can be
 * pointed at a server that does not.
 */
const NAME_ALLOWED = /[^A-Za-z0-9]/g

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
  ) {}

  received(id: string, text: string): void {
    const message = read(text)
    if (message) this.deliver(this.regatta.say(id, message))
  }

  closed(id: string): void {
    this.deliver(this.regatta.leave(id))
  }

  tick(dt: Seconds): void {
    this.deliver(this.regatta.tick(dt))
  }

  private deliver(sent: readonly Addressed[]): void {
    for (const { to, message } of sent) {
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
    const name =
      typeof message.name === 'string'
        ? message.name.replace(NAME_ALLOWED, '').slice(0, NAME_LIMIT)
        : ''
    const role = message.role === 'observer' ? 'observer' : 'racer'
    return { kind: 'join', name, role }
  }
  if (message.kind === 'helm' && typeof message.rudder === 'number') {
    if (!Number.isFinite(message.rudder)) return undefined
    return { kind: 'helm', rudder: message.rudder }
  }
  return undefined
}
