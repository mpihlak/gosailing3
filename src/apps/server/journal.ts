import { appendFileSync, createWriteStream, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Journal } from './logbook'

/**
 * A logbook's lines on disk: a file for each race, and one index of all of them.
 *
 * The race file is a stream, because a race is thousands of lines and the tick loop
 * should not wait for a disk. The index is one short line when a race ends, appended
 * outright so a reader never finds it half written.
 */
export class Files implements Journal {
  private race: ReturnType<typeof createWriteStream> | undefined

  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true })
  }

  begin(name: string): void {
    this.finish()
    this.race = createWriteStream(join(this.directory, name), { flags: 'a' })
    // A disk that fills, or a directory that goes away, must not take the race with it.
    this.race.on('error', (trouble) => console.error('logbook', trouble.message))
  }

  write(line: string): void {
    this.race?.write(line + '\n')
  }

  finish(): void {
    this.race?.end()
    this.race = undefined
  }

  index(line: string): void {
    try {
      appendFileSync(join(this.directory, 'races.jsonl'), line + '\n')
    } catch (trouble) {
      console.error('logbook index', (trouble as Error).message)
    }
  }
}
