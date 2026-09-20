# Architecture

## The rule everything follows

The simulation is a pure function of (state, inputs, time step). It reads no clock, draws
no random numbers of its own, and touches no browser API.

That single constraint is what makes the rest work:

- AI boats produce the same `BoatInput` a keyboard produces, so the physics needs no
  special case for them.
- A race can be replayed, shared by seed, or re-run in a test and behave identically.
- The same code runs in Node, which is what a server would need.
- Every module below the presentation layer tests headless, in milliseconds.

ESLint enforces it. `Math.random`, `Date.now`, `new Date()` and the browser globals are
all errors inside `foundation`, `domain`, `sim` and `agents`.

## Layers

Dependencies point downward only, and ESLint enforces that too.

```
apps/          game, lab
presentation/  view, render, ui, input
agents/        ai, (rules, netcode)
sim/           step, race, scenario, runner, events
domain/        wind, polars, boat, course, collision
foundation/    geom, units, rng
```

### foundation

`Vec2` in meters with **x east and y north**. Angles are compass bearings: 0 is north,
increasing clockwise. The renderer is the only code that flips y for the screen.

`rng` is seeded and splittable. Streams are split by label, so adding an AI boat cannot
shift the wind and a stored replay keeps working when unrelated code starts drawing
random numbers.

### domain

Each module stands alone and knows nothing about a game loop.

**wind** is a pure function of position and time. All randomness is baked into a schedule
when the field is built, so a replay can be scrubbed backwards and a test can jump
straight to minute nine. Layers compose: a base wind, an oscillation, a gradient across
the course, and gusts that drift down it.

**polars** interpolates measured boat speed from a table. Angles closer to the wind than
the table measures are derived from the beat target.

**boat** turns a rudder position into a new position: turn rate answering the helm, speed
chasing the polar, rudder drag, and leeway. Tacking costs speed without any special case
for it — the polar gives near-zero speed through the no-go zone, and the boat's inertia
does the rest.

**course** holds marks, lines and the ordered list of stages to sail. A different course
shape is a different list of stages, not new code in the race logic.

**rules** answers who has right of way, under rules 10, 11 and 12. It is domain rather
than agent knowledge because two callers need the same answer: the simulation, to decide
who is penalised, and the AI, to keep clear in the first place.

**collision** reports overlaps. A hull is a capsule — its centreline plus half its beam —
because a boat is three times longer than it is wide and a circle round its middle is
wrong in both directions at once. Marks and obstacles are discs, and each says whether it
is solid or gives way. What a contact costs is a racing question, decided in `sim`.

### sim

`step()` is the only place that knows what order things happen in: wind, helm, boats,
contacts, race progress. Roughly forty lines.

`SimContext` holds what does not change during a race (course, wind, boat specs).
`WorldState` holds what does, as plain serializable data. Keeping them apart means a
snapshot survives `JSON.stringify`, which is what replay, networking and moving the
simulation into a worker all need.

Everything the simulation has to say is a `SimEvent`. The UI, the scoreboard, telemetry
and one day the rules engine all read events rather than inspecting state.

**A rounding** is judged by two crossings of the line through the mark square to the leg:
past the mark on the side that leaves it where the rules require, then back the other way
on the opposite side. It does not care whether the boat turned tightly or sailed a wide
arc, only that she went round.

`Scenario` is the one way a race comes into being. A unit test, a lab experiment, a replay
and the game itself all start from the same description.

### agents

Everything here produces inputs and sits outside the simulation looking in.

The AI is split so each tier tests on its own: **helm** holds a bearing, **navigator**
decides which bearing, and a **skipper** joins them. Tactics can be tested against a fixed
wind with no physics in the picture.

Getting off the line is its own problem with more than one answer, so it is a
`StartStrategy` rather than part of the navigator: given the boat, the wind, the line and
the time to the gun, it asks for a bearing. `trialStart` sails one headlessly and reports
what the start looked like — when she crossed, where on the line, on which tack, at what
speed, and whether she was recalled — so a strategy can be judged on outcomes rather than
on the shape of its code.

`netcode` is not built. The `InputSource` seam means a remote player looks like any
other helm when it is.

### presentation

`view/camera` is the only code that knows about pixels. `render` layers each take a
snapshot and a camera and nothing else, so a lab scene can draw one on its own. `ui` is
plain DOM — a leaderboard is a table, not something drawn by hand on a canvas.

## Adding things

| To add | Do this |
|---|---|
| A course shape | A new builder in `domain/course/layouts.ts` returning stages |
| A wind effect | A `WindModifier`, composed in `domain/wind/presets.ts` |
| A boat class | A `PolarTable` and a `BoatSpec` |
| An AI behavior | A tier in `agents/ai`, tested against a fixed wind |
| A way of starting | A `StartStrategy` in `agents/ai/start`, judged with `trialStart` |
| A racing rule | A pure function over two boats, in `domain/rules` |
| An instrument | A field in `presentation/ui/hud.ts` |

## What is not built

Racing rules, networking, the lab scenes, sound, and persistence. The seams for the first
two exist and are described above.
