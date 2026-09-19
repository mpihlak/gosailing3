# Go Sailing

A sailing race simulator that runs in the browser. Beat to the windward mark, round it,
and run back to the line.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Typecheck and build to `dist/` |
| `npm test` | Run the tests |
| `npm run test:watch` | Run them as you edit |
| `npm run lint` | Lint, including the architecture rules |
| `npm run format` | Format |

## Playing

| Key | Action |
|---|---|
| ← → or A D | Steer |
| Space | Start the countdown, and pause |
| R | A new race, with a new wind |
| H | Controls |

The gun is a minute after you start. Cross the line, leave the orange mark to port, and
come back through the line to finish. Crossing early means going back and crossing again.

The wind shifts, blows harder on one side of the course than the other, and carries gusts
down it. One end of the start line is favored. Both are worth watching.

Boats sail faster than they would on the water — the course takes about six and a half
minutes at true scale, which is a long time to sit through. `GAME_PACE` in
`src/apps/game/scenario.ts` sets how much faster, and every clock is divided back down by
it, so the timer counts real seconds. A race runs to roughly two minutes including the
countdown. `+` and `-` watch the race faster or slower; that is a debugging aid, not part
of the game.

## Layout

```
src/
  foundation/    vectors, angles, units, seeded randomness
  domain/        wind, polars, boat physics, course, collision
  sim/           the tick, the race state machine, scenarios, the runner
  agents/        AI boats
  presentation/  camera, canvas rendering, instruments, input
  apps/          the game, and the lab
```

`ARCHITECTURE.md` explains why it is arranged this way and where new work goes.
`KNOWN_ISSUES.md` lists what is wrong with it.
