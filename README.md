# Go Sailing

A sailing race simulator that runs in the browser. Beat to the windward mark, round it,
and run back to the line.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

| Command              | What it does                                |
| -------------------- | ------------------------------------------- |
| `npm run dev`        | Development server                          |
| `npm run build`      | Typecheck and build to `dist/`              |
| `npm test`           | Run the tests                               |
| `npm run test:watch` | Run them as you edit                        |
| `npm run lint`       | Lint, including the architecture rules      |
| `npm run format`     | Format                                      |
| `npm run server`     | The regatta server, on port 8080            |
| `npm run ai-player`  | Sailors who are not people, to race against |

## Racing against nobody

Opponents are not always to hand, so the game ships sailors who are not people. They
join a server over a socket like anyone else and steer by the messages it sends them —
no privileged view of the water, and the same lag a player has.

```sh
npm run server                                  # somewhere to race
npm run ai-player -- ws://localhost:8080 --count 2
```

They take alternate ends of the line, so a fleet of them starts on both tacks and
converges on the line from both directions rather than filing out together.

Two of them will start a race between themselves, which is enough to watch one sail. Add
yourself with `?server=ws://localhost:8080` and one of them is opponent enough. They say
what they are doing as they go:

```
11:13:47 Ann      2 leg 1+ 5.9kn
11:13:47 Bob      1 leg 1+ 6.6kn
11:14:37 Ann      2 leg 2 3.4kn 2 owed
```

Place, which leg they are on, `+` once they are round its mark, speed, and the turns they
owe. `--name` prefixes them if you want to tell two fleets apart.

## Playing

| Key        | Action                         |
| ---------- | ------------------------------ |
| ← → or A D | Steer                          |
| Space      | Start the countdown, and pause |
| R          | A new race, with a new wind    |
| W          | Show or hide the wind shadows  |
| L          | Show or hide the laylines      |
| H          | Controls                       |

On a phone, pull the tiller at the foot of the screen to steer — hold it over and she
keeps turning, let go and it centres. Tap the water to stop and carry on, and tap the card
to start.

The gun is thirty seconds after you start. Cross the line, leave the orange mark to port,
and come back through the line to finish. You start alongside one opponent, lying stern to
stern with you on the other tack. You sail the blue boat and race the red one. The race runs until you are both home, and then the
finishing order goes up. Crossing early means going back and crossing again.

The telltales beside the instruments are read against the angle that makes the most of the wind
you are in — the beat angle going up, the running angle coming down. Windward lifting
means you are too high, leeward too low, both streaming means you are on it.

The wind shifts, blows harder on one side of the course than the other, and carries gusts
down it. One end of the start line is favored. Both are worth watching.

Boats sail faster than they would on the water — the course takes about six and a half
minutes at true scale, which is a long time to sit through. `GAME_PACE` in
`src/apps/game/scenario.ts` sets how much faster, and every clock is divided back down by
it, so the timer counts real seconds. A race runs to roughly two minutes including the
countdown. Holding `Shift` runs it at twice that, for as long as you hold it.

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
