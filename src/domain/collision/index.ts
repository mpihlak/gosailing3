import {
  add,
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

/** A mark, an obstacle or a committee boat: not going anywhere, and hittable. */
export interface Body {
  readonly id: string
  /** Her middle. */
  readonly position: Vec2
  readonly radius: Meters
  /**
   * For something long: her centreline, stern to bow, exactly as a hull has one. Without
   * it she is round and her position is all there is to her. A committee boat is fourteen
   * meters by four and a half, and a circle round her middle is wrong in both directions
   * at once — the same reason a boat is not a circle either.
   */
  readonly centreline?: Segment
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
  /** Clear water between the two, negative when they are into each other. */
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
): Contact | null {
  if (gap >= reach) return null

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

function hullTouchesBody(
  hull: Hull,
  body: Body,
  kind: ContactKind,
): Contact | null {
  const closest = closestBetweenSegments(hull.centreline, extentOf(body))
  return contactFrom(
    hull.id,
    body.id,
    kind,
    closest.onFirst,
    closest.onSecond,
    closest.distance,
    hull.radius + body.radius,
    body.radius,
    body.solid !== true,
  )
}

/** Something round is a capsule whose centreline has no length. */
function extentOf(body: Body): Segment {
  return body.centreline ?? { from: body.position, to: body.position }
}

function hullTouchesHull(first: Hull, second: Hull): Contact | null {
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
  )
}

export interface ContactScene {
  readonly boats: readonly Hull[]
  readonly marks?: readonly Body[]
  readonly obstacles?: readonly Body[]
}

/** Whether a reported pair is actually into each other, rather than merely close. */
export function isTouching(contact: Contact): boolean {
  return contact.separation < 0
}

/**
 * Every overlap in the scene this tick. Detection only: what a contact costs a boat is a
 * racing question, not a geometric one, so the simulation decides that.
 *
 * A straight pairwise sweep. A fleet is tens of boats, not thousands, so a spatial index
 * would cost more to maintain than it saves.
 */
export function detectContacts(scene: ContactScene): Contact[] {
  const { boats, marks = [], obstacles = [] } = scene
  const contacts: Contact[] = []

  for (let i = 0; i < boats.length; i++) {
    const boat = boats[i] as Hull
    for (let j = i + 1; j < boats.length; j++) {
      const contact = hullTouchesHull(boat, boats[j] as Hull)
      if (contact) contacts.push(contact)
    }
    for (const mark of marks) {
      const contact = hullTouchesBody(boat, mark, 'mark')
      if (contact) contacts.push(contact)
    }
    for (const obstacle of obstacles) {
      const contact = hullTouchesBody(boat, obstacle, 'obstacle')
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
