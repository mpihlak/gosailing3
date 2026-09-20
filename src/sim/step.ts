import { add } from '@/foundation/geom'
import {
  hullCentreline,
  hullRadius,
  stepBoat,
  type BoatInput,
  type BoatState,
  NEUTRAL_INPUT,
} from '@/domain/boat'
import {
  detectContacts,
  isTouching,
  separationFor,
  type Contact,
  type Hull,
} from '@/domain/collision'
import { lineEndBodies } from '@/domain/course'
import { encounter } from '@/domain/rules'
import { penalise, stepRace } from './race'
import type { SimEvent, TimedEvent } from './events'
import type { InputFrame, SimContext, WorldState } from './world'
import { raceTime, specFor } from './world'

export interface StepResult {
  readonly world: WorldState
  readonly events: readonly TimedEvent[]
}

/**
 * One tick. This is the only place in the game that knows what order things happen in:
 * the wind blows, boats answer their helms, hulls that overlap are pushed apart, and
 * then the race is judged on where everyone ended up.
 *
 * Pure. Given the same context, state and inputs it always produces the same result.
 */
export function step(ctx: SimContext, world: WorldState, inputs: InputFrame): StepResult {
  const { dt } = ctx.config
  const tick = world.tick + 1
  const time = world.time + dt

  const sailed = world.boats.map((boat) => {
    const input: BoatInput = inputs[boat.id] ?? NEUTRAL_INPUT
    const wind = ctx.wind.sample(boat.position, time)
    return stepBoat(boat, input, specFor(ctx, boat.id), { wind }, dt)
  })

  const { boats, contacts, nearby, keys } = resolveContacts(ctx, sailed, world.contacts)

  const { race, events: raceEvents } = stepRace(world.race, {
    course: ctx.course,
    specs: ctx.specs,
    previous: world.boats,
    current: boats,
    raceTime: raceTime(ctx, { ...world, time }),
  })

  // A contact is news on the tick it starts, not for every tick the boats stay locked.
  const progress = { ...race.progress }
  const penaltyEvents: SimEvent[] = []

  /*
   * One coming-together, one turn. Two hulls locked together touch and part many times a
   * second, and judging each of those separately once ran a boat up to nine hundred and
   * fifty outstanding penalties. An incident opens when a pair touches and stays open
   * while they are anywhere near each other; only once they have come properly apart can
   * the next touch be a fresh one.
   */
  const incidents: string[] = []
  const opened: Contact[] = []
  for (const contact of nearby) {
    const key = incidentKey(contact)
    if (world.incidents.includes(key) && !incidents.includes(key)) incidents.push(key)
  }

  for (const contact of contacts) {
    const key = incidentKey(contact)
    if (incidents.includes(key)) continue
    incidents.push(key)
    opened.push(contact)

    if (contact.kind !== 'boat') {
      // Touching a mark is her own affair, whoever else was about.
      penalise(progress, contact.boatId, contact.otherId, penaltyEvents)
      continue
    }

    // Who had to keep clear is asked of the tick before they touched: by now the hulls
    // have been pushed apart and the geometry that decided it is gone.
    const before = (id: string) => world.boats.find((boat) => boat.id === id)
    const one = before(contact.boatId)
    const two = before(contact.otherId)
    if (!one || !two) continue

    const verdict = encounter(
      { boat: one, spec: specFor(ctx, one.id) },
      { boat: two, spec: specFor(ctx, two.id) },
    )
    penalise(progress, verdict.keepClear, verdict.rightOfWay, penaltyEvents, verdict.rule)
  }

  const events: TimedEvent[] = [
    ...raceEvents.map((event) => ({ ...event, tick, time })),
    ...penaltyEvents.map((event) => ({ ...event, tick, time })),
    ...opened.map(
      (contact) =>
        ({
          kind: 'contact',
          boatId: contact.boatId,
          otherId: contact.otherId,
          with: contact.kind,
          tick,
          time,
        }) as const,
    ),
  ]

  return {
    world: { tick, time, boats, race: { ...race, progress }, contacts: keys, incidents },
    events,
  }
}

/** Names the pair, not the order they were found in, so one touch is one incident. */
function incidentKey(contact: Contact): string {
  return contact.kind === 'boat'
    ? `boat:${[contact.boatId, contact.otherId].sort().join('~')}`
    : keyOf(contact)
}

function keyOf(contact: Contact): string {
  return `${contact.kind}:${contact.boatId}:${contact.otherId}`
}

interface ContactResolution {
  readonly boats: BoatState[]
  /** Pairs actually into each other. */
  readonly contacts: Contact[]
  /** Those, and the pairs close enough to still count as the same incident. */
  readonly nearby: Contact[]
  readonly keys: string[]
}

/**
 * Push overlapping hulls apart and take the way off them. The rules decide who was at
 * fault; this only decides where the boats end up, which is a question of geometry.
 *
 * The speed penalty lands once, on the tick the boats touch. Charging it every tick of a
 * sustained overlap pins a boat against whatever it hit and holds it there at a dead
 * stop, because a 35% loss sixty times a second is a wall, not a collision.
 */
function resolveContacts(
  ctx: SimContext,
  boats: readonly BoatState[],
  ongoing: readonly string[],
): ContactResolution {
  const hulls: Hull[] = boats.map((boat) => {
    const spec = specFor(ctx, boat.id)
    return { id: boat.id, centreline: hullCentreline(boat, spec), radius: hullRadius(spec) }
  })

  // A boat length of clear water between them ends an incident.
  const clearance = Math.max(...boats.map((boat) => specFor(ctx, boat.id).length), 0)

  const nearby = detectContacts({
    margin: clearance,
    boats: hulls,
    // Rounding marks and the ends of the start line alike: all of them are marks of the
    // course, and all of them can be hit.
    marks: [
      ...ctx.course.marks.map((mark) => ({
        id: mark.id,
        position: mark.position,
        radius: mark.radius,
      })),
      ...lineEndBodies(ctx.course.stages),
    ],
    obstacles: ctx.course.obstacles.map((obstacle) => ({ ...obstacle, solid: true })),
  })
  const contacts = nearby.filter(isTouching)

  if (contacts.length === 0) {
    return { boats: [...boats], contacts, nearby, keys: [] }
  }

  const byId = new Map(boats.map((boat) => [boat.id, boat]))
  for (const contact of contacts) {
    const boat = byId.get(contact.boatId)
    if (!boat) continue
    const other = byId.get(contact.otherId)
    const shared = other !== undefined
    const isNew = !ongoing.includes(keyOf(contact))
    const soft = contact.soft
    const loss = soft ? ctx.config.markContactSpeedLoss : ctx.config.contactSpeedLoss
    /*
     * Something fixed goes on taking the way off a boat for as long as she leans on it,
     * or she grinds straight through: separating her by the overlap each tick does not
     * touch the speed that put her there.
     *
     * Two boats are not fixed, and charging them both every tick welded them together —
     * a pair wedged bow to bow ground each other to a standstill and stayed there for
     * the rest of the race. They pay once and sail on.
     */
    const fixed = !soft && other === undefined
    const slowing = isNew || fixed ? 1 - loss : 1

    byId.set(contact.boatId, {
      ...boat,
      position: soft ? boat.position : add(boat.position, separationFor(contact, shared)),
      speed: boat.speed * slowing,
    })
    if (other) {
      byId.set(contact.otherId, {
        ...other,
        position: add(other.position, separationFor({ ...contact, normal: negate(contact.normal) }, true)),
        speed: other.speed * slowing,
      })
    }
  }

  return {
    boats: boats.map((boat) => byId.get(boat.id) ?? boat),
    contacts,
    nearby,
    keys: contacts.map(keyOf),
  }
}

function negate(v: { x: number; y: number }) {
  return { x: -v.x, y: -v.y }
}
