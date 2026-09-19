import { describe, it, expect } from 'vitest'
import { vec } from '@/foundation/geom'
import { detectContacts, separationFor, type Body } from './index'

const boat = (id: string, x: number, y: number, radius = 6): Body => ({ id, position: vec(x, y), radius })

describe('detectContacts', () => {
  it('finds nothing when boats are clear of each other', () => {
    expect(detectContacts({ boats: [boat('a', 0, 0), boat('b', 100, 0)] })).toEqual([])
  })

  it('finds an overlap and measures how deep it is', () => {
    const [contact] = detectContacts({ boats: [boat('a', 0, 0), boat('b', 8, 0)] })
    expect(contact?.boatId).toBe('a')
    expect(contact?.otherId).toBe('b')
    expect(contact?.overlap).toBeCloseTo(4)
    expect(contact?.normal).toMatchObject({ x: -1, y: 0 }) // points from b back toward a
  })

  it('reports each pair once, not twice', () => {
    expect(detectContacts({ boats: [boat('a', 0, 0), boat('b', 5, 0), boat('c', 10, 0)] })).toHaveLength(3)
  })

  it('separates boats from marks and obstacles', () => {
    const contacts = detectContacts({
      boats: [boat('a', 0, 0)],
      marks: [{ id: 'windward', position: vec(3, 0), radius: 1.5 }],
      obstacles: [{ id: 'rock', position: vec(-4, 0), radius: 3 }],
    })
    expect(contacts.map((contact) => contact.kind)).toEqual(['mark', 'obstacle'])
  })

  it('survives two boats occupying the same point', () => {
    const [contact] = detectContacts({ boats: [boat('a', 0, 0), boat('b', 0, 0)] })
    expect(contact?.overlap).toBeCloseTo(12)
    expect(Number.isFinite(contact!.normal.x)).toBe(true)
  })

  it('touches without overlapping at exactly the combined radius', () => {
    expect(detectContacts({ boats: [boat('a', 0, 0), boat('b', 12, 0)] })).toEqual([])
  })
})

describe('separationFor', () => {
  it('splits the correction between two boats', () => {
    const [contact] = detectContacts({ boats: [boat('a', 0, 0), boat('b', 8, 0)] })
    expect(separationFor(contact!, true)).toMatchObject({ x: -2, y: 0 })
  })

  it('makes the boat give way entirely to a mark', () => {
    const [contact] = detectContacts({
      boats: [boat('a', 0, 0)],
      marks: [{ id: 'm', position: vec(5, 0), radius: 1.5 }],
    })
    expect(separationFor(contact!, false).x).toBeCloseTo(-2.5)
  })
})
