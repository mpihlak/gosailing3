# Known issues

Things that are wrong, or that will bite later, written down so they are not rediscovered.
Each entry says what it costs and what fixing it would mean, not just what it is.

## Boat speed does not predict time to the line

`GAME_PACE` (`src/apps/game/scenario.ts:14`) runs the simulation four of its seconds per
second of the player's, so boats cover four times the water per second on the clock. Speed
stays in honest polar knots and distances in meters, so the two no longer agree: the panel
showing 90 m to the line at 6.5 knots describes an arrival about 7 seconds away, where the
arithmetic says 27.

Nothing displayed is false on its own. What is lost is the player's ability to time a start
by reading the gauges against each other, which is most of what a start is. It will matter
as soon as starts are raced properly rather than sailed up to.

Three ways out, none of them another scale factor:

- A boat class that genuinely sails at that speed. A foiling boat doing 25 knots makes
  speed, distance and time consistent with no adjustment anywhere.
- A shorter course. Dividing the leg by the same factor as the pace takes the same real
  time at true speeds, at the cost of a course cramped enough that a boat is a sizeable
  part of it and there is little left to scroll.
- Accept it and add a time-to-line instrument that does the sum correctly, so the player
  reads the answer instead of computing it.

The same pace makes the wind shift four times as often against the clock: the 45 to 110
second periods in `createRaceWind` (`src/domain/wind/presets.ts:47`) arrive every 11 to 27
seconds of the player's time. This may well be part of why the faster pace plays better,
so it is recorded rather than called a fault.

## The AI clips marks

The skipper touches the mark it is rounding in about one race in eight: 5 of 40 across
eight seeds and five wind speeds, all of which finish. It costs a penalty and a little
speed, and it looks careless.

`ROUNDING_OFFSET` in `src/agents/ai/navigator.ts` is the width the AI aims to leave. A
fixed clearance is the wrong shape for the problem: what is needed scales with how fast
the boat is going and how hard she is turning. This is worth tuning in the lab rather than
by guessing at the constant.

## The HUD and the renderer have no tests

The test environment is Node with no DOM (`vite.config.ts:19`), so `presentation/ui` and
`presentation/render` are exercised by nothing. Everything below them is covered.

This is not theoretical. A bug shipped straight through the gap: the HUD looked for the
banner element inside the instrument panel, did not find it, and silently fell back to the
panel itself, so the first banner replaced all ten gauges with a line of text. A DOM
environment such as `happy-dom` would let the panel wiring be tested, and would catch that
whole class of fault.

The renderer is a harder case and probably wants screenshot comparison rather than unit
tests, which is a job for the lab.

## Penalties are only for contact

A boat is judged when two hulls touch. Real umpiring penalises a boat who fails to keep
clear whether or not there is contact, so an AI boat can force a right-of-way boat to
dodge and pay nothing for it, and a player can do the same.

Rules 13 (while tacking), 14 (avoiding contact) and 15 and 16, which limit what a
right-of-way boat may do, are not in either. A boat who tacks into someone is judged on
the tack she ends up on, and a right-of-way boat may hold her course into a collision and
be blameless.

Penalties cancelling one for one is defined between the two boats in the incident, which
is what match racing means by it. With three boats or more it is undefined.
