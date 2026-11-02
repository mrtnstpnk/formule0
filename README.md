# Formule

A two-player pen-and-paper racing game, playable hot-seat on one phone or
tablet. Based on the classic paper game where each player draws one quick
stroke per turn to move their car around a closed circuit shaped like the
modern Automotodrom Brno. Cross a wall and you crash; complete one clockwise
lap and cross the finish line first to win.

Buildless prototype: `index.html` with inline CSS/JS, HTML5 canvas, and a
vendored polygon-offset helper. No frameworks or installation step.

## How to play

- Players take turns. On your turn, draw **one fast stroke** with your
  finger (or mouse) to move your car.
- Your stroke must start exactly where your car currently is — the very
  first stroke of the game may start anywhere in the green start zone.
- The stroke lasts about 0.8 seconds; a shrinking ring shows how much time
  is left. Going fast covers more ground but is riskier.
- Touch a wall and you crash: the stroke is cut at the point of impact and
  the turn passes to the other player. Your next stroke starts from the
  crash point.
- Stay inside the track and the turn simply passes after your stroke ends.
- Follow the arrows clockwise around the entire circuit. The green start
  zone sits just before the shared start/finish line. Crossing it at the
  beginning does not win; you must complete a full lap first.
- First player to finish the lap wins. Going backwards across a lap gate
  clears lap progress. Tap **Rematch** to play again.

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
collisions, recovery after a crash, shortcuts, closed-wall geometry, visible road
width, unique lap gates, and complete laps in portrait and landscape layouts.
No dependency installation is required.

## Brno circuit

The hand-placed outline is a simplified interpretation of the modern circuit
in the [official Automotodrom Brno map](https://www.automotodrombrno.cz/content/uploads/2019/07/CzechGP-mapa.pdf).
Its centerline and proportions are preserved, with a wider road for finger
drawing. The current road is at least twice as wide on screen as the previous
28-unit half-width version, including after fitting it to the viewport.
On portrait screens the whole plan rotates to use the available space.

Wide hairpins need polygon offsets rather than simple normal offsets, which
would make the walls fold over themselves. `vendor/clipper.js` (Clipper 6.4.2.2)
trims those folds into closed contours; rendering and collision checks use the
same contours. Its original notices and licenses are retained in `vendor/`.
The library is served locally with the game; no third-party CDN or map service
is contacted at runtime.

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
- **Geometry helpers** — segment intersection, point-in-polygon,
  Catmull-Rom spline interpolation.
- **Track generation** — smooths a cyclic Brno centerline, samples it at
  uniform distances, and builds closed inner/outer walls, a green grid,
  and a shared start/finish stripe. The infield stays outside the road.
- **Rendering** — a pre-rendered static track layer plus per-frame
  strokes, crash markers, and the stroke time indicator.
- **Input handling** — Pointer Events unify touch and mouse.
- **Game logic** — turn handling, crash detection, three ordered directional
  checkpoints per player, full-lap finish detection, and reset/rematch.

The prototype has one circuit. Its outline is defined by `BRNO_ANCHORS` in
`index.html`; changing the anchors changes the shape of the closed lap.
