import { add } from '@/foundation/geom'
import {
  hullCentreline,
  hullRadius,
  stepBoat,
  type BoatInput,
  type BoatState,
  NEUTRAL_INPUT,
} from '@/domain/boat'
import { detectContacts, separationFor, type Contact, type Hull } from '@/domain/collision'
import { lineEndBodies } from '@/domain/course'
import { addPenalty, stepRace } from './race'
import type { TimedEvent } from './events'
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

  const { boats, contacts, keys } = resolveContacts(ctx, sailed, world.contacts)

  const { race, events: raceEvents } = stepRace(world.race, {
    course: ctx.course,
    specs: ctx.specs,
    previous: world.boats,
    current: boats,
    raceTime: raceTime(ctx, { ...world, time }),
  })

  // A contact is news on the tick it starts, not for every tick the boats stay locked.
  const fresh = contacts.filter((contact) => !world.contacts.includes(keyOf(contact)))
  const progress = { ...race.progress }
  for (const contact of fresh) {
    // Both boats carry the penalty. Which of them was in the wrong is a question for
    // the rules, and the rules are not the simulation's business.
    const involved = contact.kind === 'boat' ? [contact.boatId, contact.otherId] : [contact.boatId]
    for (const boatId of involved) {
      const penalised = progress[boatId]
      if (penalised) progress[boatId] = addPenalty(penalised)
    }
  }

  const events: TimedEvent[] = [
    ...raceEvents.map((event) => ({ ...event, tick, time })),
    ...fresh.map(
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
    world: { tick, time, boats, race: { ...race, progress }, contacts: keys },
    events,
  }
}

function keyOf(contact: Contact): string {
  return `${contact.kind}:${contact.boatId}:${contact.otherId}`
}

interface ContactResolution {
  readonly boats: BoatState[]
  readonly contacts: Contact[]
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

  const contacts = detectContacts({
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

  if (contacts.length === 0) {
    return { boats: [...boats], contacts, keys: [] }
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
    // Something solid goes on taking the way off a boat for as long as she leans on it,
    // or she grinds straight through: separating her by the overlap each tick does not
    // touch the speed that put her there. A buoy only charges her once, on the way past —
    // repeating that pinned boats motionless against marks.
    const slowing = isNew || !soft ? 1 - loss : 1

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
    keys: contacts.map(keyOf),
  }
}

function negate(v: { x: number; y: number }) {
  return { x: -v.x, y: -v.y }
}
