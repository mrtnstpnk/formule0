# Formule

A pen-and-paper racing game for 1–4 players on one phone or tablet,
played solo or hot-seat. Based on the classic paper game where each player draws one quick
stroke per turn to move their car around a closed circuit shaped like the
modern Automotodrom Brno. Cross a wall and you crash; complete one clockwise
lap in the fewest turns to win, with an equal-turn final chance for later starters.

Buildless browser game: `index.html`, `menu.css`, HTML5 canvas, and
shared circuit geometry in `track/brno-circuit.js`. No frameworks or build step.

## Main menu and settings

The Czech-language home screen opens before the race. Choose **Nový závod**
to start, **Nastavení** to adjust the game, or **O hře** for rules and game
information. The home screen previews the same Brno circuit used in the race.

Settings include difficulty (**Lehká**: 800 ms, **Střední**: 500 ms,
**Těžká**: 300 ms per turn), player count (1–4), the visual countdown and the
pre-race hint. The defaults are **Střední** (500 ms) and two players.
Player count applies to a new race; changing it does not alter a race that
is already in progress. Each player has a separate color and lap progress.
In solo mode, every turn belongs to the same player until the lap is complete.
Changes save automatically in this browser, with an **Obnovit výchozí**
button to restore defaults. If browser storage is unavailable, settings
still work for the current session.

During a race, **Menu** returns home and **Pokračovat v závodě** resumes it.
Opening the menu during a stroke commits that stroke at its last accepted
point and ends the turn; the timer does not run behind the menu. **Nový závod**
and **Restart** clear the race. Escape returns to the menu or resumes a race
from home. Rotating or resizing preserves car positions, stroke history,
end-of-turn crosses and lap progress. An active stroke ends at its last accepted
point before the geometry changes; the race then continues in the new layout.
If the browser loses a canvas drawing context, the active turn ends once at its
last accepted point. New turns wait until drawing is restored; car positions,
stroke history and lap progress remain in memory. Both the track artwork and
the canvas scale are rebuilt on restoration. The cached track canvas is reused
across layout changes, and a failed animation frame does not stop the turn timer.

## How to play

- Players take turns. On your turn, draw **one fast stroke** with your
  finger (or mouse) to move your car.
- Touch inside the circle around your car to start a stroke — the very
  first stroke of the game may start anywhere in the green start zone.
- By default a stroke lasts 0.5 seconds; a shrinking ring shows how much time
  is left. Going fast covers more ground but is riskier.
- Touch a wall and you crash: the stroke is cut at the point of impact and
  the turn passes to the other player. Your next stroke starts from the
  crash point.
- After a crash, the circle is centered on the wall and extends outside the
  road. Its diameter matches the road width. Finger movement inside it is
  tolerated. Leave the circle into the road to resume driving; leaving it
  outside ends the turn at the original
  crash point. Normal wall collisions resume immediately after the first
  exit, including within the same fast movement. Releasing or running out
  of time inside the circle leaves the car in place.
- Stay inside the track and the turn simply passes after your stroke ends.
- Every stroke ends with a cross in that player's color, whether it stops
  inside the road or at a collision. Each diagonal is 60% of the original
  crash marker's length; crosses remain in place as part of the stroke history.
- Strokes and endpoint crosses in the current turn round are fully opaque.
  After the last racing player ends the round, that round fades to 60% opacity;
  all older rounds use 50%. Current car positions stay fully visible.
  Rounds continue to advance when finished players are skipped, and the final
  round fades to 60% when the race ends.
- Each player's most recent completed stroke uses 1% of the smaller play-area
  dimension, bounded to 3–8 CSS pixels. That player's earlier lines use 60%
  of that width (0.6% before those bounds), independently of round opacity.
  A stroke being drawn is also thick; the previous stroke becomes thin only
  when the new stroke ends. Finished players keep their final stroke thick.
- Follow the arrows clockwise around the entire circuit. The green start
  zone sits just before the shared start/finish line. Crossing it at the
  beginning does not win; you must complete a full lap first.
- Every completed lap opens an equal-turn phase for players still racing.
  Players with fewer turns get a chance to match the finisher's turn count.
  Once that phase is settled, finished players stop taking turns and the
  remaining players race on for the lower places.
- Crossing the finish does not end the stroke. Among finishers with the same
  turn count, the furthest final position along the road beyond the finish wins.
  Sideways movement adds no distance, reversing reduces it, and collisions
  still stop the stroke. Fewer turns always rank ahead of a longer finish distance
  on more turns. Equal turn counts and distances share a place (1, 1, 3).
- The race ends once everyone has finished, or only one unfinished player
  remains after the equal-turn chance. That player receives the last place
  without needing to finish. The result lists all players, their places and
  turn counts, and marks an unfinished last player as **Nedojel**.
- Going backwards across a lap gate before finishing clears lap progress.
  Tap **Odveta** to play again.
- The result appears beside the track in landscape or below it in portrait.
  The road remains fully visible at normal brightness, including the final
  strokes and car positions; the result panel has its own space.

## Running locally

No build step — just serve the file and open it:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser. Works with touch on
phones/tablets and with a mouse for desktop testing.

## Collision regression tests

With Node.js installed, run:

```bash
node --test tests/collision.test.cjs
```

These tests run the game's input handlers with a canvas stub and cover wall
collisions, touch tolerance and recovery after a crash, shortcuts, closed-wall
geometry, and complete laps in portrait and landscape layouts. They also verify that the playable
walls exactly match the approved preview and that each lap gate has only one
crossing of the circuit. No dependencies are required.
They also verify menu input isolation, race continuation, configurable turn
deadlines, new-race behavior and validation of saved settings. Rendering recovery
checks cover a failed frame, an invalid track cache and loss/restoration of one
or both canvas contexts without resetting lap progress or consuming extra turns.

## Brno circuit

The hand-placed outline is a simplified interpretation of the modern circuit
in the [official Automotodrom Brno map](https://www.automotodrombrno.cz/content/uploads/2019/07/CzechGP-mapa.pdf).
The playable circuit uses the approved 80-unit-wide layout, including its
asymmetric widening and smoothed corner transitions. On portrait screens the
whole plan rotates to use the available space while preserving its proportions.
The map is a reference; all geometry is bundled with the game and no map
services or third-party CDNs are used at runtime.

## Deploying to GitHub Pages

A workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
publishes the repository root to GitHub Pages on every push to `main`.

To enable it on GitHub:

1. Push this repository to GitHub.
2. In the repo settings, go to **Pages** and set **Source** to
   **GitHub Actions**.
3. Push to `main` (or run the workflow manually) — the site will be
   published at `https://<user>.github.io/<repo>/`.

## Code structure

`index.html` is organized into clearly separated sections:

- **Config** — tunables like stroke duration and player colors.
- **Game state machine** — `WAITING_FOR_TOUCH` → `DRAWING` →
  `WAITING_FOR_TOUCH` / `GAME_OVER`.
- **Geometry helpers** — segment intersection and point-in-polygon checks.
- **Track generation** — scales and rotates the approved shared geometry.
  Rendering and collisions use its exact closed wall polygons, with a green
  grid and shared start/finish stripe. The infield stays outside the road.
- **Rendering** — a pre-rendered static track layer plus per-frame
  strokes, end-of-turn crosses, and the stroke time indicator.
- **Input handling** — Pointer Events unify touch and mouse.
- **Game logic** — turn handling, crash detection, three ordered directional
  checkpoints per player, full-lap finish detection, and reset/rematch.

The prototype has one circuit. `track/brno-circuit.js` defines the layout and
exports the same geometry to both the game and the full design preview.

## Track design preview

[Full Brno circuit](previews/brno-full-circuit.html) completes all 14 turns at
the same 80-unit width, with turn 10 widened outward and a taller first hairpin
to make room for the final 11–14 sequence and lower start/finish straight.
The straights have parallel edges and smooth transitions into the bends.
Corner transitions are faired in physical distance to vary their curvature
gradually while retaining 80-unit cross-sections. The entry to turn 11 uses a
broader reference arc, and widening switches sides before the tight turn 7.

[Brno turns 1–9](previews/brno-turns-1-9.html) shows the proposed one-sided
widening from 40 to 80 relative units and the revised connecting straights.
Both previews let you toggle the original centerline to compare the layouts.
