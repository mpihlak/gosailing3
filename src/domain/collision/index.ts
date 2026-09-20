import {
  add,
  closestPointOnSegment,
  closestBetweenSegments,
  normalize,
  scale,
  sub,
  type Segment,
  type Vec2,
} from '@/foundation/geom'
import type { Meters } from '@/foundation/units'

/**
 * A boat, for the purposes of touching things: its centreline and half its beam. A hull
 * is three times longer than it is wide, so a circle round its middle is wrong in both
 * directions at once — far too wide abeam, and short of the bow.
 */
export interface Hull {
  readonly id: string
  /** Stern to bow. Its length is the hull length less the beam, so the capsule as a
   * whole is exactly as long as the boat. */
  readonly centreline: Segment
  /** Half the beam. */
  readonly radius: Meters
}

/** A mark or an obstacle: round, and not going anywhere. */
export interface Disc {
  readonly id: string
  readonly position: Vec2
  readonly radius: Meters
  /**
   * Solid things stop a boat. A buoy on a rope does not: she pushes it aside and sails
   * on, having earned a penalty. Soft is the default, because most of what is out there
   * to hit is inflatable.
   */
  readonly solid?: boolean
}

export type ContactKind = 'boat' | 'mark' | 'obstacle'

export interface Contact {
  /** The boat involved. Every contact has one. */
  readonly boatId: string
  readonly otherId: string
  readonly kind: ContactKind
  /** Unit vector pointing from the other body toward the boat. */
  readonly normal: Vec2
  /** Where they touch, on the surface of the other body. */
  readonly point: Vec2
  readonly overlap: Meters
  /**
   * Clear water between the two, negative when they are into each other. Reported so a
   * caller can tell a pair still involved with one another from a pair that has come
   * properly apart.
   */
  readonly separation: Meters
  /** Whether the other body gives way rather than stopping the boat. */
  readonly soft: boolean
}

function contactFrom(
  boatId: string,
  otherId: string,
  kind: ContactKind,
  onBoat: Vec2,
  onOther: Vec2,
  gap: Meters,
  reach: Meters,
  otherRadius: Meters,
  soft: boolean,
  margin: Meters,
): Contact | null {
  if (gap >= reach + margin) return null

  // Dead centre on top of each other leaves no meaningful direction; push north.
  const normal = gap === 0 ? { x: 0, y: 1 } : normalize(sub(onBoat, onOther))
  return {
    boatId,
    otherId,
    kind,
    normal,
    point: add(onOther, scale(normal, otherRadius)),
    overlap: reach - gap,
    separation: gap - reach,
    soft,
  }
}

function hullTouchesDisc(
  hull: Hull,
  disc: Disc,
  kind: ContactKind,
  margin: Meters,
): Contact | null {
  const nearest = closestPointOnSegment(hull.centreline, disc.position)
  const gap = Math.hypot(nearest.x - disc.position.x, nearest.y - disc.position.y)
  return contactFrom(
    hull.id,
    disc.id,
    kind,
    nearest,
    disc.position,
    gap,
    hull.radius + disc.radius,
    disc.radius,
    disc.solid !== true,
    margin,
  )
}

function hullTouchesHull(first: Hull, second: Hull, margin: Meters): Contact | null {
  const closest = closestBetweenSegments(first.centreline, second.centreline)
  return contactFrom(
    first.id,
    second.id,
    'boat',
    closest.onFirst,
    closest.onSecond,
    closest.distance,
    first.radius + second.radius,
    second.radius,
    false, // hulls stop each other
    margin,
  )
}

export interface ContactScene {
  readonly boats: readonly Hull[]
  readonly marks?: readonly Disc[]
  readonly obstacles?: readonly Disc[]
  /**
   * Also report pairs this close to touching. Nothing about the physics changes; it lets
   * a caller see a pair still in each other's company, which is how one incident is told
   * from the next.
   */
  readonly margin?: Meters
}

/** Whether a reported pair is actually into each other, rather than merely close. */
export function isTouching(contact: Contact): boolean {
  return contact.separation < 0
}

/**
 * Every overlap in the scene this tick, and, if a margin is given, every near miss too. Detection only: what a contact costs a boat is a
 * racing question, not a geometric one, so the simulation decides that.
 *
 * A straight pairwise sweep. A fleet is tens of boats, not thousands, so a spatial index
 * would cost more to maintain than it saves.
 */
export function detectContacts(scene: ContactScene): Contact[] {
  const { boats, marks = [], obstacles = [], margin = 0 } = scene
  const contacts: Contact[] = []

  for (let i = 0; i < boats.length; i++) {
    const boat = boats[i] as Hull
    for (let j = i + 1; j < boats.length; j++) {
      const contact = hullTouchesHull(boat, boats[j] as Hull, margin)
      if (contact) contacts.push(contact)
    }
    for (const mark of marks) {
      const contact = hullTouchesDisc(boat, mark, 'mark', margin)
      if (contact) contacts.push(contact)
    }
    for (const obstacle of obstacles) {
      const contact = hullTouchesDisc(boat, obstacle, 'obstacle', margin)
      if (contact) contacts.push(contact)
    }
  }
  return contacts
}

/**
 * Where a boat ends up once it is no longer inside what it hit. Two boats share the
 * correction; a boat that hits something fixed moves on its own, because the obstacle
 * will not.
 */
export function separationFor(contact: Contact, shared: boolean): Vec2 {
  return scale(contact.normal, shared ? contact.overlap / 2 : contact.overlap)
}
