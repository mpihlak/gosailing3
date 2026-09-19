import { distance, normalize, scale, sub, add, type Vec2 } from '@/foundation/geom'
import type { Meters } from '@/foundation/units'

export interface Body {
  readonly id: string
  readonly position: Vec2
  readonly radius: Meters
}

export type ContactKind = 'boat' | 'mark' | 'obstacle'

export interface Contact {
  /** The boat involved. Every contact has one. */
  readonly boatId: string
  /** What it hit: another boat, a mark, or an obstacle. */
  readonly otherId: string
  readonly kind: ContactKind
  /** Unit vector pointing from the other body toward the boat. */
  readonly normal: Vec2
  readonly point: Vec2
  readonly overlap: Meters
}

function contactBetween(boat: Body, other: Body, kind: ContactKind): Contact | null {
  const gap = distance(boat.position, other.position)
  const reach = boat.radius + other.radius
  if (gap >= reach) return null

  // Two bodies exactly on top of each other have no meaningful normal; push north.
  const normal = gap === 0 ? { x: 0, y: 1 } : normalize(sub(boat.position, other.position))
  return {
    boatId: boat.id,
    otherId: other.id,
    kind,
    normal,
    point: add(other.position, scale(normal, other.radius)),
    overlap: reach - gap,
  }
}

export interface ContactScene {
  readonly boats: readonly Body[]
  readonly marks?: readonly Body[]
  readonly obstacles?: readonly Body[]
}

/**
 * Every overlap in the scene this tick. Detection only: what a contact costs a boat is
 * a racing question, not a geometric one, so the simulation decides that.
 *
 * A straight pairwise sweep. A fleet is tens of boats, not thousands, so a spatial index
 * would cost more to maintain than it saves.
 */
export function detectContacts(scene: ContactScene): Contact[] {
  const { boats, marks = [], obstacles = [] } = scene
  const contacts: Contact[] = []

  for (let i = 0; i < boats.length; i++) {
    const boat = boats[i] as Body
    for (let j = i + 1; j < boats.length; j++) {
      const contact = contactBetween(boat, boats[j] as Body, 'boat')
      if (contact) contacts.push(contact)
    }
    for (const mark of marks) {
      const contact = contactBetween(boat, mark, 'mark')
      if (contact) contacts.push(contact)
    }
    for (const obstacle of obstacles) {
      const contact = contactBetween(boat, obstacle, 'obstacle')
      if (contact) contacts.push(contact)
    }
  }
  return contacts
}

/**
 * Where a boat ends up once it is no longer inside what it hit. Two boats share the
 * correction; a boat that hits a mark moves on its own, because the mark will not.
 */
export function separationFor(contact: Contact, shared: boolean): Vec2 {
  return scale(contact.normal, shared ? contact.overlap / 2 : contact.overlap)
}
