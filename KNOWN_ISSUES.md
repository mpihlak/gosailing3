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

## The HUD and the renderer have little testing

The tests run in Node with no DOM, which is what keeps them fast, so most of
`presentation/ui` and `presentation/render` is exercised only through the pure functions
pulled out of it — the boom angle, the telltale lift, the camera, the clocks.

One smoke test starts the game against the real page in `happy-dom` and checks that it
comes up, draws, and puts its first card on the screen. That is there because the wiring
broke twice without anything noticing: a HUD that wrote its banner over its own gauges,
and a variable read while the module was still being evaluated, which left a blank screen.
Four hundred passing tests said nothing either time, because nothing loaded the page.

What is still uncovered is whether any of it looks right. That wants screenshot
comparison, which is a job for the lab.

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

## There is no race log

A race cannot be replayed or picked apart after the fact. The pieces are in place —
the simulation is a pure function of a seed and a tick-by-tick input frame, and a
snapshot serializes — so recording one is a matter of writing the frames down beside the
scenario, with periodic snapshots to seek by and the umpire's working saved at each
incident.

Without it, a wrong penalty can only be investigated by reproducing it, and a penalty
turn counted over seven minutes of sailing went unnoticed until someone watched a boat
and thought her turn looked wrong.

TODO: a recorder wrapping the runner, and a lab scene to scrub it.

## The AI does not see wind shadows

Boats take the wind out of the water behind them, and the AI takes no account of it. She
will sail into another boat's dirty air and stay there, and she will never place her own
to hold anyone off. Covering an opponent is most of what match racing is, so she is
playing a different game from the one the rules describe.

`shade` in `domain/wind` is the same function a tactical tier would consult, so the piece
is there; deciding what to do about it is the work.

## A boat going back to start does not have to keep clear

Rule 21.1 puts the whole burden on a boat returning to the pre-start side: she keeps clear
of boats that have started or are starting, and it does not matter which tack anyone is
on. None of that is modelled. A boat dipping back is judged by the ordinary right of way
rules, so she can sail through a boat who has just started and the turn may land on the
boat in the right.

Tolerable while there is one opponent, who starts on port and so owes the turn under rule
10 in most of the meetings this produces. A fleet would make it obvious.

## A boat can sail past the end of the line and never start

Starting needs a crossing of the line between its marks. A boat who has been wholly behind
the line is entitled to the course side, so once she has been there she is never called
over early — and if she then leaves across the extension beyond an end rather than between
the marks, nothing stops her. She is not started, not over early, and not coming back.

She sails away and the race cannot finish, because it ends only when every boat is home.
The AI does this from a position up by the committee boat with no countdown left to sort
herself out in: close-hauled on port from there crosses the extension, not the line.

The start strategy's own tests record the near relation of this, where she is called over
early first and recovers.
