import type { ClientMessage, Placing, ServerMessage } from '@/net'

/**
 * Where a logbook puts its lines. A file per race and one index of them all, kept behind
 * an interface so the shape of a recording can be read in a test without a disk.
 */
export interface Journal {
  /** Start a race's file. Any file already open is finished first. */
  begin(name: string): void
  write(line: string): void
  finish(): void
  /** One line about a race that has ended, appended to the index of all of them. */
  index(line: string): void
}

export interface LogbookOptions {
  readonly journal: Journal
  /** Wall clock, in milliseconds since the epoch. */
  readonly now: () => number
  /** A fresh race id. Short, because it is a thing people quote to each other. */
  readonly id: () => string
}

/** What was happening when a race's file was closed. */
export type Ending = 'scored' | 'abandoned'

interface Open {
  readonly id: string
  readonly seed: string
  readonly began: number
  readonly sailors: readonly { readonly id: string; readonly name: string }[]
}

/**
 * Every race, written down as it is sailed.
 *
 * What goes in the file is what the server sent, message for message, plus what the
 * sailors sent back. A replayer needs no simulation of its own: the stream it reads is
 * the stream the clients read, so playing it back to the game is enough to watch a race
 * again. The helm messages are there as well, small as they are, because when the
 * question is why a boat did something the answer is what its sailor asked for.
 *
 * A race is a file. It opens on the `racing` that carries a seed this logbook has not
 * seen — a late arrival is sent the same seed, and is not a new race — and closes on the
 * result, or on the next race starting if it never reached one.
 */
export class Logbook {
  private open: Open | undefined

  constructor(private readonly options: LogbookOptions) {}

  /** The race being written now, if there is one. */
  get racing(): string | undefined {
    return this.open?.id
  }

  sent(to: readonly string[], message: ServerMessage): void {
    if (message.kind === 'racing') this.maybeBegin(message)
    if (!this.open) return
    // Who it went to as well as what it was: most messages go to the whole fleet, and
    // the ones that go to one sailor are how a replayer knows what she alone was shown.
    this.line({ t: 'out', ms: this.since(), to, m: message })
    if (message.kind === 'results') this.over('scored', message.places)
  }

  heard(from: string, message: ClientMessage): void {
    if (!this.open) return
    this.line({ t: 'in', ms: this.since(), from, m: message })
  }

  /** Finish whatever is open, for a server being shut down rather than a race ending. */
  close(): void {
    if (this.open) this.over('abandoned')
  }

  private maybeBegin(message: Extract<ServerMessage, { kind: 'racing' }>): void {
    const seed = String(message.scenario.seed)
    if (this.open?.seed === seed) return
    if (this.open) this.over('abandoned')

    const began = this.options.now()
    this.open = {
      id: this.options.id(),
      seed,
      began,
      sailors: message.scenario.boats.map((boat) => ({ id: boat.id, name: boat.name })),
    }
    this.options.journal.begin(`${stamp(began)}-${this.open.id}.jsonl`)
    this.line({
      t: 'race',
      id: this.open.id,
      at: new Date(began).toISOString(),
      seed,
      sailors: this.open.sailors,
      scenario: message.scenario,
    })
  }

  private over(ending: Ending, places?: readonly Placing[]): void {
    const open = this.open
    if (!open) return
    const ended = this.options.now()
    const footer = {
      t: 'over',
      id: open.id,
      at: new Date(ended).toISOString(),
      ms: ended - open.began,
      ending,
      ...(places ? { places } : {}),
    }
    this.line(footer)
    this.options.journal.finish()
    // The index is what a replayer reads to find a race without opening every file.
    this.options.journal.index(
      JSON.stringify({
        id: open.id,
        file: `${stamp(open.began)}-${open.id}.jsonl`,
        from: new Date(open.began).toISOString(),
        to: new Date(ended).toISOString(),
        ms: ended - open.began,
        ending,
        sailors: open.sailors.map((sailor) => sailor.name),
      }),
    )
    this.open = undefined
  }

  private since(): number {
    return this.options.now() - (this.open?.began ?? 0)
  }

  private line(record: unknown): void {
    this.options.journal.write(JSON.stringify(record))
  }
}

/** Sortable by name, and no colons, which not every filesystem is happy to carry. */
function stamp(at: number): string {
  return new Date(at)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
}
